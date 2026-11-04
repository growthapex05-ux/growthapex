/**
 * FreddyAvatar.tsx
 * ----------------
 * React component for the "Freddy" procedural avatar, built from
 * freddy.avatar.json using @bible-strong/avatar-react.
 *
 * PREREQUISITES (this repo is NOT a React project yet):
 *   1. A React + TypeScript build (Vite/Next/CRA) with:
 *        - "jsx": "react-jsx"
 *        - "resolveJsonModule": true   (to import the .avatar.json)
 *        - "esModuleInterop": true
 *   2. The (currently private) packages installed:
 *        npm install @bible-strong/avatar-react @bible-strong/avatar-core react react-dom
 *      Until published, install from the workspace or a tarball.
 *
 * Available animation keys (defaultAnimation / play):
 *   sleeping, waking, idle, listening, thinking, searching, working,
 *   excited, bored, suspicious, angry, drowsy, happy, curious, confused,
 *   surprised, proud, shy, sad, laughing, scared, playful, celebrate
 *
 * Available expression keys (defaultExpression / setExpression):
 *   neutral, upward-side-glance, downward-gaze, skeptical-right,
 *   small-attentive, wide-downward-gaze, surprised-left, sleepy-squint,
 *   angry-right, curious-left, asymmetric-down-right, attentive-left,
 *   joyful-wide, eyes-closed, joyful-down-right, skeptical-left,
 *   far-right-glance, angry-left, playful-right, asymmetric-up-left,
 *   gentle-downward-gaze, wide-down-left, surprised-wide-left,
 *   drowsy-closed, suspicious-right, shy-downward, angry-brows, uneasy-left
 */

import { useRef } from 'react'
import { createAvatar, type AvatarController } from '@bible-strong/avatar-react'
import '@bible-strong/avatar-react/styles.css'
import freddyJson from './freddy.avatar.json'

// createAvatar validates the JSON and returns a concrete component
// with typed animation/expression keys derived from freddy.avatar.json.
const Freddy = createAvatar(freddyJson)

// Keys worth exposing as quick controls in the demo below.
const ANIMATIONS = ['idle', 'thinking', 'working', 'happy', 'sleeping'] as const
const EXPRESSIONS = ['neutral', 'joyful-wide', 'skeptical-left', 'angry-brows'] as const

type FreddyAvatarProps = {
  /** Initial looping animation (uncontrolled mode). Defaults to "idle". */
  defaultAnimation?: Parameters<typeof Freddy>[0]['defaultAnimation']
  /** Container size (px number or any CSS size). Defaults to 240. */
  size?: number | string
  className?: string
}

/**
 * Simplest usage: just render Freddy with a looping default animation.
 *
 *   <FreddyAvatar defaultAnimation="idle" size={200} />
 */
export function FreddyAvatar({
  defaultAnimation = 'idle',
  size = 240,
  className,
}: FreddyAvatarProps) {
  return (
    <Freddy
      defaultAnimation={defaultAnimation}
      size={size}
      className={className}
      ariaLabel="Freddy avatar"
      onError={(error) => console.error('[FreddyAvatar]', error)}
    />
  )
}

/**
 * Interactive demo: uses the imperative ref API to drive playback
 * from buttons (play / pause / setExpression / stop / read state).
 */
export function FreddyAvatarDemo() {
  const avatar = useRef<AvatarController>(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
      <Freddy
        ref={avatar}
        defaultAnimation="idle"
        size={240}
        ariaLabel="Freddy avatar"
        onAnimationEnd={(a) => console.log('animation ended:', a)}
        onExpressionChange={(e) => console.log('expression:', e)}
        onError={(error) => console.error('[FreddyAvatar]', error)}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
        {ANIMATIONS.map((a) => (
          <button key={a} onClick={() => avatar.current?.play(a)}>
            {a}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
        {EXPRESSIONS.map((e) => (
          <button key={e} onClick={() => avatar.current?.setExpression(e)}>
            {e}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => avatar.current?.pause()}>Pause</button>
        <button onClick={() => avatar.current?.stop()}>Stop</button>
        <button onClick={() => console.log(avatar.current?.getState())}>Read state</button>
      </div>
    </div>
  )
}

export default FreddyAvatar
