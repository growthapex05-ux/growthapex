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

// Helper: check if check-in is late (after 10:00 AM)
function isCheckInLate(checkInTime) {
  if (!checkInTime) return false;
  return checkInTime > '10:00:00';
}

// Helper: Format date to YYYY-MM-DD
function formatDateString(date) {
  return date.toISOString().split('T')[0];
}

// Helper: Get Indian public holidays & festivals for a given month (1-indexed) and year
function getHolidaysForMonth(year, month) {
  // month is 1-indexed (1 = January, 12 = December)
  // Verified dates for 2026. Update year blocks below for future years.
  const ALL_HOLIDAYS = [
    // Fixed-date national holidays (every year)
    { month: 1,  day: 1,  name: "New Year's Day 🎊" },
    { month: 1,  day: 26, name: "Republic Day 🇮🇳" },
    { month: 8,  day: 15, name: "Independence Day 🇮🇳" },
    { month: 10, day: 2,  name: "Gandhi Jayanti 🕊️" },
    { month: 12, day: 25, name: "Christmas 🎄" },

    // 2026 verified festival dates
    ...(year === 2026 ? [
      { month: 1,  day: 14, name: "Makar Sankranti / Lohri 🪁" },
      { month: 2,  day: 15, name: "Maha Shivratri 🔱" },
      { month: 3,  day: 4,  name: "Holi 🎨" },
      { month: 3,  day: 21, name: "Eid ul-Fitr 🌙" },
      { month: 3,  day: 26, name: "Ram Navami 🙏" },
      { month: 4,  day: 3,  name: "Good Friday ✝️" },
      { month: 4,  day: 14, name: "Ambedkar Jayanti / Baisakhi 🌾" },
      { month: 5,  day: 1,  name: "Buddha Purnima / Labour Day 🙏" },
      { month: 5,  day: 28, name: "Eid ul-Adha (Bakrid) 🌙" },
      { month: 6,  day: 26, name: "Muharram (Islamic New Year) 🕌" },
      { month: 8,  day: 28, name: "Raksha Bandhan (Rakhi) 🪢" },
      { month: 9,  day: 4,  name: "Janmashtami 🦚" },
      { month: 9,  day: 5,  name: "Teachers' Day 🍎" },
      { month: 10, day: 20, name: "Dussehra / Vijayadashami 🏹" },
      { month: 11, day: 8,  name: "Diwali 🪔" },
      { month: 11, day: 24, name: "Guru Nanak Jayanti 🙏" },
    ] : []),

    // 2027 festival dates (update when confirmed)
    ...(year === 2027 ? [
      { month: 1,  day: 14, name: "Makar Sankranti / Lohri 🪁" },
      { month: 3,  day: 4,  name: "Holi 🎨" },
      { month: 10, day: 25, name: "Diwali 🪔" },
    ] : []),
  ];

  return ALL_HOLIDAYS
    .filter(h => h.month === month)
    .sort((a, b) => a.day - b.day)  // Sort by date ascending
    .map(h => {
      const dateLabel = new Date(year, h.month - 1, h.day)
        .toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      return { date: dateLabel, name: h.name };
    });
}

