const $ = id => document.getElementById(id);
const clock = s => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), Math.floor(s % 60)].map(n => String(n).padStart(2, '0')).join(':');
const mins = s => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
let last = null;

function render(s) {
  last = s;
  if (!s) return;
  if (s.me) {
    const first = String(s.me.name || s.me.empId).split(' ')[0];
    $('hello').textContent = `${greeting()}, ${first}`;
    $('avatar').textContent = String(s.me.name || s.me.empId).split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    $('avatar').title = `${s.me.name} · ${s.me.empId} · ${s.me.email}`;
  }
  const st = $('status');
  const [cls, label] = !s.running ? ['s-off', 'Checked out'] : s.onBreak ? ['s-break', 'On break'] : s.paused ? ['s-idle', 'Screen locked'] : s.idle ? ['s-idle', 'Idle'] : ['s-on', 'Working'];
  st.className = `status ${cls}`; st.textContent = label;
  const out = s.checkOut && s.checkOut !== '—';
  $('inout').textContent = !s.checkIn || s.checkIn === '—' ? 'Not checked in yet'
    : `Checked in ${s.checkIn}${out ? ` · Out ${s.checkOut}` : ''}${s.breakSecs >= 60 ? ` · Break ${mins(s.breakSecs)}` : ''}`;
  const live = s.running && !s.onBreak && !s.paused && s.beatAt ? Math.min(120, Math.max(0, (Date.now() - s.beatAt) / 1000)) : 0;
  $('worked').textContent = clock((s.workedSecs || 0) + live);
  $('checkin').disabled = s.running;
  $('checkout').disabled = !s.running;
  $('break').disabled = !s.running;
  $('break').textContent = s.onBreak ? '▶ End break' : '☕ Start break';
  $('privacy').textContent = s.running
    ? 'Work tracking is on while you are checked in. Your activity is shared with the GrowthApex admin.'
    : 'Tracking is off — nothing is recorded while you are checked out.';

  const t = s.projectTimer;
  $('timer-running').textContent = t ? `▶ ${t.project}${t.note ? ` — ${t.note}` : ''} · ${clock((Date.now() - Date.parse(t.start)) / 1000)}` : 'No project running';
  $('pstart').disabled = !s.running;
  $('pstop').disabled = !t;
  const dl = $('projects');
  if (dl.childElementCount !== (s.projects || []).length) dl.innerHTML = (s.projects || []).map(p => `<option value="${String(p).replace(/"/g, '&quot;')}">`).join('');
  $('err').textContent = s.lastError ? `⚠️ ${s.lastError}` : '';
  if (s.running && !s.idle && !s.lastError) $('siren').classList.remove('show');
}

const act = (fn) => async () => { try { await fn(); } catch (e) { $('err').textContent = String(e.message || e); } render(await window.tracker.state()); };
$('checkin').onclick = act(() => window.tracker.checkIn());
$('checkout').onclick = act(() => window.tracker.checkOut());
$('break').onclick = act(() => window.tracker.setBreak(!(last && last.onBreak)));
$('pstart').onclick = act(() => window.tracker.startProject($('project').value || 'General', $('note').value));
$('pstop').onclick = act(() => window.tracker.stopProject());
$('logout').onclick = act(() => window.tracker.logout());
$('upd-check').onclick = e => window.checkForUpdates(e.currentTarget);

window.tracker.onState(render);
window.tracker.state().then(render);
setInterval(() => { if (last) render(last); }, 1000);

window.tracker.permissions().then(p => {
  if (!p.mac) return;
  const missing = [];
  if (p.screen !== 'granted') missing.push('<b>Screen Recording</b>');
  if (!p.accessibility) missing.push('<b>Accessibility</b>');
  if (missing.length) $('perm').innerHTML = `<span>⚠️</span><span>Please allow ${missing.join(' and ')} for GrowthApex Tracker in System Settings → Privacy &amp; Security, then quit and reopen the app.</span>`;
});
