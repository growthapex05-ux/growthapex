// EMS (Firestore) access for the tracker: login, today's attendance, heartbeats, activity,
// screenshots and timesheets. Uses the same collections and field formats as the EMS website,
// so the admin dashboard and WhatsApp reports read tracker data without changes.
// Reads are kept to a minimum (free Firestore quota): the attendance doc is read once and then
// only written; it is re-read every 10 min to notice a check-out made elsewhere.
const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword, signOut } = require('firebase/auth');
const {
  getFirestore, doc, getDoc, getDocs, addDoc, updateDoc, setDoc, collection, query, where, increment, arrayUnion
} = require('firebase/firestore');
const { distanceKm } = require('./location');
const firebaseConfig = require('./firebase-config');

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const ONLINE_GAP_S = 120; // same rule as the website: longer gaps = offline, not counted

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const timeIST = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });

let me = null;            // { empId, name, email }
let today = null;         // { date, ref, data, readAt }
let lastBeatMs = 0;

async function login(idOrEmail, password) {
  let email = String(idOrEmail || '').trim();
  if (!email.includes('@')) {
    const lookup = await getDoc(doc(db, 'empLogin', email.toUpperCase()));
    if (!lookup.exists()) throw new Error('Employee ID not found');
    email = lookup.data().email;
  }
  email = email.toLowerCase();
  await signInWithEmailAndPassword(auth, email, password);
  const staff = await getDoc(doc(db, 'staffEmails', email));
  if (!staff.exists()) { await signOut(auth); throw new Error('This account is not registered as an employee'); }
  const empId = staff.data().empId;
  const emp = await getDoc(doc(db, 'employees', empId));
  me = { empId, email, name: (emp.exists() && emp.data().name) || empId, home: (emp.exists() && emp.data().homeLocation) || null };
  today = null;
  return me;
}

async function logout() {
  me = null; today = null;
  await signOut(auth).catch(() => {});
}

const isOpen = d => d && d.checkIn && d.checkIn !== '—' && (!d.checkOut || d.checkOut === '—');

// Today's attendance record (cached; re-read every 10 min or on a new day)
async function getToday(force = false) {
  const date = todayIST();
  if (!force && today && today.date === date && Date.now() - today.readAt < 10 * 60 * 1000) return today;
  const snap = await getDocs(query(collection(db, 'attendance'), where('empId', '==', me.empId), where('date', '==', date)));
  const d = snap.docs.find(x => x.data().checkIn && x.data().checkIn !== '—') || snap.docs[0];
  today = { date, ref: d ? d.ref : null, data: d ? d.data() : null, readAt: Date.now() };
  return today;
}

