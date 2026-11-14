// idle: no turn running, the rain barely drifts. busy: a turn is running.
export type Mood = 'idle' | 'busy'

// One tool call's worth of coloured streams, waiting for the next redraw.
export type Seed = { seed: number; color: string; size: number }

// The same once taken into the backdrop: `at` is when, in seconds. The
// drawing times each burst from when it is first drawn, not from this.
export type Burst = Seed & { at: number }

// What the backdrop draws. Where each stream is comes from the drawing's own
// clock (hooks/register.tsx), not from here.
export type Stage = { mood: Mood; bursts: Burst[] }

// Tool calls since the last redraw.
export type Live = { queue: Seed[] }

declare module 'claude-code' {
  interface PluginState {
    'matrix-rain': {
      live: Shaped<Live>
      stage: Shaped<Stage>
    }
  }
}
