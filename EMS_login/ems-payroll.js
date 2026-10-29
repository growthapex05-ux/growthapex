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
//  • Leave: 1.5 days every month, reset at the start of each month — unused leave does not carry
//    over (admin's customLeaveCredit is added once, in the joining month).
//    Approved leave is PAID while that month's balance lasts; leave beyond it is UNPAID.
//    Absent days do not use the leave balance — they are always unpaid.
//  • Holidays (admin/config.holidays) are paid days off, never absent.
//  • Days before the attendance system was in use, and days on which nobody in the team has any
//    record (office closed / system down), are paid and never absent (opts.team = teamCalendar()).
//  • Leave requests saved with from/to (older format) are read as well as startDate/endDate.
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
      // Older leave requests were saved with from/to instead of startDate/endDate
      const start = [l.startDate, l.from, l.fromDate].find(validDate);
      if (l.status !== 'approved' || !start) return;
      const unit = /half/i.test(l.type || '') ? 0.5 : 1;
      const end = [l.endDate, l.to, l.toDate].find(validDate) || start;
      const cur = new Date(`${start}T12:00:00`);
      const last = new Date(`${end}T12:00:00`);
      while (cur <= last) {
        const ds = cur.toLocaleDateString('en-CA');
        if (isWorkingDay(ds)) map[ds] = Math.max(map[ds] || 0, unit);
        cur.setDate(cur.getDate() + 1);
      }
    });
    return map;
  }

  /**
   * Team-wide context for monthSummary(opts.team), built from ALL employees' attendance:
   *  trackingStart = first day anyone has a record (system went live) — earlier days are never absent
   *  openDays      = days on which at least one employee has any record — other days = office closed
   */
  function teamCalendar(allAttendance) {
    const days = new Set();
    (allAttendance || []).forEach(a => { if (a && a.date) days.add(String(a.date).slice(0, 10)); });
    const sorted = [...days].filter(validDate).sort();
    return { trackingStart: sorted[0] || null, openDays: sorted };
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
    // Team context from teamCalendar(): first day the system was used + days anyone had a record
    const trackingStart = opts && opts.team ? opts.team.trackingStart : null;
    const openDays = opts && opts.team ? new Set(opts.team.openDays) : null;
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
      eligibleWorkingDays: 0, present: 0, halfDays: 0, worked: 0, holidays: 0, notTracked: 0, officeClosed: 0,
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
    let balance = 0;
    let accrued = 0;
    let used = 0;
    let lastCreditMonth = '';

    while (cur <= last) {
      const ds = cur.toLocaleDateString('en-CA');
      const ym = ds.slice(0, 7);
      cur.setDate(cur.getDate() + 1);

      // Leave resets every month: unused leave does not carry over
      if (ym !== lastCreditMonth) {
        const extra = lastCreditMonth ? 0 : Number(emp.customLeaveCredit || 0);
        balance = accrued = MONTHLY_LEAVE_CREDIT + extra;
        used = 0;
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
      // Before the attendance system was in use there is no data -> paid, never absent
      else if (trackingStart && ds < trackingStart && day.absent > 0) day = { status: 'not-tracked', worked: 0, leave: 0, absent: 0 };
      // Nobody in the team has any record that day -> office closed / system down -> paid, never absent
      else if (openDays && ds < today && !openDays.has(ds) && day.absent > 0) day = { status: 'office-closed', worked: 0, leave: 0, absent: 0 };

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
      if (day.status === 'not-tracked') result.notTracked++;
      if (day.status === 'office-closed') result.officeClosed++;
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
    const earnedSoFar = Math.round(perDay * (result.worked + result.paidLeave + result.holidays + result.notTracked + result.officeClosed));
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
    'office-closed':  ['#a78bfa', 'Office closed (no records)'],
    'not-tracked':    ['#94a3b8', 'Before system start'],
    sunday:           ['#475569', 'Sunday'],
    pending:          ['#64748b', 'Today'],
    upcoming:         ['#cbd5e1', 'Upcoming'],
    'upcoming-leave': ['#0e7490', 'Leave (upcoming)']
  };

  function money(n) { return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN'); }
  function num(n) { return Number.isInteger(n) ? String(n) : Number(n).toFixed(1); }

  function summaryHtml(r) {
    if (!r.joined) return '<div style="padding:16px;color:var(--muted,#94a3b8)">Not joined yet in this month.</div>';
    const monthName = new Date(`${r.monthVal}-01T12:00:00`).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
    const s = r.salary;
    const stat = (label, value, color, sub) => `
      <div style="background:var(--soft,#f8fafc);border:1px solid var(--border,#e6e9f0);border-radius:10px;padding:10px 12px;min-width:0">
        <div style="font-size:11px;color:var(--muted,#94a3b8)">${label}</div>
        <div style="font-size:20px;font-weight:800;color:${color || 'var(--text,#e2e8f0)'};line-height:1.3">${value}</div>
        ${sub ? `<div style="font-size:11px;color:var(--muted,#94a3b8)">${sub}</div>` : ''}
      </div>`;
    const row = (label, value, color, bold) => `
      <div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px dashed var(--border,#e6e9f0)${bold ? ';font-weight:800;font-size:15px' : ''}">
        <span style="color:var(--muted,#94a3b8)">${label}</span><span style="color:${color || 'var(--text,#e2e8f0)'};white-space:nowrap">${value}</span>
      </div>`;
    const doneDays = r.eligibleWorkingDays - r.upcomingWorkingDays + (r.pendingToday ? 1 : 0);
    const activeH = r.activeSeconds ? `${Math.floor(r.activeSeconds / 3600)}h ${Math.round((r.activeSeconds % 3600) / 60)}m active` : '';

    const strip = r.days.map(d => {
      const [color, label] = DAY_STYLE[d.status] || ['#334155', d.status];
      const extra = d.unpaidLeave ? ' (unpaid)' : d.paidLeave ? ' (paid)' : '';
      const title = `${d.date} — ${label}${extra}${d.checkIn ? ` · In ${d.checkIn}` : ''}${d.checkOut && d.checkOut !== '—' ? ` · Out ${d.checkOut}` : ''}`;
      return `<div title="${title}" style="width:26px;height:26px;border-radius:6px;background:${color};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:${d.status === 'upcoming' ? '#475569' : '#fff'}">${Number(d.date.slice(8))}</div>`;
    }).join('');
    const legendKeys = ['present', 'half-day', 'leave', 'absent', 'holiday', 'office-closed', 'not-tracked', 'sunday', 'upcoming']
      .filter(k => ['present', 'absent', 'sunday'].includes(k) || r.days.some(d => d.status === k));
    const legend = legendKeys.map(k => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px"><span style="width:10px;height:10px;border-radius:3px;background:${DAY_STYLE[k][0]}"></span>${DAY_STYLE[k][1]}</span>`).join('');

    return `
      <div style="font-size:13px">
        <div style="font-weight:700;margin-bottom:10px">📅 ${monthName} ${s.monthOver ? '' : `<span style="font-size:11px;color:var(--muted,#94a3b8);font-weight:400">(summary till today · ${r.upcomingWorkingDays} working days left)</span>`}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:12px">
          ${stat('✅ Present', num(r.present), '#059669', `of ${doneDays} working days`)}
          ${stat('🌗 Half day', num(r.halfDays), '#d97706')}
          ${stat('🌴 Leave', num(r.paidLeave + r.unpaidLeave), '#0891b2', `${num(r.paidLeave)} paid · ${num(r.unpaidLeave)} unpaid`)}
          ${stat('❌ Absent', num(r.absent), '#dc2626', 'No check-in, no leave')}
          ${stat('⏰ Late', num(r.late), '#d97706', 'After 10:00')}
          ${r.holidays ? stat('🎉 Holiday', num(r.holidays), '#7c3aed', 'Paid') : ''}
          ${r.officeClosed ? stat('🏢 Office closed', num(r.officeClosed), '#7c3aed', 'No records · paid') : ''}
          ${r.notTracked ? stat('🕓 Before tracking', num(r.notTracked), '#64748b', 'System not in use · paid') : ''}
          ${stat('🏦 Leave balance', num(r.leave.balance), '#2563eb', `${num(r.leave.accrued)} credited · ${num(r.leave.used)} used`)}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">${strip}</div>
        <div style="font-size:11px;color:var(--muted,#94a3b8);margin-bottom:14px">${legend}${activeH ? ` · ⏱ ${activeH}` : ''}</div>
        <div style="max-width:480px">
          ${row('Monthly salary', money(r.baseSalary))}
          ${row(`Per day (${r.totalWorkingDays} working days)`, money(r.perDay))}
          ${row(s.monthOver ? 'Earned this month' : 'Earned so far', money(s.earnedSoFar), '#059669')}
          ${row(`Deduction (${num(r.unpaidDays)} unpaid days)`, s.deduction ? '-' + money(s.deduction) : '₹0', s.deduction ? '#dc2626' : '')}
          ${row('Advance deduction', s.advance ? '-' + money(s.advance) : '₹0', s.advance ? '#dc2626' : '')}
          ${row(s.monthOver ? 'Net payable' : 'Net (so far)', money(s.netSoFar), '#059669', true)}
          ${s.monthOver ? '' : row('If full month attended (estimate)', money(s.netPayable), 'var(--cyan,#22d3ee)')}
        </div>
        <div style="font-size:11px;color:var(--muted,#94a3b8);margin-top:10px;line-height:1.5">
          Rules: Mon–Sat working · Sundays and holidays paid · no check-in and no approved leave = absent (unpaid) ·
          ${MONTHLY_LEAVE_CREDIT} leave every month (resets monthly), leave paid up to balance · late = check-in after 10:00.
        </div>
      </div>`;
  }

  // Today's state from the attendance record (+ approved leave)
  function todayState(r, todayRec) {
    const d = r.days.find(x => x.date === r.today);
    if (d && d.status === 'sunday') return { label: 'Sunday', color: '#64748b', bg: '#f1f5f9' };
    if (d && d.status === 'holiday') return { label: 'Holiday', color: '#7c3aed', bg: '#ede9fe' };
    if (d && (d.status === 'leave' || d.status === 'upcoming-leave')) return { label: 'On leave', color: '#0891b2', bg: '#cffafe' };
    if (todayRec && todayRec.checkIn && todayRec.checkIn !== '—') {
      const out = todayRec.checkOut && todayRec.checkOut !== '—';
      return out ? { label: `Checked out ${todayRec.checkOut}`, color: '#475569', bg: '#f1f5f9' }
                 : { label: `Working · In ${todayRec.checkIn}`, color: '#16a34a', bg: '#dcfce7' };
    }
    return { label: 'Not checked in', color: '#dc2626', bg: '#fee2e2' };
  }

  // Compact card for the admin "Team ka Hisaab" grid
  function teamCardHtml(emp, r, todayRec, onClick) {
    const s = r.salary;
    const st = todayState(r, todayRec);
    const initials = (emp.name || emp.id || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const pct = s.gross ? Math.min(100, Math.round(s.earnedSoFar / s.gross * 100)) : 0;
    return `
      <div class="hx-card" onclick="${onClick || ''}">
        <div class="hx-head">
          <div class="hx-avatar">${initials}</div>
          <div style="flex:1;min-width:0">
            <div class="hx-name">${emp.name || emp.id}</div>
            <div class="hx-sub">${emp.id}${emp.designation ? ' · ' + emp.designation : ''}</div>
          </div>
          <span style="font-size:11px;font-weight:700;color:${st.color};background:${st.bg};padding:4px 10px;border-radius:999px;white-space:nowrap">${st.label}</span>
        </div>
        <div class="hx-mini">
          <div><b style="color:#059669">${num(r.present + r.halfDays * 0.5)}</b><span>Present</span></div>
          <div><b style="color:#dc2626">${num(r.absent)}</b><span>Absent</span></div>
          <div><b style="color:#0891b2">${num(r.paidLeave + r.unpaidLeave)}</b><span>Leave</span></div>
          <div><b style="color:#2563eb">${num(r.leave.balance)}</b><span>Balance</span></div>
        </div>
        <div class="hx-row"><span>Earned so far</span><b>${money(s.earnedSoFar)} <span style="font-weight:500;color:var(--muted)">/ ${money(s.gross)}</span></b></div>
        <div class="hx-bar"><div style="width:${pct}%"></div></div>
        <div class="hx-row"><span>Deduction ${s.deduction ? `<b style="color:#dc2626">-${money(s.deduction)}</b>` : '₹0'} · Late ${r.late}</span><span>Net (est.) <b>${money(s.netPayable)}</b></span></div>
      </div>`;
  }

  // Employee dashboard banner: today + this month at a glance
  function heroHtml(emp, r, todayRec) {
    const st = todayState(r, todayRec);
    const s = r.salary;
    const hour = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }));
    const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    return `
      <div class="hx-hero">
        <div>
          <h3>${greet}, ${(emp.name || '').split(' ')[0] || 'there'} 👋</h3>
          <p>Today: <b>${st.label}</b> · This month ${num(r.present + r.halfDays * 0.5)} days present · ${r.upcomingWorkingDays} working days left</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <span class="hx-pill">🏦 ${num(r.leave.balance)} leave left</span>
          <span class="hx-pill">💰 ${money(s.earnedSoFar)} earned</span>
        </div>
      </div>`;
  }

  const api = { teamCalendar, monthSummary, summaryHtml, teamCardHtml, heroHtml, todayState, workingDaysInMonth, istToday, timeToMinutes, MONTHLY_LEAVE_CREDIT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EMS_PAYROLL = api;
})(typeof window !== 'undefined' ? window : this);
