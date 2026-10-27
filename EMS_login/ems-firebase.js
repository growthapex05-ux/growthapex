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
        // Count real active time: seconds since the previous heartbeat (capped, so a sleeping phone adds nothing)
        const prev = Date.parse(data.lastHeartbeat || '');
        const activeAdd = statusState === 'active' && !isNaN(prev)
          ? Math.round(Math.min(60, Math.max(0, (Date.now() - prev) / 1000))) : 0;
        const update = {
          lastHeartbeat: new Date().toISOString(),
          activityStatus: statusState,
          lastDevice: emsDevice().type,
          pcConnected: true
        };
        if (activeAdd) update.activeSeconds = firebase.firestore.FieldValue.increment(activeAdd);
        await doc.ref.update(update);
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
