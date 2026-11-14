import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeSetArgs, Timer } from 'claude-code'

import type { Burst, Live, Mood, Seed, Stage } from '../types'
import { makeColors } from './make-colors.js'
import { BURST_LIFE, K, scene, virtual } from './scene'
import type { View } from './scene'

// Matrix rain: green code falling behind the conversation. Slow, nearly still
// while nothing runs; fast while a turn runs; every tool call drops a few
// streams in its own colour (reads cyan, edits magenta, shell amber, web
// violet, agents gold, other MCP tools blue, the rest white, a failure red).
// A short digital chime when a reply ends. No band and no status line, on
// purpose. /matrix on|off, /matrix sound on|off.

const SCENE = 'matrix-rain'

// Each new backdrop drawing reloads the app's frame. Tool calls are queued in
// `live` and taken into `stage`, what the backdrop draws, at most this often.
const GAP_MS = 3000

// Bursts kept in the drawing at once.
const MAX_BURSTS = 10

const live = atom({ plugin: 'matrix-rain', key: 'live' } as const, { queue: [] } as Live, { shape: 'live-1' })
const stage = atom({ plugin: 'matrix-rain', key: 'stage' } as const, { mood: 'idle', bursts: [] } as Stage, {
  shape: 'stage-2',
})

// The rain clock as the window shows it, and when each burst was first drawn.
// Kept here, not in state, and set while drawing: the app can draw a new
// backdrop seconds after the state changed, and timing a change from the
// state made the whole rain jump when the drawing arrived. Timed from the
// drawing, the speed changes where the rain is and a burst enters from the
// top. A reload starts these over, which costs one jump then.
let shown: View | undefined
const seen = new Map<number, number>()

function settle(mood: Mood, now: number): View {
  const was = shown
  const view: View =
    was === undefined
      ? { mood, from: mood, tR: now, vR: now / K[mood], prevTR: -Infinity, prevVR: 0 }
      : was.mood === mood
        ? was
        : {
            mood,
            from: was.mood,
            tR: now,
            vR: virtual(was, now),
            // A view with no change in it let every column fall steadily: all joined.
            prevTR: was.from === was.mood ? -Infinity : was.tR,
            prevVR: was.vR,
          }
  shown = view

  return view
}

function firstDrawn(bursts: Burst[], now: number): Burst[] {
  for (const seed of [...seen.keys()]) {
    if (!bursts.some(b => b.seed === seed)) {
      seen.delete(seed)
    }
  }

  return bursts.map(b => {
    const at = seen.get(b.seed) ?? now
    seen.set(b.seed, at)

    return { ...b, at }
  })
}

const { theme } = makeColors({
  label: 'Matrix Rain',
  roles: { accent: '#2bff88', danger: '#ff4f64', success: '#a8ff3e', warning: '#ffb21e', pro: '#3fe0ff' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#030a06',
        'surface-1': '#06110a',
        'surface-2': '#09160d',
        'surface-3': '#0b1a10',
        // Nearly neutral, with a trace of green: a strong mint glows on
        // black and reads soft. Kept this bright on purpose: the app draws
        // its faded labels as this colour at about 55% opacity.
        'text-primary': '#e6f6eb',
        'text-secondary': '#bfdcc8',
        'text-muted': '#9cc0a6',
      },
    },
  },
  only: 'dark',
  // The code theme paints the code blocks' background too: vitesse-black's is
  // pure black, with soft teal and green syntax (github-dark's #24292e read
  // as a light grey box on this page).
  codeTheme: { dark: 'vitesse-black' },
})

const LOOK: ThemeSetArgs = {
  colors: theme,
  // The panel behind the chat: dense enough that streams passing behind the
  // text are a soft glow, not moving noise.
  backdrop: { scene: SCENE, glass: { blur: 14, tint: '#020805', opacity: 0.84 } },
}

const RED = '#ff3346'

// A tool's colour, by what kind of work it is.
const hue = (tool: string): string => {
  if (/^(Read|Grep|Glob|LS|NotebookRead)$/.test(tool)) {
    return '#26e7ff'
  }
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) {
    return '#ff3df2'
  }
  if (/^(Bash|BashOutput|KillShell|Monitor|TaskStop)$/.test(tool)) {
    return '#ffb21e'
  }
  if (/^(WebFetch|WebSearch)$/.test(tool) || /Browser|chrome/.test(tool)) {
    return '#a77bff'
  }
  if (/^(Agent|Task|Workflow|SendMessage)$/.test(tool)) {
    return '#ffe45c'
  }
  if (tool.startsWith('mcp__')) {
    return '#4f8cff'
  }

  return '#effff4'
}

