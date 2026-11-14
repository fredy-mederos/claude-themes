import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeSetArgs, Timer } from 'claude-code'

import type { Burst, Live, Mood, Seed, Stage } from '../types'
import { makeColors } from './make-colors.js'
import { levelFor, meter, RANK } from './meter'
import { BURST_LIFE, scene, shift, start } from './scene'
import type { View } from './scene'

// Matrix rain: green code falling behind the conversation. Slow, nearly still
// while nothing runs; fast while a turn runs; every tool call drops a few
// streams in its own colour (reads cyan, edits magenta, shell amber, web
// violet, agents gold, other MCP tools blue, the rest white, a failure red).
// With the storm on, a running turn's rain follows the tokens the model
// writes: light while it waits on a command or a job, a storm while it writes
// a lot. A short digital chime when a reply ends. No band and no status line,
// on purpose. /matrix on|off, /matrix sound on|off, /matrix storm on|off.

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

// The last drawing, and the state it was drawn from. The app asks for the
// backdrop again whenever the window's size changes, and the rain doesn't
// depend on it: asked again with nothing changed, the hook hands back this
// same drawing, without reading the clock, rather than a fresh image for the
// app to swap in at every step of a resize. Every HEAL_MS it is drawn anew
// all the same, so a backdrop the app dropped (seen after resizing) comes
// back on its own instead of waiting for the next turn.
let drawn: { key: string; source: string; alt: string } | undefined
const HEAL_MS = 20_000
let healer: Timer | undefined

const keyOf = (s: Stage) => `${s.mood}:${s.bursts.map(b => b.seed).join(',')}`

