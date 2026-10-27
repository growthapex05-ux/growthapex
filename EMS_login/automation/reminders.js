// Personal WhatsApp reminders sent to each employee's own number (employees/{id}.phone):
//  - check-in reminder:  not checked in by REMIND_CHECKIN_TIME (default 10:15)
//  - check-out reminder: still checked in at REMIND_CHECKOUT_TIME (default 22:00)
// Skips Sundays, inactive employees and anyone on approved leave today.
// Each reminder has a stable id, so it is sent at most once per employee per day.

const { deliver, todayIST } = require('./outbox');

// "98765 43210" / "+91 98765-43210" / "098765..." -> "919876543210@c.us"
function toChatId(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = '91' + digits;
  return digits.length >= 11 && digits.length <= 15 ? `${digits}@c.us` : null;
}

function isOnLeave(leaves, empId, date) {
  return leaves.some(l => l.empId === empId && l.status === 'approved'
    && l.startDate <= date && date <= (l.endDate || l.startDate));
}

async function loadDay(db, date) {
  const [empSnap, attSnap, leaveSnap] = await Promise.all([
    db.collection('employees').get(),
    db.collection('attendance').where('date', '==', date).get(),
    db.collection('leaves').where('status', '==', 'approved').get()
  ]);
  const employees = empSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.status === 'active');
  const attendance = {};
  attSnap.forEach(d => { attendance[d.data().empId] = d.data(); });
  const leaves = leaveSnap.docs.map(d => d.data());
  return { employees, attendance, leaves };
}

async function sendReminders(db, kind, date = todayIST(), { dryRun = false } = {}) {
  if (new Date(`${date}T12:00:00`).getDay() === 0) {
    console.log(`📅 Sunday — no ${kind} reminders.`);
    return { sent: 0 };
  }
  const { employees, attendance, leaves } = await loadDay(db, date);
  let sent = 0;

  for (const emp of employees) {
    const att = attendance[emp.id];
    const checkedIn = att && att.checkIn && att.checkIn !== '—';
    const checkedOut = att && att.checkOut && att.checkOut !== '—';
    const firstName = (emp.name || emp.id).split(' ')[0];

    let message;
    if (kind === 'checkin') {
      if (checkedIn || (att && att.status === 'leave') || isOnLeave(leaves, emp.id, date)) continue;
      message = `⏰ *Check-In Reminder*\n\n` +
                `Hi ${firstName}, aapne aaj (${date}) abhi tak EMS par check-in nahi kiya hai.\n` +
                `👉 Please dashboard kholkar *Mark Check-In* karein.\n\n` +
                `_GrowthApex EMS_`;
    } else {
      if (!checkedIn || checkedOut) continue;
      message = `🔔 *Check-Out Reminder*\n\n` +
                `Hi ${firstName}, aap abhi bhi checked-in dikh rahe hain (Check-In: ${att.checkIn}).\n` +
                `👉 Kaam khatam ho gaya ho to please *Check-Out* aur EOD report bhar dein.\n\n` +
                `_GrowthApex EMS_`;
    }

    const chatId = toChatId(emp.phone);
    if (!chatId) {
      console.warn(`⚠️ ${emp.name} (${emp.id}) has no valid phone number — skipping ${kind} reminder.`);
      continue;
    }
    if (dryRun) {
      console.log(`[dry-run] Would send ${kind} reminder to ${emp.name} (${chatId.replace(/\d(?=\d{4})/g, '•')})`);
      continue;
    }
    const result = await deliver(db, { id: `remind-${kind}_${emp.id}_${date}`, type: 'reminder', message, chatId });
    if (result === 'sent') sent++;
  }
  console.log(`✅ ${kind} reminders done: ${sent} sent.`);
  return { sent };
}

module.exports = { sendReminders, toChatId };
