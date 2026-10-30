// Tracking engine: samples the foreground app every 5 s, keeps today's totals (apps, websites,
// window titles, active / idle), saves them to the attendance record every 5 min in the same
// `screenActivity` shape the EMS dashboard already shows, takes screenshots and runs the
// project timer. Electron APIs (powerMonitor, desktopCapturer, screen) are passed in.
const fs = require('fs');
const path = require('path');
const ems = require('./ems');
const { currentActivity } = require('./activity');
const { getLocation } = require('./location');

const SAMPLE_S = 5;
const IDLE_AFTER_S = 180;              // no mouse/keyboard for 3 min = idle
const SAVE_EVERY_MS = 5 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;
const DEFAULT_FLAGGED = ['youtube.com', 'instagram.com', 'facebook.com', 'netflix.com', 'hotstar.com', 'primevideo.com', 'x.com', 'reddit.com'];

const KEEP_DAYS = 7;          // local day files older than this are deleted
const OFFLINE_SIREN_MIN = 2;  // siren when the EMS has not confirmed a heartbeat for this long

function createTracker({ powerMonitor, desktopCapturer, screen, safeStorage, dataDir, onChange = () => {} }) {
  let day = null;           // today's totals (persisted to disk)
  let running = false;
  let onBreak = false;
  let paused = false;       // screen locked / PC asleep
  let current = null;
  let idleSince = null;
  let settings = { screenshotMinutes: 10, locationMinutes: 5, sirenMinutes: 10, flaggedSites: DEFAULT_FLAGGED, projects: [] };
  let location = null;      // last location sent to the EMS
  let lastBeatOkAt = 0;     // last heartbeat the EMS confirmed (no internet = Firestore just waits, never fails)
  let autoCheckedOut = false; // the EMS checked this employee out (not the employee)
  let lastLocAt = 0;
  let lastShotAt = 0;
  let lastSaveAt = 0;
  let timers = [];
  let lastError = null;

  // Today's totals are kept on disk encrypted with the OS keychain (safeStorage), so they cannot be
  // read from the app folder; day-<date>.json is the older plain-text format, read once and removed.
  const file = date => path.join(dataDir, `day-${date}.bin`);
  const legacyFile = date => path.join(dataDir, `day-${date}.json`);
  const timerFile = path.join(dataDir, 'project-timer.json');
  const canEncrypt = () => safeStorage && safeStorage.isEncryptionAvailable();

  function readDayFile(date) {
    try {
      const buf = fs.readFileSync(file(date));
      return JSON.parse(canEncrypt() ? safeStorage.decryptString(buf) : buf.toString());
    } catch (_) {}
    try { return JSON.parse(fs.readFileSync(legacyFile(date), 'utf8')); } catch (_) { return null; }
  }

  function loadDay() {
    const date = ems.todayIST();
    if (day && day.date === date) return day;
    day = readDayFile(date);
    if (!day || day.date !== date) day = { date, programs: {}, sites: {}, titles: {}, combined: {}, activeSecs: 0, idleSecs: 0, breakSecs: 0 };
    return day;
  }
  const persist = () => {
    try {
      const json = JSON.stringify(day);
      fs.writeFileSync(file(day.date), canEncrypt() ? safeStorage.encryptString(json) : Buffer.from(json));
      fs.rmSync(legacyFile(day.date), { force: true });
    } catch (_) {}
  };

  // Delete day files older than KEEP_DAYS (and every old plain-text day file)
  function cleanupDays() {
    const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const today = ems.todayIST();
    try {
      for (const f of fs.readdirSync(dataDir)) {
        const m = /^day-(\d{4}-\d{2}-\d{2})\.(json|bin)$/.exec(f);
        if (m && (m[1] < cutoff || (m[2] === 'json' && m[1] !== today))) fs.rmSync(path.join(dataDir, f), { force: true });
      }
    } catch (_) {}
  }
  cleanupDays();
  const addTo = (obj, key, secs) => { if (key) obj[key] = (obj[key] || 0) + secs; };

  async function sample() {
    if (!running || paused) return;
    const d = loadDay();
    if (onBreak) { d.breakSecs += SAMPLE_S; return; }
    const idle = powerMonitor.getSystemIdleTime();
    if (idle >= IDLE_AFTER_S) {
      if (!idleSince) idleSince = new Date(Date.now() - idle * 1000).toISOString();
      d.idleSecs += SAMPLE_S;
      return;
    }
    idleSince = null;
    const a = await currentActivity();
    if (!a) return;
    current = { ...a, at: new Date().toISOString() };
    d.activeSecs += SAMPLE_S;
    addTo(d.programs, a.browser || a.app, SAMPLE_S);
    if (a.browser) {
      addTo(d.sites, a.site, SAMPLE_S);
      addTo(d.combined, a.site, SAMPLE_S);
      addTo(d.titles, `${a.site} — ${a.title}`.slice(0, 140), SAMPLE_S);
    } else {
      addTo(d.combined, a.app, SAMPLE_S);
      addTo(d.titles, `${a.app} — ${a.title || a.app}`.slice(0, 140), SAMPLE_S);
    }
    maybeFlaggedShot(a);
  }

  const top = (obj, n, min) => Object.entries(obj)
    .map(([name, secs]) => ({ name, secs: Math.round(secs) }))
    .filter(x => x.secs >= min).sort((a, b) => b.secs - a.secs).slice(0, n);

  function snapshot() {
    const d = loadDay();
    return {
      source: 'tracker',
      apps: top(d.combined, 40, 60),       // apps + websites in one list (reports, attendance row)
      programs: top(d.programs, 40, 60),
      sites: top(d.sites, 60, 30),
      titles: top(d.titles, 40, 60),       // window / page titles (admin popup only)
      activeSecs: d.activeSecs, idleSecs: d.idleSecs, breakSecs: d.breakSecs,
      web: true,
      afkSince: idleSince,
      current: current ? { app: current.browser || current.app, site: current.site, at: current.at } : null,
      updatedAt: new Date().toISOString()
    };
  }

  async function save() {
    if (!running) return;
    persist();
    try { await ems.saveActivity(snapshot()); lastSaveAt = Date.now(); lastError = null; }
    catch (e) { lastError = e.message; }
  }

  async function beat() {
    if (!running) return;
    const state = onBreak ? 'break' : paused ? 'idle' : (idleSince ? 'idle' : 'active');
    try {
      const rec = await Promise.race([ems.heartbeat(state), new Promise((_, rej) => setTimeout(() => rej(new Error('no connection')), 30000))]);
      lastError = null; lastBeatOkAt = Date.now();
      if (rec && !ems.isOpen(rec)) { // checked out on the website / by admin / by the system
        autoCheckedOut = /^Auto-Checkout/.test(rec.checkoutReason || '');
        await stop(false);
      }
    } catch (e) { lastError = e.message; }
    onChange();
  }

  // ── Screenshots ────────────────────────────────────────
  async function takeScreenshot(reason) {
    if (!running || onBreak || paused) return;
    lastShotAt = Date.now();
    try {
      const { width, height } = screen.getPrimaryDisplay().size;
      const scale = Math.min(1, 1280 / width);
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) } });
      const img = sources[0] && sources[0].thumbnail;
      if (!img || img.isEmpty()) return;
      let jpeg = img.toJPEG(55);
      if (jpeg.length > 700 * 1024) jpeg = img.resize({ width: 960 }).toJPEG(45); // Firestore doc limit is 1 MB
      await ems.saveScreenshot({
        at: new Date().toISOString(), reason,
        app: current ? (current.browser || current.app) : null, site: current ? current.site : null,
        title: current ? String(current.title || '').slice(0, 140) : null,
        img: `data:image/jpeg;base64,${jpeg.toString('base64')}`
      });
    } catch (e) { lastError = `screenshot: ${e.message}`; }
  }

  function maybeFlaggedShot(a) {
    const flagged = (settings.flaggedSites || DEFAULT_FLAGGED).map(s => s.toLowerCase());
    const hit = [a.site, a.app].filter(Boolean).some(x => flagged.some(f => String(x).toLowerCase().includes(f)));
    if (hit && Date.now() - lastShotAt > 2 * 60 * 1000) takeScreenshot('flagged');
  }

  function intervalShot() {
    const every = Math.max(2, Number(settings.screenshotMinutes) || 10) * 60 * 1000;
    if (!idleSince && Date.now() - lastShotAt >= every) takeScreenshot('interval');
  }

  // ── Location (every settings.locationMinutes while checked in) ──
  async function locate(kind = 'live') {
    if (!running || (paused && kind === 'live')) return;
    lastLocAt = Date.now();
    try {
      location = await getLocation();
      await ems.saveLocation(location, kind);
    } catch (e) { lastError = `location: ${e.message}`; }
    onChange();
  }
  function intervalLocate() {
    const every = Math.max(1, Number(settings.locationMinutes) || 5) * 60 * 1000;
    if (Date.now() - lastLocAt >= every) locate();
  }

  // ── Project timer (timesheet) ──────────────────────────
  function readTimer() { try { return JSON.parse(fs.readFileSync(timerFile, 'utf8')); } catch (_) { return null; } }
  function startProject(project, note = '') {
    stopProject();
    const t = { project: String(project || 'General').slice(0, 80), note: String(note || '').slice(0, 200), start: new Date().toISOString() };
    fs.writeFileSync(timerFile, JSON.stringify(t));
    onChange();
    return t;
  }
  async function stopProject() {
    const t = readTimer();
    if (!t) return null;
    try { fs.unlinkSync(timerFile); } catch (_) {}
    const secs = Math.round((Date.now() - Date.parse(t.start)) / 1000);
    if (secs >= 60) {
      const entry = { ...t, end: new Date().toISOString(), secs, date: new Date(t.start).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) };
      try { await ems.saveTimesheet(entry); } catch (e) { lastError = `timesheet: ${e.message}`; }
    }
    onChange();
    return t;
  }

  // ── Lifecycle ──────────────────────────────────────────
  async function loadSettings() {
    try { settings = { ...settings, ...(await ems.getSettings()) }; } catch (_) {}
  }

  async function start() {
    if (running) return;
    await ems.checkIn();
    running = true; onBreak = false; paused = false; autoCheckedOut = false; lastBeatOkAt = Date.now();
    loadDay();
    await loadSettings();
    ems.saveStatus({}).catch(() => {});
    timers = [
      setInterval(() => sample().catch(() => {}), SAMPLE_S * 1000),
      setInterval(() => beat(), HEARTBEAT_MS),
      setInterval(() => { if (Date.now() - lastSaveAt >= SAVE_EVERY_MS) save(); intervalShot(); intervalLocate(); }, 30 * 1000),
      setInterval(() => { loadSettings(); cleanupDays(); }, 60 * 60 * 1000)
    ];
    setTimeout(() => takeScreenshot('check-in'), 60 * 1000);
    locate('checkin');
    onChange();
  }

  async function stop(writeCheckOut = true, reason = '') {
    if (!running) return;
    await stopProject();
    await save();
    if (writeCheckOut) await Promise.race([locate('checkout'), new Promise(r => setTimeout(r, 6000))]);
    timers.forEach(clearInterval); timers = [];
    running = false; onBreak = false;
    if (writeCheckOut) { try { await ems.checkOut(reason); } catch (e) { lastError = e.message; } }
    onChange();
  }

  // Siren on the employee's laptop (settings.sirenMinutes, 0 = off), office hours Mon–Sat only:
  // offline (no confirmed heartbeat for OFFLINE_SIREN_MIN), idle while checked in, or checked out
  // by the system. → message or null
  function alarm() {
    const lim = Number(settings.sirenMinutes ?? 10);
    if (!lim || !ems.me()) return null;
    const [h, m] = ems.timeIST().split(':').map(Number);
    const mins = h * 60 + m;
    const sunday = new Date(`${ems.todayIST()}T12:00:00`).getDay() === 0;
    if (sunday || mins < 10 * 60 || mins >= 19 * 60) return null;
    const ago = since => Math.floor((Date.now() - since) / 60000);
    if (running && !paused && lastBeatOkAt && ago(lastBeatOkAt) >= OFFLINE_SIREN_MIN)
      return `You are OFFLINE for ${ago(lastBeatOkAt)} min — your work time is not being counted. Please check your internet connection.`;
    if (running && !onBreak && !paused && idleSince && ago(Date.parse(idleSince)) >= lim)
      return `No activity for ${ago(Date.parse(idleSince))} min — please get back to work, or start a break.`;
    if (!running && autoCheckedOut)
      return 'You were checked out automatically — tap Check-In to continue working.';
    return null;
  }

  function setBreak(on) { onBreak = !!on; beat(); onChange(); }
  function setPaused(on) {
    paused = !!on;
    if (on) beat();
    else { lastBeatOkAt = Date.now(); beat(); locate(); } // back from sleep / lock: grace before the offline siren
    onChange();
  }

  function state() {
    const d = loadDay();
    const rec = ems.cached();
    // Shown to the employee: attendance only. The tracked apps / websites / location / screenshots
    // go to the EMS and are seen by the admin, not in this window.
    const me = ems.me();
    return {
      running, onBreak, paused, idle: !!idleSince, lastError: lastError ? 'Connection problem — retrying…' : null,
      me: me && { empId: me.empId, name: me.name, email: me.email },
      checkIn: rec && rec.checkIn, checkOut: rec && rec.checkOut, workedSecs: rec ? Number(rec.workedSeconds || 0) : 0,
      beatAt: rec && rec.lastHeartbeat ? Date.parse(rec.lastHeartbeat) : null,
      breakSecs: d.breakSecs, projectTimer: readTimer(), projects: settings.projects || []
    };
  }

  return { start, stop, setBreak, setPaused, state, save, startProject, stopProject, takeScreenshot, alarm };
}

module.exports = { createTracker };
