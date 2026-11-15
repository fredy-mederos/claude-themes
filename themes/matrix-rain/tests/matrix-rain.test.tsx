import type { On, ThemeSetArgs } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Mood } from '../types'
import { levelFor, meter } from '../hooks/meter'

const BACKDROP = {
  plugin: 'matrix-rain',
  surface: 'desktop',
  component: 'Backdrop',
  requestId: 'backdrop',
  props: { scene: 'matrix-rain', plugin: 'matrix-rain', glass: false },
} as any

// How long each stream head's scramble takes to cycle, in seconds.
const headCycles = (source: string) =>
  [...source.matchAll(/<g id="h\d+"><text>[^<]*<animate [^>]*dur="([\d.]+)s"/g)].map(m => Number(m[1]))

test('the backdrop is one slow Svg while idle', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  const ui = await $.ui.mount(BACKDROP)
  const svg = (await ui.find({ type: 'Svg' })) as any
  expect(svg).toBeDefined()
  expect(svg.props.alt).toMatch(/slowly/)
  // Muted: the green light behind the rain is off.
  expect(svg.props.source).toMatch(/fill="url\(#glow\)" opacity="0"/)
  // The rain is grey while idle, through the shared paint every stream uses.
  expect(svg.props.source).toMatch(/<linearGradient id="rain" [^>]*><stop offset="0" stop-color="#93a89a"/)
  expect(svg.props.source).toMatch(/fill="url\(#rain\)"/)
  // The letters change at the rain's idle pace: heads cycle in seconds.
  expect(headCycles(svg.props.source).length).toBe(14)
  expect(Math.min(...headCycles(svg.props.source))).toBeGreaterThan(3.5)
  expect(svg.props.source).not.toMatch(/viewBox|vw|vh|calc\(|@media|@keyframes|<marker/)
  expect(svg.props.source.length).toBeLessThan(131072)
  await ui.unmount()
})

// The rain's own streams in the drawing (a tool call's are painted in its colour).
const streams = (source: string) => source.match(/fill="url\(#rain\)"/g)?.length ?? 0

// The engine's side of a session the theme runs in, on a clock the test
// moves, with a model whose every request writes `reply.chars` of text and
// then says it wrote `reply.tokens`.
const session = async ($: Engine, on: On, store: Record<string, unknown> = {}) => {
  const clock = mock.clock(on, { now: 2_000_000 })
  mock.store(on, store)
  // Every look the theme sets, in order.
  const sets: ThemeSetArgs[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }) as any)
  on('tool.call', () => ({ result: 'ok' }) as any)
  on('command.register', () => ({ value: { command: 'matrix' } }))
  on('theme.set', (_, e) => {
    sets.push(e)

    return { value: { isDrawn: true, requestId: 'theme' } }
  })
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
  // The window shows the idle rain first, so the turn is a change it sees.
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
  const command = (args: string) => $.command.run({ command: 'matrix', args } as any)

  return { clock, ui, svg, write, command, sets }
}

