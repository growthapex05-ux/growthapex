// Monthly attendance / leave / salary summaries for WhatsApp, using the same rules as the
// dashboards (../ems-payroll.js).
//  - groupSection(): attendance + leave balance per employee (no salaries — the group has employees in it)
//  - sendPersonalSalarySummaries(): each employee gets their own salary breakdown on their own number

const { deliver } = require('./outbox');
const { toChatId } = require('./reminders');

const money = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const num = n => (Number.isInteger(n) ? String(n) : Number(n).toFixed(1));

// reportMonth / loadSummaries / groupSection live in ../ems-reports.js (shared with the admin dashboard)
const { reportMonth, loadSummaries, groupSection } = require('../ems-reports');

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
