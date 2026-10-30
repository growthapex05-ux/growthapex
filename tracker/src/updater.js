// In-app updates from the GitHub releases (tags tracker-vX.Y.Z, built by .github/workflows/tracker-build.yml).
// Windows: downloads the new installer and runs it (one-click install, the app starts again by itself).
// Mac: downloads the new .dmg and opens it — drag the app to Applications and replace the old one.
// The builds are unsigned, so Squirrel / electron-updater (which needs signed Mac builds) is not used.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app, shell } = require('electron');

const REPO = 'growthapex05-ux/growthapex';
const ASSET = process.platform === 'darwin' ? 'GrowthApex-Tracker.dmg' : 'GrowthApex-Tracker-Setup.exe';

let available = null;   // { version, url, notes }
let progress = null;    // 0..100 while downloading
let error = null;

const parse = v => String(v).replace(/^[^\d]*/, '').split('.').map(n => parseInt(n, 10) || 0);
function newer(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

async function check() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=15`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'GrowthApexTracker' }, signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const rel = (await res.json()).find(r => !r.draft && !r.prerelease && /^tracker-v/.test(r.tag_name) && (r.assets || []).some(a => a.name === ASSET));
    available = rel && newer(rel.tag_name, app.getVersion())
      ? { version: parse(rel.tag_name).join('.'), url: rel.assets.find(a => a.name === ASSET).browser_download_url, notes: (rel.body || '').slice(0, 500) }
      : null;
    error = null;
  } catch (e) { error = e.message; }
  return state();
}

// beforeQuit: called right before the app closes for the installer (must not check the employee out)
async function install(beforeQuit) {
  if (!available || progress != null) return state();
  const file = path.join(app.getPath('temp'), `${path.parse(ASSET).name}-${available.version}${path.extname(ASSET)}`);
  try {
    progress = 0;
    const res = await fetch(available.url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
    const total = Number(res.headers.get('content-length')) || 0;
    const out = fs.createWriteStream(file);
    let got = 0;
    for await (const chunk of res.body) {
      out.write(chunk);
      got += chunk.length;
      if (total) progress = Math.floor((got / total) * 100);
    }
    await new Promise((resolve, reject) => out.end(err => (err ? reject(err) : resolve())));
    progress = 100;
    if (process.platform === 'win32') {
      spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
      await beforeQuit();
      app.exit(0);
    } else {
      await shell.openPath(file);
      await beforeQuit();
      app.exit(0);
    }
  } catch (e) { error = `update: ${e.message}`; progress = null; }
  return state();
}

const state = () => ({ current: app.getVersion(), available, progress, error });

module.exports = { check, install, state };
