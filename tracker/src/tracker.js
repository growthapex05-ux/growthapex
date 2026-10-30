// Tracking engine: samples the foreground app every 5 s, keeps today's totals (apps, websites,
// window titles, active / idle), saves them to the attendance record every 5 min in the same
// `screenActivity` shape the EMS dashboard already shows, takes screenshots and runs the
// project timer. Electron APIs (powerMonitor, desktopCapturer, screen) are passed in.
const fs = require('fs');
const path = require('path');
const ems = require('./ems');
const { currentActivity } = require('./activity');

const SAMPLE_S = 5;
const IDLE_AFTER_S = 180;              // no mouse/keyboard for 3 min = idle
const SAVE_EVERY_MS = 5 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;
const DEFAULT_FLAGGED = ['youtube.com', 'instagram.com', 'facebook.com', 'netflix.com', 'hotstar.com', 'primevideo.com', 'x.com', 'reddit.com'];

function createTracker({ powerMonitor, desktopCapturer, screen, dataDir, onChange = () => {} }) {
  let day = null;           // today's totals (persisted to disk)
  let running = false;
  let onBreak = false;
  let paused = false;       // screen locked / PC asleep
  let current = null;
  let idleSince = null;
  let settings = { screenshotMinutes: 10, flaggedSites: DEFAULT_FLAGGED, projects: [] };
  let lastShotAt = 0;
  let lastSaveAt = 0;
  let timers = [];
  let lastError = null;

  const file = date => path.join(dataDir, `day-${date}.json`);
  const timerFile = path.join(dataDir, 'project-timer.json');

  function loadDay() {
    const date = ems.todayIST();
    if (day && day.date === date) return day;
    try { day = JSON.parse(fs.readFileSync(file(date), 'utf8')); } catch (_) { day = null; }
    if (!day || day.date !== date) day = { date, programs: {}, sites: {}, titles: {}, combined: {}, activeSecs: 0, idleSecs: 0, breakSecs: 0 };
    return day;
  }
  const persist = () => { try { fs.writeFileSync(file(day.date), JSON.stringify(day)); } catch (_) {} };
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
      const rec = await ems.heartbeat(state);
      lastError = null;
      if (rec && !ems.isOpen(rec)) { await stop(false); } // checked out on the website / by admin
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
    running = true; onBreak = false; paused = false;
    loadDay();
    await loadSettings();
    ems.saveStatus({}).catch(() => {});
    timers = [
      setInterval(() => sample().catch(() => {}), SAMPLE_S * 1000),
      setInterval(() => beat(), HEARTBEAT_MS),
      setInterval(() => { if (Date.now() - lastSaveAt >= SAVE_EVERY_MS) save(); intervalShot(); }, 30 * 1000),
      setInterval(() => loadSettings(), 60 * 60 * 1000)
    ];
    setTimeout(() => takeScreenshot('check-in'), 60 * 1000);
    onChange();
  }

  async function stop(writeCheckOut = true, reason = '') {
    if (!running) return;
    await stopProject();
    await save();
    timers.forEach(clearInterval); timers = [];
    running = false; onBreak = false;
    if (writeCheckOut) { try { await ems.checkOut(reason); } catch (e) { lastError = e.message; } }
    onChange();
  }

  function setBreak(on) { onBreak = !!on; beat(); onChange(); }
  function setPaused(on) { paused = !!on; if (on) beat(); onChange(); }

  function state() {
    const d = loadDay();
    const rec = ems.cached();
    return {
      running, onBreak, paused, idle: !!idleSince, current, lastError, me: ems.me(),
      checkIn: rec && rec.checkIn, checkOut: rec && rec.checkOut, workedSecs: rec ? Number(rec.workedSeconds || 0) : 0,
      activeSecs: d.activeSecs, idleSecs: d.idleSecs, breakSecs: d.breakSecs,
      topApps: top(d.combined, 6, 1), projectTimer: readTimer(), projects: settings.projects || []
    };
  }

  return { start, stop, setBreak, setPaused, state, save, startProject, stopProject, takeScreenshot };
}

module.exports = { createTracker };
