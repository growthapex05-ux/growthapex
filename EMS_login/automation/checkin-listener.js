require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { initializeFirebase } = require('./report-generator');
const { deliver, flush } = require('./outbox');

// Keep the 24/7 listener alive through network drops / unexpected errors
process.on('unhandledRejection', (err) => console.error('⚠️ Unhandled rejection:', err && err.message ? err.message : err));
process.on('uncaughtException', (err) => console.error('⚠️ Uncaught exception:', err && err.message ? err.message : err));

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

  // On a new day start fresh; on a re-subscribe after an error keep what we already alerted,
  // so check-ins that happened while disconnected are still sent.
  if (activeDateStr !== targetDateStr) {
    processedCheckIns.clear();
    processedLogins.clear();
    isInitialLoad = true;
    isInitialLoginLoad = true;
  }
  activeDateStr = targetDateStr;

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
          await deliver(db, { id: `login_${docId}`, type: 'alert', message });
        }
      }

      if (isInitialLoginLoad) {
        isInitialLoginLoad = false;
        console.log(`⚡ Real-time login listener active for ${activeDateStr}.`);
      }
    }, (err) => {
      console.error("❌ Firestore Logins Snapshot Error (will re-subscribe):", err.message);
      unsubLogins = null;
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
          
          await deliver(db, { id: `checkin_${key}`, type: 'alert', message });
        }
      }

      if (isInitialLoad) {
        isInitialLoad = false;
        console.log(`⚡ Real-time check-in listener active for ${activeDateStr}. Waiting for new employee logins & check-ins...`);
      }
    }, (err) => {
      console.error("❌ Firestore Attendance Snapshot Error (will re-subscribe):", err.message);
      unsubAttendance = null;
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
    try {
      const now = new Date();
      const currentTodayStr = getTodayDateStr();

      // Check if date rolled over to next day, or a listener died after a network error
      if (currentTodayStr !== activeDateStr) {
        console.log(`🔄 Date changed from ${activeDateStr} to ${currentTodayStr}. Refreshing real-time listeners...`);
        await updateEmployeeMap();
        setupListenersForDate(currentTodayStr);
      } else if (!unsubLogins || !unsubAttendance) {
        console.log(`🔁 Re-subscribing real-time listeners...`);
        setupListenersForDate(currentTodayStr);
      }

      // Send the daily report once it is past the target time (e.g. 19:00), skip Sundays (0).
      // If the PC was off/offline at that time it catches up later; the shared "sent" marker
      // stops duplicates with GitHub Actions and the Windows task.
      const pastTarget = now.getHours() > targetHour || (now.getHours() === targetHour && now.getMinutes() >= targetMin);
      if (pastTarget && now.getDay() !== 0 && lastDailyReportDate !== currentTodayStr) {
        lastDailyReportDate = currentTodayStr;
        console.log(`\n⏰ [Auto Scheduler] Daily Report for ${currentTodayStr}...`);
        await deliver(db, { id: `daily_${currentTodayStr}`, type: 'daily', date: currentTodayStr });
      }
    } catch (err) {
      console.error(`❌ [Auto Scheduler] Error:`, err.message);
    }
  }, 20000); // Check every 20 seconds

  // 4. Re-send anything that was queued while offline / while WhatsApp was unlinked
  let flushing = false;
  setInterval(async () => {
    if (flushing) return;
    flushing = true;
    try {
      await flush(db);
    } catch (err) {
      console.error(`❌ [Queue] Flush error:`, err.message);
    } finally {
      flushing = false;
    }
  }, 5 * 60 * 1000);
}

startListener();
