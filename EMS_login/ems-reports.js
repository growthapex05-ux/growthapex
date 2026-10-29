// ============================================================
// EMS WhatsApp report builders — shared by the automation (Node, firebase-admin)
// and the admin dashboard preview (browser, Firestore compat SDK: global EMS_REPORTS).
// Every builder takes `db` and only uses the Firestore API both SDKs share.
//  • buildAttendanceReport(db, date, { mode })  daily (evening) / morning attendance
//  • generateWeeklyReport(db), generateMonthlyReport(db) + groupSection(db)
// ============================================================
(function (root) {
  const P = (typeof module !== 'undefined' && module.exports) ? require('./ems-payroll') : root.EMS_PAYROLL;

  function todayIST() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }

  // ── Shared helpers + weekly / monthly reports ──────────────

// Helper: check if check-in is late (after 10:00 AM)
function isCheckInLate(checkInTime) {
  if (!checkInTime) return false;
  return checkInTime > '10:00:00';
}

// Helper: Format date to YYYY-MM-DD (Asia/Kolkata timezone)
function formatDateString(date) {
  if (typeof date === 'string') return date;
  if (!date) date = new Date();
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
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

// Helper: Check if an employee is on approved leave on a given date
function isEmployeeOnLeave(emp, leavesList, dateStr) {
  if (!leavesList || !leavesList.length) return false;
  const empIdNorm = (emp.id || '').toString().trim().toUpperCase();
  const empNameNorm = (emp.name || '').toString().trim().toLowerCase();
  const empEmailNorm = (emp.email || '').toString().trim().toLowerCase();

  return leavesList.some(l => {
    const st = (l.status || '').toString().toLowerCase().trim();
    if (st !== 'approved') return false;

    let lFrom = l.startDate || l.from || l.fromDate || l.date || '';
    let lTo = l.endDate || l.to || l.toDate || lFrom;
    if (typeof lFrom === 'object' && lFrom && typeof lFrom.toDate === 'function') lFrom = formatDateString(lFrom.toDate());
    if (typeof lTo === 'object' && lTo && typeof lTo.toDate === 'function') lTo = formatDateString(lTo.toDate());
    if (typeof lFrom === 'string' && lFrom.includes('T')) lFrom = lFrom.split('T')[0];
    if (typeof lTo === 'string' && lTo.includes('T')) lTo = lTo.split('T')[0];

    if (!lFrom || !lTo) return false;
    if (dateStr < lFrom || dateStr > lTo) return false;

    const lEmpId = (l.empId || '').toString().trim().toUpperCase();
    const lEmpName = (l.empName || l.employeeName || l.name || '').toString().trim().toLowerCase();
    const lEmail = (l.email || '').toString().trim().toLowerCase();

    if (empIdNorm && lEmpId && empIdNorm === lEmpId) return true;
    if (empEmailNorm && lEmail && empEmailNorm === lEmail) return true;
    if (empNameNorm && lEmpName && (empNameNorm === lEmpName || empNameNorm.includes(lEmpName) || lEmpName.includes(empNameNorm))) return true;

    return false;
  });
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
    const lFrom = data.startDate || data.from || data.fromDate || '';
    const lTo = data.endDate || data.to || data.toDate || lFrom;
    if (lFrom && lTo && lTo >= startStr && lFrom <= endStr) {
      const empName = employeeMap[data.empId]?.name || data.empId;
      leaveLog.push(`${empName} (${data.type || 'Leave'}: ${lFrom} to ${lTo})`);
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
    const lFrom = data.startDate || data.from || data.fromDate || '';
    const lTo = data.endDate || data.to || data.toDate || lFrom;
    if (lFrom && lTo && lTo >= startStr && lFrom <= endStr) {
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
      // Attendance / leave numbers come from the shared payroll rules in the section appended by month-summary.js
      report += ` • *${stats.name}*: ${stats.tasksCompleted}/${stats.tasksAssigned} Tasks\n`;
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

  // ── Daily (evening) / morning attendance report ────────────

const HOME_RADIUS_KM = 1;
const NUM_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

const num = n => (Number.isInteger(n) ? String(n) : Number(n).toFixed(1));
const has = t => t && t !== '—';

function nextDay(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA');
}

function prettyDate(dateStr) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function duration(mins) {
  if (mins == null || mins < 0) return null;
  return `${Math.floor(mins / 60)}h ${String(Math.round(mins % 60)).padStart(2, '0')}m`;
}

// Online (connected) work time — same rule as emsWorkedSeconds() in ems-firebase.js:
// offline gaps (> 2 min without a heartbeat) are not counted.
function onlineSeconds(rec) {
  if (!rec || rec.workedSeconds === undefined) return null;
  let secs = Number(rec.workedSeconds) || 0;
  const open = !has(rec.checkOut);
  const hb = Date.parse(rec.lastHeartbeat || '');
  if (open && !isNaN(hb)) {
    const gap = (Date.now() - hb) / 1000;
    if (gap >= 0 && gap <= 120) secs += gap;
  }
  return Math.floor(secs);
}

// "2h 40m" / "45m"
function shortDuration(secs) {
  const m = Math.round(secs / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

const SCREEN_TOP = 5;
// App / website usage from ActivityWatch, saved on the attendance record by the employee dashboard
function screenLines(rec) {
  const act = rec.screenActivity;
  if (act && Array.isArray(act.apps) && act.apps.length) {
    const lines = ['   🖥️ Screen time (top apps/sites):'];
    act.apps.slice(0, SCREEN_TOP).forEach(a => lines.push(`      • ${a.name} — ${shortDuration(a.secs)}`));
    if (act.idleSecs) lines.push(`   💤 Idle: ${shortDuration(act.idleSecs)}`);
    return lines;
  }
  if (rec.checkInDevice && rec.checkInDevice.type !== 'desktop') return ['   🖥️ Screen time: not tracked (mobile check-in)'];
  return ['   🖥️ ⚠️ No screen activity data (ActivityWatch not running)'];
}

function deviceText(d) {
  if (!d || !d.type) return null;
  const icon = d.type === 'desktop' ? '💻' : '📱';
  return `${icon} ${d.type.charAt(0).toUpperCase() + d.type.slice(1)}${d.os ? ` · ${d.os} ${d.browser || ''}`.trimEnd() : ''}`;
}

function locationText(label, loc, distKm) {
  if (!loc) return null;
  if (loc.error) return `📍 ${label}: ❌ ${loc.error === 'denied' ? 'Location permission denied' : 'Location not available'}`;
  let home = '';
  if (distKm != null) home = distKm > HOME_RADIUS_KM ? ` · 🏠 *${distKm} km from home* ⚠️` : ' · 🏠 From home';
  const approx = loc.accuracy > 1000 ? ` (±${(loc.accuracy / 1000).toFixed(1)} km)` : '';
  return `📍 ${label}: https://maps.google.com/?q=${loc.lat},${loc.lng}${approx}${home}`;
}

async function loadData(db, date) {
  const month = date.slice(0, 7);
  const [empSnap, attSnap, leaveSnap, wlSnap, cfgDoc] = await Promise.all([
    db.collection('employees').get(),
    db.collection('attendance').get(),
    db.collection('leaves').get(),
    db.collection('worklogs').where('date', '==', date).get(),
    db.collection('admin').doc('config').get()
  ]);
  const cfg = cfgDoc.exists ? cfgDoc.data() : {};
  const attendance = attSnap.docs.map(d => d.data());
  const leaves = leaveSnap.docs.map(d => d.data());
  const worklogs = {};
  wlSnap.forEach(d => { worklogs[d.data().empId] = d.data(); });
  const employees = empSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(e => e.status === 'active' && (!e.joinDate || e.joinDate <= date));
  return { month, cfg, attendance, leaves, worklogs, employees };
}

/**
 * @param mode 'evening' (full day, default) | 'morning' (who has checked in so far)
 */
async function buildAttendanceReport(db, date = todayIST(), { mode = 'evening' } = {}) {
  const { month, cfg, attendance, leaves, worklogs, employees } = await loadData(db, date);
  const holidays = cfg.holidays || [];
  const isMorning = mode === 'morning';
  const sentLate = date < todayIST();
  // Evening: the report day is over, so a missing check-in counts as absent
  const asOf = isMorning ? date : nextDay(date);

  const header = isMorning
    ? `🌅 *GROWTHAPEX — MORNING ATTENDANCE*`
    : `🚀 *GROWTHAPEX — DAILY ATTENDANCE REPORT*`;
  let msg = `${header}\n📅 *${prettyDate(date)}*\n`;
  if (sentLate) msg += `⏰ _This report could not be auto-sent on time — sending it now._\n`;
  if (holidays.includes(date)) msg += `🎉 _Today is an office holiday._\n`;

  const counts = { present: 0, late: 0, leave: 0, absent: 0, pending: 0 };
  const blocks = [];

  employees.forEach((emp, i) => {
    const empAtt = attendance.filter(a => a.empId === emp.id);
    const empLeaves = leaves.filter(l => l.empId === emp.id);
    const s = P.monthSummary(emp, month, empAtt, empLeaves, asOf, { holidays, team: P.teamCalendar(attendance) });
    const day = s.days.find(d => d.date === date) || {};
    const rec = empAtt.find(a => a.date === date && has(a.checkIn)) || empAtt.find(a => a.date === date);
    const inMin = rec && has(rec.checkIn) ? P.timeToMinutes(rec.checkIn) : null;
    const isLate = inMin != null && inMin > 10 * 60;
    const lines = [];

    let status;
    if (day.status === 'present' || day.status === 'half-day') {
      counts.present++;
      if (isLate) counts.late++;
      status = `${day.status === 'half-day' ? '🌗 Half day' : '✅ Present'}${isLate ? ' · ⏰ Late' : ' · On time'}`;
    } else if (['leave', 'half-leave', 'upcoming-leave'].includes(day.status)) {
      counts.leave++;
      const lv = empLeaves.find(l => l.status === 'approved' && l.startDate <= date && date <= (l.endDate || l.startDate));
      status = `🌴 Leave${lv && lv.type ? ` (${lv.type})` : ''}`;
    } else if (day.status === 'holiday') {
      status = '🎉 Holiday';
    } else if (day.status === 'absent') {
      counts.absent++;
      status = '❌ Absent — no check-in, no approved leave';
    } else {
      counts.pending++;
      status = '⏳ Not checked in yet';
    }

    lines.push(`${NUM_EMOJI[i] || '•'} *${emp.name}* (${emp.id}) — ${status}`);

    if (rec && has(rec.checkIn)) {
      const outMin = has(rec.checkOut) ? P.timeToMinutes(rec.checkOut) : null;
      const online = onlineSeconds(rec);
      let timing = `🕘 In *${rec.checkIn}*`;
      if (!isMorning) {
        if (outMin != null) {
          // Prefer real online time; old records only have check-in → check-out
          const worked = online != null ? duration(online / 60) : duration(outMin - inMin);
          timing += ` → Out *${rec.checkOut}*${worked ? ` · ⌛ ${worked}${online != null ? ' online' : ''}` : ''}`;
        } else {
          timing += ` → ⚠️ Did not check out`;
          if (online != null) timing += ` · ⌛ ${duration(online / 60)} online`;
        }
      } else if (online != null) {
        timing += ` · ⌛ ${duration(online / 60)} online`;
      }
      if (rec.activeSeconds) timing += ` · 🟢 Active ${duration(rec.activeSeconds / 60)}`;
      lines.push(`   ${timing}`);
      if (!isMorning && rec.checkoutReason) lines.push(`   ℹ️ ${rec.checkoutReason}`);

      const dev = deviceText(rec.checkInDevice);
      if (dev) lines.push(`   ${dev}`);
      const inLoc = locationText('Check-in', rec.checkInLocation, rec.checkInDistanceFromHomeKm);
      if (inLoc) lines.push(`   ${inLoc}`);
      if (!isMorning) {
        const outLoc = locationText('Check-out', rec.checkOutLocation, rec.checkOutDistanceFromHomeKm);
        if (outLoc) lines.push(`   ${outLoc}`);
      }
      if (rec.checkInNetwork === 'outside') lines.push(`   🌐 Outside office network (${rec.checkInIP})`);
      if (!rec.checkInDevice && !rec.checkInLocation) lines.push(`   _Device/location: old check-in (before tracking)_`);
      if (!isMorning) lines.push(...screenLines(rec));
    }

    if (!isMorning && (day.status === 'present' || day.status === 'half-day')) {
      const wl = worklogs[emp.id];
      if (wl) {
        const tasks = Array.isArray(wl.tasks) ? wl.tasks : [];
        const done = tasks.filter(t => t.done).length;
        const rate = wl.completionRate !== undefined ? wl.completionRate : (tasks.length ? Math.round(done / tasks.length * 100) : null);
        lines.push(`   📝 EOD: ${rate != null ? `${rate}% done` : 'submitted'}${tasks.length ? ` (${done}/${tasks.length} tasks)` : ''}${wl.hours ? ` · ${wl.hours}h` : ''}`);
      } else {
        lines.push(`   📝 ⚠️ EOD report not submitted`);
      }
    }

    lines.push(`   📊 ${new Date(`${month}-01T12:00:00`).toLocaleString('en-IN', { month: 'short' })}: Present ${num(s.present + s.halfDays * 0.5)} · Absent ${num(s.absent)} · Late ${s.late} · 🏦 Leave balance ${num(s.leave.balance)}`);
    blocks.push(lines.join('\n'));
  });

  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `👥 Team: *${employees.length}* · ✅ Present *${counts.present}* · ⏰ Late *${counts.late}* · 🌴 Leave *${counts.leave}* · ` +
         (isMorning ? `⏳ Pending *${counts.pending}*` : `❌ Absent *${counts.absent}*`) + `\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += blocks.join('\n\n');
  msg += `\n\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `_Late = check-in after 10:00 · ⌛ = online time only (offline gaps not counted) · Absent = working day with no check-in and no approved leave · Location is taken only at check-in/out._`;
  return msg;
}

  // ── Monthly attendance & leave section for the group ───────

// Same month rule as generateMonthlyReport: first 5 days of a month report on the previous month
function reportMonth(today = todayIST()) {
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(y, m - 1 - (d <= 5 ? 1 : 0), 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

async function loadSummaries(db, monthVal) {
  const [empSnap, attSnap, leaveSnap, cfgDoc] = await Promise.all([
    db.collection('employees').get(),
    db.collection('attendance').get(),
    db.collection('leaves').get(),
    db.collection('admin').doc('config').get()
  ]);
  const holidays = (cfgDoc.exists && cfgDoc.data().holidays) || [];
  const att = attSnap.docs.map(d => d.data());
  const leaves = leaveSnap.docs.map(d => d.data());
  return empSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(e => e.status === 'active')
    .map(emp => ({
      emp,
      s: P.monthSummary(emp, monthVal, att.filter(a => a.empId === emp.id),
                        leaves.filter(l => l.empId === emp.id), todayIST(), { holidays, team: P.teamCalendar(att) })
    }))
    .filter(x => x.s.joined);
}

async function groupSection(db, monthVal = reportMonth()) {
  const rows = await loadSummaries(db, monthVal);
  if (!rows.length) return '';
  const lines = rows.map(({ emp, s }) =>
    `👤 *${emp.name}*\n` +
    `   ✅ Present ${num(s.present)} · 🌗 Half ${num(s.halfDays)} · 🌴 Leave ${num(s.paidLeave + s.unpaidLeave)} · ❌ Absent ${num(s.absent)} · ⏰ Late ${num(s.late)}\n` +
    `   🏦 Leave balance: ${num(s.leave.balance)} days`
  );
  return `\n\n📋 *ATTENDANCE & LEAVE (${monthVal})*\n` + lines.join('\n') +
         `\n_Absent = working day with no check-in and no approved leave._`;
}

  // ── 7 PM screen activity report: every app and website per employee (ActivityWatch) ──

  async function buildScreenReport(db, date = todayIST()) {
    const { attendance, employees } = await loadData(db, date);
    let msg = `🖥️ *GROWTHAPEX — SCREEN ACTIVITY REPORT*
📅 *${prettyDate(date)}*
━━━━━━━━━━━━━━━━━━━━━━
`;
    const blocks = [];
    employees.forEach((emp, i) => {
      const rec = attendance.find(a => a.empId === emp.id && a.date === date && has(a.checkIn));
      const lines = [`${NUM_EMOJI[i] || '•'} *${emp.name}* (${emp.id})`];
      const act = rec && rec.screenActivity;
      if (!rec) {
        lines.push('   — Not checked in');
      } else if (!act || !Array.isArray(act.apps) || !act.apps.length) {
        lines.push(rec.checkInDevice && rec.checkInDevice.type !== 'desktop'
          ? '   🖥️ Not tracked (mobile check-in)'
          : '   ⚠️ No screen activity data (ActivityWatch not connected)');
      } else {
        lines.push(`   🟢 Active *${shortDuration(act.activeSecs || 0)}* · 💤 Idle *${shortDuration(act.idleSecs || 0)}*`);
        const programs = act.programs || act.apps;
        lines.push(act.programs ? '   🧩 *Apps:*' : '   🧩 *Apps & websites:*');
        programs.forEach(a => lines.push(`      • ${a.name} — ${shortDuration(a.secs)}`));
        if (act.sites) {
          lines.push('   🌐 *Websites:*');
          if (act.sites.length) act.sites.forEach(a => lines.push(`      • ${a.name} — ${shortDuration(a.secs)}`));
          else lines.push('      — none (no browser extension data)');
        }
        const noWeb = (act.apps || []).filter(a => / (no website data)$/.test(a.name));
        if (noWeb.length) lines.push(`   ⚠️ No website data from: ${noWeb.map(a => a.name.replace(/ (no website data)$/, '')).join(', ')} (extension not installed)`);
        if (act.updatedAt) lines.push(`   _Updated ${new Date(act.updatedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })}_`);
      }
      blocks.push(lines.join('\n'));
    });
    msg += blocks.join('\n\n');
    msg += `

━━━━━━━━━━━━━━━━━━━━━━
_Time on screen since check-in (idle time not counted) · websites = active browser tab · from ActivityWatch on each laptop._`;
    return msg;
  }

  const api = {
    buildScreenReport,
    buildAttendanceReport, generateWeeklyReport, generateMonthlyReport, groupSection,
    loadSummaries, reportMonth, isCheckInLate, formatDateString, getHolidaysForMonth,
    getActiveEmployees, isEmployeeOnLeave, todayIST
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EMS_REPORTS = api;
})(typeof window !== 'undefined' ? window : this);