async function getActiveEmployees(db) {
  const snap = await db.collection('employees').get();
  return snap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(emp => emp.status === 'active');
}

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
  const leavesSnap = await db.collection('leaves')
    .where('status', '==', 'approved')
    .get();
  
  const leavesActiveToday = [];
  leavesSnap.forEach(doc => {
    const data = doc.data();
    if (todayStr >= data.from && todayStr <= data.to) {
      leavesActiveToday.push(data);
    }
  });
  const leaveEmpIds = new Set(leavesActiveToday.map(l => l.empId));

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
    if (leaveEmpIds.has(emp.id)) {
      onLeaveList.push(emp.name);
    } else {
      const att = attendanceMap[emp.id];
      if (att && (att.status === 'present' || att.checkIn)) {
        if (isCheckInLate(att.checkIn)) {
          lateList.push(`${emp.name} (Late: ${att.checkIn})`);
        } else {
          presentList.push(`${emp.name} (In: ${att.checkIn})`);
        }
      } else {
        absentList.push(emp.name);
      }
    }
  });

  // Format Daily Report
  let report = `📢 *GROWTHAPEX EMS - DAILY REPORT* 📢\n`;
  report += `📅 *Date:* ${todayStr}\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  report += `👥 *Attendance Summary:*\n`;
  report += `• Total Strength: ${employees.length}\n`;
  report += `• Present: ${presentList.length + lateList.length}\n`;
  report += `• Absent: ${absentList.length}\n`;
  if (onLeaveList.length > 0) {
    report += `• On Leave: ${onLeaveList.length}\n`;
  }
  report += `\n`;

  if (presentList.length > 0) {
    report += `✅ *On-Time:* \n${presentList.map(name => ` - ${name}`).join('\n')}\n\n`;
  }

  if (lateList.length > 0) {
    report += `⏰ *Late Check-ins:* \n${lateList.map(name => ` - ${name}`).join('\n')}\n\n`;
  }

  if (onLeaveList.length > 0) {
    report += `🌴 *On Leave:* \n${onLeaveList.map(name => ` - ${name}`).join('\n')}\n\n`;
  }

  if (absentList.length > 0) {
    report += `❌ *Absent:* \n${absentList.map(name => ` - ${name}`).join('\n')}\n\n`;
  }

  report += `📝 *Task Updates & Ongoing Work:*\n`;
  if (doneTodayTasks.length > 0) {
    report += `✅ *Completed Today (${doneTodayTasks.length}):*\n`;
    doneTodayTasks.forEach(t => {
      const empName = employeeMap[t.empId]?.name || t.empId;
      report += ` - ${t.title} (by ${empName})\n`;
    });
  }
  if (todoTasks.length > 0) {
    report += `${doneTodayTasks.length > 0 ? '\n' : ''}📌 *Active / In-Progress Tasks (${todoTasks.length}):*\n`;
    todoTasks.forEach(t => {
      const empName = employeeMap[t.empId]?.name || t.empId;
      const dueStr = t.deadline ? ` | Due: ${t.deadline}` : '';
      report += ` - ${t.title} (assigned to ${empName}${dueStr})\n`;
    });
  }
  if (doneTodayTasks.length === 0 && todoTasks.length === 0) {
    report += `• No active or completed tasks recorded.`;
  }
  report += `\n\n`;

  report += `📊 *Task Completion % by Employee:*\n`;
  employees.forEach(emp => {
    const stats = empTaskStats[emp.id];
    if (!stats || stats.total === 0) {
      report += ` • *${emp.name}*: ➖ *N/A* (No tasks assigned)\n`;
    } else {
      const pct = Math.round((stats.completed / stats.total) * 100);
      const blocks = Math.round(pct / 10);
      const filled = '█'.repeat(blocks);
      const empty = '░'.repeat(10 - blocks);
      const star = pct === 100 ? ' ⭐' : '';
      report += ` • *${emp.name}*: ${filled}${empty} ${pct}% (${stats.completed}/${stats.total})${star}\n`;
    }
  });

  return report;
}

// Generate WEEKLY Report
async function generateWeeklyReport(db) {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday
  
  let startDate = new Date();
  let endDate = new Date();
  
  // If Monday (1) or Tuesday (2), report on the complete previous week.
  // Otherwise report on the trailing 7 days.
  if (dayOfWeek === 1 || dayOfWeek === 2) {
    const daysToSubtract = dayOfWeek === 1 ? 7 : 8;
    startDate.setDate(now.getDate() - daysToSubtract);
    startDate.setHours(0, 0, 0, 0);
    
    endDate.setDate(startDate.getDate() + 6);
    endDate.setHours(23, 59, 59, 999);
  } else {
    startDate.setDate(now.getDate() - 7);
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);
  }

  const startStr = formatDateString(startDate);
  const endStr = formatDateString(endDate);

  const employees = await getActiveEmployees(db);
  const employeeMap = {};
  employees.forEach(emp => {
    employeeMap[emp.id] = emp;
  });

  if (employees.length === 0) {
    return `⚠️ *GROWTHAPEX EMS - WEEKLY REPORT* ⚠️\n📅 *Period:* ${startStr} to ${endStr}\n\nNo active employees found.`;
  }

  // 1. Fetch attendance records in range
  const attSnap = await db.collection('attendance')
    .where('date', '>=', startStr)
    .where('date', '<=', endStr)
    .get();

  const attendanceRecords = attSnap.docs.map(doc => doc.data());

  // 2. Fetch tasks created in range
  const tasksSnap = await db.collection('tasks')
    .where('createdAt', '>=', startDate.toISOString())
    .where('createdAt', '<=', endDate.toISOString())
    .get();
  
  const tasksRecords = tasksSnap.docs.map(doc => doc.data());

  // 3. Fetch leaves approved in range
  const leavesSnap = await db.collection('leaves')
    .where('status', '==', 'approved')
    .get();
  
  let totalLeavesApprovedDays = 0;
  const leaveLog = [];

  // Calculate statistics per employee
  const employeeStats = {};
  employees.forEach(emp => {
    employeeStats[emp.id] = {
      name: emp.name,
      presentDays: 0,
      lateDays: 0,
      leaveDays: 0,
      absentDays: 0,
      tasksAssigned: 0,
      tasksCompleted: 0
    };
  });

  leavesSnap.forEach(doc => {
    const data = doc.data();
    // Check if overlap exists with the week range
    const lFrom = data.from;
    const lTo = data.to;
    if (lTo >= startStr && lFrom <= endStr) {
      const empName = employeeMap[data.empId]?.name || data.empId;
      leaveLog.push(`${empName} (${data.type}: ${data.from} to ${data.to})`);
      totalLeavesApprovedDays++;

      // Count overlap days for this employee (excluding Sundays)
      try {
        let current = new Date(lFrom > startStr ? lFrom : startStr);
        const limit = new Date(lTo < endStr ? lTo : endStr);
        let overlapDays = 0;
        while (current <= limit) {
          if (current.getDay() !== 0) { // 0 is Sunday
            overlapDays++;
          }
          current.setDate(current.getDate() + 1);
        }
        if (employeeStats[data.empId]) {
          employeeStats[data.empId].leaveDays += overlapDays;
        }
      } catch (e) {
        console.error("Error calculating overlap days:", e.message);
      }
    }
  });

  // Calculate actual working days in this weekly period (Monday to Saturday, excluding Sundays)
  let totalWorkingDays = 0;
  let dateIter = new Date(startDate);
  while (dateIter <= endDate) {
    if (dateIter.getDay() !== 0) { // 0 is Sunday
      totalWorkingDays++;
    }
    dateIter.setDate(dateIter.getDate() + 1);
  }

  attendanceRecords.forEach(rec => {
    const stats = employeeStats[rec.empId];
    if (stats) {
      if (rec.status === 'present' || rec.checkIn) {
        stats.presentDays++;
        if (isCheckInLate(rec.checkIn)) {
          stats.lateDays++;
        }
      }
    }
  });

  // Calculate absent days per employee (working days - present - leave)
  employees.forEach(emp => {
    const stats = employeeStats[emp.id];
    stats.absentDays = totalWorkingDays - stats.presentDays - stats.leaveDays;
    if (stats.absentDays < 0) stats.absentDays = 0;
  });

  tasksRecords.forEach(task => {
    const stats = employeeStats[task.empId];
    if (stats) {
      stats.tasksAssigned++;
      if (task.status === 'done' || task.status === 'completed') {
        stats.tasksCompleted++;
      }
    }
  });

  // Aggregate global stats
  let totalPresentCount = 0;
  let totalLateCount = 0;
  let totalTasksAssigned = tasksRecords.length;
  let totalTasksCompleted = tasksRecords.filter(t => t.status === 'done' || t.status === 'completed').length;

  employees.forEach(emp => {
    const stats = employeeStats[emp.id];
    totalPresentCount += stats.presentDays;
    totalLateCount += stats.lateDays;
  });

  const completionRate = totalTasksAssigned > 0 
    ? Math.round((totalTasksCompleted / totalTasksAssigned) * 100) 
    : 0;

  // Task leaderboard
  const leaderboard = Object.values(employeeStats)
    .sort((a, b) => b.tasksCompleted - a.tasksCompleted)
    .filter(s => s.tasksCompleted > 0)
    .slice(0, 3);

  // Format Report
  let report = `📊 *GROWTHAPEX EMS - WEEKLY REPORT* 📊\n`;
  report += `📅 *Period:* ${startStr} to ${endStr}\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  report += `👥 *Team Engagement:*\n`;
  report += `• Active Employees: ${employees.length}\n`;
  report += `• Total Present Check-ins: ${totalPresentCount}\n`;
  report += `• Late Check-ins: ${totalLateCount} ⏰\n`;
  report += `• Total Leaves Taken: ${totalLeavesApprovedDays} days\n\n`;

  report += `👥 *Employee Attendance Summary:*\n`;
  employees.forEach(emp => {
    const stats = employeeStats[emp.id];
    const lateText = stats.lateDays > 0 ? ` (⏰ ${stats.lateDays} Late)` : '';
    report += ` • *${stats.name}*: Present: ${stats.presentDays}d | Absent: ${stats.absentDays}d | Leaves: ${stats.leaveDays}d${lateText}\n`;
  });
  report += `\n`;

  report += `📝 *Task Execution summary:*\n`;
  report += `• Total Tasks Logged: ${totalTasksAssigned}\n`;
  report += `• Total Tasks Completed: ${totalTasksCompleted}\n`;
  report += `• Completion Success Rate: ${completionRate}%\n\n`;

  if (leaderboard.length > 0) {
    report += `🥇 *Weekly Task Achievers:*\n`;
    const medals = ['🥇', '🥈', '🥉'];
    leaderboard.forEach((user, idx) => {
      report += ` ${medals[idx]} *${user.name}* - Completed ${user.tasksCompleted} tasks\n`;
    });
    report += `\n`;
  }

  if (leaveLog.length > 0) {
    report += `🌴 *Leave Absences:*\n`;
    leaveLog.forEach(log => {
      report += ` • ${log}\n`;
    });
    report += `\n`;
  }

  report += `📌 *System Note:* Keep logging daily tasks and checking in before 10:00 AM.`;
  return report;
}

