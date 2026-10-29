// Monthly attendance / leave / salary summaries for WhatsApp, using the same rules as the
// dashboards (../ems-payroll.js).
//  - groupSection(): attendance + leave balance per employee (no salaries — the group has employees in it)
//  - sendPersonalSalarySummaries(): each employee gets their own salary breakdown on their own number

const P = require('../ems-payroll');
const { deliver, todayIST } = require('./outbox');
const { toChatId } = require('./reminders');

const money = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const num = n => (Number.isInteger(n) ? String(n) : Number(n).toFixed(1));

// Same month rule as generateMonthlyReport: first 5 days of a month report on the previous month
function reportMonth(today = todayIST()) {
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(y, m - 1 - (d <= 5 ? 1 : 0), 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

async function loadSummaries(db, monthVal) {
  const [empSnap, attSnap, leaveSnap, cfgDoc] = await Promise.all([
    db.collection('employees').get(),
    db.collection('attendance').get(),
    db.collection('leaves').get(),
    db.collection('admin').doc('config').get()
  ]);
  const holidays = (cfgDoc.exists && cfgDoc.data().holidays) || [];
  const att = attSnap.docs.map(d => d.data());
  const leaves = leaveSnap.docs.map(d => d.data());
  return empSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(e => e.status === 'active')
    .map(emp => ({
      emp,
      s: P.monthSummary(emp, monthVal, att.filter(a => a.empId === emp.id),
                        leaves.filter(l => l.empId === emp.id), todayIST(), { holidays, team: P.teamCalendar(att) })
    }))
    .filter(x => x.s.joined);
}

async function groupSection(db, monthVal = reportMonth()) {
  const rows = await loadSummaries(db, monthVal);
  if (!rows.length) return '';
  const lines = rows.map(({ emp, s }) =>
    `👤 *${emp.name}*\n` +
    `   ✅ Present ${num(s.present)} · 🌗 Half ${num(s.halfDays)} · 🌴 Leave ${num(s.paidLeave + s.unpaidLeave)} · ❌ Absent ${num(s.absent)} · ⏰ Late ${num(s.late)}\n` +
    `   🏦 Leave balance: ${num(s.leave.balance)} days`
  );
  return `\n\n📋 *ATTENDANCE & LEAVE (${monthVal})*\n` + lines.join('\n') +
         `\n_Absent = working day with no check-in and no approved leave._`;
}

function personalMessage(emp, s) {
  const monthName = new Date(`${s.monthVal}-01T12:00:00`).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  const sal = s.salary;
  return `📊 *Your Monthly Summary — ${monthName}*\n\n` +
    `Hi ${(emp.name || '').split(' ')[0]},\n\n` +
    `*Attendance*\n` +
    `✅ Present: ${num(s.present)} · 🌗 Half day: ${num(s.halfDays)}\n` +
    `🌴 Leave: ${num(s.paidLeave)} paid, ${num(s.unpaidLeave)} unpaid\n` +
    `❌ Absent: ${num(s.absent)} · ⏰ Late: ${num(s.late)}\n` +
    `🏦 Leave balance: ${num(s.leave.balance)} days\n\n` +
    `*Salary*\n` +
    `Monthly salary: ${money(s.baseSalary)} (${money(s.perDay)}/day)\n` +
    `Deduction (${num(s.unpaidDays)} unpaid days): -${money(sal.deduction)}\n` +
    `Advance: -${money(sal.advance)}\n` +
    `*Net payable: ${money(sal.netPayable)}*\n\n` +
    `_Your salary slip will appear on the EMS portal once released. For any questions, please contact HR._`;
}

async function sendPersonalSalarySummaries(db, monthVal = reportMonth(), { dryRun = false } = {}) {
  const rows = await loadSummaries(db, monthVal);
  let sent = 0;
  for (const { emp, s } of rows) {
    const chatId = toChatId(emp.phone);
    if (!chatId) {
      console.warn(`⚠️ ${emp.name} has no valid phone — personal summary skipped.`);
      continue;
    }
    const message = personalMessage(emp, s);
    if (dryRun) {
      console.log(`\n[dry-run] → ${emp.name}\n${message}`);
      continue;
    }
    const r = await deliver(db, { id: `salary-summary_${emp.id}_${monthVal}`, type: 'salary-summary', message, chatId });
    if (r === 'sent') sent++;
  }
  console.log(`✅ Personal monthly summaries: ${sent} sent.`);
  return { sent };
}

module.exports = { groupSection, sendPersonalSalarySummaries, reportMonth };
