// What is in front of the employee right now: { app, title, site, url? } — never throws.
// Windows: user32 GetForegroundWindow + window title + process name (koffi, no compiling).
// Mac: AppleScript (System Events; needs Accessibility permission for window titles) and, for
//      browsers, the URL of the active tab (needs Automation permission once per browser).
const path = require('path');
const { execFile } = require('child_process');

const BROWSERS = {
  // process / app name -> label
  'chrome': 'Chrome', 'google chrome': 'Chrome', 'msedge': 'Edge', 'microsoft edge': 'Edge',
  'firefox': 'Firefox', 'brave': 'Brave', 'brave browser': 'Brave', 'opera': 'Opera',
  'vivaldi': 'Vivaldi', 'safari': 'Safari', 'arc': 'Arc'
};
const browserLabel = app => BROWSERS[String(app || '').toLowerCase()] || null;

// Well-known sites recognised from a browser window title (Windows gives no URL)
const KNOWN_SITES = [
  ['youtube', 'youtube.com'], ['whatsapp', 'web.whatsapp.com'], ['instagram', 'instagram.com'],
  ['facebook', 'facebook.com'], ['netflix', 'netflix.com'], ['hotstar', 'hotstar.com'],
  ['prime video', 'primevideo.com'], ['gmail', 'mail.google.com'], ['google docs', 'docs.google.com'],
  ['google sheets', 'docs.google.com'], ['google drive', 'drive.google.com'], ['canva', 'canva.com'],
  ['chatgpt', 'chatgpt.com'], ['claude', 'claude.ai'], ['linkedin', 'linkedin.com'],
  ['twitter', 'x.com'], [' / x', 'x.com'], ['figma', 'figma.com'], ['growthapex', 'growthapex.in'],
  ['meta business', 'business.facebook.com'], ['ads manager', 'business.facebook.com'], ['amazon', 'amazon.in'],
  ['flipkart', 'flipkart.com'], ['spotify', 'spotify.com'], ['reddit', 'reddit.com'], ['telegram', 'web.telegram.org']
];

// "Funny cats - YouTube - Google Chrome" -> page "Funny cats - YouTube", site "youtube.com"
function siteFromTitle(title) {
  const page = String(title || '')
    .replace(/\s+and \d+ more pages?/i, '')
    .replace(/\s+[-–—]\s+(Personal|Work|Profile \d+)?\s*[-–—]?\s*(Google Chrome|Microsoft​? ?Edge|Mozilla Firefox|Brave|Opera|Vivaldi|Arc)\s*$/i, '')
    .replace(/\s+[-–—]\s+(Google Chrome|Microsoft​? ?Edge|Mozilla Firefox|Brave|Opera|Vivaldi)\s*$/i, '')
    .trim();
  const lower = page.toLowerCase();
  const known = KNOWN_SITES.find(([k]) => lower.includes(k));
  if (known) return { page, site: known[1] };
  // Otherwise the site name is usually the last part: "Article | Site", "Page - Site"
  const parts = page.split(/\s+[|•–—-]\s+/).filter(Boolean);
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  return { page, site: last && last.length <= 40 ? last : (page || 'New tab') };
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return null; }
}

// ── Windows ────────────────────────────────────────────────
let win32 = null;
function loadWin32() {
  if (win32) return win32;
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  win32 = {
    GetForegroundWindow: user32.func('void * __stdcall GetForegroundWindow()'),
    GetWindowTextW: user32.func('int __stdcall GetWindowTextW(void *hWnd, _Out_ uint16_t *lpString, int nMaxCount)'),
    GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32_t *pid)'),
    OpenProcess: kernel32.func('void * __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)'),
    QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(void *h, uint32_t flags, _Out_ uint16_t *buf, _Inout_ uint32_t *size)'),
    CloseHandle: kernel32.func('bool __stdcall CloseHandle(void *h)')
  };
  return win32;
}

function foregroundWindows() {
  const w = loadWin32();
  const hwnd = w.GetForegroundWindow();
  if (!hwnd) return null;
  const titleBuf = new Uint16Array(512);
  const n = w.GetWindowTextW(hwnd, titleBuf, 512);
  const title = Buffer.from(titleBuf.buffer).toString('utf16le', 0, n * 2);
  const pid = [0];
  w.GetWindowThreadProcessId(hwnd, pid);
  let app = '';
  const h = w.OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid[0]);
  if (h) {
    const buf = new Uint16Array(1024);
    const size = [1024];
    if (w.QueryFullProcessImageNameW(h, 0, buf, size)) {
      const exe = Buffer.from(buf.buffer).toString('utf16le', 0, size[0] * 2);
      app = path.win32.basename(exe).replace(/\.exe$/i, '');
    }
    w.CloseHandle(h);
  }
  return { app: app || 'Unknown', title };
}

// ── Mac ────────────────────────────────────────────────────
function osascript(script) {
  return new Promise(resolve => {
    execFile('osascript', ['-e', script], { timeout: 4000 }, (err, out) => resolve(err ? null : String(out).trim()));
  });
}

const MAC_URL_SCRIPTS = {
  Chrome: 'tell application "Google Chrome" to return URL of active tab of front window',
  Brave: 'tell application "Brave Browser" to return URL of active tab of front window',
  Edge: 'tell application "Microsoft Edge" to return URL of active tab of front window',
  Vivaldi: 'tell application "Vivaldi" to return URL of active tab of front window',
  Arc: 'tell application "Arc" to return URL of active tab of front window',
  Safari: 'tell application "Safari" to return URL of front document'
};

async function foregroundMac() {
  const out = await osascript(`tell application "System Events"
  set p to first application process whose frontmost is true
  set appName to name of p
  set winTitle to ""
  try
    set winTitle to name of front window of p
  end try
end tell
return appName & linefeed & winTitle`);
  if (!out) return null;
  const [app, ...rest] = out.split('\n');
  const res = { app: app || 'Unknown', title: rest.join(' ').trim() };
  const b = browserLabel(app);
  if (b && MAC_URL_SCRIPTS[b]) res.url = await osascript(MAC_URL_SCRIPTS[b]);
  return res;
}

async function currentActivity() {
  let w = null;
  try {
    w = process.platform === 'win32' ? foregroundWindows() : process.platform === 'darwin' ? await foregroundMac() : null;
  } catch (_) { w = null; }
  if (!w) return null;
  const browser = browserLabel(w.app);
  if (!browser) return { app: w.app, title: w.title, site: null, browser: null };
  const fromTitle = siteFromTitle(w.title);
  const site = (w.url && hostOf(w.url)) || fromTitle.site;
  return { app: w.app, title: fromTitle.page || w.title, site, browser };
}

module.exports = { currentActivity, siteFromTitle, browserLabel };
