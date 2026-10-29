// ============================================================
// EMS Firebase Engine — GrowthApex Employee Management System
// Replaces: ems-db.js  (localStorage → Firebase Firestore + Auth)
// ============================================================
// DEPENDENCIES (loaded before this script in HTML):
//   firebase-app-compat.js, firebase-auth-compat.js,
//   firebase-firestore-compat.js, firebase-config.js
// ============================================================

// ── Shared helpers ──────────────────────────────────────────

/** Today's date (YYYY-MM-DD) in India time. toISOString() is UTC and gives yesterday before 5:30 AM. */
function emsToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/** Which device the employee is using: { type: 'mobile'|'tablet'|'desktop', os, browser } */
function emsDevice() {
  const ua = navigator.userAgent || '';
  const isTablet = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMobile = !isTablet && /Mobi|Android|iPhone|iPod/i.test(ua);
  const os = /Android/i.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iOS'
    : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS/i.test(ua) ? 'macOS'
    : /Linux/i.test(ua) ? 'Linux' : 'Other';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /SamsungBrowser/.test(ua) ? 'Samsung'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari' : 'Other';
  return { type: isTablet ? 'tablet' : (isMobile ? 'mobile' : 'desktop'), os, browser };
}

/**
 * Public IP of the current network and whether it is the office network.
 * Office IPs are set by the admin in Firestore: admin/config.officeIPs (array of strings).
 * Returns { ip, network: 'office'|'outside'|'unknown' } — never throws.
 */
let _emsNetworkCache = null;
async function emsNetwork() {
  if (_emsNetworkCache) return _emsNetworkCache;
  let ip = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch('https://api.ipify.org?format=json', { signal: ctrl.signal });
    clearTimeout(t);
    ip = (await res.json()).ip || null;
  } catch (_) {}
  let network = 'unknown';
  try {
    const cfg = await EMS_DB.getAdmin();
    const officeIPs = Array.isArray(cfg.officeIPs) ? cfg.officeIPs : [];
    if (ip && officeIPs.length) network = officeIPs.includes(ip) ? 'office' : 'outside';
  } catch (_) {}
  _emsNetworkCache = { ip, network };
  return _emsNetworkCache;
}

/**
 * One-time location for check-in / check-out (asks the browser's permission; no background tracking).
 * Returns { lat, lng, accuracy, at } or { error: 'denied'|'unavailable'|'timeout'|'unsupported' } — never throws.
 */
function emsLocation(timeoutMs = 12000) {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve({ error: 'unsupported' });
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat: +pos.coords.latitude.toFixed(6),
        lng: +pos.coords.longitude.toFixed(6),
        accuracy: Math.round(pos.coords.accuracy),
        at: new Date().toISOString()
      }),
      err => resolve({ error: err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 }
    );
  });
}

/** Straight-line distance in km between two {lat,lng} points (haversine) */
function emsDistanceKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return +(2 * R * Math.asin(Math.sqrt(h))).toFixed(2);
}

/** Location + distance from the employee's saved home (employees/{id}.homeLocation, set by the admin) */
async function emsLocationWithHome(empId) {
  const loc = await emsLocation();
  if (loc.error) return { location: loc, distanceFromHomeKm: null };
  let home = null;
  try { home = (await EMS_DB.getEmployee(empId))?.homeLocation || null; } catch (_) {}
  return { location: loc, distanceFromHomeKm: home ? emsDistanceKm(home, loc) : null };
}

/**
 * Worked (online) time for an attendance record, in seconds.
 * Only time while the dashboard was connected counts: heartbeats every 15s add the gap since the
 * previous one, and a gap longer than EMS_ONLINE_GAP_S means the employee was offline — not counted.
 * So 1h work, 4h offline, back online => the timer continues from 1h, not 5h.
 */
