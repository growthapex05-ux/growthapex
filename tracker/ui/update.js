// "New version available" banner (login + panel windows) and the version in the footer
(function () {
  const box = document.getElementById('update');
  const ver = document.getElementById('ver');
  function render(u) {
    if (!u) return;
    if (ver) ver.textContent = `v${u.current}`;
    if (!u.available) { box.classList.remove('show'); return; }
    box.classList.add('show');
    const busy = u.progress != null;
    box.innerHTML = `<span class="up-icon">⬆️</span>
      <div class="grow"><b>Update available — v${u.available.version}</b>
        ${busy ? `<div class="bar"><i></i></div><span>Downloading… ${u.progress}%</span>`
               : `<span>${u.error ? u.error : 'Takes a minute. You stay checked in.'}</span>`}</div>
      ${busy ? '' : '<button id="upd-btn">Update now</button>'}`;
    const fill = box.querySelector('.bar i');
    if (fill) fill.style.width = `${u.progress}%`; // CSSOM — inline style attributes are blocked by the CSP
    const b = document.getElementById('upd-btn');
    if (b) b.onclick = async () => { b.disabled = true; b.textContent = 'Starting…'; render(await window.tracker.installUpdate()); };
  }
  window.tracker.onUpdate(render);
  window.tracker.updateState().then(render);
  setInterval(() => window.tracker.updateState().then(render), 1000);
  window.checkForUpdates = async btn => {
    if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
    const u = await window.tracker.checkUpdate();
    render(u);
    if (btn) { btn.disabled = false; btn.textContent = u.available ? 'Update available ↑' : u.error ? 'Could not check' : '✓ Up to date'; }
  };
})();
