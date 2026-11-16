import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeSetArgs, Timer } from 'claude-code'

import type { Mood, Stage } from '../types'
import { levelFor, meter, RANK } from './meter'
import { scene, shift, start } from './scene'
import type { View } from './scene'

// Clockworks: an iron gear train behind the conversation. While nothing runs
// it stands still and muted; while a turn runs it turns, at full strength.
// With the storm on, a running turn's gears follow the tokens the model
// writes: creeping while it waits on a command or a job, faster while it
// writes a lot. The colours never change, only how visible the gears are and
// how fast they turn. A clockwork chime when a reply ends. No band and no
// status line, on purpose. Claude's own colours and background (text, panels,
// code blocks) are left as they are, in light and dark mode: the theme draws
// only the gears, with no background of their own, and frosts the panel over
// them. /clockworks on|off, sound on|off, storm on|off.

const SCENE = 'clockworks'

// Each new backdrop drawing reloads the app's frame: a level the meter asks
// for is drawn at most this often.
const GAP_MS = 3000

const stage = atom({ plugin: 'clockworks', key: 'stage' } as const, { mood: 'idle' } as Stage, { shape: 'stage-1' })

// The turning clock as the window shows it. Kept here, not in state, and set
// while drawing: the app can draw a new backdrop seconds after the state
// changed, and timing a change from the state would make every gear jump
// when the drawing arrived. Timed from the drawing, the speed changes where
// the gears are. A reload starts it over, which costs one jump then.
let shown: View | undefined

// The last drawing, and the level it was drawn at. The app asks for the
// backdrop again whenever the window's size changes, and the gears don't
// depend on it: asked again with nothing changed, the hook hands back this
// same drawing rather than a fresh image for the app to swap in at every step
// of a resize. Every HEAL_MS it is drawn anew all the same, so a backdrop the
// app dropped comes back on its own instead of waiting for the next turn.
let drawn: { key: Mood; source: string; alt: string } | undefined
const HEAL_MS = 20_000
let healer: Timer | undefined

function settle(mood: Mood, now: number): View {
  shown = shown === undefined ? start(mood, now) : shown.mood === mood ? shown : shift(shown, mood, now)

  return shown
}

// The look is the backdrop alone: no `colors`, so Claude keeps its own text,
// panels and code blocks in each mode. The panel behind the chat is dense
// enough that gears turning behind the text are a soft shape, not moving
// noise, and takes the app's own panel colour, which follows its mode.
const LOOK: ThemeSetArgs = {
  backdrop: { scene: SCENE, glass: { blur: 14, opacity: 0.82 } },
}

const ALT: Record<Mood, string> = {
  idle: 'Iron gears standing still',
  wait: 'Iron gears creeping round',
  busy: 'Iron gears turning',
  storm: 'Iron gears turning fast',
}

// The module's own: they start over on a reload, which only means one early redraw.
let lastRedraw = 0
let pending: Timer | undefined

// The level wanted now. Unknown after a reload until a turn starts or ends,
// and a redraw meanwhile keeps the level the backdrop shows.
let level: Mood | undefined
// A main-loop turn is running.
let running = false

// ── The storm ───────────────────────────────────────────────────────────
// While a turn runs with the storm on, a tick reads the token meter once a
// second and asks for the level it calls for. A faster level is drawn at the
// next redraw; a slower one only once the meter has asked for it for HOLD
// seconds, so a pause between two replies doesn't slow the gears.
const TICK_MS = 1000
const HOLD = 3

const tokens = meter()
let ticker: Timer | undefined
// When the meter first asked for less than the level now.
let lower: number | undefined

async function isOff($: EngineInterface) {
  return (await $.store.get('off')) === true
}

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

// Takes a new level (`mood` if given, else the one wanted) into the backdrop.
async function redraw($: EngineInterface, mood?: Mood) {
  pending?.cancel()
  pending = undefined
  lastRedraw = await $.clock.now()
  const want = mood ?? level
  if (want === undefined || want === (await read($, stage)).mood) {
    return
  }
  await update($, stage, () => ({ mood: want }))
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
      name: 'clockworks',
      description: 'Clockworks theme: on | off | sound on | sound off | storm on | storm off',
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

  on('command.run', { command: 'clockworks' }, async ($, e) => {
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
          text: 'Clockworks: the storm is off. While Claude works the gears turn at one speed. `/clockworks storm on` brings it back.',
        }
      }
      await $.store.delete('nostorm')
      if (running && ticker === undefined && !(await isOff($))) {
        await follow($)
      }

      return {
        text: 'Clockworks: the storm is on. While Claude works the gears follow the tokens it writes: creeping while it waits on a command or a job, faster while it writes a lot.',
      }
    }
    if (args[0] === 'sound') {
      if (args[1] === 'off') {
        await $.store.set('mute', true)

        return { text: 'Clockworks: the end-of-reply chime is off. `/clockworks sound on` brings it back.' }
      }
      await $.store.delete('mute')

      return { text: 'Clockworks: the end-of-reply chime is on.' }
    }
    if (args[0] === 'off') {
      await $.store.set('off', true)
      unfollow()
      await $.theme.clear()

      return { text: 'Clockworks off, here and in new sessions. `/clockworks on` brings it back.' }
    }
    await $.store.delete('off')
    await $.theme.set(LOOK)

    return { text: 'Clockworks on.' }
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.scene !== SCENE) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)
    const { mood } = await read($, stage)
    if (drawn?.key !== mood) {
      const now = (await $.clock.now()) / 1000
      drawn = { key: mood, source: scene(settle(mood, now), now), alt: ALT[mood] }
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
