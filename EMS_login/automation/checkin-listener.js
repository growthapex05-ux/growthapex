const { initializeFirebase } = require('./report-generator');
const { sendReport } = require('./sender');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const db = initializeFirebase();

function formatDateString(date) {
  return date.toISOString().split('T')[0];
}

function isCheckInLate(checkInTime) {
  if (!checkInTime) return false;
  return checkInTime > '10:00:00';
}

const processedCheckIns = new Set();
const processedLogins = new Set();
let isInitialLoad = true;
let isInitialLoginLoad = true;

async function startListener() {
  const todayStr = formatDateString(new Date());
  console.log(`🤖 Starting Real-Time Employee Check-In & Login Listener for ${todayStr}...`);

  // Cache employee details
  const empSnap = await db.collection('employees').get();
  const employeeMap = {};
  empSnap.forEach(doc => {
    employeeMap[doc.id] = doc.data();
  });

  // 1. Listen to today's logins in Firestore real-time
  db.collection('logins')
    .where('date', '==', todayStr)
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
                          `🆔 *ID / Role:* ${data.empId} (${data.role.toUpperCase()})\n` +
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
        console.log(`⚡ Real-time login listener active.`);
      }
    }, (err) => {
      console.error("❌ Firestore Logins Snapshot Error:", err);
    });

  // 2. Listen to today's attendance changes in Firestore real-time
  db.collection('attendance')
    .where('date', '==', todayStr)
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
        console.log(`⚡ Real-time check-in listener active. Waiting for new employee logins & check-ins...`);
      }
    }, (err) => {
      console.error("❌ Firestore Attendance Snapshot Error:", err);
    });
}

startListener();
