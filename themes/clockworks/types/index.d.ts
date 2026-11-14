// idle: no turn running, the gears stand still and muted. busy: a turn is
// running, the gears turn. With the storm on (`/clockworks storm`), a running
// turn follows the tokens the model writes: wait while it writes almost none
// (a long command, a job), busy while it works, storm while it writes a lot
// (several subagents).
export type Mood = 'idle' | 'wait' | 'busy' | 'storm'

// What the backdrop draws. Where each gear is comes from the drawing's own
// clock (hooks/register.tsx), not from here.
export type Stage = { mood: Mood }

declare module 'claude-code' {
  interface PluginState {
    clockworks: {
      stage: Shaped<Stage>
    }
  }
}
