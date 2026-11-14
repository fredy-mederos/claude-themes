import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { clashes, TAU } from '../hooks/gears'
import { GEARS, LAYOUT, scene, shift, speedAt, start, turning, virtual } from '../hooks/scene'

const BACKDROP = {
  plugin: 'clockworks',
  surface: 'desktop',
  component: 'Backdrop',
  requestId: 'backdrop',
  props: { scene: 'clockworks', plugin: 'clockworks', glass: false },
} as any

// Seconds per turn of each gear turning steadily.
const periods = (source: string) =>
  [...source.matchAll(/type="rotate" from="[-\d.]+" to="[-\d.]+" dur="([\d.]+)s" begin="[\d.]+s" repeatCount="indefinite"/g)].map(m => Number(m[1]))

// A change of speed in progress: one eased turn that holds where it ends.
const easing = (source: string) => source.match(/fill="freeze" calcMode="spline"/g)?.length ?? 0

// `a` within `tol` of `b`.
const near = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol)

// The angle each gear starts at, in train order.
const angles = (source: string) => [...source.matchAll(/<g transform="rotate\(([-\d.]+)\)">/g)].map(m => Number(m[1]))

test('idle, the gears stand still and muted', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  const ui = await $.ui.mount(BACKDROP)
  const svg = (await ui.find({ type: 'Svg' })) as any
  expect(svg).toBeDefined()
  expect(svg.props.alt).toMatch(/standing still/)
  const source: string = svg.props.source
  expect(angles(source).length).toBe(GEARS.length)
  expect(source).not.toMatch(/animateTransform/)
  expect(source).toMatch(/<g opacity="0.26">/)
  // The form the desktop app lets move: no viewBox, no CSS, no filters.
  expect(source).not.toMatch(/viewBox|vw|vh|calc\(|@media|@keyframes|<style|<filter|<mask|<marker|<script/)
  expect(source.length).toBeLessThan(131072)
  await ui.unmount()
})

// The engine's side of a session the theme runs in, on a clock the test
// moves, with a model whose every request writes `reply.chars` of text and
// then says it wrote `reply.tokens`.
const session = async ($: Engine, on: On, store: Record<string, unknown> = {}) => {
  const clock = mock.clock(on, { now: 2_000_000 })
  mock.store(on, store)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }) as any)
  on('command.register', () => ({ value: { command: 'clockworks' } }))
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'theme' } }))
  on('theme.clear', () => ({ value: { isDrawn: false, reason: 'cleared' } }) as any)
  on('audio.play', () => ({ value: undefined }) as any)
  const reply = { chars: 0, tokens: 0 }
  on('turn.step', async function* (_, e) {
    const usage = {
      input_tokens: 40_000,
      output_tokens: reply.tokens,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      model: 'test',
    }
    yield { kind: 'text', index: 0, text: 'x'.repeat(reply.chars) } as any
    yield { kind: 'stop', stopReason: 'end_turn', usage } as any

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage } as any
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
  // The window shows the idle gears first, so the turn is a change it sees.
  const ui = await $.ui.mount(BACKDROP)
  const svg = async () => ((await ui.find({ type: 'Svg' })) as any).props as { alt: string; source: string }
  await svg()
  // One model request that writes `chars` characters, `tokens` tokens.
  const write = async (chars: number, tokens: number) => {
    reply.chars = chars
    reply.tokens = tokens
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'test', messageCount: 1 } as any)) {
      // Read to the end.
    }
  }
  const command = (args: string) => $.command.run({ command: 'clockworks', args } as any)

  return { clock, ui, svg, write, command }
}

test('a turn spins the gears up and brings them to full strength', async ($, on) => {
  const { ui, svg } = await session($, on)
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  const { alt, source } = await svg()
  expect(alt).toMatch(/turning on/)
  // Every gear spins up, then turns on: the driver once in 40 s.
  expect(easing(source)).toBe(GEARS.length)
  expect(periods(source).length).toBe(GEARS.length)
  expect(Math.max(...periods(source))).toBe(40)
  // The pinions turn as much faster as the driver has teeth over theirs.
  near(Math.min(...periods(source)), (40 * 14) / 72, 0.01)
  expect(source).toMatch(/<g opacity="0.9"><animate attributeName="opacity" from="0.26" to="0.9"/)
  expect(source.length).toBeLessThan(131072)
  await ui.unmount()
})

