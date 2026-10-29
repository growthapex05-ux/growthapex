// Makes sure no attendance report is missed, and handles "send now" requests from the admin portal.
//
// catchUpMissed(): sends any daily (evening) report of the last few working days that never went out
//                  (PC was off, offline, task didn't run...), and today's morning report if it is due.
//                  Already-sent reports are skipped via the Firestore "sent" markers.
// processReportRequests(): admin portal writes report_requests/{id} = { type, date, status: 'pending' };
//                  this sends them (force re-send) and writes back status 'sent' / 'failed'.

const { deliver, todayIST } = require('./outbox');

const CATCH_UP_DAYS = parseInt(process.env.CATCH_UP_DAYS, 10) || 3;
// Reports before this date were sent by the old system without "sent" markers — never re-send them
const CATCH_UP_START_DATE = process.env.CATCH_UP_START_DATE || '2026-10-27';

function minutesOf(hhmm, fallback) {
  const [h, m] = String(hhmm || fallback).split(':').map(n => parseInt(n, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

function nowMinutesIST() {
  const t = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
}

const isSunday = dateStr => new Date(`${dateStr}T12:00:00`).getDay() === 0;

async function getHolidays(db) {
  try {
    const doc = await db.collection('admin').doc('config').get();
    return (doc.exists && doc.data().holidays) || [];
  } catch (_) {
    return [];
  }
}

async function catchUpMissed(db) {
  const today = todayIST();
  const now = nowMinutesIST();
  const dailyAt = minutesOf(process.env.DAILY_REPORT_TIME, '19:00');
  const morningAt = minutesOf(process.env.MORNING_REPORT_TIME, '11:00');
  const holidays = await getHolidays(db);
  const results = [];

  // Evening reports: older days first, today only once its time has passed
  for (let i = CATCH_UP_DAYS; i >= 0; i--) {
    const date = shiftDate(today, -i);
    if (date < CATCH_UP_START_DATE || isSunday(date) || holidays.includes(date)) continue;
    if (i === 0 && now < dailyAt) continue;
    results.push([`daily_${date}`, await deliver(db, { id: `daily_${date}`, type: 'daily', date })]);
  }

  // Today's morning report: only between its time and the evening report (a stale one is pointless)
  if (!isSunday(today) && !holidays.includes(today) && now >= morningAt && now < dailyAt) {
    results.push([`morning_${today}`, await deliver(db, { id: `morning_${today}`, type: 'login', date: today })]);
  }

  const sent = results.filter(([, r]) => r === 'sent').map(([id]) => id);
  if (sent.length) console.log(`📤 Catch-up sent: ${sent.join(', ')}`);
  return results;
}

const REQUEST_TYPES = { daily: 'daily', morning: 'login', login: 'login' };

async function processReportRequests(db) {
  const snap = await db.collection('report_requests').where('status', '==', 'pending').get();
  for (const doc of snap.docs) {
    const req = doc.data();
    const type = REQUEST_TYPES[req.type];
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.date || '') ? req.date : todayIST();
    if (!type) {
      await doc.ref.update({ status: 'failed', error: `Unknown type ${req.type}`, doneAt: Date.now() });
      continue;
    }
    await doc.ref.update({ status: 'sending', pickedAt: Date.now() });
    // Own id per request: using the scheduled id (daily_<date>) made a manual send during the day
    // mark that evening's automatic report as "already sent", so it never went out.
    const id = `manual_${type === 'login' ? 'morning' : 'daily'}_${date}_${doc.id}`;
    console.log(`📨 Admin request: ${req.type} report for ${date}`);
    const result = await deliver(db, { id, type, date }, { force: true });
    await doc.ref.update({
      status: result === 'sent' ? 'sent' : 'failed',
      result,
      error: result === 'sent' ? null : 'Not sent — the message is queued and will go out once internet/WhatsApp is back.',
      doneAt: Date.now()
    });
  }
  return snap.size;
}

module.exports = { catchUpMissed, processReportRequests };
