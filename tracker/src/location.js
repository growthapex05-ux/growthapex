// Laptop location while checked in: the OS location service (Windows Location / macOS Location
// Services, via Chromium's navigator.geolocation in a hidden window) and, when that is off or
// denied, an approximate city-level location from the internet connection's IP address.
// Place names come from OpenStreetMap, looked up only when the laptop has moved (usage policy).
const path = require('path');
const { BrowserWindow, session } = require('electron');

const UA = 'GrowthApexTracker/1.1 (growthapex.in)';
let win = null;
let lastPlace = null; // { lat, lng, place }

function allowGeolocation() {
  const s = session.defaultSession;
  s.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'geolocation'));
  s.setPermissionCheckHandler((_wc, perm) => perm === 'geolocation');
}

function distanceKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return +(2 * R * Math.asin(Math.sqrt(h))).toFixed(2);
}

async function osLocation() {
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    await win.loadFile(path.join(__dirname, '..', 'ui', 'locate.html'));
  }
  return win.webContents.executeJavaScript(`new Promise(r => navigator.geolocation.getCurrentPosition(
    p => r({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
    e => r({ error: e.message || 'code ' + e.code }),
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 }))`);
}

async function ipLocation() {
  const res = await fetch('https://get.geojs.io/v1/ip/geo.json', { signal: AbortSignal.timeout(10000) });
  const j = await res.json();
  if (!j.latitude) throw new Error('no IP location');
  return {
    lat: +j.latitude, lng: +j.longitude, accuracy: 10000,
    place: [j.city, j.region].filter(Boolean).join(', ') || j.country || null
  };
}

async function placeName(lat, lng) {
  if (lastPlace && distanceKm(lastPlace, { lat, lng }) < 0.2) return lastPlace.place;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${lat}&lon=${lng}`;
    const j = await (await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })).json();
    const a = j.address || {};
    const place = [a.suburb || a.neighbourhood || a.road, a.city || a.town || a.village || a.county].filter(Boolean).join(', ') || j.display_name || null;
    lastPlace = { lat, lng, place };
    return place;
  } catch (_) { return lastPlace ? lastPlace.place : null; }
}

// → { lat, lng, accuracy, source: 'gps' | 'ip', place, at } or { error, at }
async function getLocation() {
  const at = new Date().toISOString();
  let osError = null;
  try {
    const p = await Promise.race([osLocation(), new Promise(r => setTimeout(() => r({ error: 'timeout' }), 25000))]);
    if (p && p.lat != null) return { ...p, source: 'gps', place: await placeName(p.lat, p.lng), at };
    osError = (p && p.error) || null;
  } catch (e) { osError = e.message; }
  try { return { ...(await ipLocation()), source: 'ip', osError, at }; }
  catch (e) { return { error: `location unavailable (${osError || e.message})`, at }; }
}

module.exports = { allowGeolocation, getLocation, distanceKm };
