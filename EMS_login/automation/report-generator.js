const admin = require('firebase-admin');
const path = require('path');

function initializeFirebase() {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 'serviceAccountKey.json';
  const resolvedPath = path.isAbsolute(serviceAccountPath) 
    ? serviceAccountPath 
    : path.join(__dirname, serviceAccountPath);

  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert(require(resolvedPath))
    });
  }
  return admin.firestore();
}

// Helpers and the weekly / monthly reports live in ../ems-reports.js (shared with the admin dashboard)
const {
  isCheckInLate, formatDateString, getHolidaysForMonth, getActiveEmployees, isEmployeeOnLeave,
  generateWeeklyReport, generateMonthlyReport
} = require('../ems-reports');

// Generate DAILY Report
async function generateDailyReport(db, targetDateStr = null) {
  const todayStr = targetDateStr || formatDateString(new Date());
  
  // 1. Fetch active employees
  const employees = await getActiveEmployees(db);
  const employeeMap = {};
  employees.forEach(emp => {
    employeeMap[emp.id] = emp;
  });

  if (employees.length === 0) {
    return `⚠️ *GROWTHAPEX EMS - DAILY REPORT* ⚠️\n📅 *Date:* ${todayStr}\n\nNo active employees found in the database.`;
  }

  // 2. Fetch today's attendance
  const attSnap = await db.collection('attendance')
    .where('date', '==', todayStr)
    .get();
  
  const attendanceMap = {};
  attSnap.forEach(doc => {
    const data = doc.data();
    attendanceMap[data.empId] = data;
  });

  // 3. Fetch leaves active today
  const leavesSnap = await db.collection('leaves').get();
  const allLeaves = [];
  leavesSnap.forEach(doc => allLeaves.push(doc.data()));

  // 4. Fetch all tasks (open/pending tasks + tasks created/completed today)
  const tasksSnap = await db.collection('tasks').get();
  const allTasks = [];
  tasksSnap.forEach(doc => {
    allTasks.push({ id: doc.id, ...doc.data() });
  });

  const todoTasks = allTasks.filter(t => t.status === 'todo' || t.status === 'doing' || t.status === 'in-progress');
  const doneTodayTasks = allTasks.filter(t => {
    const isDone = (t.status === 'done' || t.status === 'completed');
    if (!isDone) return false;
    const dateStr = t.updatedAt || t.createdAt || '';
    return dateStr.startsWith(todayStr);
  });

  // Calculate per-employee task completion (active open tasks + completed tasks)
  const empTaskStats = {};
  employees.forEach(emp => {
    const empTasks = allTasks.filter(t => t.empId === emp.id);
    const completed = empTasks.filter(t => t.status === 'done' || t.status === 'completed').length;
    empTaskStats[emp.id] = {
      name: emp.name,
      total: empTasks.length,
      completed: completed
    };
  });

  // Analyze attendance
  const presentList = [];
  const lateList = [];
  const absentList = [];
  const onLeaveList = [];

  employees.forEach(emp => {
    const empIdNorm = (emp.id || '').trim().toUpperCase();
    const att = attendanceMap[emp.id] || attendanceMap[empIdNorm];

    const isPresent = att && (att.status === 'present' || att.checkIn);
    const isAttLeave = att && (att.status === 'leave' || att.status === 'on-leave' || att.status === 'on_leave');
    const isOnLeave = isAttLeave || isEmployeeOnLeave(emp, allLeaves, todayStr);

    if (isPresent) {
      if (isCheckInLate(att.checkIn)) {
        lateList.push(`${emp.name} (Late: ${att.checkIn})`);
      } else {
        presentList.push(`${emp.name} (In: ${att.checkIn})`);
      }
    } else if (isOnLeave) {
      onLeaveList.push(emp.name);
    } else {
      absentList.push(emp.name);
    }
  });

  const FUNNY_ABSENT_ROASTS = [
    "Lagta hai sapno ki duniya me busy hain! 😴💤",
    "Bed se rishta bohot gehra chal raha hai! 🛏️✨",
    "Snooze button ne aaj dhokha de diya! ⏰🛑",
    "Bina bataye chutti? Lagta hai Goa nikal gaye! 🏖️🍹",
    "Work from Pillow mode ON hai aaj! 🛋️✨"
  ];

  // Format Daily Report
  let report = `🚀 *GROWTHAPEX EMS - DAILY VIBE CHECK* ⚡\n`;
  report += `📅 *Date:* ${todayStr} | *Gen-Z Mode Active* 🔥\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  report += `👥 *SQUAD ATTENDANCE BREAKDOWN:*\n`;
  report += `• Total Squad Strength: ${employees.length} 💼\n`;
  report += `• Present & Grinding: ${presentList.length + lateList.length} ⚡\n`;
  report += `• Absent / Ghosting: ${absentList.length} 👻\n`;
  if (onLeaveList.length > 0) {
    report += `• On Approved Leave: ${onLeaveList.length} 🌴\n`;
  }
  report += `\n`;

  if (presentList.length > 0) {
    report += `👑 *ON-TIME CHAMPIONS (Slayed Punctuality)*: \n${presentList.map(name => ` - ${name} ✨`).join('\n')}\n\n`;
  }

  if (lateList.length > 0) {
    report += `⏰ *LATE COMERS (Traffic Ko Blame Mat Karna 🚗💨)*: \n${lateList.map(name => ` - ${name} ⚠️`).join('\n')}\n\n`;
  }

  if (onLeaveList.length > 0) {
    report += `🌴 *APPROVED CHUTTI VIBES (Enjoying Leave 😎)*: \n${onLeaveList.map(name => ` - ${name} 🍹`).join('\n')}\n\n`;
  }

  if (absentList.length > 0) {
    report += `❌ *ABSENT:*\n${absentList.map((name, idx) => ` - *${name}*: ${FUNNY_ABSENT_ROASTS[idx % FUNNY_ABSENT_ROASTS.length]}`).join('\n')}\n\n`;
  }

  report += `📝 *TASK SLAYS & ONGOING GRIND:*\n`;
  if (doneTodayTasks.length > 0) {
    report += `✅ *Slayed Today (${doneTodayTasks.length}):*\n`;
    doneTodayTasks.forEach(t => {
      const empName = employeeMap[t.empId]?.name || t.empId;
      report += ` - ${t.title} (by ${empName})\n`;
    });
  }
  if (todoTasks.length > 0) {
    report += `${doneTodayTasks.length > 0 ? '\n' : ''}📌 *Active Grind (${todoTasks.length}):*\n`;
    todoTasks.forEach(t => {
      const empName = employeeMap[t.empId]?.name || t.empId;
      const dueStr = t.deadline ? ` | Due: ${t.deadline}` : '';
      report += ` - ${t.title} (assigned to ${empName}${dueStr})\n`;
    });
  }
  if (doneTodayTasks.length === 0 && todoTasks.length === 0) {
    report += `• No active or completed tasks recorded today.`;
  }
  report += `\n\n`;

  report += `📊 *SQUAD EFFICIENCY SCOREBAR:*\n`;
  employees.forEach(emp => {
    const stats = empTaskStats[emp.id];
    if (!stats || stats.total === 0) {
      report += ` • *${emp.name}*: ➖ *N/A* (No tasks assigned)\n`;
    } else {
      const pct = Math.round((stats.completed / stats.total) * 100);
      const blocks = Math.round(pct / 10);
      const filled = '█'.repeat(blocks);
      const empty = '░'.repeat(10 - blocks);
      const star = pct === 100 ? ' ⭐ [Pro Player 👑]' : '';
      report += ` • *${emp.name}*: ${filled}${empty} ${pct}% (${stats.completed}/${stats.total})${star}\n`;
    }
  });

  report += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  report += `🔥 _GrowthApex Gen-Z Automation Engine • Stay Grinding!_ 🔥`;
  return report;
}

// Generate LOGIN Report
async function generateLoginReport(db, targetDateStr = null) {
  const dateStr = targetDateStr || formatDateString(new Date());

  const [loginsSnap, attSnap, empSnap, leavesSnap] = await Promise.all([
    db.collection('logins').where('date', '==', dateStr).get(),
    db.collection('attendance').where('date', '==', dateStr).get(),
    db.collection('employees').get(),
    db.collection('leaves').get()
  ]);

  const empMap = {};
  empSnap.forEach(doc => {
    const empData = doc.data();
    const id = doc.id;
    empMap[id] = empData;
    empMap[id.trim().toUpperCase()] = empData;
  });

  const allLeaves = [];
  leavesSnap.forEach(doc => allLeaves.push(doc.data()));

  const adminLogins = [];
  const empLoginsMap = new Map();

  // Populate active employees in map
  empSnap.forEach(doc => {
    const empData = { id: doc.id, ...doc.data() };
    if (empData.status === 'active') {
      const empIdNorm = doc.id.trim().toUpperCase();
      empLoginsMap.set(empIdNorm, {
        id: doc.id,
        name: empData.name || doc.id,
        department: empData.department || '',
        designation: empData.designation || '',
        logins: [],
        attendance: null,
        isOnLeave: isEmployeeOnLeave(empData, allLeaves, dateStr)
      });
    }
  });

  // Process logins records
  loginsSnap.forEach(doc => {
    const data = doc.data();
    const role = (data.role || 'employee').toLowerCase();
    const time = data.loginTime || (data.timestamp ? new Date(data.timestamp).toLocaleTimeString('en-IN', { hour12: true }) : 'Logged in');
    
    if (role === 'admin' || data.empId === 'ADMIN') {
      adminLogins.push({
        name: data.name || 'GrowthApex Admin',
        email: data.email || '',
        time: time
      });
    } else if (data.empId) {
      const empIdNorm = String(data.empId).trim().toUpperCase();
      if (!empLoginsMap.has(empIdNorm)) {
        const empInfo = empMap[empIdNorm] || {};
        empLoginsMap.set(empIdNorm, {
          id: data.empId,
          name: data.name || empInfo.name || data.empId,
          department: empInfo.department || '',
          designation: empInfo.designation || '',
          logins: [],
          attendance: null,
          isOnLeave: leavesActiveToday.has(empIdNorm)
        });
      }
      empLoginsMap.get(empIdNorm).logins.push(time);
    }
  });

  // Process attendance records
  attSnap.forEach(doc => {
    const data = doc.data();
    if (data.empId) {
      const empIdNorm = String(data.empId).trim().toUpperCase();
      if (!empLoginsMap.has(empIdNorm)) {
        const empInfo = empMap[empIdNorm] || {};
        empLoginsMap.set(empIdNorm, {
          id: data.empId,
          name: empInfo.name || data.empId,
          department: empInfo.department || '',
          designation: empInfo.designation || '',
          logins: [],
          attendance: null,
          isOnLeave: leavesActiveToday.has(empIdNorm)
        });
      }
      empLoginsMap.get(empIdNorm).attendance = data;
    }
  });

  let report = `🔑 *GROWTHAPEX EMS - LOGIN & SESSION REPORT* 🔑\n`;
  report += `📅 *Date:* ${dateStr}\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  const totalWebLogins = loginsSnap.size;
  let activeUsersCount = 0;
  empLoginsMap.forEach(record => {
    if (record.logins.length > 0 || (record.attendance && record.attendance.checkIn)) {
      activeUsersCount++;
    }
  });

  report += `📊 *SESSION SUMMARY:*\n`;
  report += `• Total Web Logins: ${totalWebLogins} 🌐\n`;
  report += `• Staff Active Today: ${activeUsersCount} / ${empLoginsMap.size} 👥\n`;
  if (adminLogins.length > 0) {
    report += `• Admin Logins: ${adminLogins.length} 👑\n`;
  }
  report += `\n`;

  if (adminLogins.length > 0) {
    report += `👑 *ADMIN LOGINS:*\n`;
    adminLogins.forEach(adm => {
      report += ` • *${adm.name}* [ADMIN] — ⏰ ${adm.time}\n`;
    });
    report += `\n`;
  }

  report += `👥 *STAFF LOGINS & CHECK-INS:*\n`;

  const employeeEntries = Array.from(empLoginsMap.values());

  // Sort employees: logged in / checked in first, then on leave, then others
  employeeEntries.sort((a, b) => {
    const aActive = a.logins.length > 0 || (a.attendance && a.attendance.checkIn);
    const bActive = b.logins.length > 0 || (b.attendance && b.attendance.checkIn);
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    return a.name.localeCompare(b.name);
  });

  if (employeeEntries.length === 0) {
    report += `ℹ️ No employee records found.`;
  } else {
    employeeEntries.forEach(rec => {
      const desigStr = rec.designation ? ` (${rec.designation})` : '';
      const hasWebLogin = rec.logins.length > 0;
      const hasCheckIn = rec.attendance && rec.attendance.checkIn;

      report += `• *${rec.name}* [${rec.id}]${desigStr}:\n`;

      if (hasWebLogin) {
        report += `   └ 🌐 *Web Login:* ${rec.logins.join(', ')}\n`;
      } else {
        report += `   └ 🌐 *Web Login:* No web login\n`;
      }

      if (hasCheckIn) {
        const att = rec.attendance;
        const isLate = isCheckInLate(att.checkIn);
        const lateTag = isLate ? ' ⚠️ (Late)' : ' ✨ (On Time)';
        const checkOutStr = (att.checkOut && att.checkOut !== '—') ? ` | Out: ${att.checkOut}` : '';
        report += `   └ 📍 *Attendance Check-In:* ${att.checkIn}${lateTag}${checkOutStr}\n`;
      } else if (rec.isOnLeave) {
        report += `   └ 🌴 *Status:* On Approved Leave 😎\n`;
      } else {
        report += `   └ 📍 *Attendance:* No check-in recorded\n`;
      }

      report += `\n`;
    });
  }

  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  report += `🔥 _GrowthApex EMS Automated System Logging_ 🔥`;

  return report;
}

module.exports = {
  initializeFirebase,
  generateDailyReport,
  generateWeeklyReport,
  generateMonthlyReport,
  generateLoginReport
};

