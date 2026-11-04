/**
 * ============================================================
 * rate-limiter.js — GrowthApex EMS · API Rate Limiter
 * ============================================================
 * Prevents hitting WhatsApp / Green-API / Firestore rate limits
 * by enforcing a minimum gap between calls and a max burst cap.
 *
 * Exported helpers
 * ─────────────────
 *  RateLimiter          – General-purpose token-bucket limiter class
 *  whatsappLimiter      – Pre-configured for WhatsApp message sends
 *  firestoreLimiter     – Pre-configured for Firestore write bursts
 *  throttledSend(fn)    – Wrap any send function with WA rate limit
 *  throttleFirestore(fn)– Wrap any Firestore write with FS rate limit
 *  sleep(ms)            – Simple promise-based delay (re-exported)
 * ============================================================
 */

'use strict';

// ── Utility ──────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Token-Bucket Rate Limiter ─────────────────────────────────
/**
 * Classic token-bucket algorithm:
 *   • `maxTokens`  – burst capacity (max calls in quick succession)
 *   • `refillRate` – tokens restored per second
 *   • `minGapMs`   – hard floor between any two calls (regardless of tokens)
 */
class RateLimiter {
  /**
   * @param {object} opts
   * @param {number} opts.maxTokens   – burst limit (default 5)
   * @param {number} opts.refillRate  – tokens/second refill speed (default 1)
   * @param {number} opts.minGapMs    – minimum ms between calls (default 1000)
   * @param {string} opts.name        – label used in log messages
   */
  constructor({ maxTokens = 5, refillRate = 1, minGapMs = 1000, name = 'limiter' } = {}) {
    this.maxTokens  = maxTokens;
    this.refillRate = refillRate;   // tokens per second
    this.minGapMs   = minGapMs;
    this.name       = name;

    this._tokens    = maxTokens;    // start full
    this._lastRefill  = Date.now();
    this._lastCallAt  = 0;
    this._queue     = [];           // pending resolve callbacks
    this._processing  = false;
  }

  // Refill tokens based on elapsed time
  _refill() {
    const now     = Date.now();
    const elapsed = (now - this._lastRefill) / 1000; // seconds
    this._tokens  = Math.min(this.maxTokens, this._tokens + elapsed * this.refillRate);
    this._lastRefill = now;
  }

  /**
   * Wait until a token is available, then consume one.
   * Respects minGapMs even if tokens are available.
   */
  async acquire() {
    return new Promise((resolve) => {
      this._queue.push(resolve);
      this._drain();
    });
  }

  async _drain() {
    if (this._processing) return;
    this._processing = true;

    while (this._queue.length > 0) {
      this._refill();

      // Enforce minimum gap between calls
      const sinceLastCall = Date.now() - this._lastCallAt;
      if (sinceLastCall < this.minGapMs) {
        await sleep(this.minGapMs - sinceLastCall);
      }

      // Wait for a token if bucket is empty
      if (this._tokens < 1) {
        const waitMs = Math.ceil((1 - this._tokens) / this.refillRate * 1000);
        if (process.env.RATELIMIT_DEBUG) {
          console.log(`[${this.name}] bucket empty — waiting ${waitMs}ms for refill`);
        }
        await sleep(waitMs);
        this._refill();
      }

      this._tokens    -= 1;
      this._lastCallAt = Date.now();

      const next = this._queue.shift();
      next(); // release the caller
    }

    this._processing = false;
  }

  /**
   * Wraps an async function so each call waits its turn.
   * @param  {Function} fn  – async function to rate-limit
   * @returns {Function}    – rate-limited version
   */
  wrap(fn) {
    return async (...args) => {
      await this.acquire();
      return fn(...args);
    };
  }

  /** Current stats (for diagnostics) */
  stats() {
    this._refill();
    return {
      name:       this.name,
      tokens:     +this._tokens.toFixed(2),
      maxTokens:  this.maxTokens,
      minGapMs:   this.minGapMs,
      queued:     this._queue.length,
    };
  }
}

// ── Pre-configured limiters ───────────────────────────────────

/**
 * WhatsApp limiter:
 *   • Max 5 messages burst
 *   • Refill 1 token / 4 seconds  →  ~15 msg/min sustained
 *   • Hard gap: 3 s between any two sends (avoids spam flags)
 *
 * Override via env:
 *   WA_RATE_MAX_TOKENS=5
 *   WA_RATE_REFILL_PER_SEC=0.25
 *   WA_RATE_MIN_GAP_MS=3000
 */
const whatsappLimiter = new RateLimiter({
  name:       'whatsapp',
  maxTokens:  parseInt(process.env.WA_RATE_MAX_TOKENS        || '5',    10),
  refillRate: parseFloat(process.env.WA_RATE_REFILL_PER_SEC  || '0.25'),  // 1 token / 4 s
  minGapMs:   parseInt(process.env.WA_RATE_MIN_GAP_MS        || '3000', 10),
});

/**
 * Firestore write limiter:
 *   • Max 10 writes burst
 *   • Refill 5 tokens / sec  →  300 writes/min (well under 1-write-per-doc/sec limit)
 *   • Hard gap: 100 ms between writes
 *
 * Override via env:
 *   FS_RATE_MAX_TOKENS=10
 *   FS_RATE_REFILL_PER_SEC=5
 *   FS_RATE_MIN_GAP_MS=100
 */
const firestoreLimiter = new RateLimiter({
  name:       'firestore',
  maxTokens:  parseInt(process.env.FS_RATE_MAX_TOKENS        || '10', 10),
  refillRate: parseFloat(process.env.FS_RATE_REFILL_PER_SEC  || '5'),
  minGapMs:   parseInt(process.env.FS_RATE_MIN_GAP_MS        || '100', 10),
});

// ── Convenience wrappers ──────────────────────────────────────

/**
 * Wrap a WhatsApp send function with rate limiting.
 * @example
 *   const safeSend = throttledSend(sendReport);
 *   await safeSend(message, chatId);
 */
function throttledSend(fn) {
  return whatsappLimiter.wrap(fn);
}

/**
 * Wrap a Firestore write (set / update / create / delete) with rate limiting.
 * @example
 *   const safeSet = throttleFirestore((data) => ref.set(data));
 *   await safeSet({ status: 'sent' });
 */
function throttleFirestore(fn) {
  return firestoreLimiter.wrap(fn);
}

/**
 * Send messages from an array with a fixed inter-message delay.
 * Useful for personal salary summaries sent one-per-employee.
 *
 * @param {Array}    items      – array of items to process
 * @param {Function} sendFn     – async (item) => void
 * @param {number}   delayMs    – wait between sends (default 4 s)
 */
async function sendBatch(items, sendFn, delayMs = 4000) {
  for (let i = 0; i < items.length; i++) {
    await whatsappLimiter.acquire();
    await sendFn(items[i]);
    if (i < items.length - 1) {
      if (process.env.RATELIMIT_DEBUG) {
        console.log(`[whatsapp] batch delay ${delayMs}ms (${i + 1}/${items.length} sent)`);
      }
      await sleep(delayMs);
    }
  }
}

module.exports = {
  RateLimiter,
  whatsappLimiter,
  firestoreLimiter,
  throttledSend,
  throttleFirestore,
  sendBatch,
  sleep,
};