test('a turn makes it pour, and a tool call drops streams in its colour', async ($, on) => {
  const { clock, ui, svg, write } = await session($, on)
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  await write(700, 200)
  // Past the gap since the turn's own redraw, so the call draws at once.
  await clock.advance(5000)
  await $.tool.call({ tool: 'Read', tool_use_id: 'u1', input: { file_path: '/x' } } as any)

  const { alt, source } = await svg()
  expect(alt).toMatch(/fast/)
  // The rain turns green as the turn starts.
  expect(source).toMatch(/attributeName="stop-color" from="#93a89a" to="#19ff6a"/)
  // The light comes up as the turn starts.
  expect(source).toMatch(/fill="url\(#glow\)" opacity="1"><animate attributeName="opacity" from="0" to="1"/)
  expect(source).toMatch(/#26e7ff/)
  // Working, the heads scramble fast again.
  expect(headCycles(source).length).toBe(14)
  expect(Math.max(...headCycles(source))).toBeLessThan(0.7)
  // The letters that change: shared cells, placed down the streams.
  expect(source).toMatch(/<use href="#f\d+"/)
  expect(source).toMatch(/<use href="#h\d+"/)
  expect(source.length).toBeLessThan(131072)
  await ui.unmount()
})

test('with the storm on, the rain follows the tokens the model writes', async ($, on) => {
  const { clock, ui, svg, write, command } = await session($, on)
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  // Working: the second tier of streams joins the first.
  expect((await svg()).alt).toMatch(/fast/)
  expect(streams((await svg()).source)).toBe(82)

  // 1,200 tokens in a second, as several subagents at once write: a storm,
  // drawn as soon as the gap since the last redraw allows.
  await write(4200, 1200)
  await clock.advance(1000)
  await clock.advance(3000)
  const storm = await svg()
  expect(storm.alt).toMatch(/storm/)
  expect(streams(storm.source)).toBe(106)
  // Faster than working: the heads scramble faster too.
  expect(Math.max(...headCycles(storm.source))).toBeLessThan(0.56)
  expect(storm.source.length).toBeLessThan(131072)

  // A long command, nothing written: the storm thins out to a light rain, the
  // extra streams finishing their fall rather than vanishing.
  await clock.advance(10_000)
  const thinning = await svg()
  expect(thinning.alt).toMatch(/steadily/)
  expect(streams(thinning.source)).toBeGreaterThan(50)
  // Once they have fallen, the next redraw (a tool call's) leaves them out.
  await clock.advance(30_000)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'u1', input: { command: 'make' } } as any)
  const light = await svg()
  expect(streams(light.source)).toBe(50)
  // Still green, with the light half up: a turn is running.
  expect(light.source).toMatch(/<linearGradient id="rain" [^>]*><stop offset="0" stop-color="#19ff6a"/)
  expect(light.source).toMatch(/fill="url\(#glow\)" opacity="0.5"/)

  // The model writes again, at one model's usual pace: back to working.
  await write(700, 200)
  await clock.advance(1000)
  await clock.advance(3000)
  expect((await svg()).alt).toMatch(/fast/)

  // Turned off mid-turn, the rain stays working whatever is written.
  await command('storm off')
  await write(4200, 1200)
  await clock.advance(5000)
  expect((await svg()).alt).toMatch(/fast/)

  await $.turn.complete({ turnId: 't1', reason: 'answer' } as any)
  expect((await svg()).alt).toMatch(/slowly/)
  await ui.unmount()
})

test('with the storm off, a turn falls at one pace', async ($, on) => {
  const { clock, ui, svg, write } = await session($, on, { nostorm: true })
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  await write(4200, 1200)
  await clock.advance(5000)
  expect((await svg()).alt).toMatch(/fast/)
  expect(streams((await svg()).source)).toBe(82)
  // Nothing written for a long while: still working.
  await clock.advance(30_000)
  expect((await svg()).alt).toMatch(/fast/)
  await ui.unmount()
})

test('/matrix storm turns it off and on, mid-turn too', async ($, on) => {
  const { clock, ui, svg, write, command } = await session($, on)
  expect((await command('storm off')).text).toMatch(/storm is off/)
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  await write(4200, 1200)
  await clock.advance(5000)
  expect((await svg()).alt).toMatch(/fast/)
  expect((await command('storm on')).text).toMatch(/storm is on/)
  await write(4200, 1200)
  await clock.advance(1000)
  expect((await svg()).alt).toMatch(/storm/)
  await ui.unmount()
})

test('one model writing stays working; two at once make a storm', () => {
  const m = meter()
  m.reset(0)
  let level: Mood = 'busy'
  // About 70 tokens a second, a reply a second, for ten seconds.
  for (let t = 1; t <= 10; t++) {
    const step = m.step()
    step.add(245)
    step.stop(70)
    step.end()
    level = levelFor(level, m.tick(t))
  }
  expect(level).toBe('busy')
  // Two at once.
  for (let t = 11; t <= 20; t++) {
    for (const _ of [0, 1]) {
      const step = m.step()
      step.add(245)
      step.stop(70)
      step.end()
    }
    level = levelFor(level, m.tick(t))
  }
  expect(level).toBe('storm')
  // A reply whose thinking the stream never showed still counts, spread over
  // the time it took: 600 tokens over the next six seconds is no storm.
  m.reset(30)
  const quiet = m.step()
  for (let t = 31; t <= 36; t++) {
    m.tick(t)
  }
  quiet.stop(600)
  quiet.end()
  expect(levelFor('busy', m.tick(37)).valueOf()).toBe('busy')
  // Nothing streaming and nothing written for a while: waiting.
  expect(levelFor('busy', m.tick(50))).toBe('wait')
})

