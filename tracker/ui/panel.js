const $ = id => document.getElementById(id);
const clock = s => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), Math.floor(s % 60)].map(n => String(n).padStart(2, '0')).join(':');
const mins = s => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
let last = null;

function render(s) {
  last = s;
  if (!s) return;
  if (s.me) { $('name').textContent = s.me.name; $('sub').textContent = `${s.me.empId} · ${s.me.email}`; }
  const st = $('status');
  const [cls, label] = !s.running ? ['s-off', 'Checked out'] : s.onBreak ? ['s-break', '☕ On break'] : s.paused ? ['s-idle', '🔒 Screen locked'] : s.idle ? ['s-idle', '💤 Idle'] : ['s-on', '🟢 Working — tracking on'];
  st.className = `status ${cls}`; st.textContent = label;
  $('inout').textContent = s.checkIn ? `In ${s.checkIn}${s.checkOut && s.checkOut !== '—' ? ` · Out ${s.checkOut}` : ''}` : '';
  $('worked').textContent = clock(s.workedSecs || 0);
  $('split').textContent = `Active ${mins(s.activeSecs)} · Idle ${mins(s.idleSecs)} · Break ${mins(s.breakSecs)}`;
  $('checkin').disabled = s.running;
  $('checkout').disabled = !s.running;
  $('break').disabled = !s.running;
  $('break').textContent = s.onBreak ? '▶ End Break' : '☕ Start Break';

  const t = s.projectTimer;
  $('timer-running').textContent = t ? `▶ ${t.project}${t.note ? ` — ${t.note}` : ''} · ${clock((Date.now() - Date.parse(t.start)) / 1000)}` : 'No project running';
  $('pstart').disabled = !s.running;
  $('pstop').disabled = !t;
  const dl = $('projects');
  if (dl.childElementCount !== (s.projects || []).length) dl.innerHTML = (s.projects || []).map(p => `<option value="${String(p).replace(/"/g, '&quot;')}">`).join('');

  $('now').textContent = s.current ? `${s.current.site || s.current.app}` : '—';
  $('top').innerHTML = (s.topApps || []).map(a => `<div><span>${a.name.replace(/</g, '&lt;')}</span><b>${mins(a.secs)}</b></div>`).join('') || '<div class="muted">Nothing tracked yet today</div>';
  $('err').textContent = s.lastError ? `⚠️ ${s.lastError}` : '';
}

const act = (fn) => async () => { try { await fn(); } catch (e) { $('err').textContent = String(e.message || e); } render(await window.tracker.state()); };
$('checkin').onclick = act(() => window.tracker.checkIn());
$('checkout').onclick = act(() => window.tracker.checkOut());
$('break').onclick = act(() => window.tracker.setBreak(!(last && last.onBreak)));
$('pstart').onclick = act(() => window.tracker.startProject($('project').value || 'General', $('note').value));
$('pstop').onclick = act(() => window.tracker.stopProject());
$('logout').onclick = act(() => window.tracker.logout());

window.tracker.onState(render);
window.tracker.state().then(render);
setInterval(() => { if (last && last.projectTimer) render(last); }, 1000);

window.tracker.permissions().then(p => {
  if (!p.mac) return;
  const missing = [];
  if (p.screen !== 'granted') missing.push('<b>Screen Recording</b> (for screenshots)');
  if (!p.accessibility) missing.push('<b>Accessibility</b> (for window titles)');
  if (missing.length) $('perm').innerHTML = `⚠️ Please allow ${missing.join(' and ')} for GrowthApex Tracker in System Settings → Privacy &amp; Security, then quit and reopen the app.`;
});
