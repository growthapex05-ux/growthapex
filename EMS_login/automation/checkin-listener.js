const { initializeFirebase, generateDailyReport } = require('./report-generator');
const { sendReport } = require('./sender');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const db = initializeFirebase();

function getTodayDateStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function isCheckInLate(checkInTime) {
  if (!checkInTime) return false;
  return checkInTime > '10:00:00';
}

let activeDateStr = '';
let unsubLogins = null;
let unsubAttendance = null;

const processedCheckIns = new Set();
const processedLogins = new Set();
let isInitialLoad = true;
let isInitialLoginLoad = true;

// Track last date auto daily report was sent to avoid duplicate sends
let lastDailyReportDate = '';

// Target schedule time for daily report (default 19:00 / 7:00 PM)
const timeStr = process.env.DAILY_REPORT_TIME || '19:00';
const [targetHourStr, targetMinStr] = timeStr.split(':');
const targetHour = parseInt(targetHourStr, 10) || 19;
const targetMin = parseInt(targetMinStr, 10) || 0;

let employeeMap = {};

async function updateEmployeeMap() {
  try {
    const empSnap = await db.collection('employees').get();
    empSnap.forEach(doc => {
      employeeMap[doc.id] = doc.data();
    });
  } catch (err) {
    console.error("⚠️ Error caching employee map:", err.message);
  }
}

function setupListenersForDate(targetDateStr) {
  if (activeDateStr === targetDateStr && unsubLogins && unsubAttendance) return;

  // Cleanup existing listeners if changing date
  if (unsubLogins) {
    try { unsubLogins(); } catch (_) {}
    unsubLogins = null;
  }
  if (unsubAttendance) {
    try { unsubAttendance(); } catch (_) {}
    unsubAttendance = null;
  }

  activeDateStr = targetDateStr;
  processedCheckIns.clear();
  processedLogins.clear();
  isInitialLoad = true;
  isInitialLoginLoad = true;

  console.log(`\n📅 Subscribing Real-Time Firestore Listeners for Date: ${activeDateStr} (IST)`);

  // 1. Listen to target date's logins in Firestore real-time
  unsubLogins = db.collection('logins')
    .where('date', '==', activeDateStr)
    .onSnapshot(async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (change.type === 'added') {
          const docId = change.doc.id;
          const data = change.doc.data();

          if (processedLogins.has(docId)) continue;
          processedLogins.add(docId);

          if (isInitialLoginLoad) {
            console.log(`ℹ️ [Initial Load] Recorded existing login: ${data.name} (${data.role})`);
            continue;
          }

          const message = `🔑 *EMS SYSTEM LOGIN ALERT* 🔑\n` +
                          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                          `👤 *User:* ${data.name}\n` +
                          `🆔 *ID / Role:* ${data.empId} (${(data.role || 'user').toUpperCase()})\n` +
                          `⏰ *Login Time:* ${data.loginTime}\n` +
                          `📅 *Date:* ${data.date}\n` +
                          `━━━━━━━━━━━━━━━━━━━━━━━━━━`;

          console.log(`\n📲 New Login Detected! Sending WhatsApp Alert for ${data.name}...`);
          try {
            await sendReport(message);
            console.log(`✅ WhatsApp Login Alert sent successfully for ${data.name}!`);
          } catch (err) {
            console.error(`❌ Failed to send Login Alert for ${data.name}:`, err.message);
          }
        }
      }

      if (isInitialLoginLoad) {
        isInitialLoginLoad = false;
        console.log(`⚡ Real-time login listener active for ${activeDateStr}.`);
      }
    }, (err) => {
      console.error("❌ Firestore Logins Snapshot Error:", err);
    });

  // 2. Listen to target date's attendance changes in Firestore real-time
  unsubAttendance = db.collection('attendance')
    .where('date', '==', activeDateStr)
    .onSnapshot(async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (change.type === 'added' || change.type === 'modified') {
          const data = change.doc.data();
          const empId = data.empId;
          const checkIn = data.checkIn;
          const key = `${empId}_${data.date}_${checkIn}`;

          // Skip if no checkIn or already processed
          if (!checkIn || processedCheckIns.has(key)) {
            continue;
          }

          // Mark as processed
          processedCheckIns.add(key);

          // On initial snapshot load, just record existing check-ins without sending messages
          if (isInitialLoad) {
            console.log(`ℹ️ [Initial Load] Recorded existing check-in: ${empId} at ${checkIn}`);
            continue;
          }

          // Fetch Employee Name
          let empName = employeeMap[empId]?.name;
          if (!empName) {
            const empDoc = await db.collection('employees').doc(empId).get();
            if (empDoc.exists) {
              empName = empDoc.data().name;
              employeeMap[empId] = empDoc.data();
            } else {
              empName = empId;
            }
          }

          const late = isCheckInLate(checkIn);
          const statusText = late ? '⏰ Late Check-In' : '✅ On Time';

          const message = `📍 *EMPLOYEE CHECK-IN ALERT* 📍\n` +
                          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                          `👤 *Employee:* ${empName}\n` +
                          `🆔 *ID:* ${empId}\n` +
                          `⏰ *Check-In Time:* ${checkIn}\n` +
                          `📅 *Date:* ${data.date}\n` +
                          `🚦 *Status:* ${statusText}\n` +
                          `━━━━━━━━━━━━━━━━━━━━━━━━━━`;

          console.log(`\n📲 New Check-in Detected! Sending WhatsApp Alert for ${empName} (${checkIn})...`);
          
          try {
            await sendReport(message);
            console.log(`✅ WhatsApp Check-in Alert sent successfully for ${empName}!`);
          } catch (err) {
            console.error(`❌ Failed to send Check-in Alert for ${empName}:`, err.message);
          }
        }
      }

      if (isInitialLoad) {
        isInitialLoad = false;
        console.log(`⚡ Real-time check-in listener active for ${activeDateStr}. Waiting for new employee logins & check-ins...`);
      }
    }, (err) => {
      console.error("❌ Firestore Attendance Snapshot Error:", err);
    });
}

