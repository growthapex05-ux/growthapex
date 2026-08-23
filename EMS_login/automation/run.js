#!/usr/bin/env node

// Load environment variables from .env file
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const parseArgs = require('minimist');
const { 
  initializeFirebase, 
  generateDailyReport, 
  generateWeeklyReport, 
  generateMonthlyReport 
} = require('./report-generator');
const { sendReport } = require('./sender');

// Parse CLI arguments
// Example: node run.js --type=daily [--dry-run]
const argv = parseArgs(process.argv.slice(2), {
  string: ['type'],
  boolean: ['dry-run'],
  alias: { t: 'type', d: 'dry-run' }
});

async function main() {
  const reportType = (argv.type || '').toLowerCase();
  const isDryRun = !!argv['dry-run'];

  if (!['daily', 'weekly', 'monthly'].includes(reportType)) {
    console.error("❌ Error: Invalid or missing report type.");
    console.error("👉 Usage: node run.js --type=[daily|weekly|monthly] [--dry-run]");
    console.error("   Short aliases: node run.js -t daily -d");
    process.exit(1);
  }

  // Skip running the daily report on Sundays
  if (reportType === 'daily' && new Date().getDay() === 0) {
    console.log(`📅 Today is Sunday. Exclude Sunday from working days. Skipping daily report.`);
    process.exit(0);
  }

  console.log(`🤖 Starting EMS Report Automation`);
  console.log(`📊 Report Type: ${reportType.toUpperCase()}`);
  console.log(`⚙️  Dry Run: ${isDryRun ? 'ENABLED (Will only print to console)' : 'DISABLED (Will send to WhatsApp)'}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  let db;
  try {
    console.log("Connecting to Firebase...");
    db = initializeFirebase();
    console.log("✅ Connected to Firebase successfully!");
  } catch (err) {
    console.error("❌ Firebase Initialization Error:", err.message);
    process.exit(1);
  }

  let reportText = "";
  try {
    console.log(`Generating ${reportType} report data...`);
    if (reportType === 'daily') {
      reportText = await generateDailyReport(db);
    } else if (reportType === 'weekly') {
      reportText = await generateWeeklyReport(db);
    } else if (reportType === 'monthly') {
      reportText = await generateMonthlyReport(db);
    }
    console.log("✅ Report generated successfully!");
  } catch (err) {
    console.error("❌ Error generating report content:", err);
    process.exit(1);
  }

  console.log(`\n📄 Generated Message content:\n`);
  console.log(reportText);
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  if (isDryRun) {
    console.log("✨ Dry run completed. Message was NOT sent to WhatsApp.");
    process.exit(0);
  }

  try {
    console.log("Sending report to WhatsApp...");
    await sendReport(reportText);
    console.log("🚀 Report automation run completed successfully!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Failed to send report to WhatsApp:", err.message);
    process.exit(1);
  }
}

main();
