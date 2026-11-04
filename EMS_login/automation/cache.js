/**
 * ============================================================
 * cache.js — GrowthApex EMS · Fast In-Memory Cache Layer
 * ============================================================
 * Wraps Firestore calls with a TTL-based in-memory cache so
 * the same collection is never fetched twice within a run.
 *
 * Usage:
 *   const { cachedGet, cachedQuery, clearCache } = require('./cache');
 *
 *   // Drop-in for db.collection('employees').get()
 *   const snap = await cachedGet(db, 'employees');
 *
 *   // Drop-in for db.collection('attendance').where('date','==',dateStr).get()
 *   const snap = await cachedQuery(db, 'attendance', 'date', '==', dateStr);
 *
 * Cache TTL (per collection):
 *   employees  → 10 min  (rarely changes mid-run)
 *   leaves     → 5 min
 *   attendance → 2 min   (checkins happen live)
 *   tasks      → 2 min
 *   logins     → 2 min
 *   *          → 3 min   (default)
 * ============================================================
 */

'use strict';

// ── TTL config (ms) ─────────────────────────────────────────
const TTL_MAP = {
  employees:  10 * 60 * 1000,  // 10 min
  leaves:      5 * 60 * 1000,  // 5 min
  attendance:  2 * 60 * 1000,  // 2 min
  tasks:       2 * 60 * 1000,  // 2 min
  logins:      2 * 60 * 1000,  // 2 min
};
const TTL_DEFAULT = 3 * 60 * 1000; // 3 min

// ── Internal store ───────────────────────────────────────────
// key → { data: QuerySnapshot, expiresAt: timestamp }
const _store = new Map();

function _ttl(collection) {
  return TTL_MAP[collection] ?? TTL_DEFAULT;
}

function _makeKey(collection, ...parts) {
  return [collection, ...parts].join('|');
}

function _get(key) {
  const entry = _store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _store.delete(key);
    return null;
  }
  return entry.data;
}

function _set(key, data, collection) {
  _store.set(key, { data, expiresAt: Date.now() + _ttl(collection) });
}

// ── Public helpers ───────────────────────────────────────────

/**
 * Cached version of db.collection(col).get()
 * Returns the same QuerySnapshot object on cache hit (read-only, safe).
 */
async function cachedGet(db, collection) {
  const key = _makeKey(collection);
  const hit = _get(key);
  if (hit) {
    if (process.env.CACHE_DEBUG) console.log(`[cache] HIT  ${collection}`);
    return hit;
  }
  if (process.env.CACHE_DEBUG) console.log(`[cache] MISS ${collection} — fetching…`);
  const snap = await db.collection(collection).get();
  _set(key, snap, collection);
  return snap;
}

/**
 * Cached version of db.collection(col).where(field, op, value).get()
 * Supports a single .where() clause (the most common pattern here).
 */
async function cachedQuery(db, collection, field, op, value) {
  const key = _makeKey(collection, field, op, String(value));
  const hit = _get(key);
  if (hit) {
    if (process.env.CACHE_DEBUG) console.log(`[cache] HIT  ${collection} [${field}${op}${value}]`);
    return hit;
  }
  if (process.env.CACHE_DEBUG) console.log(`[cache] MISS ${collection} [${field}${op}${value}] — fetching…`);
  const snap = await db.collection(collection).where(field, op, value).get();
  _set(key, snap, collection);
  return snap;
}

/**
 * Parallel fetch of multiple full collections — returns results in same order.
 * Automatically uses cache for each.
 *
 * Example:
 *   const [empSnap, leavesSnap, tasksSnap] =
 *     await parallelGet(db, ['employees', 'leaves', 'tasks']);
 */
async function parallelGet(db, collections) {
  return Promise.all(collections.map(col => cachedGet(db, col)));
}

/**
 * Invalidate one or all cached entries.
 * Call this after a write (e.g., after marking attendance).
 */
function clearCache(collection) {
  if (!collection) {
    _store.clear();
    if (process.env.CACHE_DEBUG) console.log('[cache] cleared all');
    return;
  }
  for (const key of _store.keys()) {
    if (key === collection || key.startsWith(collection + '|')) {
      _store.delete(key);
    }
  }
  if (process.env.CACHE_DEBUG) console.log(`[cache] cleared ${collection}`);
}

/** Return a snapshot of current cache stats (for debugging / logging). */
function cacheStats() {
  const now = Date.now();
  const stats = [];
  for (const [key, entry] of _store.entries()) {
    const ttlLeft = Math.round((entry.expiresAt - now) / 1000);
    stats.push({ key, ttlLeft: `${ttlLeft}s`, docs: entry.data?.size ?? '?' });
  }
  return stats;
}

module.exports = { cachedGet, cachedQuery, parallelGet, clearCache, cacheStats };

