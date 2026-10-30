document.getElementById('f').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('btn');
  const err = document.getElementById('err');
  btn.disabled = true; btn.textContent = 'Logging in…'; err.textContent = '';
  try {
    await window.tracker.login(document.getElementById('id').value, document.getElementById('pw').value, document.getElementById('remember').checked);
  } catch (ex) {
    const msg = String(ex.message || ex);
    err.textContent = /invalid-credential|wrong-password|user-not-found/.test(msg) ? 'Wrong Employee ID / email or password.'
      : /network/i.test(msg) ? 'No internet connection.' : msg.replace(/^Error invoking remote method 'login': (Error: )?/, '');
    btn.disabled = false; btn.textContent = 'Login & Check-In';
  }
});
