// GrowthApex Tracker — Electron main process: login, tray, panel window, auto check-in/out.
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, powerMonitor, desktopCapturer, screen, safeStorage, systemPreferences, dialog, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const ems = require('./src/ems');
const { createTracker } = require('./src/tracker');
const { allowGeolocation } = require('./src/location');
const updater = require('./src/updater');

// Windows: use the Windows Location service for navigator.geolocation (Wi-Fi / GPS based)
app.commandLine.appendSwitch('enable-features', 'WinrtGeolocationImplementation');
// The siren must play without a click in the window
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// The tracker must keep running while the employee is checked in: restart after an unexpected error
process.on('uncaughtException', err => {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'crash.log'), `${new Date().toISOString()} ${err.stack || err}
`); } catch (_) {}
  app.relaunch();
  app.exit(0);
});
process.on('unhandledRejection', err => {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'crash.log'), `${new Date().toISOString()} rejection ${err && err.stack || err}
`); } catch (_) {}
});

const dataDir = app.getPath('userData');
const credFile = path.join(dataDir, 'login.bin');
let win = null;
let mini = null;          // small always-on-top widget shown while the main window is minimised / closed
let tray = null;
let tracker = null;
let quitting = false;

// ── Saved login (encrypted with the OS keychain via safeStorage) ──
function saveCreds(id, password) {
  const json = JSON.stringify({ id, password });
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json);
  fs.writeFileSync(credFile, data);
}
function readCreds() {
  try {
    const data = fs.readFileSync(credFile);
    return JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(data) : data.toString());
  } catch (_) { return null; }
}
const clearCreds = () => { try { fs.unlinkSync(credFile); } catch (_) {} };

// ── Window + tray ──
function showWindow(page) {
  if (!win) {
    win = new BrowserWindow({
      width: 400, height: 740, resizable: false, backgroundColor: '#f4f7fb', title: 'GrowthApex Tracker', autoHideMenuBar: true,
      icon: path.join(__dirname, 'assets', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false }
    });
    // Always in front of other apps (files, browser, …); minimise / close → the mini widget
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); showMini(); } });
    win.on('minimize', e => { e.preventDefault(); win.hide(); showMini(); });
    win.webContents.on('render-process-gone', () => { if (!quitting && win && !win.isDestroyed()) win.reload(); });
    // Windows shutdown / sign-out: check out and let Windows close the app
    win.on('session-end', () => { quitApp(true); });
  }
  if (page) win.loadFile(path.join(__dirname, 'ui', page));
  if (mini && !mini.isDestroyed()) mini.hide();
  win.show();
  win.focus();
}

// ── Mini widget: timer + Check-In / Check-Out, on top of everything, draggable ──
const miniPosFile = path.join(dataDir, 'mini-position.json');
function showMini() {
  const s = tracker && tracker.state();
  if (!s || !s.me) return; // only once logged in
  if (!mini || mini.isDestroyed()) {
    let pos = null;
    try { pos = JSON.parse(fs.readFileSync(miniPosFile, 'utf8')); } catch (_) {}
    const area = screen.getPrimaryDisplay().workArea;
    const W = 300, H = 64;
    const visible = pos && screen.getAllDisplays().some(d => pos.x >= d.workArea.x && pos.y >= d.workArea.y && pos.x + 40 <= d.workArea.x + d.workArea.width && pos.y + 20 <= d.workArea.y + d.workArea.height);
    mini = new BrowserWindow({
      width: W, height: H, x: visible ? pos.x : area.x + area.width - W - 16, y: visible ? pos.y : area.y + 16,
      frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true,
      transparent: true, hasShadow: true, show: false, title: 'GrowthApex Tracker',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false }
    });
    mini.setAlwaysOnTop(true, 'screen-saver');
    mini.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mini.loadFile(path.join(__dirname, 'ui', 'mini.html'));
    mini.once('ready-to-show', () => { mini.showInactive(); pushState(); });
    mini.on('moved', () => { try { const [x, y] = mini.getPosition(); fs.writeFileSync(miniPosFile, JSON.stringify({ x, y })); } catch (_) {} });
    mini.on('close', e => { if (!quitting) { e.preventDefault(); } }); // stays while the app runs
    mini.webContents.on('render-process-gone', () => { if (!quitting && mini && !mini.isDestroyed()) mini.reload(); });
    return;
  }
  mini.showInactive();
  mini.setAlwaysOnTop(true, 'screen-saver'); // re-assert: some full-screen apps push it down
}

