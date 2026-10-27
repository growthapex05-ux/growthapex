#!/usr/bin/env node
// One-time security / tracking setup for the EMS (uses the Firebase Admin key in this folder).
//
//   node setup-security.js                    -> register every employee in staffEmails + empLogin
//                                                 (needed by firestore.rules and Employee-ID login)
//   node setup-security.js --check            -> show whether the live Firestore rules are the new ones
//   node setup-security.js --disable-resolver -> disable the old ems-system-resolver account
//                                                 (its password was public; run AFTER publishing the new rules)
//   node setup-security.js --office-ip=auto   -> save this network's public IP as the office network
//   node setup-security.js --office-ip=1.2.3.4,5.6.7.8
//   node setup-security.js --set-home=EMP001                 -> employee's home = their latest check-in location
//   node setup-security.js --set-home=EMP001 --date=2026-10-28  (use that day's check-in location)
//   node setup-security.js --set-home=EMP001 --lat=28.61 --lng=77.20
//   node setup-security.js --list-locations=EMP001           -> recent check-in locations, to pick the right one

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const path = require('path');
const axios = require('axios');
const admin = require('firebase-admin');
const parseArgs = require('minimist');
const { initializeFirebase } = require('./report-generator');

const argv = parseArgs(process.argv.slice(2), {
  boolean: ['check', 'disable-resolver'],
  string: ['office-ip', 'set-home', 'list-locations', 'date']
});
const RESOLVER_EMAIL = 'ems-system-resolver@growthapex.com';

async function registerStaff(db) {
  const snap = await db.collection('employees').get();
  const batch = db.batch();
  let count = 0;
  snap.forEach(doc => {
    const email = (doc.data().email || '').trim().toLowerCase();
    if (!email) {
      console.warn(`⚠️ ${doc.id} has no email — skipped`);
      return;
    }
    batch.set(db.collection('staffEmails').doc(email), { empId: doc.id, role: 'employee' });
    batch.set(db.collection('empLogin').doc(doc.id), { email });
    count++;
    console.log(`✅ ${doc.id} ${doc.data().name} registered`);
  });
  await batch.commit();
  console.log(`\n${count} employee(s) registered for login + data access.`);
}

async function checkRules() {
  const token = (await admin.app().options.credential.getAccessToken()).access_token;
  const projectId = admin.app().options.credential.projectId || require(path.resolve(__dirname, process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 'serviceAccountKey.json')).project_id;
  const headers = { Authorization: `Bearer ${token}` };
  const { data } = await axios.get(`https://firebaserules.googleapis.com/v1/projects/${projectId}/releases`, { headers });
  const rel = data.releases.find(r => r.name.endsWith('/cloud.firestore'));
  const rs = await axios.get(`https://firebaserules.googleapis.com/v1/${rel.rulesetName}`, { headers });
  const live = rs.data.source.files[0].content;
  const isNew = live.includes('staffEmails') && live.includes('empLogin');
  console.log(isNew
    ? '✅ Live Firestore rules are the NEW secure rules.'
    : '❌ Live Firestore rules are still the OLD ones (any signed-in user can read/write everything).\n   Paste firestore.rules into Firebase Console -> Firestore -> Rules -> Publish.');
  return isNew;
}

async function disableResolver() {
  if (!(await checkRules())) {
    console.log('⛔ Not disabling the resolver yet — publish the new rules first, or Employee-ID login on the old site breaks.');
    return;
  }
  try {
    const user = await admin.auth().getUserByEmail(RESOLVER_EMAIL);
    await admin.auth().updateUser(user.uid, { disabled: true });
    console.log(`✅ ${RESOLVER_EMAIL} disabled. The leaked password no longer works.`);
  } catch (e) {
    console.log(e.code === 'auth/user-not-found' ? 'Resolver account does not exist.' : `❌ ${e.message}`);
  }
}

async function checkInLocations(db, empId) {
  const snap = await db.collection('attendance').where('empId', '==', empId).get();
  return snap.docs.map(d => d.data())
    .filter(a => a.checkInLocation && !a.checkInLocation.error)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

async function listLocations(db, empId) {
  const rows = await checkInLocations(db, empId.toUpperCase());
  if (!rows.length) return console.log('No check-in locations recorded yet for', empId);
  rows.slice(0, 15).forEach(a => {
    const l = a.checkInLocation;
    console.log(`${a.date}  ${l.lat},${l.lng}  ±${l.accuracy}m  https://www.google.com/maps?q=${l.lat},${l.lng}`);
  });
}

async function setHome(db, empId) {
  empId = empId.toUpperCase();
  let home;
  if (argv.lat != null && argv.lng != null) {
    home = { lat: Number(argv.lat), lng: Number(argv.lng) };
  } else {
    const rows = await checkInLocations(db, empId);
    const pick = argv.date ? rows.find(a => a.date === argv.date) : rows[0];
    if (!pick) {
      console.log(`❌ No check-in location found for ${empId}${argv.date ? ` on ${argv.date}` : ''}. Ask them to check in once with location allowed.`);
      return;
    }
    home = { lat: pick.checkInLocation.lat, lng: pick.checkInLocation.lng, fromDate: pick.date };
    if (pick.checkInLocation.accuracy > 500) {
      console.warn(`⚠️ That location is only accurate to ±${pick.checkInLocation.accuracy}m (probably a PC). A phone check-in is more precise.`);
    }
  }
  await db.collection('employees').doc(empId).update({ homeLocation: { ...home, setAt: new Date().toISOString() } });
  console.log(`✅ ${empId} home set to ${home.lat},${home.lng} — https://www.google.com/maps?q=${home.lat},${home.lng}`);
}

async function setOfficeIp(db, value) {
  let ips = value.split(',').map(s => s.trim()).filter(Boolean);
  if (ips.length === 1 && ips[0] === 'auto') {
    const { data } = await axios.get('https://api.ipify.org?format=json', { timeout: 10000 });
    ips = [data.ip];
  }
  await db.collection('admin').doc('config').set({ officeIPs: ips }, { merge: true });
  console.log(`✅ Office network IP(s) saved: ${ips.join(', ')}`);
  console.log('   Check-ins from other networks will be flagged "Outside office" (not blocked).');
}

(async () => {
  const db = initializeFirebase();
  if (argv.check) await checkRules();
  else if (argv['disable-resolver']) await disableResolver();
  else if (argv['office-ip']) await setOfficeIp(db, argv['office-ip']);
  else if (argv['set-home']) await setHome(db, argv['set-home']);
  else if (argv['list-locations']) await listLocations(db, argv['list-locations']);
  else await registerStaff(db);
  process.exit(0);
})().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
