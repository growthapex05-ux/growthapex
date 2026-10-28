#!/usr/bin/env node

// Load environment variables from .env file
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const parseArgs = require('minimist');
const {
  initializeFirebase,
  generateWeeklyReport,
  generateMonthlyReport
} = require('./report-generator');
const { getGreenApiState } = require('./sender');
const { deliver, flush, enqueue, listQueued, isOnline, waitForNetwork, todayIST } = require('./outbox');
const { sendReminders } = require('./reminders');
const { groupSection, sendPersonalSalarySummaries } = require('./month-summary');
const { catchUpMissed, processReportRequests } = require('./catch-up');
const { buildAttendanceReport } = require('./attendance-report');

const REPORT_TYPES = ['daily', 'weekly', 'monthly', 'login'];
const REMINDER_TYPES = ['remind-checkin', 'remind-checkout'];

// Parse CLI arguments
// Example: node run.js --type=daily [--date=2026-08-26] [--dry-run] [--force]
//          node run.js --flush     (send queued messages + any missed report + admin "send now" requests)
//          node run.js --catch-up  (same as --flush)
//          node run.js --status    (check internet, WhatsApp link and queue)
const argv = parseArgs(process.argv.slice(2), {
  string: ['type', 'date'],
  boolean: ['dry-run', 'flush', 'status', 'force', 'catch-up'],
  alias: { t: 'type', d: 'dry-run', f: 'force' }
});

// Stable id per report so it is sent exactly once (shared by PC, listener and GitHub Actions)
function reportId(type, date) {
  const today = date || todayIST();
  if (type === 'daily') return `daily_${today}`;
  if (type === 'login') return `morning_${today}`;
  const d = new Date(`${today}T12:00:00`);
  if (type === 'weekly') {
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return `weekly_${monday.toLocaleDateString('en-CA')}`;
  }
  // monthly: first 5 days of a month report on the previous month (same rule as generateMonthlyReport)
  const m = new Date(d.getFullYear(), d.getMonth() - (d.getDate() <= 5 ? 1 : 0), 1);
  return `monthly_${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
}

async function showStatus() {
  const online = await isOnline();
  console.log(`🌐 Internet:      ${online ? '✅ online' : '❌ offline'}`);
  if (online && (process.env.PROVIDER || '').toLowerCase() === 'green-api') {
    try {
      const state = await getGreenApiState(process.env.GREEN_API_INSTANCE_ID, process.env.GREEN_API_TOKEN);
      console.log(`📱 Green-API:     ${state === 'authorized' ? '✅' : '❌'} ${state}`);
    } catch (err) {
      console.log(`📱 Green-API:     ❌ ${err.message}`);
    }
  }
  const queued = listQueued();
  console.log(`📥 Offline queue: ${queued.length} message(s)`);
  queued.forEach(q => console.log(`   • ${q.id} (attempts: ${q.attempts}, last error: ${q.lastError || '-'})`));
}

async function main() {
  if (argv['catch-up']) argv.flush = true;
  const reportType = (argv.type || '').toLowerCase();
  const targetDate = argv.date || null;
  const isDryRun = !!argv['dry-run'];

  if (argv.status) {
    await showStatus();
    process.exit(0);
  }

  if (!argv.flush && ![...REPORT_TYPES, ...REMINDER_TYPES].includes(reportType)) {
    console.error("❌ Error: Invalid or missing report type.");
    console.error("👉 Usage: node run.js --type=[daily|weekly|monthly|login|remind-checkin|remind-checkout] [--date=YYYY-MM-DD] [--dry-run] [--force]");
    console.error("         node run.js --flush | --status");
    console.error("   Short aliases: node run.js -t daily -d");
    process.exit(1);
  }

  // Skip running the daily/morning report on Sundays (unless explicit date specified)
  if (['daily', 'login'].includes(reportType) && !targetDate && new Date().getDay() === 0) {
    console.log(`📅 Today is Sunday. Exclude Sunday from working days. Skipping ${reportType} report.`);
    process.exit(0);
  }

  console.log(`\n🤖 Starting EMS Report Automation — ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  if (argv.flush) {
    console.log(`📤 Mode: FLUSH offline queue`);
  } else {
    console.log(`📊 Report Type: ${reportType.toUpperCase()}${targetDate ? ` (Date: ${targetDate})` : ''}`);
    console.log(`⚙️  Dry Run: ${isDryRun ? 'ENABLED (Will only print to console)' : 'DISABLED (Will send to WhatsApp)'}`);
  }
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const isReminder = REMINDER_TYPES.includes(reportType);
  const item = (argv.flush || isReminder) ? null : {
    id: reportId(reportType, targetDate),
    type: reportType,
    date: targetDate || (['daily', 'login'].includes(reportType) ? todayIST() : null)
  };

  // Wait a while for the connection; if it never comes, park the job in the offline queue
  if (!isDryRun && !(await waitForNetwork())) {
    if (item) enqueue(item, new Error('offline'));
    else console.log('🌐 Still offline. Queue will be flushed on the next run.');
    process.exit(0);
  }

  let db;
  try {
    console.log("Connecting to Firebase...");
    db = initializeFirebase();
    console.log("✅ Connected to Firebase successfully!");
  } catch (err) {
    console.error("❌ Firebase Initialization Error:", err.message);
    process.exit(1);
  }

  if (isReminder) {
    if (!isDryRun) await flush(db);
    await sendReminders(db, reportType.replace('remind-', ''), targetDate || todayIST(), { dryRun: isDryRun });
    process.exit(0);
  }

  if (isDryRun) {
    let reportText;
    try {
      console.log(`Generating ${reportType} report data...`);
      if (reportType === 'daily') reportText = await buildAttendanceReport(db, targetDate || todayIST(), { mode: 'evening' });
      else if (reportType === 'login') reportText = await buildAttendanceReport(db, targetDate || todayIST(), { mode: 'morning' });
      else if (reportType === 'weekly') reportText = await generateWeeklyReport(db);
      else {
        reportText = (await generateMonthlyReport(db)) + (await groupSection(db));
        await sendPersonalSalarySummaries(db, undefined, { dryRun: true });
      }
    } catch (err) {
      console.error("❌ Error generating report content:", err);
      process.exit(1);
    }
    console.log(`\n📄 Generated Message content:\n`);
    console.log(reportText);
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log("✨ Dry run completed. Message was NOT sent to WhatsApp.");
    process.exit(0);
  }

  // Send anything left over from earlier offline periods first
  const backlog = await flush(db);
  if (backlog.sent) console.log(`📤 Sent ${backlog.sent} queued message(s) from earlier.`);

  if (argv.flush) {
    // Also send any report that was missed and any "send now" request from the admin portal
    try {
      await processReportRequests(db);
      await catchUpMissed(db);
    } catch (err) {
      console.error('❌ Catch-up error:', err.message);
    }
    console.log(`🚀 Flush finished. ${listQueued().length} message(s) still waiting.`);
    process.exit(0);
  }

  const result = await deliver(db, item, { force: !!argv.force });

  // Monthly: each employee also gets their own attendance + salary breakdown, privately
  if (reportType === 'monthly') await sendPersonalSalarySummaries(db);
  if (result === 'queued') {
    console.log("⏳ Report could not be sent now — it is queued and will go out automatically.");
  } else {
    console.log("🚀 Report automation run completed successfully!");
  }
  process.exit(0);
}

main().catch(err => {
  console.error("❌ Unexpected error:", err);
  process.exit(1);
});
