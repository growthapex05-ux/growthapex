// GrowthApex Admin — a desktop wrapper around the EMS admin dashboard.
// Loads the live site so it is always up to date, and shows the web app's
// offline / alert notifications as native desktop notifications.
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');

const START_URL = 'https://growthapex.in/EMS_login/index.html';

// Notifications on Windows need a stable app id (shown as the sender)
app.setAppUserModelId('in.growthapex.admin');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 360,
    minHeight: 600,
    backgroundColor: '#0e1627',
    title: 'GrowthApex Admin',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      // No preload / node access in the page: this is a plain, safe web wrapper.
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  Menu.setApplicationMenu(null);

  win.loadURL(START_URL).catch(() => showOffline());

  // Open target=_blank / external links (Google Maps, GitHub downloads) in the real browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });

  // If the page fails to load (no internet), show a friendly retry screen
  win.webContents.on('did-fail-load', (_e, code, desc, validatedURL, isMainFrame) => {
    if (isMainFrame && code !== -3) showOffline(desc);
  });

  win.on('closed', () => { win = null; });
}

function showOffline(desc) {
  if (!win) return;
  const msg = (desc || 'No internet connection').replace(/"/g, '');
  win.loadURL('data:text/html,' + encodeURIComponent(`
    <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>html,body{height:100%;margin:0;font-family:Segoe UI,system-ui,sans-serif;background:#0e1627;color:#e5edf7;
      display:flex;align-items:center;justify-content:center;text-align:center}
      .c{max-width:420px;padding:28px}h1{font-size:20px;margin:0 0 10px}p{color:#9fb2cc;line-height:1.6;font-size:14px}
      button{margin-top:18px;padding:11px 22px;border:0;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;
        color:#fff;background:linear-gradient(135deg,#1e40af,#0e7fb8,#10b981)}</style></head>
    <body><div class="c"><h1>Can't reach GrowthApex</h1>
    <p>${msg}.<br>Check your internet connection and try again.</p>
    <button onclick="location.href='${START_URL}'">Retry</button></div></body></html>`));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(createWindow);
app.on('activate', () => { if (!win) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