function device() {
  return { type: 'desktop', os: process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux', browser: 'Tracker app' };
}

async function checkIn() {
  const t = await getToday(true);
  const nowIso = new Date().toISOString();
  lastBeatMs = Date.now();
  if (isOpen(t.data)) return t.data;
  if (t.ref) {
    // Re-check-in after a check-out today: keep the first check-in time (same as "Resume Work")
    const upd = { status: 'present', checkOut: '—', checkoutReason: '', lastHeartbeat: nowIso, trackerHeartbeat: nowIso,
                  activityStatus: 'active', lastDevice: 'desktop', pcConnected: true };
    if (!t.data.checkIn || t.data.checkIn === '—') Object.assign(upd, { checkIn: timeIST(), workedSeconds: 0, checkInDevice: device() });
    await updateDoc(t.ref, upd);
    t.data = { ...t.data, ...upd };
  } else {
    const rec = {
      empId: me.empId, date: t.date, status: 'present', checkIn: timeIST(), checkOut: '—', checkoutReason: '',
      workedSeconds: 0, activeSeconds: 0, lastHeartbeat: nowIso, trackerHeartbeat: nowIso, activityStatus: 'active',
      lastDevice: 'desktop', pcConnected: true, checkInDevice: device(), source: 'tracker', markedAt: nowIso
    };
    t.ref = await addDoc(collection(db, 'attendance'), rec);
    t.data = rec;
  }
  return t.data;
}

async function checkOut(reason = '') {
  const t = await getToday(true);
  if (!t.ref || !isOpen(t.data)) return t.data;
  const gap = (Date.now() - lastBeatMs) / 1000;
  const upd = { checkOut: timeIST(), checkoutReason: reason, activityStatus: 'checked-out', pcConnected: false };
  if (gap > 0 && gap <= ONLINE_GAP_S) upd.workedSeconds = increment(Math.round(gap));
  await updateDoc(t.ref, upd);
  t.data = { ...t.data, ...upd, workedSeconds: Number(t.data.workedSeconds || 0) + (upd.workedSeconds ? Math.round(gap) : 0) };
  return t.data;
}

// Every minute while checked in. state: 'active' | 'idle' | 'break'
async function heartbeat(state) {
  const t = await getToday();
  if (!t.ref || !isOpen(t.data)) return t.data; // checked out elsewhere (website / admin)
  const now = Date.now();
  const gap = lastBeatMs ? (now - lastBeatMs) / 1000 : 0;
  lastBeatMs = now;
  const nowIso = new Date(now).toISOString();
  const upd = { lastHeartbeat: nowIso, trackerHeartbeat: nowIso, activityStatus: state, lastDevice: 'desktop', pcConnected: true };
  const add = gap > 0 && gap <= ONLINE_GAP_S ? Math.round(gap) : 0;
  if (add && state !== 'break') upd.workedSeconds = increment(add);
  if (add && state === 'active') upd.activeSeconds = increment(add);
  if (add && state === 'break') upd.breakSeconds = increment(add);
  await updateDoc(t.ref, upd);
  t.data = {
    ...t.data, ...upd,
    workedSeconds: Number(t.data.workedSeconds || 0) + (upd.workedSeconds ? add : 0),
    activeSeconds: Number(t.data.activeSeconds || 0) + (upd.activeSeconds ? add : 0),
    breakSeconds: Number(t.data.breakSeconds || 0) + (upd.breakSeconds ? add : 0)
  };
  return t.data;
}

async function saveActivity(screenActivity) {
  const t = await getToday();
  if (!t.ref) return;
  await updateDoc(t.ref, { screenActivity, screenActivityError: null });
}

// Live location (trackerLocation) + the day's route (locationTrail: a point when the laptop moved
// 100 m+ or every 30 min). The first fix also fills checkInLocation, the last one checkOutLocation,
// in the same shape the website stores, so the admin "📍 In / Out" links work for tracker check-ins.
async function saveLocation(loc, kind = 'live') {
  const t = await getToday();
  if (!t.ref) return;
  const upd = { trackerLocation: loc };
  if (!loc.error) {
    const point = { lat: +loc.lat.toFixed(5), lng: +loc.lng.toFixed(5), acc: loc.accuracy, src: loc.source, at: loc.at, place: loc.place || null };
    const trail = t.data.locationTrail || [];
    const prev = trail[trail.length - 1];
    if (!prev || distanceKm(prev, point) >= 0.1 || Date.parse(point.at) - Date.parse(prev.at) >= 30 * 60000 || kind !== 'live') {
      upd.locationTrail = arrayUnion(point);
      t.data.locationTrail = [...trail, point];
    }
    const field = { lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy, place: loc.place || null, source: loc.source, at: loc.at };
    const home = me.home ? distanceKm(me.home, loc) : null;
    if (kind === 'checkout') Object.assign(upd, { checkOutLocation: field, checkOutDistanceFromHomeKm: home });
    else if (!t.data.checkInLocation || t.data.checkInLocation.error) Object.assign(upd, { checkInLocation: field, checkInDistanceFromHomeKm: home });
  }
  await updateDoc(t.ref, upd);
  const { locationTrail, ...rest } = upd;
  Object.assign(t.data, rest);
}

async function saveScreenshot(shot) {
  await addDoc(collection(db, 'screenshots'), { empId: me.empId, name: me.name, date: todayIST(), ...shot });
}

async function saveTimesheet(entry) {
  await addDoc(collection(db, 'timesheets'), { empId: me.empId, name: me.name, ...entry });
}

async function saveStatus(status) {
  // Shown in the admin "ActivityWatch Setup" table too (screen_status/{empId})
  await setDoc(doc(db, 'screen_status', me.empId), {
    empId: me.empId, name: me.name, connected: true, reason: null, web: true, source: 'tracker',
    device: device(), at: new Date().toISOString(), ...status
  }, { merge: true });
}

// Admin settings: admin/config.tracker = { screenshotMinutes, flaggedSites: [...], projects: [...] }
async function getSettings() {
  const cfg = await getDoc(doc(db, 'admin', 'config'));
  return (cfg.exists() && cfg.data().tracker) || {};
}

module.exports = {
  login, logout, checkIn, checkOut, heartbeat, getToday, saveActivity, saveLocation, saveScreenshot, saveTimesheet,
  saveStatus, getSettings, isOpen, todayIST, timeIST, me: () => me, cached: () => today && today.data
};
