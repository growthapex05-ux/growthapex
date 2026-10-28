// New WhatsApp attendance reports (morning + evening/daily) with full detail per employee:
// check-in/out, hours, active time, device, location (Google Maps), distance from home,
// network, late, EOD work log and the month's present / absent / leave balance.
// Month numbers use the same rules as the dashboards (../ems-payroll.js).

const P = require('../ems-payroll');
const { todayIST } = require('./outbox');

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

function deviceText(d) {
  if (!d || !d.type) return null;
  const icon = d.type === 'desktop' ? '💻' : '📱';
  return `${icon} ${d.type.charAt(0).toUpperCase() + d.type.slice(1)}${d.os ? ` · ${d.os} ${d.browser || ''}`.trimEnd() : ''}`;
}

function locationText(label, loc, distKm) {
  if (!loc) return null;
  if (loc.error) return `📍 ${label}: ❌ ${loc.error === 'denied' ? 'Location permission band' : 'Location nahi mili'}`;
  let home = '';
  if (distKm != null) home = distKm > HOME_RADIUS_KM ? ` · 🏠 Ghar se *${distKm} km door* ⚠️` : ' · 🏠 Ghar se';
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
  if (sentLate) msg += `⏰ _Ye report time par auto-send nahi ho payi thi — ab bheji ja rahi hai._\n`;
  if (holidays.includes(date)) msg += `🎉 _Aaj office holiday hai._\n`;

  const counts = { present: 0, late: 0, leave: 0, absent: 0, pending: 0 };
  const blocks = [];

  employees.forEach((emp, i) => {
    const empAtt = attendance.filter(a => a.empId === emp.id);
    const empLeaves = leaves.filter(l => l.empId === emp.id);
    const s = P.monthSummary(emp, month, empAtt, empLeaves, asOf, { holidays });
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
      status = '❌ Absent — check-in nahi, approved leave nahi';
    } else {
      counts.pending++;
      status = '⏳ Abhi tak check-in nahi';
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
          timing += ` → ⚠️ Check-out nahi kiya`;
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
      if (rec.checkInNetwork === 'outside') lines.push(`   🌐 Office network se bahar (${rec.checkInIP})`);
      if (!rec.checkInDevice && !rec.checkInLocation) lines.push(`   _Device/location: purana check-in (tracking se pehle)_`);
    }

    if (!isMorning && (day.status === 'present' || day.status === 'half-day')) {
      const wl = worklogs[emp.id];
      if (wl) {
        const tasks = Array.isArray(wl.tasks) ? wl.tasks : [];
        const done = tasks.filter(t => t.done).length;
        const rate = wl.completionRate !== undefined ? wl.completionRate : (tasks.length ? Math.round(done / tasks.length * 100) : null);
        lines.push(`   📝 EOD: ${rate != null ? `${rate}% done` : 'submitted'}${tasks.length ? ` (${done}/${tasks.length} tasks)` : ''}${wl.hours ? ` · ${wl.hours}h` : ''}`);
      } else {
        lines.push(`   📝 ⚠️ EOD report nahi bhara`);
      }
    }

    lines.push(`   📊 ${new Date(`${month}-01T12:00:00`).toLocaleString('en-IN', { month: 'short' })}: Present ${num(s.present + s.halfDays * 0.5)} · Absent ${num(s.absent)} · Late ${s.late} · 🏦 Leave balance ${num(s.leave.balance)}`);
    blocks.push(lines.join('\n'));
  });

  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `👥 Team: *${employees.length}* · ✅ Present *${counts.present}* · ⏰ Late *${counts.late}* · 🌴 Leave *${counts.leave}* · ` +
         (isMorning ? `⏳ Baaki *${counts.pending}*` : `❌ Absent *${counts.absent}*`) + `\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += blocks.join('\n\n');
  msg += `\n\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `_Late = 10:00 ke baad check-in · ⌛ = sirf online time (offline gap nahi gina jaata) · Absent = working din bina check-in aur bina approved leave · Location sirf check-in/out ke time li jaati hai._`;
  return msg;
}

module.exports = { buildAttendanceReport };