// Generate MONTHLY Report
async function generateMonthlyReport(db) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth(); // Current month (0-11)

  // If run in the first 5 days of the month, generate report for the PREVIOUS month
  if (now.getDate() <= 5) {
    month = month - 1;
    if (month < 0) {
      month = 11;
      year = year - 1;
    }
  }

  const startDate = new Date(year, month, 1);
  const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);

  const startStr = formatDateString(startDate);
  const endStr = formatDateString(endDate);
  const monthName = startDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const employees = await getActiveEmployees(db);
  const employeeMap = {};
  employees.forEach(emp => {
    employeeMap[emp.id] = emp;
  });

  if (employees.length === 0) {
    return `⚠️ *GROWTHAPEX EMS - MONTHLY PERFORMANCE* ⚠️\n📅 *Month:* ${monthName}\n\nNo active employees found.`;
  }

  // 1. Fetch attendance
  const attSnap = await db.collection('attendance')
    .where('date', '>=', startStr)
    .where('date', '<=', endStr)
    .get();
  const attendanceRecords = attSnap.docs.map(doc => doc.data());

  // 2. Fetch tasks
  const tasksSnap = await db.collection('tasks')
    .where('createdAt', '>=', startDate.toISOString())
    .where('createdAt', '<=', endDate.toISOString())
    .get();
  const tasksRecords = tasksSnap.docs.map(doc => doc.data());

  // 3. Fetch leaves approved in range
  const leavesSnap = await db.collection('leaves')
    .where('status', '==', 'approved')
    .get();
  
  // Calculate actual working days in this monthly period (excluding Sundays)
  let totalWorkingDays = 0;
  let dateIter = new Date(startDate);
  while (dateIter <= endDate) {
    if (dateIter.getDay() !== 0) { // 0 is Sunday
      totalWorkingDays++;
    }
    dateIter.setDate(dateIter.getDate() + 1);
  }

  // Calculate stats per employee
  const employeeStats = {};
  employees.forEach(emp => {
    employeeStats[emp.id] = {
      name: emp.name,
      department: emp.department,
      presentDays: 0,
      lateDays: 0,
      leaveDays: 0,
      absentDays: 0,
      tasksAssigned: 0,
      tasksCompleted: 0
    };
  });

  let monthlyLeavesDays = 0;
  leavesSnap.forEach(doc => {
    const data = doc.data();
    const lFrom = data.from;
    const lTo = data.to;
    if (lTo >= startStr && lFrom <= endStr) {
      // Calculate overlap days (excluding Sundays) in current month
      try {
        let current = new Date(lFrom > startStr ? lFrom : startStr);
        const limit = new Date(lTo < endStr ? lTo : endStr);
        let overlapDays = 0;
        while (current <= limit) {
          if (current.getDay() !== 0) { // 0 is Sunday
            overlapDays++;
          }
          current.setDate(current.getDate() + 1);
        }
        monthlyLeavesDays += overlapDays;
        if (employeeStats[data.empId]) {
          employeeStats[data.empId].leaveDays += overlapDays;
        }
      } catch (e) {
        console.error("Error calculating overlap days for monthly leaves:", e.message);
      }
    }
  });

  attendanceRecords.forEach(rec => {
    const stats = employeeStats[rec.empId];
    if (stats) {
      if (rec.status === 'present' || rec.checkIn) {
        stats.presentDays++;
        if (isCheckInLate(rec.checkIn)) {
          stats.lateDays++;
        }
      }
    }
  });

  // Calculate absent days per employee (working days - present - leave)
  employees.forEach(emp => {
    const stats = employeeStats[emp.id];
    stats.absentDays = totalWorkingDays - stats.presentDays - stats.leaveDays;
    if (stats.absentDays < 0) stats.absentDays = 0;
  });

  tasksRecords.forEach(task => {
    const stats = employeeStats[task.empId];
    if (stats) {
      stats.tasksAssigned++;
      if (task.status === 'done' || task.status === 'completed') {
        stats.tasksCompleted++;
      }
    }
  });

  let totalTasks = tasksRecords.length;
  let totalCompleted = tasksRecords.filter(t => t.status === 'done' || t.status === 'completed').length;
  let monthlyCompletionRate = totalTasks > 0 
    ? Math.round((totalCompleted / totalTasks) * 100) 
    : 0;

  // Find Employee of the Month (Highest tasks completed, minimum late days)
  let employeeOfTheMonth = null;
  let maxCompleted = 0;
  let minLate = 999;

  Object.values(employeeStats).forEach(stats => {
    if (stats.tasksCompleted > maxCompleted) {
      maxCompleted = stats.tasksCompleted;
      minLate = stats.lateDays;
      employeeOfTheMonth = stats;
    } else if (stats.tasksCompleted === maxCompleted && stats.tasksCompleted > 0) {
      if (stats.lateDays < minLate) {
        minLate = stats.lateDays;
        employeeOfTheMonth = stats;
      }
    }
  });

  // Format Monthly Report
  let report = `🏆 *GROWTHAPEX EMS - MONTHLY PERFORMANCE* 🏆\n`;
  report += `📅 *Month:* ${monthName}\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  report += `🌟 *Key performance indicators (KPIs):*\n`;
  report += `• Total Tasks Assigned: ${totalTasks}\n`;
  report += `• Total Tasks Completed: ${totalCompleted}\n`;
  report += `• Average Task Completion: ${monthlyCompletionRate}%\n`;
  report += `• Total Approved Leave Days: ${monthlyLeavesDays} days\n`;
  report += `• Avg Attendance Check-ins: ${Math.round(attendanceRecords.length / employees.length)} days (out of ${totalWorkingDays} working days)\n\n`;

  if (employeeOfTheMonth && maxCompleted > 0) {
    report += `🎉 *EMPLOYEE OF THE MONTH* 🎉\n`;
    report += `⭐ *${employeeOfTheMonth.name}* (${employeeOfTheMonth.department})\n`;
    report += `💪 Completed *${employeeOfTheMonth.tasksCompleted} tasks* with only *${employeeOfTheMonth.lateDays} late check-ins*!\n\n`;
  }

  report += `👥 *Employee Breakdown (Completed/Assigned):*\n`;
  Object.values(employeeStats)
    .sort((a, b) => b.tasksCompleted - a.tasksCompleted)
    .forEach(stats => {
      const lateStr = stats.lateDays > 0 ? ` (⏰ ${stats.lateDays} Late)` : '';
      report += ` • *${stats.name}*: ${stats.tasksCompleted}/${stats.tasksAssigned} Tasks (Attendance: ${stats.presentDays}d Present | ${stats.absentDays}d Absent | ${stats.leaveDays}d Leave)${lateStr}\n`;
    });

  // Notable holidays / festivals section
  const holidays = getHolidaysForMonth(year, month + 1); // month is 0-indexed inside function
  if (holidays.length > 0) {
    report += `\n🗓️ *Notable Holidays & Festivals This Month:*\n`;
    holidays.forEach(h => {
      report += ` • *${h.date}* - ${h.name}\n`;
    });
  }

  report += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  report += `🚀 Great job team! Let's hit new heights this month!`;

  return report;
}

