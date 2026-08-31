// ============================================================
// EMS Firebase Engine — GrowthApex Employee Management System
// Replaces: ems-db.js  (localStorage → Firebase Firestore + Auth)
// ============================================================
// DEPENDENCIES (loaded before this script in HTML):
//   firebase-app-compat.js, firebase-auth-compat.js,
//   firebase-firestore-compat.js, firebase-config.js
// ============================================================

const EMS_DB = {

  // ── Collection helpers ────────────────────────────────────
  _col(name) { return db.collection(name); },

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

    // Create Firebase Auth account for this employee
    try {
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await cred.user.updateProfile({ displayName: data.name });
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
      joinDate:    restData.joinDate || new Date().toISOString().split('T')[0],
      status:      restData.status || 'active',
      createdAt:   new Date().toISOString(),
    };

    await this._col('employees').doc(empId).set(emp);
    return { id: empId, ...emp };
  },

  async updateEmployee(id, data) {
    // Never store password in Firestore
    const { password, ...safeData } = data;
    await this._col('employees').doc(id).update(safeData);

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
    await this._col('employees').doc(id).delete();
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
    const today = new Date().toISOString().split('T')[0];
    const snap  = await this._col('attendance')
      .where('empId', '==', empId)
      .where('date',  '==', today)
      .get();
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
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