test('with the storm on, the gears follow the tokens the model writes', async ($, on) => {
  const { clock, ui, svg, write, command } = await session($, on)
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  expect(Math.max(...periods((await svg()).source))).toBe(40)

  // 1,200 tokens in a second, as several subagents at once write: a storm,
  // drawn as soon as the gap since the last redraw allows.
  await write(4200, 1200)
  await clock.advance(1000)
  await clock.advance(3000)
  const storm = await svg()
  expect(storm.alt).toMatch(/turning fast/)
  expect(Math.max(...periods(storm.source))).toBe(25)
  expect(storm.source).toMatch(/<g opacity="1">/)

  // A long command, nothing written: the gears slow to a creep.
  await clock.advance(10_000)
  const creeping = await svg()
  expect(creeping.alt).toMatch(/creeping/)
  expect(Math.max(...periods(creeping.source))).toBe(160)
  expect(easing(creeping.source)).toBe(GEARS.length)

  // The model writes again, at one model's usual pace: back to working.
  await write(700, 200)
  await clock.advance(1000)
  await clock.advance(3000)
  expect(Math.max(...periods((await svg()).source))).toBe(40)

  // Turned off mid-turn, the gears stay at working speed whatever is written.
  await command('storm off')
  await write(4200, 1200)
  await clock.advance(5000)
  expect((await svg()).alt).toMatch(/turning on/)

  await $.turn.complete({ turnId: 't1', reason: 'answer' } as any)
  expect((await svg()).alt).toMatch(/standing still/)
  await ui.unmount()
})

test('when a reply ends the gears coast to a stop and fade back', async ($, on) => {
  const { clock, ui, svg } = await session($, on, { nostorm: true })
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  await clock.advance(10_000)
  await $.turn.complete({ turnId: 't1', reason: 'answer' } as any)
  const { source } = await svg()
  // No steady turning: each gear eases to a stop and holds there.
  expect(periods(source).length).toBe(0)
  expect(easing(source)).toBe(GEARS.length)
  expect(source).toMatch(/<g opacity="0.26"><animate attributeName="opacity" from="0.9" to="0.26"/)
  await ui.unmount()
})

test('with the storm off, a turn keeps one speed', async ($, on) => {
  const { clock, ui, svg, write } = await session($, on, { nostorm: true })
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  await write(4200, 1200)
  await clock.advance(5000)
  expect((await svg()).alt).toMatch(/turning on/)
  // Nothing written for a long while: still working.
  await clock.advance(30_000)
  expect((await svg()).alt).toMatch(/turning on/)
  await ui.unmount()
})

test('/clockworks storm turns it off and on, mid-turn too', async ($, on) => {
  const { clock, ui, svg, write, command } = await session($, on)
  expect((await command('storm off')).text).toMatch(/storm is off/)
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  await write(4200, 1200)
  await clock.advance(5000)
  expect((await svg()).alt).toMatch(/turning on/)
  expect((await command('storm on')).text).toMatch(/storm is on/)
  await write(4200, 1200)
  await clock.advance(1000)
  expect((await svg()).alt).toMatch(/turning fast/)
  await ui.unmount()
})

test('/clockworks off clears the look, on brings it back', async ($, on) => {
  const { ui, command } = await session($, on)
  expect((await command('off')).text).toMatch(/Clockworks off/)
  expect((await command('on')).text).toMatch(/Clockworks on/)
  expect((await command('sound off')).text).toMatch(/chime is off/)
  await ui.unmount()
})

