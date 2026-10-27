// ============================================================
// EMS Payroll & Attendance Calculator — single source of truth
// Used by: employee dashboard, admin dashboard (browser global EMS_PAYROLL)
//          and the WhatsApp automation (require('../ems-payroll')).
//
// Rules
//  • Working days = Monday–Saturday. Sundays are paid off.
//  • Salary per day = monthly salary ÷ working days in that month.
//  • Present = 1 day, Half-day = ½ worked + ½ leave.
//  • A past working day with no check-in and no approved leave = ABSENT (unpaid).
//  • Leave: 1.5 days credited every month from the joining month (+ admin's customLeaveCredit once).
//    Approved leave is PAID while balance lasts; leave beyond the balance is UNPAID.
//    Absent days do not use the leave balance — they are always unpaid.
//  • Holidays (admin/config.holidays) are paid days off, never absent.
//  • Today is "pending" until the day is over (not absent yet). Future days are "upcoming".
// ============================================================
(function (root) {
  const MONTHLY_LEAVE_CREDIT = 1.5;
  const LATE_AFTER_MIN = 10 * 60; // check-in after 10:00 = late

  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }
  function isWorkingDay(dateStr) { return new Date(`${dateStr}T12:00:00`).getDay() !== 0; }
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
  function istToday() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); }
  function validDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

  function workingDaysInMonth(y, m) {
    let n = 0;
    for (let d = 1; d <= daysInMonth(y, m); d++) if (isWorkingDay(ymd(y, m, d))) n++;
    return n;
  }

  // "10:17:16" / "10:17" / "06:42 PM" -> minutes since midnight
  function timeToMinutes(t) {
    if (!t || t === '—') return null;
    const m = String(t).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (m[3]) {
      const pm = m[3].toUpperCase() === 'PM';
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
    }
    return h * 60 + min;
  }

  function hasCheckIn(rec) { return rec && rec.checkIn && rec.checkIn !== '—'; }

  // Approved leave requests -> { 'YYYY-MM-DD': 1 | 0.5 }
  function approvedLeaveMap(leaves) {
    const map = {};
    (leaves || []).forEach(l => {
      if (l.status !== 'approved' || !validDate(l.startDate)) return;
      const unit = /half/i.test(l.type || '') ? 0.5 : 1;
      const end = validDate(l.endDate) ? l.endDate : l.startDate;
      const cur = new Date(`${l.startDate}T12:00:00`);
      const last = new Date(`${end}T12:00:00`);
      while (cur <= last) {
        const ds = cur.toLocaleDateString('en-CA');
        if (isWorkingDay(ds)) map[ds] = Math.max(map[ds] || 0, unit);
        cur.setDate(cur.getDate() + 1);
      }
    });
    return map;
  }

  // Attendance records -> { date: record } (prefers the record that has a check-in)
  function attendanceMap(attendance) {
    const map = {};
    (attendance || []).forEach(a => {
      if (!a || !a.date) return;
      const d = String(a.date).split('T')[0];
      if (!map[d] || (!hasCheckIn(map[d]) && hasCheckIn(a))) map[d] = a;
    });
    return map;
  }

  /**
   * What happened on one working day.
   * Returns { status, worked, leave, absent } where worked/leave/absent are day fractions.
   * status: present | half-day | leave | half-leave | absent | pending | upcoming | upcoming-leave
   */
  function classifyDay(date, today, rec, leaveUnit) {
    const isPast = date < today;
    const isToday = date === today;
    const st = rec && rec.status;

    if (st === 'leave') return { status: 'leave', worked: 0, leave: 1, absent: 0 };
    if (st === 'half-day') return { status: 'half-day', worked: 0.5, leave: 0.5, absent: 0 };
    if (st === 'absent' && !leaveUnit) return { status: 'absent', worked: 0, leave: 0, absent: 1 };

    if (hasCheckIn(rec) || st === 'present') {
      if (leaveUnit === 0.5) return { status: 'half-day', worked: 0.5, leave: 0.5, absent: 0 };
      return { status: 'present', worked: 1, leave: 0, absent: 0 };
    }

    if (leaveUnit === 1) {
      return (isPast || isToday) ? { status: 'leave', worked: 0, leave: 1, absent: 0 }
                                 : { status: 'upcoming-leave', worked: 0, leave: 0, absent: 0 };
    }
    if (leaveUnit === 0.5) {
      if (isPast) return { status: 'half-leave', worked: 0, leave: 0.5, absent: 0.5 };
      return { status: isToday ? 'pending' : 'upcoming-leave', worked: 0, leave: 0, absent: 0 };
    }

    if (isPast) return { status: 'absent', worked: 0, leave: 0, absent: 1 };
    return { status: isToday ? 'pending' : 'upcoming', worked: 0, leave: 0, absent: 0 };
  }

  /**
   * Full month summary for one employee.
   * @param emp        employee doc ({ id, salary, joinDate, customLeaveCredit, advanceDeduction })
   * @param monthVal   'YYYY-MM'
   * @param attendance this employee's attendance records (all time)
   * @param leaves     this employee's leave requests (all time)
   * @param today      'YYYY-MM-DD' (defaults to today in IST)
   * @param opts       { holidays: ['YYYY-MM-DD', ...] }
   */
  function monthSummary(emp, monthVal, attendance, leaves, today, opts) {
    const holidays = new Set((opts && opts.holidays) || []);
    today = today || istToday();
    const [y, m] = monthVal.split('-').map(Number);
    const monthStart = ymd(y, m, 1);
    const monthEnd = ymd(y, m, daysInMonth(y, m));
    const baseSalary = Number(emp.salary || 0);
    const totalWorkingDays = workingDaysInMonth(y, m);
    const perDay = totalWorkingDays ? Math.round(baseSalary / totalWorkingDays) : 0;
    const joinDate = validDate(emp.joinDate) ? emp.joinDate : null;
    const advance = emp.advanceDeduction !== undefined && emp.advanceDeduction !== '' ? Number(emp.advanceDeduction) || 0 : 0;

    const result = {
      empId: emp.id, name: emp.name, monthVal, today, baseSalary, perDay, totalWorkingDays,
      joined: !joinDate || joinDate <= monthEnd,
      eligibleWorkingDays: 0, present: 0, halfDays: 0, worked: 0, holidays: 0,
      paidLeave: 0, unpaidLeave: 0, absent: 0, late: 0, activeSeconds: 0,
      pendingToday: false, upcomingWorkingDays: 0, upcomingLeave: 0,
      days: [],
      leave: { creditPerMonth: MONTHLY_LEAVE_CREDIT, accrued: 0, used: 0, balance: 0 },
      salary: {}
    };

    const attMap = attendanceMap(attendance);
    const leaveMap = approvedLeaveMap(leaves);

    // Walk every day from joining (or this month) to the end of this month, keeping a running
    // leave balance so we know which leave days are paid.
    const startStr = joinDate || monthStart;
    const cur = new Date(`${startStr}T12:00:00`);
    const last = new Date(`${monthEnd}T12:00:00`);
    let balance = Number(emp.customLeaveCredit || 0);
    let accrued = balance;
    let used = 0;
    let lastCreditMonth = '';

    while (cur <= last) {
      const ds = cur.toLocaleDateString('en-CA');
      const ym = ds.slice(0, 7);
      cur.setDate(cur.getDate() + 1);

      if (ym !== lastCreditMonth) {
        balance += MONTHLY_LEAVE_CREDIT;
        accrued += MONTHLY_LEAVE_CREDIT;
        lastCreditMonth = ym;
      }
      if (!isWorkingDay(ds)) {
        if (ym === monthVal) result.days.push({ date: ds, status: 'sunday' });
        continue;
      }

      const rec = attMap[ds];
      let day = classifyDay(ds, today, rec, leaveMap[ds]);
      // A holiday is a paid day off unless the employee actually worked that day
      if (holidays.has(ds) && day.worked === 0) day = { status: 'holiday', worked: 0, leave: 0, absent: 0 };

      // Leave is paid while there is balance
      let paid = 0, unpaid = 0;
      if (day.leave > 0) {
        paid = Math.min(day.leave, Math.max(0, balance));
        unpaid = +(day.leave - paid).toFixed(2);
        balance = +(balance - paid).toFixed(2);
        used = +(used + day.leave).toFixed(2);
      }

      if (ym !== monthVal) continue;

      result.eligibleWorkingDays++;
      result.worked += day.worked;
      result.paidLeave += paid;
      result.unpaidLeave += unpaid;
      result.absent += day.absent;
      if (day.status === 'present') result.present++;
      if (day.status === 'holiday' && ds <= today) result.holidays++;
      if (day.status === 'half-day') result.halfDays++;
      if (day.status === 'pending') result.pendingToday = true;
      if (day.status === 'upcoming' || day.status === 'upcoming-leave' || day.status === 'pending') result.upcomingWorkingDays++;
      if (day.status === 'upcoming-leave') result.upcomingLeave++;
      if (hasCheckIn(rec)) {
        const mins = timeToMinutes(rec.checkIn);
        if (mins != null && mins > LATE_AFTER_MIN) result.late++;
        result.activeSeconds += Number(rec.activeSeconds || 0);
      }
      result.days.push({ date: ds, status: day.status, paidLeave: paid, unpaidLeave: unpaid,
                         checkIn: rec?.checkIn || null, checkOut: rec?.checkOut || null });
    }

    // Leave balance as of today (or month end for past months)
    result.leave.accrued = +accrued.toFixed(2);
    result.leave.used = used;
    result.leave.balance = +Math.max(0, balance).toFixed(2);

    // Salary
    const gross = result.joined && totalWorkingDays
      ? Math.round(baseSalary * result.eligibleWorkingDays / totalWorkingDays) : 0; // full month if attended every day
    const unpaidDays = +(result.absent + result.unpaidLeave).toFixed(2);
    const deduction = Math.round(perDay * unpaidDays);
    const earnedSoFar = Math.round(perDay * (result.worked + result.paidLeave + result.holidays));
    const monthTotal = Math.max(0, gross - deduction); // what the month pays if the remaining days are attended
    const monthOver = today > monthEnd;

    result.unpaidDays = unpaidDays;
    result.salary = {
      gross,
      deduction,
      earnedSoFar: monthOver ? monthTotal : earnedSoFar,
      monthTotal,
      advance,
      netSoFar: Math.max(0, (monthOver ? monthTotal : earnedSoFar) - advance),
      netPayable: Math.max(0, monthTotal - advance),
      monthOver
    };
    result.worked = +result.worked.toFixed(2);
    result.paidLeave = +result.paidLeave.toFixed(2);
    result.unpaidLeave = +result.unpaidLeave.toFixed(2);
    result.absent = +result.absent.toFixed(2);
    return result;
  }

  // ── HTML card (browser dashboards) ────────────────────────
  const DAY_STYLE = {
    present:          ['#10b981', 'Present'],
    'half-day':       ['#f59e0b', 'Half day'],
    leave:            ['#06b6d4', 'Leave'],
    'half-leave':     ['#06b6d4', 'Half leave'],
    absent:           ['#ef4444', 'Absent'],
    holiday:          ['#8b5cf6', 'Holiday'],
    sunday:           ['#475569', 'Sunday'],
    pending:          ['#94a3b8', 'Today'],
    upcoming:         ['#1e293b', 'Upcoming'],
    'upcoming-leave': ['#0e7490', 'Leave (upcoming)']
  };

  function money(n) { return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN'); }
  function num(n) { return Number.isInteger(n) ? String(n) : Number(n).toFixed(1); }

  function summaryHtml(r) {
    if (!r.joined) return '<div style="padding:16px;color:var(--muted,#94a3b8)">Is mahine join nahi kiya tha.</div>';
    const monthName = new Date(`${r.monthVal}-01T12:00:00`).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
    const s = r.salary;
    const stat = (label, value, color, sub) => `
      <div style="background:var(--card2,rgba(255,255,255,.04));border:1px solid var(--border,rgba(255,255,255,.08));border-radius:10px;padding:10px 12px;min-width:0">
        <div style="font-size:11px;color:var(--muted,#94a3b8)">${label}</div>
        <div style="font-size:20px;font-weight:800;color:${color || 'var(--text,#e2e8f0)'};line-height:1.3">${value}</div>
        ${sub ? `<div style="font-size:11px;color:var(--muted,#94a3b8)">${sub}</div>` : ''}
      </div>`;
    const row = (label, value, color, bold) => `
      <div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px dashed var(--border,rgba(255,255,255,.08))${bold ? ';font-weight:800;font-size:15px' : ''}">
        <span style="color:var(--muted,#94a3b8)">${label}</span><span style="color:${color || 'var(--text,#e2e8f0)'};white-space:nowrap">${value}</span>
      </div>`;
    const doneDays = r.eligibleWorkingDays - r.upcomingWorkingDays + (r.pendingToday ? 1 : 0);
    const activeH = r.activeSeconds ? `${Math.floor(r.activeSeconds / 3600)}h ${Math.round((r.activeSeconds % 3600) / 60)}m active` : '';

    const strip = r.days.map(d => {
      const [color, label] = DAY_STYLE[d.status] || ['#334155', d.status];
      const extra = d.unpaidLeave ? ' (unpaid)' : d.paidLeave ? ' (paid)' : '';
      const title = `${d.date} — ${label}${extra}${d.checkIn ? ` · In ${d.checkIn}` : ''}${d.checkOut && d.checkOut !== '—' ? ` · Out ${d.checkOut}` : ''}`;
      return `<div title="${title}" style="width:26px;height:26px;border-radius:6px;background:${color};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;opacity:${d.status === 'upcoming' ? .5 : 1}">${Number(d.date.slice(8))}</div>`;
    }).join('');
    const legendKeys = ['present', 'half-day', 'leave', 'absent', 'holiday', 'sunday', 'upcoming'];
    const legend = legendKeys.map(k => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px"><span style="width:10px;height:10px;border-radius:3px;background:${DAY_STYLE[k][0]}"></span>${DAY_STYLE[k][1]}</span>`).join('');

    return `
      <div style="font-size:13px">
        <div style="font-weight:700;margin-bottom:10px">📅 ${monthName} ${s.monthOver ? '' : `<span style="font-size:11px;color:var(--muted,#94a3b8);font-weight:400">(aaj tak ka hisaab · ${r.upcomingWorkingDays} working din baaki)</span>`}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:12px">
          ${stat('✅ Present', num(r.present), '#34d399', `${doneDays} working din mein`)}
          ${stat('🌗 Half day', num(r.halfDays), '#fbbf24')}
          ${stat('🌴 Leave', num(r.paidLeave + r.unpaidLeave), '#67e8f9', `${num(r.paidLeave)} paid · ${num(r.unpaidLeave)} unpaid`)}
          ${stat('❌ Absent', num(r.absent), '#f87171', 'Check-in nahi, leave nahi')}
          ${stat('⏰ Late', num(r.late), '#fbbf24', '10:00 ke baad')}
          ${r.holidays ? stat('🎉 Holiday', num(r.holidays), '#a78bfa', 'Paid') : ''}
          ${stat('🏦 Leave balance', num(r.leave.balance), '#38bdf8', `${num(r.leave.accrued)} mile · ${num(r.leave.used)} use`)}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">${strip}</div>
        <div style="font-size:11px;color:var(--muted,#94a3b8);margin-bottom:14px">${legend}${activeH ? ` · ⏱ ${activeH}` : ''}</div>
        <div style="max-width:480px">
          ${row('Monthly salary', money(r.baseSalary))}
          ${row(`Per day (${r.totalWorkingDays} working days)`, money(r.perDay))}
          ${row(s.monthOver ? 'Earned this month' : 'Ab tak kamaya', money(s.earnedSoFar), '#34d399')}
          ${row(`Katauti (${num(r.unpaidDays)} unpaid din)`, s.deduction ? '-' + money(s.deduction) : '₹0', s.deduction ? '#f87171' : '')}
          ${row('Advance deduction', s.advance ? '-' + money(s.advance) : '₹0', s.advance ? '#f87171' : '')}
          ${row(s.monthOver ? 'Net payable' : 'Net (ab tak)', money(s.netSoFar), '#34d399', true)}
          ${s.monthOver ? '' : row('Poora mahina aaye to (estimate)', money(s.netPayable), 'var(--cyan,#22d3ee)')}
        </div>
        <div style="font-size:11px;color:var(--muted,#94a3b8);margin-top:10px;line-height:1.5">
          Niyam: Mon–Sat working · Sunday aur holiday paid · bina check-in aur bina approved leave = absent (unpaid) ·
          har mahine ${MONTHLY_LEAVE_CREDIT} leave milti hai, balance tak leave paid · late = 10:00 ke baad check-in.
        </div>
      </div>`;
  }

  const api = { monthSummary, summaryHtml, workingDaysInMonth, istToday, MONTHLY_LEAVE_CREDIT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EMS_PAYROLL = api;
})(typeof window !== 'undefined' ? window : this);
