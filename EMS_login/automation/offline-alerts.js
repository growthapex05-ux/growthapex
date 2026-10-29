// Personal WhatsApp to an employee who stops working during office hours without checking out:
//  • offline       — checked in, but the dashboard has sent no heartbeat for OFFLINE_ALERT_MINUTES
//                    (60 min when they checked in from a phone: a locked phone stops heartbeats)
//  • auto check-out — the system checked them out (PC closed / disconnected) and they have not
//                    resumed work within AUTO_CHECKOUT_ALERT_MINUTES
// One message per offline episode (dedupe id), at most MAX_OFFLINE_ALERTS a day per employee.
// "Idle" is not used: it only sees mouse/keyboard on the EMS tab, so work in other tabs looks idle.

const P = require('../ems-payroll');
const { deliver, todayIST } = require('./outbox');
const { toChatId } = require('./reminders');

const OFFLINE_MIN = parseInt(process.env.OFFLINE_ALERT_MINUTES, 10) || 15;
const OFFLINE_MOBILE_MIN = parseInt(process.env.OFFLINE_ALERT_MOBILE_MINUTES, 10) || 60;
const AUTO_OUT_MIN = parseInt(process.env.AUTO_CHECKOUT_ALERT_MINUTES, 10) || 10;
const MAX_ALERTS = parseInt(process.env.MAX_OFFLINE_ALERTS, 10) || 3;
const WORK_START = process.env.WORK_START_TIME || '10:00';
const WORK_END = process.env.WORK_END_TIME || '19:00';

const has = t => t && t !== '—';
const sentToday = new Map(); // `${empId}_${date}` -> count

function minutesOf(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

function nowMinutesIST() {
  const t = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function timeIST(iso) {
  return new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
}

function offlineMessage(first, mins, lastSeen) {
  return `⚠️ *EMS Offline Alert*\n\n` +
    `Hi ${first}, your EMS dashboard has been offline for *${mins} min* (last seen ${lastSeen}), but you are still checked in.\n\n` +
    `👉 If you are working, please open the EMS dashboard and keep it open.\n` +
    `👉 If you have stopped for the day, please *Check-Out*.\n\n` +
    `_GrowthApex EMS_`;
}

function autoCheckoutMessage(first, outTime, reason) {
  return `🔌 *Auto Check-Out Alert*\n\n` +
    `Hi ${first}, you were automatically checked out at *${outTime}* (${reason.replace(/^Auto-Checkout \(|\)$/g, '')}) during office hours.\n\n` +
    `👉 If you are still working, please open the EMS dashboard and tap *▶️ Resume Work*.\n\n` +
    `_GrowthApex EMS_`;
}

async function checkOfflineEmployees(db, { dryRun = false } = {}) {
  const date = todayIST();
  const now = nowMinutesIST();
  if (new Date(`${date}T12:00:00`).getDay() === 0) return 0;
  if (now < minutesOf(WORK_START) + OFFLINE_MIN || now >= minutesOf(WORK_END)) return 0;

  const [empSnap, attSnap, cfgDoc] = await Promise.all([
    db.collection('employees').get(),
    db.collection('attendance').where('date', '==', date).get(),
    db.collection('admin').doc('config').get()
  ]);
  const holidays = (cfgDoc.exists && cfgDoc.data().holidays) || [];
  if (holidays.includes(date)) return 0;
  const emps = {};
  empSnap.forEach(d => { if (d.data().status === 'active') emps[d.id] = { id: d.id, ...d.data() }; });

  let sent = 0;
  for (const doc of attSnap.docs) {
    const rec = doc.data();
    const emp = emps[rec.empId];
    if (!emp || !has(rec.checkIn)) continue;
    const key = `${emp.id}_${date}`;
    if ((sentToday.get(key) || 0) >= MAX_ALERTS) continue;
    const chatId = toChatId(emp.phone);
    if (!chatId) continue;
    const first = (emp.name || emp.id).split(' ')[0];

    let item = null;
    if (!has(rec.checkOut)) {
      const hb = Date.parse(rec.lastHeartbeat || '');
      if (isNaN(hb)) continue;
      const mins = Math.floor((Date.now() - hb) / 60000);
      const limit = rec.lastDevice && rec.lastDevice !== 'desktop' ? OFFLINE_MOBILE_MIN : OFFLINE_MIN;
      if (mins < limit) continue;
      item = { id: `offline_${emp.id}_${date}_${rec.lastHeartbeat}`, message: offlineMessage(first, mins, timeIST(hb)) };
    } else if (/^Auto-Checkout/.test(rec.checkoutReason || '')) {
      const outMin = P.timeToMinutes(rec.checkOut);
      if (outMin == null || now - outMin < AUTO_OUT_MIN || outMin >= minutesOf(WORK_END)) continue;
      item = { id: `autoout_${emp.id}_${date}_${rec.checkOut}`, message: autoCheckoutMessage(first, rec.checkOut, rec.checkoutReason) };
    }
    if (!item) continue;
    if (dryRun) { console.log(`[dry-run] → ${emp.name}
${item.message}
`); continue; }

    const result = await deliver(db, { ...item, type: 'reminder', chatId });
    if (result === 'sent') {
      sentToday.set(key, (sentToday.get(key) || 0) + 1);
      console.log(`📲 [Offline alert] ${emp.name}: ${item.id}`);
      sent++;
    }
  }
  return sent;
}

module.exports = { checkOfflineEmployees };