// Generate LOGIN Report
async function generateLoginReport(db, targetDateStr = null) {
  const dateStr = targetDateStr || formatDateString(new Date());

  const [loginsSnap, attSnap, empSnap] = await Promise.all([
    db.collection('logins').where('date', '==', dateStr).get(),
    db.collection('attendance').where('date', '==', dateStr).get(),
    db.collection('employees').get()
  ]);

  const empMap = {};
  empSnap.forEach(doc => { empMap[doc.id] = doc.data(); });

  const entriesMap = new Map();

  // 1. Add web logins
  loginsSnap.forEach(doc => {
    const data = doc.data();
    const key = (data.empId || data.name || doc.id).toUpperCase();
    entriesMap.set(key, {
      name: data.name || empMap[data.empId]?.name || key,
      empId: data.empId || 'USER',
      role: data.role || 'employee',
      time: data.loginTime || 'Logged in'
    });
  });

  // 2. Add attendance check-ins
  attSnap.forEach(doc => {
    const data = doc.data();
    const key = (data.empId || doc.id).toUpperCase();
    if (!entriesMap.has(key)) {
      const emp = empMap[key] || {};
      entriesMap.set(key, {
        name: emp.name || key,
        empId: key,
        role: 'employee',
        time: data.checkIn ? `${data.checkIn} (Check-in)` : 'Checked in'
      });
    }
  });

  const entries = Array.from(entriesMap.values());

  let report = `🔑 *GROWTHAPEX EMS - LOGIN REPORT* 🔑\n`;
  report += `📅 *Date:* ${dateStr}\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (entries.length === 0) {
    report += `ℹ️ No system logins or check-ins recorded for this date.`;
  } else {
    report += `👤 *Staff Logins & Check-ins (${entries.length}):*\n`;
    entries.forEach(e => {
      const roleStr = e.role ? ` (${e.role.toUpperCase()})` : '';
      report += ` • *${e.name}* [${e.empId}]${roleStr} — ⏰ ${e.time}\n`;
    });
  }

  return report;
}

module.exports = {
  initializeFirebase,
  generateDailyReport,
  generateWeeklyReport,
  generateMonthlyReport,
  generateLoginReport
};

