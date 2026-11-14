import { expect, test } from 'claude-code/testing'

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

test('a turn makes it pour, and a tool call drops streams in its colour', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: 'ok' }) as any)
  let ms = 2_000_000
  on('clock.now', () => ({ value: ms }))
  on('clock.after', () => ({ value: { cancel: () => undefined } }))
  on('store.get', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'matrix' } }))
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'theme' } }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as any)
  // The window shows the idle rain first, so the turn is a change it sees.
  const ui = await $.ui.mount(BACKDROP)
  await ui.find({ type: 'Svg' })
  await $.turn.start({ text: 'hi', turnId: 't1' } as any)
  // Past the gap since the turn's own redraw, so the call draws at once.
  ms += 5000
  await $.tool.call({ tool: 'Read', tool_use_id: 'u1', input: { file_path: '/x' } } as any)

  const svg = (await ui.find({ type: 'Svg' })) as any
  expect(svg.props.alt).toMatch(/fast/)
  // The rain turns green as the turn starts.
  expect(svg.props.source).toMatch(/attributeName="stop-color" from="#93a89a" to="#19ff6a"/)
  // The light comes up as the turn starts.
  expect(svg.props.source).toMatch(/fill="url\(#glow\)" opacity="1"><animate attributeName="opacity" from="0" to="1"/)
  expect(svg.props.source).toMatch(/#26e7ff/)
  // Working, the heads scramble fast again.
  expect(headCycles(svg.props.source).length).toBe(14)
  expect(Math.max(...headCycles(svg.props.source))).toBeLessThan(0.7)
  // The letters that change: shared cells, placed down the streams.
  expect(svg.props.source).toMatch(/<use href="#f\d+"/)
  expect(svg.props.source).toMatch(/<use href="#h\d+"/)
  expect(svg.props.source.length).toBeLessThan(131072)
  await ui.unmount()
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
