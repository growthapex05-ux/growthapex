// ============================================================
// EMS Database - LocalStorage Engine  (fixed)
// GrowthApex Employee Management System
// ============================================================

const EMS_DB = {

  // ── Keys ──────────────────────────────────────────────────
  KEYS: {
    employees:  'ems_employees',
    attendance: 'ems_attendance',
    tasks:      'ems_tasks',
    leaves:     'ems_leaves',
    admin:      'ems_admin',
    session:    'ems_session',   // stored in localStorage (not sessionStorage)
  },

  // ── Initialise / seed data ─────────────────────────────────
  init() {
    // Always ensure admin record is valid
    try {
      const a = JSON.parse(localStorage.getItem(this.KEYS.admin));
      if (!a || !a.username) throw new Error('bad admin');
    } catch(_) {
      localStorage.setItem(this.KEYS.admin, JSON.stringify({
        username: 'admin',
        password: 'admin@123',
        name:     'Admin',
        email:    'admin@growthapex.in',
      }));
    }

    // Seed employees on first run
    if (!localStorage.getItem(this.KEYS.employees)) {
      const seed = [
        { id:'EMP001', name:'Surya Pratap Singh', email:'surya@growthapex.in',  phone:'9217648531', department:'Management', designation:'Founder & CEO',           salary:150000, password:'surya@123',  joinDate:'2022-01-01', status:'active' },
        { id:'EMP002', name:'Naresh Mandal',       email:'naresh@growthapex.in', phone:'9876543210', department:'Technology', designation:'Co-Founder & CTO',        salary:120000, password:'naresh@123', joinDate:'2022-01-15', status:'active' },
        { id:'EMP003', name:'Priya Sharma',        email:'priya@growthapex.in',  phone:'9988776655', department:'Marketing',  designation:'Social Media Manager',    salary:55000,  password:'priya@123',  joinDate:'2023-03-01', status:'active' },
        { id:'EMP004', name:'Rohan Verma',         email:'rohan@growthapex.in',  phone:'9112233445', department:'Design',     designation:'Graphic Designer',        salary:50000,  password:'rohan@123',  joinDate:'2023-06-01', status:'active' },
        { id:'EMP005', name:'Anjali Gupta',        email:'anjali@growthapex.in', phone:'9654321098', department:'Sales',      designation:'Business Dev Executive',  salary:45000,  password:'anjali@123', joinDate:'2024-01-10', status:'active' },
      ];
      localStorage.setItem(this.KEYS.employees, JSON.stringify(seed));
    }

    if (!localStorage.getItem(this.KEYS.attendance)) localStorage.setItem(this.KEYS.attendance, JSON.stringify([]));
    if (!localStorage.getItem(this.KEYS.tasks))      localStorage.setItem(this.KEYS.tasks,      JSON.stringify([]));
    if (!localStorage.getItem(this.KEYS.leaves))     localStorage.setItem(this.KEYS.leaves,     JSON.stringify([]));
  },

  // ── Helpers ───────────────────────────────────────────────
  _get(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch(_) { return []; }
  },
  _set(key, data) { localStorage.setItem(key, JSON.stringify(data)); },

  // ── Admin ─────────────────────────────────────────────────
  getAdmin() {
    try { return JSON.parse(localStorage.getItem(this.KEYS.admin)) || {}; } catch(_) { return {}; }
  },
  updateAdmin(data) {
    localStorage.setItem(this.KEYS.admin, JSON.stringify({ ...this.getAdmin(), ...data }));
  },

  // ── Employees ─────────────────────────────────────────────
  getEmployees()  { return this._get(this.KEYS.employees); },
  getEmployee(id) { return this.getEmployees().find(e => e.id === id) || null; },

  addEmployee(emp) {
    const list   = this.getEmployees();
    const nextNum = list.length + 1;
    emp.id       = 'EMP' + String(nextNum).padStart(3, '0');
    if (!emp.joinDate) emp.joinDate = new Date().toISOString().split('T')[0];
    if (!emp.status)   emp.status   = 'active';
    list.push(emp);
    this._set(this.KEYS.employees, list);
    return emp;
  },
  updateEmployee(id, data) {
    this._set(this.KEYS.employees, this.getEmployees().map(e => e.id === id ? { ...e, ...data } : e));
  },
  deleteEmployee(id) {
    this._set(this.KEYS.employees, this.getEmployees().filter(e => e.id !== id));
  },

  // ── Attendance ────────────────────────────────────────────
  getAttendance(empId) {
    const all = this._get(this.KEYS.attendance);
    return empId ? all.filter(a => a.empId === empId) : all;
  },
  markAttendance(rec) {
    const list = this._get(this.KEYS.attendance);
    const idx  = list.findIndex(a => a.empId === rec.empId && a.date === rec.date);
    if (idx > -1) list[idx] = { ...list[idx], ...rec };
    else          list.push({ id: Date.now(), ...rec });
    this._set(this.KEYS.attendance, list);
  },
  getTodayAttendance(empId) {
    const today = new Date().toISOString().split('T')[0];
    return this._get(this.KEYS.attendance).find(a => a.empId === empId && a.date === today) || null;
  },

  // ── Tasks ─────────────────────────────────────────────────
  getTasks(empId) {
    const all = this._get(this.KEYS.tasks);
    return empId ? all.filter(t => t.empId === empId) : all;
  },
  addTask(task)        { const l = this._get(this.KEYS.tasks); task.id = Date.now(); l.push(task); this._set(this.KEYS.tasks, l); return task; },
  updateTask(id, data) { this._set(this.KEYS.tasks, this._get(this.KEYS.tasks).map(t => +t.id === +id ? { ...t, ...data } : t)); },
  deleteTask(id)       { this._set(this.KEYS.tasks, this._get(this.KEYS.tasks).filter(t => +t.id !== +id)); },

  // ── Leaves ────────────────────────────────────────────────
  getLeaves(empId) {
    const all = this._get(this.KEYS.leaves);
    return empId ? all.filter(l => l.empId === empId) : all;
  },
  applyLeave(leave)        { const l = this._get(this.KEYS.leaves); leave.id = Date.now(); leave.status = 'pending'; l.push(leave); this._set(this.KEYS.leaves, l); return leave; },
  updateLeave(id, status)  { this._set(this.KEYS.leaves, this._get(this.KEYS.leaves).map(l => +l.id === +id ? { ...l, status } : l)); },

  // ── Session  (localStorage so it survives page redirects) ─
  setSession(data)  { localStorage.setItem(this.KEYS.session, JSON.stringify({ ...data, _ts: Date.now() })); },
  getSession()      {
    try {
      const s = JSON.parse(localStorage.getItem(this.KEYS.session));
      // Expire after 8 hours of inactivity
      if (s && (Date.now() - s._ts) < 8 * 3600 * 1000) return s;
      this.clearSession();
      return null;
    } catch(_) { return null; }
  },
  clearSession()    { localStorage.removeItem(this.KEYS.session); },

  // ── Auth ──────────────────────────────────────────────────
  loginAdmin(username, password) {
    try {
      const admin = this.getAdmin();
      if (admin && admin.username === username && admin.password === password) {
        this.setSession({ role: 'admin', name: admin.name || 'Admin', email: admin.email || '' });
        return true;
      }
    } catch(e) { console.error('loginAdmin error:', e); }
    return false;
  },

  loginEmployee(id, password) {
    try {
      const emp = this.getEmployee(id.toUpperCase());
      if (emp && emp.password === password && emp.status === 'active') {
        this.setSession({ role: 'employee', id: emp.id, name: emp.name, designation: emp.designation, department: emp.department });
        return true;
      }
    } catch(e) { console.error('loginEmployee error:', e); }
    return false;
  },

  // ── Utility: hard reset (call from console if needed) ─────
  reset() {
    Object.values(this.KEYS).forEach(k => localStorage.removeItem(k));
    this.init();
    console.log('EMS database reset complete.');
  },
};

// Initialise on script load
EMS_DB.init();
