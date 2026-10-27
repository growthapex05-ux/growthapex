const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const gen = require('./report-generator');
const { sendReport } = require('./sender');

// Offline-safe delivery:
//  1. Every message has a stable id (e.g. daily_2026-10-27). A marker doc in Firestore
//     (automation_sent/{id}) makes sure it is sent only once, no matter whether GitHub
//     Actions, the Windows task or the listener gets there first.
//  2. If the PC is offline or WhatsApp sending fails, the message is saved in ./outbox
//     and re-sent automatically by flush() once the connection is back.

const OUTBOX_DIR = path.join(__dirname, 'outbox');
const SENT_COLLECTION = 'automation_sent';
const HOST = process.env.CI ? 'github-actions' : os.hostname();
const MAX_QUEUE_AGE_HOURS = parseFloat(process.env.MAX_QUEUE_AGE_HOURS) || 72;
const STALE_CLAIM_MS = 10 * 60 * 1000;
const RETRY_DELAYS_MS = [15000, 45000];

const BUILDERS = {
  daily: (db, date) => gen.generateDailyReport(db, date),
  login: (db, date) => gen.generateLoginReport(db, date),
  weekly: (db) => gen.generateWeeklyReport(db),
  monthly: (db) => gen.generateMonthlyReport(db)
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function safeId(id) {
  return String(id).replace(/[^\w-]/g, '_');
}

function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

// Real TCP connect (DNS alone can be answered from the Windows cache while offline)
function canReach(host, port = 443, timeoutMs = 5000) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

async function isOnline() {
  return canReach('firestore.googleapis.com');
}

async function waitForNetwork(maxMinutes = parseFloat(process.env.NETWORK_WAIT_MINUTES) || 10) {
  const deadline = Date.now() + maxMinutes * 60000;
  let warned = false;
  while (true) {
    if (await isOnline()) return true;
    if (Date.now() >= deadline) return false;
    if (!warned) {
      console.log(`🌐 No internet connection. Waiting up to ${maxMinutes} min for it to come back...`);
      warned = true;
    }
    await sleep(30000);
  }
}

// ---------- Firestore "sent once" markers ----------

async function claim(db, id, force) {
  const ref = db.collection(SENT_COLLECTION).doc(id);
  const marker = { status: 'sending', host: HOST, startedAt: Date.now() };
  try {
    await ref.create(marker);
    return 'claimed';
  } catch (err) {
    if (err.code !== 6) throw err; // 6 = ALREADY_EXISTS
  }
  const data = (await ref.get()).data() || {};
  if (!force && data.status === 'sent') return 'already-sent';
  if (!force && data.status === 'sending' && Date.now() - (data.startedAt || 0) < STALE_CLAIM_MS) return 'in-progress';
  await ref.set(marker);
  return 'claimed';
}

async function markSent(db, id, type) {
  await db.collection(SENT_COLLECTION).doc(id).set({ status: 'sent', type, host: HOST, sentAt: Date.now() });
}

async function releaseClaim(db, id) {
  try { await db.collection(SENT_COLLECTION).doc(id).delete(); } catch (_) {}
}

// ---------- Local queue ----------

function queuePath(id) {
  return path.join(OUTBOX_DIR, `${id}.json`);
}

function enqueue(item, error) {
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  const record = {
    id: item.id,
    type: item.type,
    date: item.date || null,
    message: item.message || null,
    createdAt: item.createdAt || Date.now(),
    attempts: (item.attempts || 0) + 1,
    lastError: error ? String(error.message || error) : null
  };
  fs.writeFileSync(queuePath(item.id), JSON.stringify(record, null, 2), 'utf8');
  console.log(`📥 Saved "${item.id}" to the offline queue. It will be sent automatically when sending works again.`);
}

function dequeue(id) {
  try { fs.unlinkSync(queuePath(id)); } catch (_) {}
}

function listQueued() {
  if (!fs.existsSync(OUTBOX_DIR)) return [];
  return fs.readdirSync(OUTBOX_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(OUTBOX_DIR, f), 'utf8')); } catch (_) { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// ---------- Sending ----------

async function sendWithRetry(message) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sendReport(message);
    } catch (err) {
      if (err.permanent || attempt >= RETRY_DELAYS_MS.length) throw err;
      const wait = RETRY_DELAYS_MS[attempt];
      console.warn(`⚠️ Send failed (${err.message}). Retrying in ${wait / 1000}s...`);
      await sleep(wait);
    }
  }
}

// item: { id, type, date?, message? } — message is built from `type` when missing.
// Returns 'sent' | 'already-sent' | 'in-progress' | 'queued'
async function deliver(db, item, { force = false } = {}) {
  item = { ...item, id: safeId(item.id) };

  if (!(await isOnline())) {
    enqueue(item, new Error('offline'));
    return 'queued';
  }

  let claimed = false;
  try {
    const state = await claim(db, item.id, force);
    if (state !== 'claimed') {
      console.log(`⏭️  "${item.id}" ${state === 'already-sent' ? 'was already sent' : 'is being sent by another runner'}. Skipping.`);
      dequeue(item.id);
      return state;
    }
    claimed = true;

    if (!item.message) {
      const build = BUILDERS[item.type];
      if (!build) throw new Error(`No report builder for type "${item.type}"`);
      console.log(`Generating ${item.type} report data...`);
      item.message = await build(db, item.date);
    }

    console.log(`Sending "${item.id}" to WhatsApp...`);
    await sendWithRetry(item.message);
    await markSent(db, item.id, item.type);
    dequeue(item.id);
    console.log(`✅ "${item.id}" delivered.`);
    return 'sent';
  } catch (err) {
    console.error(`❌ Could not deliver "${item.id}": ${err.message}`);
    if (claimed) await releaseClaim(db, item.id);
    enqueue(item, err);
    return 'queued';
  }
}

// Re-send everything waiting in the offline queue (oldest first)
async function flush(db) {
  const items = listQueued();
  if (!items.length) return { sent: 0, pending: 0 };
  if (!(await isOnline())) {
    console.log(`🌐 Still offline. ${items.length} message(s) waiting in the queue.`);
    return { sent: 0, pending: items.length };
  }

  console.log(`📤 Flushing ${items.length} queued message(s)...`);
  let sent = 0;
  for (const item of items) {
    const ageHours = (Date.now() - item.createdAt) / 3600000;
    if (ageHours > MAX_QUEUE_AGE_HOURS) {
      console.warn(`🗑️  Dropping "${item.id}" — older than ${MAX_QUEUE_AGE_HOURS}h.`);
      dequeue(item.id);
      continue;
    }
    const result = await deliver(db, item);
    if (result === 'sent') sent++;
    // Stop early if sending is broken (e.g. WhatsApp logged out) instead of hammering every item
    if (result === 'queued') break;
  }
  return { sent, pending: listQueued().length };
}

module.exports = {
  deliver,
  flush,
  enqueue,
  listQueued,
  isOnline,
  waitForNetwork,
  safeId,
  todayIST
};
