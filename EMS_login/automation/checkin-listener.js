require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { initializeFirebase } = require('./report-generator');
const { deliver, flush } = require('./outbox');
const { sendReminders } = require('./reminders');
const { catchUpMissed, processReportRequests } = require('./catch-up');
const { checkOfflineEmployees } = require('./offline-alerts');

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

// Personal reminder times (HH:MM, IST)
function parseHHMM(str, fallback) {
  const [h, m] = String(str || fallback).split(':').map(n => parseInt(n, 10));
  return { h: isNaN(h) ? 0 : h, m: isNaN(m) ? 0 : m };
}
const remindIn = parseHHMM(process.env.REMIND_CHECKIN_TIME, '10:15');
const remindOut = parseHHMM(process.env.REMIND_CHECKOUT_TIME, '22:00');
const remindersDone = { checkin: '', checkout: '' };

function isPast(now, t) {
  return now.getHours() > t.h || (now.getHours() === t.h && now.getMinutes() >= t.m);
}

// "📱 *Device:* Mobile · Android Chrome"
function deviceLine(device) {
  if (!device || !device.type) return '';
  const icon = device.type === 'desktop' ? '💻' : '📱';
  const label = device.type.charAt(0).toUpperCase() + device.type.slice(1);
  return `${icon} *Device:* ${label}${device.os ? ` · ${device.os} ${device.browser || ''}` : ''}\n`;
}

const HOME_RADIUS_KM = 1;

// "📍 *Location:* https://maps... · 🏠 Ghar se 4.2 km door ⚠️"
function locationLine(att) {
  const loc = att.checkInLocation;
  if (!loc) return '';
  if (loc.error) return `📍 *Location:* ❌ ${loc.error === 'denied' ? 'Permission denied' : 'Not available'}\n`;
  const dist = att.checkInDistanceFromHomeKm;
  const home = dist == null ? ''
    : dist > HOME_RADIUS_KM ? ` · 🏠 ${dist} km from home ⚠️` : ' · 🏠 From home';
  return `📍 *Location:* https://www.google.com/maps?q=${loc.lat},${loc.lng}${home}\n`;
}

function networkLine(att) {
  if (att.checkInNetwork === 'office') return `🏢 *Network:* Office\n`;
  if (att.checkInNetwork === 'outside') return `🌐 *Network:* Outside office (${att.checkInIP})\n`;
  return '';
}

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
                          deviceLine(data.device) +
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
                          deviceLine(data.checkInDevice) +
                          locationLine(data) +
                          networkLine(data) +
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
      // Personal check-in / check-out reminders (once a day each; dedupe ids stop repeats after a restart)
      for (const [kind, t] of [['checkin', remindIn], ['checkout', remindOut]]) {
        if (isPast(now, t) && remindersDone[kind] !== currentTodayStr) {
          remindersDone[kind] = currentTodayStr;
          // Don't send a stale morning check-in reminder if the listener only starts late at night
          if (kind === 'checkin' && isPast(now, remindOut)) continue;
          console.log(`\n⏰ [Reminders] Sending ${kind} reminders for ${currentTodayStr}...`);
          await sendReminders(db, kind, currentTodayStr);
        }
      }

      if (pastTarget && now.getDay() !== 0 && lastDailyReportDate !== currentTodayStr) {
        lastDailyReportDate = currentTodayStr;
        console.log(`\n⏰ [Auto Scheduler] Daily Report for ${currentTodayStr}...`);
        await deliver(db, { id: `daily_${currentTodayStr}`, type: 'daily', date: currentTodayStr });
        await deliver(db, { id: `screen_${currentTodayStr}`, type: 'screen', date: currentTodayStr });
      }
    } catch (err) {
      console.error(`❌ [Auto Scheduler] Error:`, err.message);
    }
  }, 20000); // Check every 20 seconds

  // 6. Employees who went offline / were auto-checked-out during office hours -> personal WhatsApp
  let checkingOffline = false;
  const runOfflineCheck = async () => {
    if (checkingOffline) return;
    checkingOffline = true;
    try {
      await checkOfflineEmployees(db);
    } catch (err) {
      console.error('❌ [Offline alerts] Error:', err.message);
    } finally {
      checkingOffline = false;
    }
  };
  runOfflineCheck();
  setInterval(runOfflineCheck, 60 * 1000); // every minute

  // 5. "Send report now" button in the admin portal -> report_requests -> sent instantly
  // Requests that arrive while others are being sent are picked up straight after (not dropped)
  let handlingRequests = false;
  let requestsWaiting = false;
  db.collection('report_requests').where('status', '==', 'pending').onSnapshot(async (snap) => {
    if (snap.empty) return;
    if (handlingRequests) { requestsWaiting = true; return; }
    handlingRequests = true;
    try {
      do {
        requestsWaiting = false;
        await processReportRequests(db);
      } while (requestsWaiting);
    } catch (err) {
      console.error('❌ [Requests] Error:', err.message);
    } finally {
      handlingRequests = false;
    }
  }, (err) => console.error('❌ report_requests listener error:', err.message));

  // 4. Re-send anything that was queued while offline / while WhatsApp was unlinked
  let flushing = false;
  setInterval(async () => {
    if (flushing) return;
    flushing = true;
    try {
      await flush(db);
      await catchUpMissed(db); // any report missed while the PC was off / offline
    } catch (err) {
      console.error(`❌ [Queue] Flush error:`, err.message);
    } finally {
      flushing = false;
    }
  }, 5 * 60 * 1000);
}

startListener();