function settle(mood: Mood, now: number): View {
  shown = shown === undefined ? start(mood, now) : shown.mood === mood ? shown : shift(shown, mood, now)

  return shown
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
    // Diffs and git states in vitesse-black's own colours, to match the code
    // blocks. Added, modified, merged and draft are a little lighter than
    // vitesse's, as much as their labels need to read on their tints.
    git: {
      added: '#69a48b',
      removed: '#cb7676',
      modified: '#6f9dc4',
      merged: '#da76a1',
      closed: '#cb7676',
      conflicting: '#d4976c',
      draft: '#8e9b8e',
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

const ALT: Record<Mood, string> = {
  idle: 'Green code drifting slowly down a black screen',
  wait: 'Green code falling steadily down a black screen',
  busy: 'Green code raining fast down a black screen',
  storm: 'Green code pouring down a black screen in a storm',
}

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

// The rain wanted now. Unknown after a reload until a turn starts or ends,
// and a redraw meanwhile keeps the level the backdrop shows.
let level: Mood | undefined
// A main-loop turn is running.
let running = false

// ── The storm ───────────────────────────────────────────────────────────
// While a turn runs with the storm on, a tick reads the token meter once a
// second and asks for the level it calls for. More rain is drawn at the next
// redraw; less only once the meter has asked for it for HOLD seconds, so a
// pause between two replies doesn't thin the rain.
const TICK_MS = 1000
const HOLD = 3

const tokens = meter()
let ticker: Timer | undefined
// When the meter first asked for less rain than the level now.
let lower: number | undefined

async function stormy($: EngineInterface) {
  return (await $.store.get('nostorm')) !== true && !(await isOff($))
}

async function tick($: EngineInterface) {
  const now = (await $.clock.now()) / 1000
  if (!running || ticker === undefined || level === undefined) {
    return
  }
  const want = levelFor(level, tokens.tick(now))
  if (RANK[want] < RANK[level]) {
    lower ??= now
    if (now - lower < HOLD) {
      return
    }
  }
  lower = undefined
  if (want !== level) {
    level = want
    await schedule($)
  }
}

async function follow($: EngineInterface) {
  unfollow()
  tokens.reset((await $.clock.now()) / 1000)
  ticker = $.clock.every(TICK_MS, () => {
    void tick($).catch(() => undefined)
  })
}

function unfollow() {
  ticker?.cancel()
  ticker = undefined
  lower = undefined
}

// Takes the queued tool calls (and a new level: `mood` if given, else the one
// wanted) into the backdrop in one write, so one redraw.
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
  const want = mood ?? level
  const turned = want !== undefined && want !== was.mood
  if (!turned && taken.length === 0) {
    return
  }
  await update($, stage, s => ({
    mood: want ?? s.mood,
    bursts: [...s.bursts.filter(b => now - b.at < BURST_LIFE), ...taken.map(t => ({ ...t, at: now }))].slice(-MAX_BURSTS),
  }))
}

// Queues a tool call's streams and draws them.
async function spawn($: EngineInterface, color: string, size: number) {
  const seed = Math.floor(Math.random() * 2147483647)
  await update($, live, l => ({ queue: [...l.queue, { seed, color, size }].slice(-MAX_BURSTS) }))
  await schedule($)
}

// Redraws now, or as soon as the last redraw is GAP_MS old.
async function schedule($: EngineInterface) {
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
    await $.command.register({
      name: 'matrix',
      description: 'Matrix rain theme: on | off | sound on | sound off | storm on | storm off',
    })
    if (!(await isOff($))) {
      await $.theme.set(LOOK)
    }
    healer?.cancel()
    healer = $.clock.every(HEAL_MS, () => {
      drawn = undefined
      $.ui.invalidate('ui.render')
    })
    // A session that ended mid-turn may have stored busy.
    running = false
    level = 'idle'
    unfollow()
    await redraw($, 'idle')

    return next(e)
  })

  // The main loop's turns only: a subagent's turn runs inside one of these.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      running = true
      level = 'busy'
      await redraw($, 'busy')
      if (await stormy($)) {
        await follow($)
      } else {
        unfollow()
      }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      running = false
      level = 'idle'
      unfollow()
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

  // Every model request, the main loop's and each subagent's: the meter counts
  // what the model writes as it streams in. Each piece goes on as it came.
  on('turn.step', async function* ($, e, next) {
    const step = tokens.step()
    try {
      for await (const c of next(e)) {
        if (c.kind === 'text' || c.kind === 'thinking') {
          step.add(c.text.length)
        } else if (c.kind === 'input') {
          step.add(c.json.length)
        } else if (c.kind === 'stop' && c.usage !== null) {
          step.stop(c.usage.output_tokens)
        }
        yield c
      }
    } finally {
      step.end()
    }
  })

  on('command.run', { command: 'matrix' }, async ($, e) => {
    const args = e.args.trim().split(/\s+/)
    if (args[0] === 'storm') {
      if (args[1] === 'off') {
        await $.store.set('nostorm', true)
        unfollow()
        if (running) {
          level = 'busy'
          await schedule($)
        }

        return {
          text: 'Matrix rain: the storm is off. While Claude works the rain falls at one pace. `/matrix storm on` brings it back.',
        }
      }
      await $.store.delete('nostorm')
      if (running && ticker === undefined && !(await isOff($))) {
        await follow($)
      }

      return {
        text: 'Matrix rain: the storm is on. While Claude works the rain follows the tokens it writes: light while it waits on a command or a job, a storm while it writes a lot.',
      }
    }
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
      unfollow()
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
    const key = keyOf(s)
    if (drawn?.key !== key) {
      const now = (await $.clock.now()) / 1000
      drawn = { key, source: scene(settle(s.mood, now), firstDrawn(s.bursts, now), now), alt: ALT[s.mood] }
    }

    return <Svg source={drawn.source} alt={drawn.alt} />
    // A drawing that failed shows the last one, not the app's empty backdrop.
  }).catch(($, e, next) => {
    if (drawn === undefined || (e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.scene !== SCENE) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)

    return <Svg source={drawn.source} alt={drawn.alt} />
  })
}