const EMS_ONLINE_GAP_S = 120;
function emsWorkedSeconds(rec, nowMs = Date.now()) {
  if (!rec) return 0;
  const base = Number(rec.workedSeconds ?? rec.activeSeconds ?? 0);
  const open = rec.checkIn && rec.checkIn !== '—' && (!rec.checkOut || rec.checkOut === '—');
  const hb = Date.parse(rec.lastHeartbeat || '');
  let live = 0;
  if (open && !isNaN(hb)) {
    const gap = (nowMs - hb) / 1000;
    if (gap >= 0 && gap <= EMS_ONLINE_GAP_S) live = gap;
  }
  return Math.max(0, Math.floor(base + live));
}

/**
 * App / website usage since `sinceMs`, read from ActivityWatch running on this laptop
 * (http://localhost:5600 — the employee installs it; its cors_origins must allow growthapex.in).
 * Only active (not-AFK) time counts. Browser time is split into websites when the
 * "ActivityWatch Web Watcher" extension is installed.
 * Returns { apps: [{ name, secs }], activeSecs, idleSecs, web: bool } or { error: 'not-running' | ... } — never throws.
 */
const EMS_AW_URLS = ['http://localhost:5600/api/0', 'http://127.0.0.1:5600/api/0'];
const EMS_BROWSERS = ['chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'vivaldi.exe',
  'Google Chrome', 'Microsoft Edge', 'Firefox', 'Brave Browser', 'Safari', 'Opera', 'Arc'];
