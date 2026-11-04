/**
 * mascot.js — Freddy animated mascot for the GrowthApex website.
 *
 * Framework-free. Loads @bible-strong/avatar-web from a CDN (which resolves
 * its @bible-strong/avatar-core dependency), fetches freddy.avatar.json, and
 * renders Freddy in a fixed bottom-right corner on every page.
 *
 * Include once per page, just before </body>:
 *   <script type="module" src="mascot.js"></script>
 *
 * Library: @bible-strong/avatar-web (AGPL-3.0-only).
 */

const AVATAR_CDN = 'https://esm.sh/@bible-strong/avatar-web@0.1.0'
const DEFINITION_URL = new URL('freddy.avatar.json', import.meta.url).href
const SIZE = 120            // px, desktop
const SIZE_MOBILE = 84      // px, screens < 480px
const IDLE_MS = 30000       // 30s of no activity -> drowsy

const prefersReducedMotion =
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function injectStyles() {
  if (document.getElementById('mascot-style')) return
  const style = document.createElement('style')
  style.id = 'mascot-style'
  style.textContent = `
    #mascot {
      position: fixed;
      right: 16px;
      bottom: 16px;
      width: ${SIZE}px;
      height: ${SIZE}px;
      z-index: 2147483000;
      cursor: pointer;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
    }
    @media (max-width: 480px) {
      #mascot { width: ${SIZE_MOBILE}px; height: ${SIZE_MOBILE}px; right: 10px; bottom: 10px; }
    }
    @media print { #mascot { display: none !important; } }
  `
  document.head.appendChild(style)
}

function ensureContainer() {
  let el = document.getElementById('mascot')
  if (!el) {
    el = document.createElement('div')
    el.id = 'mascot'
    el.setAttribute('aria-hidden', 'false')
    document.body.appendChild(el)
  }
  return el
}

async function boot() {
  if (!document.body) return

  injectStyles()
  const container = ensureContainer()

  let createAvatar
  try {
    ;({ createAvatar } = await import(AVATAR_CDN))
  } catch (err) {
    console.error('[mascot] Could not load avatar library:', err)
    container.remove()
    return
  }

  let definition
  try {
    const res = await fetch(DEFINITION_URL)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    definition = await res.json()
  } catch (err) {
    console.error('[mascot] Could not load freddy.avatar.json:', err)
    container.remove()
    return
  }

  // Reduced motion: show a calm, still expression and skip all reactions.
  if (prefersReducedMotion) {
    createAvatar(container, {
      definition,
      defaultExpression: 'neutral',
      autoplay: false,
      size: '100%',
      ariaLabel: 'GrowthApex mascot',
      onError: (e) => console.error('[mascot]', e),
    })
    return
  }

  const avatar = createAvatar(container, {
    definition,
    defaultAnimation: 'waking',
    size: '100%',
    ariaLabel: 'GrowthApex mascot',
    onError: (e) => console.error('[mascot]', e),
  })

  // --- Reaction state machine -------------------------------------------
  let asleep = false
  let idleTimer = null

  const toIdle = () => avatar.play('idle')

  // "waking" loops, so move to idle after a short beat.
  setTimeout(() => { if (!asleep) toIdle() }, 2000)

  function goDrowsy() {
    asleep = true
    avatar.play('drowsy')
    setTimeout(() => { if (asleep) avatar.play('sleeping') }, 4000)
  }

  function wake() {
    if (asleep) {
      asleep = false
      avatar.play('waking')
      setTimeout(() => { if (!asleep) toIdle() }, 1500)
    }
  }

  function resetIdleTimer() {
    wake()
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(goDrowsy, IDLE_MS)
  }

  ;['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach((evt) =>
    window.addEventListener(evt, resetIdleTimer, { passive: true })
  )
  resetIdleTimer()

  // Click / tap the mascot -> laugh, then settle back.
  container.addEventListener('click', () => {
    wake()
    avatar.play('laughing')
    if (idleTimer) clearTimeout(idleTimer)
    setTimeout(() => {
      if (!asleep) { toIdle(); resetIdleTimer() }
    }, 2500)
  })

  // Expose for other scripts: window.mascot.play('celebrate'), etc.
  window.mascot = avatar
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot)
} else {
  boot()
}