async function startListener() {
  const initialTodayStr = getTodayDateStr();
  console.log(`🤖 Starting Real-Time Employee Check-In, Login Listener & Auto Daily Scheduler...`);
  console.log(`⏰ Daily Report Scheduled for ${timeStr} IST every day (except Sundays).`);

  await updateEmployeeMap();
  setupListenersForDate(initialTodayStr);

  // 3. Auto Daily Report Scheduler & Midnight Date Rollover Check
  setInterval(async () => {
    const now = new Date();
    const currentTodayStr = getTodayDateStr();

    // Check if date rolled over to next day
    if (currentTodayStr !== activeDateStr) {
      console.log(`🔄 Date changed from ${activeDateStr} to ${currentTodayStr}. Refreshing real-time listeners...`);
      await updateEmployeeMap();
      setupListenersForDate(currentTodayStr);
    }

    const hours = now.getHours();
    const minutes = now.getMinutes();

    // Trigger daily report at exact target HH:MM (e.g. 19:00 / 7:00 PM), skip Sundays (0)
    if (hours === targetHour && minutes === targetMin && now.getDay() !== 0 && lastDailyReportDate !== currentTodayStr) {
      lastDailyReportDate = currentTodayStr;
      console.log(`\n⏰ [Auto Scheduler] Triggering Scheduled Daily Report at ${timeStr} for ${currentTodayStr}...`);
      try {
        const report = await generateDailyReport(db);
        await sendReport(report);
        console.log(`✅ [Auto Scheduler] Daily Report sent successfully!`);
      } catch (err) {
        console.error(`❌ [Auto Scheduler] Failed to send Daily Report:`, err.message);
      }
    }
  }, 20000); // Check every 20 seconds
}

startListener();
