import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeSetArgs, Timer } from 'claude-code'

import type { Appearance, Burst, Live, Mood, Seed, Stage } from '../types'
import { levelFor, meter, RANK } from './meter'
import { BURST_LIFE, scene, shift, start, TOOL } from './scene'
import type { View } from './scene'

// Matrix rain: green code falling behind the conversation. Slow, nearly still
// while nothing runs; fast while a turn runs; every tool call drops a few
// streams in its own colour (reads cyan, edits magenta, shell amber, web
// violet, agents gold, other MCP tools blue, the rest white, a failure red).
// With the storm on, a running turn's rain follows the tokens the model
// writes: light while it waits on a command or a job, a storm while it writes
// a lot. A short digital chime when a reply ends. No band and no status line,
// on purpose. It follows Claude's own mode: bright green letters in dark
// mode, deep green in light mode; /matrix light|dark keeps one look. Claude's
// own colours and background (text, panels, code blocks) are left as they
// are: the theme draws only the falling letters, with no background of their
// own, and frosts the panel over them.
// /matrix on|off, /matrix auto|light|dark, /matrix sound on|off,
// /matrix storm on|off.

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

const keyOf = (s: Stage, look: Appearance) => `${look}:${s.mood}:${s.bursts.map(b => b.seed).join(',')}`

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

// The look is the backdrop alone: no `colors`, so Claude keeps its own text,
// panels and code blocks in each mode. Following Claude's mode, the look asks
// for none, and the backdrop draws both looks, the app's mode picking one. A
// kept look asks for its mode, and the backdrop draws that one alone. The
// panel behind the chat is dense enough that streams passing behind the text
// are a soft glow, not moving noise, and takes the app's own panel colour.
const lookOf = (appearance: Appearance): ThemeSetArgs => ({
  ...(appearance === 'auto' ? {} : { overrideColorScheme: appearance }),
  backdrop: { scene: SCENE, glass: { blur: 14, opacity: 0.84 } },
})

// The look: `auto` follows Claude's mode; /matrix light|dark keeps one, across
// sessions. Read again at each session start.
let appearance: Appearance = 'auto'

async function appearanceOf($: EngineInterface): Promise<Appearance> {
  const kept = await $.store.get('look')

  return kept === 'light' || kept === 'dark' ? kept : 'auto'
}

const FALL: Record<Mood, string> = {
  idle: 'drifting slowly down',
  wait: 'falling steadily down',
  busy: 'raining fast down',
  storm: 'pouring down',
}
const altOf = (look: Appearance, mood: Mood) =>
  `${look === 'light' ? 'Deep green' : 'Green'} code ${FALL[mood]} the screen${mood === 'storm' ? ' in a storm' : ''}`

const SAID: Record<Appearance, string> = {
  auto: "Matrix rain follows Claude's appearance: bright green letters in dark mode, deep green in light mode. `/matrix light` or `/matrix dark` keeps one look.",
  light: "Matrix rain: light, whatever Claude's appearance. Deep green letters, made for a light background. `/matrix auto` follows Claude's appearance again.",
  dark: "Matrix rain: dark, whatever Claude's appearance. Bright green letters, made for a dark background. `/matrix auto` follows Claude's appearance again.",
}

// A tool's colour, by what kind of work it is.
const hue = (tool: string): string => {
  if (/^(Read|Grep|Glob|LS|NotebookRead)$/.test(tool)) {
    return TOOL.read
  }
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) {
    return TOOL.edit
  }
  if (/^(Bash|BashOutput|KillShell|Monitor|TaskStop)$/.test(tool)) {
    return TOOL.shell
  }
  if (/^(WebFetch|WebSearch)$/.test(tool) || /Browser|chrome/.test(tool)) {
    return TOOL.web
  }
  if (/^(Agent|Task|Workflow|SendMessage)$/.test(tool)) {
    return TOOL.agent
  }
  if (tool.startsWith('mcp__')) {
    return TOOL.mcp
  }

  return TOOL.other
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
      description: 'Matrix rain theme: on | off | auto | light | dark | sound on | sound off | storm on | storm off',
    })
    appearance = await appearanceOf($)
    if (!(await isOff($))) {
      await $.theme.set(lookOf(appearance))
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
      await spawn($, TOOL.failed, 6)
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
    if (args[0] === 'auto' || args[0] === 'light' || args[0] === 'dark') {
      appearance = args[0]
      if (appearance === 'auto') {
        await $.store.delete('look')
      } else {
        await $.store.set('look', appearance)
      }
      if (await isOff($)) {
        return { text: `${SAID[appearance]} It shows once you turn it on with \`/matrix on\`.` }
      }
      await $.theme.set(lookOf(appearance))
      $.ui.invalidate('ui.render')

      return { text: SAID[appearance] }
    }
    if (args[0] === 'off') {
      await $.store.set('off', true)
      unfollow()
      await $.theme.clear()

      return { text: 'Matrix rain off, here and in new sessions. `/matrix on` brings it back.' }
    }
    await $.store.delete('off')
    await $.theme.set(lookOf(appearance))

    return { text: 'Matrix rain on.' }
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.scene !== SCENE) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)
    const s = await read($, stage)
    // The look the theme was set with, as the app hands it back: a kept one's
    // mode, or none while it follows Claude's.
    const look: Appearance = e.props.overrideColorScheme ?? appearance
    const key = keyOf(s, look)
    if (drawn?.key !== key) {
      const now = (await $.clock.now()) / 1000
      drawn = { key, source: scene(settle(s.mood, now), firstDrawn(s.bursts, now), now, look), alt: altOf(look, s.mood) }
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
