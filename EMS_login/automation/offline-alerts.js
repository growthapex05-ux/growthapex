// WhatsApp to an employee (and a copy in the team group) who stops working during office hours
// without checking out — checked every minute by the listener:
//  • offline       — checked in, but the dashboard has sent no heartbeat for OFFLINE_ALERT_MINUTES
//                    (60 min when they checked in from a phone: a locked phone stops heartbeats)
//  • auto check-out — the system checked them out (PC closed / disconnected) and they have not
//                    resumed work within AUTO_CHECKOUT_ALERT_MINUTES
//  • inactive      — online, but ActivityWatch has seen no mouse/keyboard on the laptop for
//                    INACTIVE_ALERT_MINUTES (screenActivity.afkSince, synced by the dashboard every 5 min)
// One message per offline episode (dedupe id), at most MAX_OFFLINE_ALERTS a day per employee.
// The EMS tab's own idle flag is not used: it only sees input on the EMS tab, so work in other tabs looks idle.

const P = require('../ems-payroll');
const { deliver, todayIST } = require('./outbox');
const { toChatId } = require('./reminders');

const OFFLINE_MIN = parseInt(process.env.OFFLINE_ALERT_MINUTES, 10) || 10;
const OFFLINE_MOBILE_MIN = parseInt(process.env.OFFLINE_ALERT_MOBILE_MINUTES, 10) || 60;
const AUTO_OUT_MIN = parseInt(process.env.AUTO_CHECKOUT_ALERT_MINUTES, 10) || 5;
const INACTIVE_MIN = parseInt(process.env.INACTIVE_ALERT_MINUTES, 10) || 30;
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
    const first = (emp.name || emp.id).split(' ')[0];
    const who = `*${emp.name}* (${emp.id})`;

    let alert = null;
    if (!has(rec.checkOut)) {
      const hb = Date.parse(rec.lastHeartbeat || '');
      if (isNaN(hb)) continue;
      const mins = Math.floor((Date.now() - hb) / 60000);
      const limit = rec.lastDevice && rec.lastDevice !== 'desktop' ? OFFLINE_MOBILE_MIN : OFFLINE_MIN;
      if (mins < limit) {
        // Online — but away from the laptop? (ActivityWatch AFK; data must be fresh)
        const act = rec.screenActivity;
        const afk = act && Date.parse(act.afkSince || '');
        const fresh = act && Date.now() - Date.parse(act.updatedAt || '') < 15 * 60000;
        if (!afk || !fresh) continue;
        const idleMin = Math.floor((Date.now() - afk) / 60000);
        if (idleMin < INACTIVE_MIN) continue;
        alert = {
          id: `inactive_${emp.id}_${date}_${act.afkSince}`,
          personal: `⏸️ *EMS Inactive Alert*

Hi ${first}, there has been no activity on your laptop for *${idleMin} min* (since ${timeIST(afk)}), but you are still checked in.

👉 If you are on a break, that's fine — otherwise please get back to work.
👉 If you have stopped for the day, please *Check-Out*.

_GrowthApex EMS_`,
          group: `⏸️ *EMS Inactive Alert*

${who} is checked in, but there has been no activity on their laptop for *${idleMin} min* (since ${timeIST(afk)}).

_GrowthApex EMS_`
        };
      } else alert = {
        id: `offline_${emp.id}_${date}_${rec.lastHeartbeat}`,
        personal: offlineMessage(first, mins, timeIST(hb)),
        group: `⚠️ *EMS Offline Alert*

${who} is checked in, but their EMS dashboard has been offline for *${mins} min* (last seen ${timeIST(hb)}).

_GrowthApex EMS_`
      };
    } else if (/^Auto-Checkout/.test(rec.checkoutReason || '')) {
      const outMin = P.timeToMinutes(rec.checkOut);
      if (outMin == null || now - outMin < AUTO_OUT_MIN || outMin >= minutesOf(WORK_END)) continue;
      const reason = rec.checkoutReason.replace(/^Auto-Checkout \(|\)$/g, '');
      alert = {
        id: `autoout_${emp.id}_${date}_${rec.checkOut}`,
        personal: autoCheckoutMessage(first, rec.checkOut, rec.checkoutReason),
        group: `🔌 *Auto Check-Out Alert*

${who} was automatically checked out at *${rec.checkOut}* (${reason}) during office hours and has not resumed work.

_GrowthApex EMS_`
      };
    }
    if (!alert) continue;
    if (dryRun) { console.log(`[dry-run] → ${emp.name}
${alert.personal}

[dry-run] → group
${alert.group}
`); continue; }

    // Personal message to the employee + a copy in the team group (each sent once per episode)
    const results = [];
    if (chatId) results.push(await deliver(db, { id: alert.id, type: 'reminder', message: alert.personal, chatId }));
    results.push(await deliver(db, { id: `${alert.id}_group`, type: 'alert', message: alert.group }));
    if (results.includes('sent')) {
      sentToday.set(key, (sentToday.get(key) || 0) + 1);
      console.log(`📲 [Offline alert] ${emp.name}: ${alert.id}`);
      sent++;
    }
  }
  return sent;
}

module.exports = { checkOfflineEmployees };