// The module's own: they start over on a reload, which only means one early redraw.
let lastRedraw = 0
let pending: Timer | undefined

// Takes the queued tool calls (and a new mood, if given) into the backdrop in
// one write, so one redraw.
async function redraw($: EngineInterface, mood?: Mood) {
  pending?.cancel()
  pending = undefined
  const ms = await $.clock.now()
  lastRedraw = ms
  const now = ms / 1000
  let taken: Seed[] = []
  await update($, live, l => {
    taken = l.queue

    return { queue: [] }
  })
  const was = await read($, stage)
  const turned = mood !== undefined && mood !== was.mood
  if (!turned && taken.length === 0) {
    return
  }
  await update($, stage, s => ({
    mood: mood ?? s.mood,
    bursts: [...s.bursts.filter(b => now - b.at < BURST_LIFE), ...taken.map(t => ({ ...t, at: now }))].slice(-MAX_BURSTS),
  }))
}

// Queues a tool call's streams and draws them now, or as soon as the last
// redraw is GAP_MS old.
async function spawn($: EngineInterface, color: string, size: number) {
  const seed = Math.floor(Math.random() * 2147483647)
  await update($, live, l => ({ queue: [...l.queue, { seed, color, size }].slice(-MAX_BURSTS) }))
  if (pending !== undefined) {
    return
  }
  const wait = lastRedraw + GAP_MS - (await $.clock.now())
  if (wait <= 0) {
    await redraw($)

    return
  }
  pending = $.clock.after(wait, () => {
    void redraw($).catch(() => undefined)
  })
}

async function isOff($: EngineInterface) {
  return (await $.store.get('off')) === true
}

// The chime at the end of a reply (tools/make-sound.py makes it). Not awaited
// by the turn: a sound that can't play must not hold anything up.
async function chime($: EngineInterface) {
  if ((await isOff($)) || (await $.store.get('mute')) === true) {
    return
  }
  void $.audio.play({ asset: 'sounds/turn-end.wav' }, { gain: 0.7 }).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'matrix', description: 'Matrix rain theme: on | off | sound on | sound off' })
    if (!(await isOff($))) {
      await $.theme.set(LOOK)
    }
    // A session that ended mid-turn may have stored busy.
    await redraw($, 'idle')

    return next(e)
  })

  // The main loop's turns only: a subagent's turn runs inside one of these.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await redraw($, 'busy')
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await redraw($, 'idle')
      // Only a finished reply: not one you stopped, or one an error ended.
      if (e.reason === 'answer') {
        await chime($)
      }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    await spawn($, hue(e.tool), e.tool === 'Agent' ? 6 : 4)
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError === true) {
      await spawn($, RED, 6)
    }

    return ran
    // Where the hook had called next, next(e) replays its answer: nothing runs twice.
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'matrix' }, async ($, e) => {
    const args = e.args.trim().split(/\s+/)
    if (args[0] === 'sound') {
      if (args[1] === 'off') {
        await $.store.set('mute', true)

        return { text: 'Matrix rain: the end-of-reply chime is off. `/matrix sound on` brings it back.' }
      }
      await $.store.delete('mute')

      return { text: 'Matrix rain: the end-of-reply chime is on.' }
    }
    if (args[0] === 'off') {
      await $.store.set('off', true)
      await $.theme.clear()

      return { text: 'Matrix rain off, here and in new sessions. `/matrix on` brings it back.' }
    }
    await $.store.delete('off')
    await $.theme.set(LOOK)

    return { text: 'Matrix rain on.' }
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.scene !== SCENE) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)
    const s = await read($, stage)
    const now = (await $.clock.now()) / 1000
    const view = settle(s.mood, now)

    return (
      <Svg
        source={scene(view, firstDrawn(s.bursts, now), now)}
        alt={s.mood === 'busy' ? 'Green code raining fast down a black screen' : 'Green code drifting slowly down a black screen'}
      />
    )
  })
}