function pushState() {
  const s = tracker ? tracker.state() : null;
  if (win && !win.isDestroyed()) { win.webContents.send('state', s); win.webContents.send('update', updater.state()); }
  if (mini && !mini.isDestroyed()) mini.webContents.send('state', s);
  const up = updater.state();
  if (tray) {
    const label = !s || !s.me ? 'Not logged in' : !s.running ? 'Checked out' : s.onBreak ? 'On break' : s.paused ? 'Paused (screen locked)' : s.idle ? 'Idle' : 'Working — tracking on';
    tray.setToolTip(`GrowthApex Tracker — ${label}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label, enabled: false },
      { type: 'separator' },
      { label: 'Open GrowthApex Tracker', click: () => showWindow() },
      ...(up.available ? [{ label: `⬆ Update to v${up.available.version}`, click: () => { showWindow(); doUpdate(); } }] : []),
      ...(s && s.me ? [
        s.running ? { label: 'Check-Out', click: () => doCheckOut() } : { label: 'Check-In', click: () => doCheckIn() },
        ...(s.running ? [{ label: s.onBreak ? 'End break' : 'Start break', click: () => { tracker.setBreak(!s.onBreak); } }] : [])
      ] : []),
      { type: 'separator' },
      // While checked in the app stays on: it can only be closed after checking out
      s && s.running ? { label: 'Check out first to quit', enabled: false } : { label: 'Quit', click: () => quitApp() }
    ]));
  }
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')).resize({ width: 16, height: 16 }));
  tray.on('click', () => showWindow());
  pushState();
}

// ── Actions ──
async function doCheckIn() {
  try { await tracker.start(); } catch (e) { dialog.showErrorBox('Check-in failed', e.message); }
  pushState();
}
async function doCheckOut(reason = '') {
  try { await tracker.stop(true, reason); } catch (e) { dialog.showErrorBox('Check-out failed', e.message); }
  pushState();
}

async function startSession(me) {
  app.setLoginItemSettings({ openAtLogin: true }); // start with the PC
  if (process.platform === 'darwin') {
    systemPreferences.isTrustedAccessibilityClient(true); // asks for Accessibility (window titles)
  }
  await doCheckIn(); // auto check-in when the app starts
  showWindow('panel.html');
  return me;
}

// Update: the installer replaces the app; the employee stays checked in and the new version
// carries on (it finds today's open attendance record on start)
async function doUpdate() {
  const r = await updater.install(async () => {
    quitting = true;
    if (tracker) await Promise.race([tracker.save(), new Promise(res => setTimeout(res, 5000))]);
  });
  pushState();
  return r;
}

// Siren: every 10 min while tracker.alarm() reports a problem — window to the front + sound + notification
const SIREN_EVERY_MS = 10 * 60 * 1000;
let lastSirenAt = 0;
function checkSiren() {
  const msg = tracker && tracker.alarm();
  if (!msg) { lastSirenAt = 0; return; }
  if (Date.now() - lastSirenAt < SIREN_EVERY_MS) return;
  lastSirenAt = Date.now();
  showWindow();
  if (win && !win.isDestroyed()) win.webContents.send('siren', msg);
  try { new Notification({ title: '🚨 GrowthApex Tracker', body: msg, urgency: 'critical' }).show(); } catch (_) {}
}

// force: PC shutting down / logging off — check out and close even while checked in
async function quitApp(force = false) {
  if (tracker && tracker.state().running && !force) {
    showWindow();
    dialog.showMessageBox(win, { type: 'info', title: 'GrowthApex Tracker', message: 'Please check out first.',
      detail: 'The tracker stays on while you are checked in. Tap Check-Out, then you can quit.' });
    return;
  }
  quitting = true;
  if (tracker && tracker.state().running) {
    await Promise.race([tracker.stop(true, 'PC shut down'), new Promise(r => setTimeout(r, 8000))]);
  }
  app.quit();
}

// ── IPC from the window ──
ipcMain.handle('login', async (_e, { id, password, remember }) => {
  const me = await ems.login(id, password);
  if (remember !== false) saveCreds(id, password);
  await startSession(me);
  return me;
});
ipcMain.handle('logout', async () => {
  await doCheckOut('Logged out');
  clearCreds();
  await ems.logout();
  if (mini && !mini.isDestroyed()) mini.hide();
  showWindow('login.html');
  pushState();
});
ipcMain.handle('checkin', () => doCheckIn());
ipcMain.handle('open-main', () => showWindow());
ipcMain.handle('checkout', () => doCheckOut());
ipcMain.handle('break', (_e, on) => { tracker.setBreak(on); pushState(); });
ipcMain.handle('project-start', (_e, { project, note }) => tracker.startProject(project, note));
ipcMain.handle('project-stop', () => tracker.stopProject());
ipcMain.handle('state', () => (tracker ? tracker.state() : null));
ipcMain.handle('update-state', () => updater.state());
ipcMain.handle('update-check', async () => { const r = await updater.check(); pushState(); return r; });
ipcMain.handle('update-install', () => doUpdate());
ipcMain.handle('permissions', () => (process.platform === 'darwin'
  ? { mac: true, screen: systemPreferences.getMediaAccessStatus('screen'), accessibility: systemPreferences.isTrustedAccessibilityClient(false) }
  : { mac: false }));

// ── App lifecycle ──
app.on('second-instance', () => showWindow());
app.on('window-all-closed', e => e.preventDefault && e.preventDefault()); // stay in the tray
app.on('before-quit', e => { if (!quitting) { e.preventDefault(); quitApp(); } });

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  allowGeolocation();
  tracker = createTracker({ powerMonitor, desktopCapturer, screen, safeStorage, dataDir, onChange: pushState });
  createTray();
  setInterval(pushState, 5000);
  setInterval(checkSiren, 30000);
  const checkUpdate = () => updater.check().then(pushState);
  setTimeout(checkUpdate, 15000);
  setInterval(checkUpdate, 6 * 60 * 60 * 1000);

  // Locked screen / sleep: pause tracking (heartbeats stop while asleep; the EMS marks offline)
  powerMonitor.on('lock-screen', () => tracker.setPaused(true));
  powerMonitor.on('suspend', () => tracker.setPaused(true));
  powerMonitor.on('unlock-screen', () => tracker.setPaused(false));
  powerMonitor.on('resume', () => tracker.setPaused(false));
  powerMonitor.on('shutdown', () => { quitApp(true); });

  const creds = readCreds();
  if (creds) {
    try { await startSession(await ems.login(creds.id, creds.password)); return; }
    catch (e) { if (/auth\/(wrong-password|invalid-credential|user-not-found)/.test(e.code || e.message)) clearCreds(); }
  }
  showWindow('login.html');
});