test('asked again with nothing changed, as on a resize, the drawing is the same', async ($, on) => {
  // The storm off, so the turn stays at one level while nothing is written.
  const { clock, ui, svg } = await session($, on, { nostorm: true })
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  const first = (await svg()).source
  // The app asks again (a window of another size): the same drawing, though
  // the clock has moved on, so the app has no new image to swap in.
  await ui.unmount()
  await clock.advance(5000)
  const again = await $.ui.mount(BACKDROP)
  expect(((await again.find({ type: 'Svg' })) as any).props.source).toBe(first)
  await again.unmount()
  // Every 20 seconds it is drawn anew all the same, each gear carrying on
  // from where it had turned to: a backdrop the app dropped comes back.
  await clock.advance(16_000)
  const healed = await $.ui.mount(BACKDROP)
  const fresh = ((await healed.find({ type: 'Svg' })) as any).props.source
  expect(fresh).not.toBe(first)
  expect(easing(fresh)).toBe(0)
  expect(periods(fresh).length).toBe(GEARS.length)
  // The driver has turned 9° for every working second since the turn began,
  // less the 0.6 s spinning up took: 21 s in, 9 x 20.4.
  near(angles(fresh)[0] ?? Number.NaN, 9 * 20.4, 0.1)
  await healed.unmount()
})

test('the turning clock eases between speeds and never jumps', () => {
  const idle = start('idle', 100)
  const busy = shift(idle, 'busy', 100)
  // Spinning up over 1.2 s covers 0.6 working seconds, at half speed midway.
  near(speedAt(busy, 100.6), 0.5, 1e-06)
  near(virtual(busy, 101.2), 0.6, 1e-06)
  near(virtual(busy, 110), 9.4, 1e-06)
  // Coasting down over 2.4 s covers 1.2 more, then it stands still.
  const stop = shift(busy, 'idle', 110)
  near(virtual(stop, 112.4), 10.6, 1e-06)
  near(virtual(stop, 200), 10.6, 1e-06)
  // Drawn mid-way, every gear's eased turn ends where a drawing made then
  // would start it.
  for (const g of GEARS) {
    const { anim } = turning(g, stop, 111)
    const to = Number(/ to="([-\d.]+)"/.exec(anim)?.[1])
    const later = turning(g, stop, 112.4).at
    near((((to - later) % 360) + 540) % 360, 180, 0.1)
  }
  // A storm mid-spin-up starts from the speed it had reached.
  const storm = shift(busy, 'storm', 100.6)
  near(storm.s0, 0.5, 1e-06)
  expect(storm.s1).toBe(1.6)
})

test('the train meshes: every tooth in a gap, and no two wheels collide', () => {
  expect(clashes(GEARS)).toEqual([])
  const p = LAYOUT.pitch
  const mod = (x: number, m: number) => ((x % m) + m) % m
  for (const b of GEARS) {
    if (b.from === undefined) {
      continue
    }
    const a = GEARS[b.from]!
    near(Math.hypot(b.x - a.x, b.y - a.y), a.r + b.r, 1e-06)
    expect(b.dir).toBe(-a.dir as 1 | -1)
    // Along the line of centres, arc from each gear's nearest tooth: a tooth
    // of one faces a gap of the other, half a pitch apart.
    const th = Math.atan2(b.y - a.y, b.x - a.x)
    const sa = mod(th - a.phase, TAU / a.N) * a.r
    const sb = mod(th + Math.PI - b.phase, TAU / b.N) * b.r
    near(mod(sa + sb, p), p / 2, 1e-06)
  }
  // Drawn whole, the scene stays well inside the app's limit.
  expect(scene(shift(start('idle', 0), 'storm', 0), 0.5).length).toBeLessThan(80_000)
})

test('a finished reply plays the chime, a stopped one does not', async ($, on) => {
  const played: string[] = []
  on('clock.now', () => ({ value: 3_000_000 }))
  on('store.get', () => ({ value: undefined }))
  on('audio.play', (_, e: any) => {
    played.push(e.asset ?? e.clip?.asset)

    return { value: undefined } as any
  })
  on('turn.complete', () => ({ text: '' }) as any)
  await $.turn.complete({ turnId: 't1', reason: 'aborted' } as any)
  expect(played.length).toBe(0)
  await $.turn.complete({ turnId: 't2', reason: 'answer' } as any)
  expect(played).toEqual(['sounds/turn-end.wav'])
})
