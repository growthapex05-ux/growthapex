const admin = require('firebase-admin');
const serviceAccount = require('../../growthapex-f811b-firebase-adminsdk-fbsvc-7e9de58021.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkAttendance() {
  const snapshot = await db.collection('attendance').get();
  let results = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    // e.g. date: '2026-09-XX', status: 'leave', 'half-day', etc.
    if (data.date && data.date.startsWith('2026-09')) {
      if (data.status === 'leave' || data.status === 'half-day') {
        results.push({
          empId: data.empId,
          date: data.date,
          status: data.status,
          name: data.empName || 'Unknown' // if stored
        });
      }
    }
  });
  console.log("September Leave/Half-day Records:");
  console.log(JSON.stringify(results, null, 2));

  // also fetch employee names if missing
  if (results.length > 0 && results[0].name === 'Unknown') {
    const empSnapshot = await db.collection('employees').get();
    const emps = {};
    empSnapshot.forEach(doc => emps[doc.data().id] = doc.data().name);
    results = results.map(r => ({ ...r, name: emps[r.empId] || 'Unknown' }));
    console.log("With Names:");
    console.log(JSON.stringify(results, null, 2));
  }
}

checkAttendance().then(() => process.exit(0)).catch(console.error);