async function emsScreenActivity(sinceMs, nowMs = Date.now()) {
  const awFetch = async (url, opts = {}) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try { return await fetch(url, { ...opts, signal: ctrl.signal }); } finally { clearTimeout(t); }
  };
  // Chrome's "local network access" permission for this site: granted | denied | prompt | unsupported
  let lna = 'unsupported';
  try { lna = (await navigator.permissions.query({ name: 'local-network-access' })).state; } catch (_) {}

  // Some laptops only answer on 127.0.0.1 (or only on localhost) — try both
  let buckets, base, lastErr = '';
  for (const url of EMS_AW_URLS) {
    try {
      const res = await awFetch(`${url}/buckets/`);
      if (!res.ok) { lastErr = `http-${res.status}`; continue; }
      buckets = Object.keys(await res.json());
      base = url;
      break;
    } catch (e) { lastErr = `${e.name}: ${e.message}`; }
  }
  if (!base) {
    // A no-cors request succeeds when ActivityWatch is running but growthapex.in is not in its
    // cors_origins yet (setup file not run) — tells the two cases apart.
    for (const url of EMS_AW_URLS) {
      try {
        await awFetch(`${url}/info`, { mode: 'no-cors' });
        return { error: 'setup-not-run', detail: lastErr, lna };
      } catch (_) {}
    }
    // not installed / not running, or Chrome blocked local network access
    return { error: lna === 'denied' ? 'chrome-blocked' : 'not-running', detail: lastErr, lna };
  }
  const pick = prefix => buckets.find(b => b.startsWith(prefix));
  const win = pick('aw-watcher-window_'), afk = pick('aw-watcher-afk_');
  if (!win || !afk) return { error: 'no-watchers' };
  const webBuckets = buckets.filter(b => b.startsWith('aw-watcher-web'));

  const q = JSON.stringify;
  const query = [
    `afk = flood(query_bucket(${q(afk)}));`,
    `not_afk = filter_keyvals(afk, "status", ["not-afk"]);`,
    `events = filter_period_intersect(flood(query_bucket(${q(win)})), not_afk);`,
    `apps = sort_by_duration(merge_events_by_keys(events, ["app"]));`,
    `afk_total = merge_events_by_keys(afk, ["status"]);`,
    `web = [];`,
    ...(webBuckets.length ? [
      `browser = filter_keyvals(events, "app", ${q(EMS_BROWSERS)});`,
      `web_raw = [];`,
      ...webBuckets.map(b => `web_raw = concat(web_raw, flood(query_bucket(${q(b)})));`),
      `web = sort_by_duration(merge_events_by_keys(split_url_events(filter_period_intersect(web_raw, browser)), ["$domain"]));`
    ] : []),
    `RETURN = {"apps": apps, "afk": afk_total, "web": web};`
  ];
  const iso = ms => new Date(ms).toISOString();
  let out;
  try {
    const res = await awFetch(`${base}/query/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeperiods: [`${iso(sinceMs)}/${iso(nowMs)}`], query })
    });
    if (!res.ok) return { error: `query-${res.status}` };
    out = (await res.json())[0];
  } catch (_) {
    return { error: 'query-failed' };
  }

  const status = s => (out.afk || []).filter(e => e.data.status === s).reduce((t, e) => t + e.duration, 0);
  const tally = {};
  const add = (name, secs) => { if (name && secs > 0) tally[name] = (tally[name] || 0) + secs; };
  const webSecs = (out.web || []).reduce((t, e) => t + e.duration, 0);
  (out.apps || []).forEach(e => {
    const app = String(e.data.app || '');
    // With the web watcher, browser time is shown per website instead (rest stays under the browser name)
    if (webSecs && EMS_BROWSERS.includes(app)) return;
    add(app.replace(/\.exe$/i, ''), e.duration);
  });
  (out.web || []).forEach(e => add(String(e.data.$domain || '').replace(/^www\./, ''), e.duration));
  if (webSecs) {
    const browserSecs = (out.apps || []).filter(e => EMS_BROWSERS.includes(String(e.data.app))).reduce((t, e) => t + e.duration, 0);
    add('Browser (other)', browserSecs - webSecs);
  }
  const apps = Object.entries(tally)
    .map(([name, secs]) => ({ name, secs: Math.round(secs) }))
    .filter(a => a.secs >= 60)
    .sort((a, b) => b.secs - a.secs)
    .slice(0, 15);

  // Away right now? (no mouse/keyboard on the whole laptop — ActivityWatch's AFK watcher)
  let afkSince = null;
  try {
    const res = await awFetch(`${base}/buckets/${encodeURIComponent(afk)}/events?limit=1`);
    const last = res.ok ? (await res.json())[0] : null;
    if (last && last.data && last.data.status === 'afk') afkSince = new Date(last.timestamp).toISOString();
  } catch (_) {}

  // What is on screen right now: last focused app, and the website if it is a browser
  let current = null;
  try {
    const lastOf = async b => {
      const res = await awFetch(`${base}/buckets/${encodeURIComponent(b)}/events?limit=1`);
      return res.ok ? (await res.json())[0] : null;
    };
    const w = await lastOf(win);
    if (w && w.data) {
      const app = String(w.data.app || '').replace(/\.exe$/i, '');
      let site = null;
      if (EMS_BROWSERS.includes(String(w.data.app)) && webBuckets.length) {
        const webs = (await Promise.all(webBuckets.map(lastOf))).filter(Boolean)
          .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
        try { if (webs[0]) site = new URL(webs[0].data.url).hostname.replace(/^www\./, ''); } catch (_) {}
      }
      current = { app, site, at: new Date(Date.parse(w.timestamp) + (w.duration || 0) * 1000).toISOString() };
    }
  } catch (_) {}

  // Separate lists for the admin popup: programs (browser = total) and websites (active tab only)
  const programs = (out.apps || [])
    .map(e => ({ name: String(e.data.app || '').replace(/\.exe$/i, ''), secs: Math.round(e.duration) }))
    .filter(a => a.name && a.secs >= 60).slice(0, 15);
  const sites = (out.web || [])
    .map(e => ({ name: String(e.data.$domain || '').replace(/^www\./, ''), secs: Math.round(e.duration) }))
    .filter(a => a.name && a.secs >= 30).slice(0, 25);

  return { apps, programs, sites, activeSecs: Math.round(status('not-afk')), idleSecs: Math.round(status('afk')), web: webBuckets.length > 0, afkSince, current };
}

/** "01 : 05 : 09" */
function emsClock(totalSecs) {
  const s = Math.max(0, Math.floor(totalSecs));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')} : ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} : ${String(s % 60).padStart(2, '0')}`;
}

const EMS_DB = {

  // ── Collection helpers ────────────────────────────────────
  _col(name) { return db.collection(name); },

  // Login lookups used by firestore.rules: staffEmails/{email} marks registered staff,
  // empLogin/{EMPID} lets the login page turn an Employee ID into an email.
  async _setLoginLookup(empId, email) {
    email = (email || '').trim().toLowerCase();
    if (!empId || !email) return;
    await this._col('staffEmails').doc(email).set({ empId, role: 'employee' });
    await this._col('empLogin').doc(empId).set({ email });
  },

  async _removeLoginLookup(empId, email) {
    email = (email || '').trim().toLowerCase();
    if (email) await this._col('staffEmails').doc(email).delete().catch(() => {});
    if (empId) await this._col('empLogin').doc(empId).delete().catch(() => {});
  },

  // ── Employees ─────────────────────────────────────────────

  /** Returns all employees as array */
  async getEmployees() {
    const snap = await this._col('employees').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  /** Returns single employee or null */
  async getEmployee(id) {
    if (!id) return null;
    const doc = await this._col('employees').doc(id.toUpperCase()).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  },

  /** Add new employee — auto-assigns next EMP ID (or uses customId if provided), creates Firebase Auth account */
  async addEmployee(data) {
    let empId;
    if (data.customId && data.customId.trim()) {
      // Admin-specified ID (e.g. EMP003)
      empId = data.customId.trim().toUpperCase();
      // Check if already taken
      const existing = await this._col('employees').doc(empId).get();
      if (existing.exists) throw new Error(`Employee ID ${empId} is already taken.`);
    } else {
      // Auto-generate next EMP ID
      const emps = await this.getEmployees();
      const nextNum = emps.length + 1;
      empId = 'EMP' + String(nextNum).padStart(3, '0');
    }

    const email   = data.email.trim().toLowerCase();
    const password = data.password;

    // Create Firebase Auth account on a secondary app, so the admin stays signed in
    // (createUserWithEmailAndPassword on the main app would switch the session to the new employee)
    try {
      const secondary = firebase.apps.find(a => a.name === 'ems-create-user')
        || firebase.initializeApp(firebase.app().options, 'ems-create-user');
      const cred = await secondary.auth().createUserWithEmailAndPassword(email, password);
      await cred.user.updateProfile({ displayName: data.name });
      await secondary.auth().signOut();
    } catch (e) {
      // Auth account may already exist — log and continue
      console.warn('Auth createUser warning:', e.message);
    }

    const { customId: _drop, ...restData } = data; // strip customId from stored fields
    const emp = {
      name:        restData.name,
      email:       email,
      phone:       restData.phone || '',
      department:  restData.department || 'General',
      designation: restData.designation || '',
      salary:      Number(restData.salary) || 0,
      joinDate:    restData.joinDate || emsToday(),
      status:      restData.status || 'active',
      createdAt:   new Date().toISOString(),
    };

    await this._col('employees').doc(empId).set(emp);
    await this._setLoginLookup(empId, email);
    return { id: empId, ...emp };
  },

  async updateEmployee(id, data) {
    // Never store password in Firestore
    const { password, ...safeData } = data;
    const before = await this.getEmployee(id);
    await this._col('employees').doc(id).update(safeData);
    if (safeData.email !== undefined) {
      const oldEmail = (before?.email || '').trim().toLowerCase();
      const newEmail = (safeData.email || '').trim().toLowerCase();
      if (oldEmail && oldEmail !== newEmail) await this._removeLoginLookup(null, oldEmail);
      await this._setLoginLookup(id, newEmail);
    }

    // If password supplied, update Firebase Auth password
    if (password && password.length >= 6) {
      const emp = await this.getEmployee(id);
      if (emp) {
        // Admin must re-auth or use Firebase Admin SDK for this.
        // For now, store a flag — password resets should be done via Firebase Auth console.
        console.warn('Password change for', id, '— use Firebase Auth console or Admin SDK.');
      }
    }
  },

  async deleteEmployee(id) {
    const emp = await this.getEmployee(id);
    await this._col('employees').doc(id).delete();
    await this._removeLoginLookup(id, emp?.email);
    // Note: Firebase Auth account deletion requires Admin SDK; handled separately
  },

  // ── Admin ─────────────────────────────────────────────────

  async getAdmin() {
    const doc = await this._col('admin').doc('config').get();
    return doc.exists ? doc.data() : {};
  },

  async updateAdmin(data) {
    await this._col('admin').doc('config').set(data, { merge: true });
  },

  // ── Attendance ────────────────────────────────────────────

  async getAttendance(empId) {
    let q = this._col('attendance');
    if (empId) q = q.where('empId', '==', empId);
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async markAttendance(rec) {
    // Check for existing record for empId + date
    const snap = await this._col('attendance')
      .where('empId', '==', rec.empId)
      .where('date',  '==', rec.date)
      .get();

    if (!snap.empty) {
      await snap.docs[0].ref.update(rec);
    } else {
      await this._col('attendance').add({ ...rec, markedAt: new Date().toISOString() });
    }
  },

  async getTodayAttendance(empId) {
    const today = emsToday();
    const snap  = await this._col('attendance')
      .where('empId', '==', empId)
      .where('date',  '==', today)
      .get();
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
  },

  async updateHeartbeat(empId, statusState = 'active') {
    const today = emsToday();
    const snap = await this._col('attendance')
      .where('empId', '==', empId)
      .where('date',  '==', today)
      .get();

    if (!snap.empty) {
      const doc = snap.docs[0];
      const data = doc.data();
      // Only heartbeat if employee is checked in and not checked out
      if (data.checkIn && (!data.checkOut || data.checkOut === '—')) {
        // Time since the previous heartbeat counts only if we were connected the whole time
        // (gap <= EMS_ONLINE_GAP_S). A longer gap = offline / phone locked / browser closed -> adds nothing.
        const prev = Date.parse(data.lastHeartbeat || '');
        const gap = isNaN(prev) ? 0 : (Date.now() - prev) / 1000;
        const onlineAdd = gap > 0 && gap <= EMS_ONLINE_GAP_S ? Math.round(gap) : 0;
        const activeAdd = statusState === 'active' ? onlineAdd : 0;
        const nowIso = new Date().toISOString();
        const update = {
          lastHeartbeat: nowIso,
          activityStatus: statusState,
          lastDevice: emsDevice().type,
          pcConnected: true
        };
        if (activeAdd) update.activeSeconds = firebase.firestore.FieldValue.increment(activeAdd);
        // Records from before online-time tracking start from their active time
        let worked;
        if (data.workedSeconds === undefined) {
          worked = Number(data.activeSeconds || 0) + onlineAdd;
          update.workedSeconds = worked;
        } else {
          worked = Number(data.workedSeconds) + onlineAdd;
          if (onlineAdd) update.workedSeconds = firebase.firestore.FieldValue.increment(onlineAdd);
        }
        await doc.ref.update(update);
        return { ...data, ...update, workedSeconds: worked, lastHeartbeat: nowIso,
                 activeSeconds: Number(data.activeSeconds || 0) + activeAdd };
      }
    }
  },

  async autoCheckoutDisconnected(empId, dateStr) {
    const today = dateStr || emsToday();
    const snap = await this._col('attendance')
      .where('empId', '==', empId)
      .where('date',  '==', today)
      .get();

    if (!snap.empty) {
      const doc = snap.docs[0];
      const data = doc.data();
      if (data.checkIn && (!data.checkOut || data.checkOut === '—')) {
        let outTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
        if (data.lastHeartbeat) {
          try {
            outTime = new Date(data.lastHeartbeat).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
          } catch(e) {}
        }
        await doc.ref.update({
          checkOut: outTime,
          checkoutReason: 'Auto-Checkout (PC Closed / Disconnected)',
          pcConnected: false,
          activityStatus: 'disconnected'
        });
        return { success: true, checkOut: outTime };
      }
    }
    return { success: false };
  },

  async processAutoCheckouts() {
    const today = emsToday();
    const snap = await this._col('attendance')
      .where('date', '==', today)
      .get();

    const now = Date.now();
    const TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes timeout (desktop)
    // Phones pause the page when locked / app switched, so heartbeats stop without the employee leaving.
    const MOBILE_TIMEOUT_MS = 90 * 60 * 1000;

    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.checkIn && (!data.checkOut || data.checkOut === '—') && data.lastHeartbeat) {
        const lastHbTime = new Date(data.lastHeartbeat).getTime();
        const device = data.lastDevice || data.checkInDevice?.type || 'desktop';
        const isMobile = device === 'mobile' || device === 'tablet';
        if (!isNaN(lastHbTime) && (now - lastHbTime > (isMobile ? MOBILE_TIMEOUT_MS : TIMEOUT_MS))) {
          let outTime = new Date(lastHbTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
          await doc.ref.update({
            checkOut: outTime,
            checkoutReason: isMobile ? 'Auto-Checkout (Mobile inactive 90 min)' : 'Auto-Checkout (PC Closed / Disconnected)',
            pcConnected: false,
            activityStatus: 'disconnected'
          });
        }
      }
    }
  },

  // ── Tasks ─────────────────────────────────────────────────

  async getTasks(empId) {
    let q = this._col('tasks');
    if (empId) q = q.where('empId', '==', empId);
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async addTask(task) {
    const ref = await this._col('tasks').add({ ...task, createdAt: new Date().toISOString() });
    return { id: ref.id, ...task };
  },

  async updateTask(id, data) {
    await this._col('tasks').doc(String(id)).update(data);
  },

  async deleteTask(id) {
    await this._col('tasks').doc(String(id)).delete();
  },

  // ── Leaves ────────────────────────────────────────────────

  async getLeaves(empId) {
    let q = this._col('leaves');
    if (empId) q = q.where('empId', '==', empId);
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async applyLeave(leave) {
    const ref = await this._col('leaves').add({
      ...leave,
      status: 'pending',
      appliedAt: new Date().toISOString(),
    });
    return { id: ref.id, ...leave, status: 'pending' };
  },

  async updateLeave(id, status) {
    await this._col('leaves').doc(String(id)).update({ status });
  },

  // ── Daily EOD Work Logs ───────────────────────────────────

  async getWorkLogs(empId) {
    let q = this._col('worklogs');
    if (empId) q = q.where('empId', '==', empId);
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async addWorkLog(log) {
    const ref = await this._col('worklogs').add({
      ...log,
      submittedAt: new Date().toISOString(),
    });
    return { id: ref.id, ...log };
  },

  async deleteWorkLog(logId) {
    if (!logId) return { success: false };
    await this._col('worklogs').doc(logId).delete();
    return { success: true };
  },

  // ── Expenses & Reimbursements ─────────────────────────────

  async getExpenses(empId) {
    let q = this._col('expenses');
    if (empId) q = q.where('empId', '==', empId);
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async addExpense(exp) {
    const ref = await this._col('expenses').add({
      ...exp,
      status: 'pending',
      submittedAt: new Date().toISOString(),
    });
    return { id: ref.id, ...exp, status: 'pending' };
  },

  async updateExpense(id, status) {
    await this._col('expenses').doc(String(id)).update({ status });
  },

  // ── Notice Board & Announcements ─────────────────────────

  async getAnnouncements() {
    const snap = await this._col('announcements').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async addAnnouncement(ann) {
    const ref = await this._col('announcements').add({
      ...ann,
      createdAt: new Date().toISOString(),
    });
    return { id: ref.id, ...ann };
  },

  async deleteAnnouncement(id) {
    await this._col('announcements').doc(String(id)).delete();
  },

  // ── Client Invoices & Quotations ──────────────────────────

  async getInvoices() {
    const snap = await this._col('invoices').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async addInvoice(inv) {
    const ref = await this._col('invoices').add({
      ...inv,
      createdAt: new Date().toISOString()
    });
    return { id: ref.id, ...inv };
  },

  async deleteInvoice(id) {
    await this._col('invoices').doc(String(id)).delete();
  },

  // ── Salary Releases ───────────────────────────────────────

  async getReleasedSalarySlips(empId) {
    let q = this._col('salary_releases');
    if (empId) q = q.where('empId', '==', empId.toUpperCase());
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async releaseSalarySlip(empId, monthVal, slipData) {
    const docId = `${empId.toUpperCase()}_${monthVal}`;
    await this._col('salary_releases').doc(docId).set({
      empId: empId.toUpperCase(),
      monthVal: monthVal,
      status: 'released',
      releasedAt: new Date().toISOString(),
      slipData: slipData || {}
    }, { merge: true });
    return { id: docId, status: 'released' };
  },

  async unreleaseSalarySlip(empId, monthVal) {
    const docId = `${empId.toUpperCase()}_${monthVal}`;
    await this._col('salary_releases').doc(docId).delete();
  },

  // ── Auth + Session ────────────────────────────────────────

  /**
   * Login Admin via Firebase Auth only — no pre-auth Firestore dependency.
   * Signs in directly, verifies email matches known admin, then sets session.
   */
  async loginAdmin(username, password) {
    // Known admin email (set during project setup)
    const ADMIN_EMAIL = 'growthapex05@gmail.com';

    try {
      // Use input directly if it looks like an email, otherwise use admin email
      const email = (username && username.includes('@')) ? username : ADMIN_EMAIL;

      // Sign in with Firebase Auth
      const cred = await auth.signInWithEmailAndPassword(email, password);

      // Verify the signed-in account is the admin account
      if (cred.user.email !== ADMIN_EMAIL) {
        await auth.signOut();
        return false;
      }

      // Optionally enrich session with Firestore data (non-blocking)
      let adminName = 'GrowthApex Admin';
      try {
        const adminDoc = await this.getAdmin();
        if (adminDoc && adminDoc.name) adminName = adminDoc.name;
      } catch (_) { /* Firestore enrichment optional */ }

      this.setSession({
        role:  'admin',
        name:  adminName,
        email: cred.user.email,
      });
      return true;
    } catch (e) {
      console.error('loginAdmin error:', e.message);
      return false;
    }
  },

  /**
   * Login Employee via Firebase Auth.
   * Strategy: look up employee by EMP ID → get email → signIn with email+password
   */
  async loginEmployee(empId, password) {
    try {
      const emp = await this.getEmployee(empId.toUpperCase());
      if (!emp || emp.status !== 'active') return false;

      await auth.signInWithEmailAndPassword(emp.email, password);

      this.setSession({
        role:        'employee',
        id:          emp.id,
        name:        emp.name,
        designation: emp.designation,
        department:  emp.department,
      });
      return true;
    } catch (e) {
      console.error('loginEmployee error:', e.message);
      return false;
    }
  },

  // ── Session (localStorage for redirect persistence) ───────
  setSession(data) {
    localStorage.setItem('ems_session', JSON.stringify({ ...data, _ts: Date.now() }));
  },

  getSession() {
    try {
      const s = JSON.parse(localStorage.getItem('ems_session'));
      if (s && (Date.now() - s._ts) < 8 * 3600 * 1000) return s;
      this.clearSession();
      return null;
    } catch (_) { return null; }
  },

  clearSession() {
    localStorage.removeItem('ems_session');
    auth.signOut().catch(() => {});
  },
};
