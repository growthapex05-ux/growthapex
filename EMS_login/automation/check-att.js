const admin = require('firebase-admin');
const serviceAccount = require('../../growthapex-f811b-firebase-adminsdk-fbsvc-7e9de58021.json');
const { cachedGet } = require('./cache');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkAttendance() {
  // Fetch attendance + employees IN PARALLEL (cached)
  const [snapshot, empSnapshot] = await Promise.all([
    cachedGet(db, 'attendance'),
    cachedGet(db, 'employees'),
  ]);

  // Build employee id→name map upfront
  const emps = {};
  empSnapshot.forEach(doc => {
    const d = doc.data();
    emps[d.id || doc.id] = d.name;
  });

  let results = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.date && data.date.startsWith('2026-09')) {
      if (data.status === 'leave' || data.status === 'half-day') {
        results.push({
          empId: data.empId,
          date:  data.date,
          status: data.status,
          name:  data.empName || emps[data.empId] || 'Unknown'
        });
      }
    }
  });

  console.log("September Leave/Half-day Records:");
  console.log(JSON.stringify(results, null, 2));
}

checkAttendance().then(() => process.exit(0)).catch(console.error);
