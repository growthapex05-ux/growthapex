// Siren + red alert banner, triggered by the main process (see checkSiren in main.js)
(function () {
  const box = document.getElementById('siren');
  let ctx = null;

  function play(seconds = 5) {
    try {
      ctx = ctx || new AudioContext();
      if (ctx.state === 'suspended') ctx.resume();
      const t0 = ctx.currentTime, osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sawtooth';
      for (let t = 0; t < seconds; t += 1) { // wail up and down once a second
        osc.frequency.setValueAtTime(650, t0 + t);
        osc.frequency.linearRampToValueAtTime(1250, t0 + t + 0.5);
        osc.frequency.linearRampToValueAtTime(650, t0 + t + 1);
      }
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.05);
      gain.gain.setValueAtTime(0.3, t0 + seconds - 0.1);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0); osc.stop(t0 + seconds);
    } catch (_) {}
  }

  window.tracker.onSiren(msg => {
    play();
    box.innerHTML = '<span class="up-icon">🚨</span><div class="grow"><b>Attention</b><span></span></div><button id="siren-ok">OK</button>';
    box.querySelector('.grow span').textContent = msg;
    box.classList.add('show');
    document.getElementById('siren-ok').onclick = () => box.classList.remove('show');
  });
})();
