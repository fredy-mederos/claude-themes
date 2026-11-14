import { expect, test } from 'claude-code/testing'

const BACKDROP = {
  plugin: 'matrix-rain',
  surface: 'desktop',
  component: 'Backdrop',
  requestId: 'backdrop',
  props: { scene: 'matrix-rain', plugin: 'matrix-rain', glass: false },
} as any

test('the backdrop is one slow Svg while idle', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  const ui = await $.ui.mount(BACKDROP)
  const svg = (await ui.find({ type: 'Svg' })) as any
  expect(svg).toBeDefined()
  expect(svg.props.alt).toMatch(/slowly/)
  // Muted: the green light behind the rain is off.
  expect(svg.props.source).toMatch(/fill="url\(#glow\)" opacity="0"/)
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
  // The light comes up as the turn starts.
  expect(svg.props.source).toMatch(/fill="url\(#glow\)" opacity="1"><animate attributeName="opacity" from="0" to="1"/)
  expect(svg.props.source).toMatch(/#26e7ff/)
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
