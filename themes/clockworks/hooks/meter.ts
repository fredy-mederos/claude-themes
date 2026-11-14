import type { Mood } from '../types'

// The token meter: how fast the model is writing, the main loop and every
// subagent together, from the pieces of each reply as they stream in. Only
// what the model writes counts (text, thinking, a tool call's arguments):
// every request sends the whole conversation again as input, so input
// counts measure how long the chat is, not how busy Claude is.
//
// The stream hook only adds up characters; the meter's tick, once a second
// while a turn runs, turns them into tokens over time. A reply's last piece
// carries its true count, and the difference from the estimate is spread
// over the reply's time, so thinking the stream doesn't show still counts.

// Seconds of writing the rate is averaged over.
export const WINDOW = 8

// Characters per token, near enough for prose and code.
const CHARS = 3.5

// Tokens a second: below QUIET, with nothing streaming, the turn is waiting;
// at STORM_IN the gears go to a storm, and stay in one until under STORM_OUT.
// One model writing at its usual pace stays under STORM_IN; two or more
// subagents at once, or a fast model writing a big file, go over it.
export const QUIET = 2
export const STORM_IN = 100
export const STORM_OUT = 60

// Tokens written, spread evenly from second `a` to second `b`.
type Span = { a: number; b: number; n: number }

export type Reading = { rate: number; streaming: number }

export type Step = {
  // Characters of the reply that just streamed in.
  add: (chars: number) => void
  // The reply is whole: its true count of output tokens.
  stop: (tokens: number) => void
  // The request is over, whatever happened to it.
  end: () => void
}

export type Meter = {
  step: () => Step
  // Starts the meter's time at `now`, in seconds, forgetting what it saw.
  reset: (now: number) => void
  tick: (now: number) => Reading
}

export const meter = (): Meter => {
  let spans: Span[] = []
  // Tokens estimated since the last tick.
  let fresh = 0
  // The last tick, in seconds.
  let last = 0
  // Model requests streaming now.
  let streaming = 0

  return {
    step: () => {
      streaming += 1
      const from = last
      let guessed = 0
      let open = true

      return {
        add: chars => {
          const n = chars / CHARS
          guessed += n
          fresh += n
        },
        stop: tokens => {
          spans.push({ a: from, b: last, n: tokens - guessed })
          guessed = tokens
        },
        end: () => {
          if (open) {
            open = false
            streaming -= 1
          }
        },
      }
    },
    reset: now => {
      spans = []
      fresh = 0
      last = now
    },
    tick: now => {
      spans.push({ a: last, b: now, n: fresh })
      fresh = 0
      last = now
      const from = now - WINDOW
      spans = spans.filter(s => s.b > from)
      let sum = 0
      for (const s of spans) {
        if (s.b <= s.a) {
          sum += s.a > from && s.a <= now ? s.n : 0
          continue
        }
        const lo = Math.max(s.a, from)
        const hi = Math.min(s.b, now)
        if (hi > lo) {
          sum += (s.n * (hi - lo)) / (s.b - s.a)
        }
      }

      return { rate: Math.max(0, sum / WINDOW), streaming }
    },
  }
}

// The level a running turn's gears should be at, from the meter's reading and
// the level it is at now (a storm has its own, lower way out).
export const levelFor = (was: Mood, { rate, streaming }: Reading): Mood => {
  if (rate >= (was === 'storm' ? STORM_OUT : STORM_IN)) {
    return 'storm'
  }

  return streaming > 0 || rate >= QUIET ? 'busy' : 'wait'
}

// How busy each level is, to tell a step down from a step up.
export const RANK: Record<Mood, number> = { idle: 0, wait: 1, busy: 2, storm: 3 }
