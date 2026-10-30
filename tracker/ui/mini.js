const $ = id => document.getElementById(id);
const clock = s => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), Math.floor(s % 60)].map(n => String(n).padStart(2, '0')).join(':');
let last = null;

// Worked time ticks every second between heartbeats (the EMS adds at most 2 min per gap)
function worked(s) {
  if (!s) return 0;
  const live = s.running && !s.onBreak && !s.paused && s.beatAt ? Math.min(120, Math.max(0, (Date.now() - s.beatAt) / 1000)) : 0;
  return (s.workedSecs || 0) + live;
}

function render(s) {
  if (s) last = s;
  s = last;
  if (!s) return;
  $('m-time').textContent = clock(worked(s));
  const [cls, label] = !s.running ? ['off', 'Checked out'] : s.onBreak ? ['break', 'On break'] : s.paused ? ['idle', 'Screen locked'] : s.lastError ? ['bad', 'Offline'] : s.idle ? ['idle', 'Idle'] : ['on', 'Working'];
  $('m-dot').className = `dot-${cls}`;
  $('m-label').textContent = label;
  $('m-in').hidden = s.running;
  $('m-out').hidden = !s.running;
}

const act = fn => async e => {
  const b = e.currentTarget; b.disabled = true;
  try { await fn(); } catch (_) {}
  b.disabled = false;
  render(await window.tracker.state());
};
$('m-in').onclick = act(() => window.tracker.checkIn());
$('m-out').onclick = act(() => window.tracker.checkOut());
$('m-open').onclick = () => window.tracker.openMain();
$('mini').ondblclick = e => { if (!e.target.closest('button')) window.tracker.openMain(); };

window.tracker.onState(render);
window.tracker.state().then(render);
setInterval(() => render(), 1000);