test('asked again with nothing changed, as on a resize, the drawing is the same', async ($, on) => {
  const { clock, ui, svg } = await session($, on)
  const first = (await svg()).source
  // The app asks again (a window of another size): the same drawing, though
  // the clock has moved on, so the app has no new image to swap in.
  await ui.unmount()
  await clock.advance(5000)
  const again = await $.ui.mount(BACKDROP)
  expect(((await again.find({ type: 'Svg' })) as any).props.source).toBe(first)
  await again.unmount()
  // Every 20 seconds it is drawn anew all the same, the rain carrying on from
  // where it was: a backdrop the app dropped comes back on its own.
  await clock.advance(16_000)
  const healed = await $.ui.mount(BACKDROP)
  const fresh = ((await healed.find({ type: 'Svg' })) as any).props.source
  expect(fresh).not.toBe(first)
  expect(streams(fresh)).toBe(50)
  await healed.unmount()
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
  expect(played.length).toBe(1)
})

// The backdrop as the app asks for it once the theme was set light.
const LIGHT_BACKDROP = { ...BACKDROP, props: { ...BACKDROP.props, overrideColorScheme: 'light' } }

const drawLight = async ($: Engine) => {
  const ui = await $.ui.mount(LIGHT_BACKDROP)
  const props = ((await ui.find({ type: 'Svg' })) as any).props as { alt: string; source: string }
  await ui.unmount()

  return props
}

test('dark by default, with colours for both of the app\'s modes', async ($, on) => {
  const { ui, svg, sets } = await session($, on)
  const look = sets.at(-1)
  expect(look?.overrideColorScheme).toBe('dark')
  expect(Object.keys(look?.colors?.inputs ?? {}).sort()).toEqual(['dark', 'light'])
  expect(look?.colors?.codeTheme).toEqual({ light: 'vitesse-light', dark: 'vitesse-black' })
  // The panel takes the app's own colour, so it suits whichever mode the app paints.
  expect(look?.backdrop).toEqual({ scene: 'matrix-rain', glass: { blur: 14, opacity: 0.84 } })
  const { alt, source } = await svg()
  expect(alt).toMatch(/black screen/)
  expect(source).toMatch(/<rect width="100%" height="100%" fill="#010603"\/>/)
  await ui.unmount()
})

test('/matrix light makes it pale paper, and /matrix dark brings back the black', async ($, on) => {
  const { ui, command, sets } = await session($, on)
  expect((await command('light')).text).toMatch(/light.*pale paper.*set it to Light/)
  expect(sets.at(-1)?.overrideColorScheme).toBe('light')
  await ui.unmount()
  const { alt, source } = await drawLight($)
  expect(alt).toMatch(/slowly down a pale screen/)
  // Pale paper, and muted grey-green rain while idle.
  expect(source).toMatch(/<rect width="100%" height="100%" fill="#e6f0e8"\/>/)
  expect(source).toMatch(/<linearGradient id="rain" [^>]*><stop offset="0" stop-color="#62776a"/)
  expect(source).not.toMatch(/#010603|#93a89a/)
  expect(source).not.toMatch(/viewBox|vw|vh|calc\(|@media|@keyframes|<marker/)

  expect((await command('dark')).text).toMatch(/dark.*set it to Dark/)
  expect(sets.at(-1)?.overrideColorScheme).toBe('dark')
})

test('a session started light is light, and its turns pour deep green with tools in paper colours', async ($, on) => {
  const { clock, ui, write, sets } = await session($, on, { light: true })
  expect(sets[0]?.overrideColorScheme).toBe('light')
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  await write(700, 200)
  await clock.advance(5000)
  await $.tool.call({ tool: 'Read', tool_use_id: 'u1', input: { file_path: '/x' } } as any)
  await ui.unmount()
  const { alt, source } = await drawLight($)
  expect(alt).toMatch(/fast down a pale screen/)
  expect(source).toMatch(/attributeName="stop-color" from="#62776a" to="#0b8a3f"/)
  // A read is cyan, deep enough to read on paper.
  expect(source).toMatch(/#0086a3/)
  expect(source).not.toMatch(/#26e7ff/)
  expect(source.length).toBeLessThan(131072)
})

test('a look chosen while the theme is off shows once it is on', async ($, on) => {
  const { ui, command, sets } = await session($, on, { off: true })
  expect(sets.length).toBe(0)
  expect((await command('light')).text).toMatch(/once you turn it on/)
  expect(sets.length).toBe(0)
  await command('on')
  expect(sets.at(-1)?.overrideColorScheme).toBe('light')
  await ui.unmount()
})
