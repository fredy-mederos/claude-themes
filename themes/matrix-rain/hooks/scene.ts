import type { Burst, Mood, Scheme } from '../types'

// Code rain, in the form the desktop app lets move (see the claude-themes
// skill): no root viewBox, each stream hung from a 1x1 nested <svg> at a
// percentage of the window's width, all motion SMIL, a <style> of plain paint
// only (no calc, var, @keyframes or @media), no filters or masks.
//
// Every redraw reloads the frame, so the streams are seeded (the same columns,
// glyphs and speeds every time) and each one's `begin` comes from the
// window's own rain clock (`View`, kept by register.tsx): a redraw picks every
// stream up where it was.

// How much slower than busy each level falls. Idle, a stream takes from
// about forty seconds to over two minutes to cross a laptop-sized window;
// waiting, a turn that writes nothing (a long command, a job) falls a fifth
// as fast as working, about three times as fast as idle; a storm, a quarter
// faster than working.
export const K: Record<Mood, number> = { idle: 14, wait: 5, busy: 1, storm: 0.8 }

// Streams fall to this far below the top. A window shorter than this just
// gets a longer pause before the stream comes round again.
const TRAVEL = 1800

// How long a tool call's burst is kept: two passes of at most 6 s, and slack.
export const BURST_LIFE = 20

// A tier of streams past the first, as the window shows it. `on`: the rain
// clock when it was last turned on (-Infinity: on from the start, every
// column falling). `offs`: each time it was turned off while its streams may
// still be finishing their fall: the wall second, the rain clock, the pace
// it was falling at and its `on` then.
export type Off = { t: number; v: number; k: number; on: number }
export type Tier = { on?: number; offs: Off[] }

// The rain clock as the window shows it: since wall second `tR` the rain has
// fallen at `mood`'s speed, and at `tR` the clock read `vR` (busy seconds).
// `from` is the mood before (the same when the window has seen no change).
export type View = { mood: Mood; from: Mood; tR: number; vR: number; tiers: Tier[] }

export const virtual = (v: View, now: number) => v.vR + (now - v.tR) / K[v.mood]

const GLYPHS = Array.from('ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789Z:.=*+-¦')

// Three depths: far streams small, dim and slow; near ones big and bright.
const LAYERS = [
  { cls: 'a', cell: 14, alpha: 0.3, pace: 1.35 },
  { cls: 'b', cell: 18, alpha: 0.55, pace: 1 },
  { cls: 'c', cell: 22, alpha: 0.85, pace: 0.8 },
] as const

type Layer = 0 | 1 | 2

// A tool call's colour, by the kind of work, as it falls on black. A burst
// keeps this colour; the light look paints it in its own (`PAPER`).
export const TOOL = {
  read: '#26e7ff', // cyan
  edit: '#ff3df2', // magenta
  shell: '#ffb21e', // amber
  web: '#a77bff', // violet
  agent: '#ffe45c', // gold
  mcp: '#4f8cff', // blue
  other: '#effff4', // white
  failed: '#ff3346', // red
} as const

// mulberry32: small, seedable, the same numbers on every redraw.
const rng = (seed: number) => {
  let a = seed >>> 0

  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rand = () => number

const pick = (r: Rand) => GLYPHS[Math.floor(r() * GLYPHS.length)] ?? '0'

const word = (r: Rand, n: number) => Array.from({ length: n }, () => pick(r))

// ── Changing letters ────────────────────────────────────────────────────
// A flicker cell is a few glyphs stacked in one spot, shown one at a time by
// discrete SMIL on `visibility`. Cells are drawn once in <defs> and placed
// down the streams with <use>: a letter that keeps changing costs a stream
// one short tag. While Claude works, trail cells change every ~0.3-1.2 s and
// head cells scramble; idle, they change K times slower, as the rain falls.
const FLICKS = 28
const HEADS = 14

const cell = (id: string, glyphs: string[], step: number) => {
  const n = glyphs.length
  const dur = (step * n).toFixed(2)
  const parts = glyphs.map((g, i) => {
    const values = glyphs.map((_, j) => (j === i ? 'visible' : 'hidden')).join(';')
    const start = i === 0 ? '' : ' visibility="hidden"'

    return `<text${start}>${g}<animate attributeName="visibility" values="${values}" calcMode="discrete" dur="${dur}s" repeatCount="indefinite"/></text>`
  })

  return `<g id="${id}">${parts.join('')}</g>`
}

// The same glyphs for both moods (one seed); only the pace differs.
const cells = (k: number) => {
  const r = rng(77)
  const trail = Array.from({ length: FLICKS }, (_, i) => cell(`f${i}`, word(r, 3), (0.3 + r() * 0.9) * k))
  const heads = Array.from({ length: HEADS }, (_, i) => cell(`h${i}`, word(r, 4), (0.07 + r() * 0.08) * k))

  return `<g text-anchor="middle">${trail.join('')}${heads.join('')}</g>`
}

const CELLS: Record<Mood, string> = { idle: cells(K.idle), wait: cells(K.wait), busy: cells(K.busy), storm: cells(K.storm) }

// ── Streams ─────────────────────────────────────────────────────────────
type Shape = {
  x: number
  layer: Layer
  glyphs: string[] // the trail, top to bottom; the head is a flicker cell below it
  flicks: Map<number, number> // trail index -> trail cell that changes there
  head: number // head cell
}

type Column = Shape & { period: number; offset: number }

const shape = (r: Rand, x: number, layer: Layer, length: number): Shape => {
  const glyphs = word(r, length)
  const flicks = new Map<number, number>()
  // A few letters that keep changing, mostly in the bright lower half.
  const count = 2 + Math.floor(r() * 3)
  for (let i = 0; i < count; i++) {
    const at = Math.floor(length * (0.35 + r() * 0.65))
    flicks.set(Math.min(at, length - 1), Math.floor(r() * FLICKS))
  }

  return { x, layer, glyphs, flicks, head: Math.floor(r() * HEADS) }
}

const layerOf = (r: Rand): Layer => {
  const d = r()

  return d < 0.45 ? 0 : d < 0.8 ? 1 : 2
}

// `count` streams spread evenly across the width, each jittered in its slot.
const columns = (seed: number, count: number): Column[] => {
  const r = rng(seed)

  return Array.from({ length: count }, (_, i) => {
    const x = ((i + 0.1 + r() * 0.8) / count) * 100
    const layer = layerOf(r)
    const period = 7 + r() * 8
    const offset = r() * 40

    return { ...shape(r, x, layer, 7 + Math.floor(r() * 16)), period, offset }
  })
}

// Tiers of streams: the first always falls, a turn that is working adds the
// second, a storm the third. The third is kept small: a storm is a busier
// rain, not a flood, and the whole scene must stay under the app's limit.
const TIER3 = 24
const TIERS = [columns(1999, 50), columns(2003, 32), columns(2011, TIER3)]

// How many tiers fall at each level.
const ON: Record<Mood, number> = { idle: 1, wait: 1, busy: 2, storm: 3 }

// The first view a window draws: the tiers of its level all falling.
export const start = (mood: Mood, now: number): View => ({
  mood,
  from: mood,
  tR: now,
  vR: now / K[mood],
  tiers: TIERS.map((_, i) => (i < ON[mood] ? { on: -Infinity, offs: [] } : { offs: [] })),
})

// The view once the level changes at `now`: the rain clock carries on where
// it was, at the new speed; a tier turned on joins from the top, one turned
// off finishes the pass it was on.
export const shift = (was: View, mood: Mood, now: number): View => {
  const v = virtual(was, now)
  const tiers = was.tiers.map((t, i): Tier => {
    const before = i < ON[was.mood]
    const after = i < ON[mood]
    const offs = t.offs.filter(o => now <= o.t + LONGEST * o.k)
    if (before === after) {
      return { on: t.on, offs }
    }

    return after ? { on: v, offs } : { offs: [...offs, { t: now, v, k: K[was.mood], on: t.on ?? v }] }
  })

  return { mood, from: was.mood, tR: now, vR: v, tiers }
}

const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0')

// A colour moved `t` of the way to white (255) or black (0): a stream's head.
const toward = (color: string, to: number, t: number) => {
  const v = parseInt(color.slice(1), 16)
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(x => x + (to - x) * t)

  return `#${c.map(hex).join('')}`
}

const gradId = (color: string) => `g${color.slice(1)}`

const gradient = (color: string) =>
  `<linearGradient id="${gradId(color)}" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="${color}" stop-opacity="0"/>` +
  `<stop offset=".55" stop-color="${color}" stop-opacity=".55"/>` +
  `<stop offset="1" stop-color="${color}" stop-opacity="1"/>` +
  `</linearGradient>`

// How a stream falls: `dur` per pass, `begin` from the frame's start, how
// many passes; `from` (a y) starts it part way down instead of above the top.
type Fall = { dur: number; begin: number; repeat: string; from?: number }

const topOf = (s: Shape) => -(s.glyphs.length + 2) * LAYERS[s.layer].cell

// What a stream is painted with: its body (the changing letters), its trail
// (the letters that fade up from the head) and its head.
type Paint = { body: string; trail: string; head: string }

// A tool call's colour as paint, in a look: its head is the brightest letter
// on black, the darkest on paper.
const tinted = (color: string, look: Look): Paint => {
  const c = look.tool(color)

  return { body: c, trail: `url(#${gradId(c)})`, head: look.toHead(c) }
}

// The rain's own paint: shared paint servers in <defs> (see `rainPaint`), so
// one colour change there turns every stream grey or green at once.
const RAIN: Paint = { body: 'url(#rain)', trail: 'url(#rainTrail)', head: 'url(#rainHead)' }

// One stream: a column of glyphs fading up from a bright, scrambling head,
// hung from its point on the top edge and slid down past the window's foot.
const stream = (s: Shape, alpha: number, paint: Paint, fall: Fall) => {
  const L = LAYERS[s.layer]
  const n = s.glyphs.length
  const top = topOf(s)
  const xs: string[] = []
  const ys: string[] = []
  let still = ''
  let changing = ''
  s.glyphs.forEach((g, i) => {
    const y = (i + 1) * L.cell
    const f = s.flicks.get(i)
    if (f === undefined) {
      xs.push('0')
      ys.push(String(y))
      still += g
    } else {
      // The trail's own gradient, as an opacity: the cell has no box to fade over.
      changing += `<use href="#f${f}" y="${y}" fill-opacity="${((i + 0.5) / n).toFixed(2)}"/>`
    }
  })
  const from = fall.from ?? top
  const freeze = fall.repeat === 'indefinite' ? '' : ' fill="freeze"'

  return (
    `<svg x="${s.x.toFixed(2)}%" width="1" height="1" overflow="visible">` +
    `<g class="${L.cls}" fill="${paint.body}" opacity="${alpha}" transform="translate(0 ${top})">` +
    `<animateTransform attributeName="transform" type="translate" from="0 ${from.toFixed(0)}" to="0 ${TRAVEL}" dur="${fall.dur.toFixed(3)}s" begin="${fall.begin.toFixed(3)}s" repeatCount="${fall.repeat}"${freeze}/>` +
    `<text x="${xs.join(' ')}" y="${ys.join(' ')}" fill="${paint.trail}">${still}</text>` +
    changing +
    `<use href="#h${s.head}" y="${(n + 1) * L.cell}" fill="${paint.head}"/>` +
    `</g></svg>`
  )
}

const periodOf = (c: Column) => c.period * LAYERS[c.layer].pace

// The longest pass of any column, in busy seconds: no stream of a tier turned
// off is still falling this long (times its pace) after.
const LONGEST = Math.max(...TIERS.flat().map(periodOf))

// Where a column is in its pass at rain-clock `v`, in busy seconds.
const phaseAt = (c: Column, v: number) => {
  const p = periodOf(c)

  return (((v + c.offset) % p) + p) % p
}

const steady = (c: Column, v: number, k: number) =>
  stream(c, LAYERS[c.layer].alpha, RAIN, {
    dur: periodOf(c) * k,
    begin: -phaseAt(c, v) * k,
    repeat: 'indefinite',
  })

// The rain clock when a column of a tier turned on at `on` first starts a
// pass from the top: until then it waits above the window, so it never pops
// in part way down. -Infinity: it was falling from the start.
const joinAt = (c: Column, on: number) => (on === -Infinity ? -Infinity : on + periodOf(c) - phaseAt(c, on))

// A column waiting to join: it starts from the top when the clock reaches `at`.
const joining = (c: Column, at: number, view: View, now: number, k: number) =>
  stream(c, LAYERS[c.layer].alpha, RAIN, {
    dur: periodOf(c) * k,
    begin: view.tR + (at - view.vR) * k - now,
    repeat: 'indefinite',
  })

// A column after its tier turned off: it finishes the pass it was on at the
// pace it had, and is gone, rather than vanishing where it was.
const leaving = (c: Column, off: Off, now: number) => {
  // Not yet joined when the tier turned off.
  if (off.v < joinAt(c, off.on)) {
    return ''
  }
  const p = periodOf(c)
  const ph = phaseAt(c, off.v)
  const left = (p - ph) * off.k
  if (now > off.t + left) {
    return ''
  }
  const top = topOf(c)

  return stream(c, LAYERS[c.layer].alpha, RAIN, {
    dur: left,
    begin: off.t - now,
    repeat: '1',
    from: top + (ph / p) * (TRAVEL - top),
  })
}

// One column as the window shows it: the end of any pass it was leaving on,
// and, while its tier is on, falling or waiting to join.
const column = (c: Column, tier: Tier, view: View, v: number, now: number) => {
  const k = K[view.mood]
  let out = tier.offs.map(o => leaving(c, o, now)).join('')
  if (tier.on !== undefined) {
    const at = joinAt(c, tier.on)
    out += v >= at ? steady(c, v, k) : joining(c, at, view, now, k)
  }

  return out
}

// A tool call's streams: a handful in its colour, near and bright, falling
// fast twice and gone. Each is placed by the burst's seed and timed from
// `at`, when the window first drew it, so it always enters from the top.
const burst = (b: Burst, now: number, look: Look) => {
  const r = rng(b.seed)
  const age = now - b.at
  const paint = tinted(b.color, look)
  let out = ''
  for (let j = 0; j < b.size; j++) {
    const x = 1 + r() * 98
    const layer: Layer = r() < 0.5 ? 2 : 1
    const s = shape(r, x, layer, 9 + Math.floor(r() * 11))
    const dur = 3 + r() * 3
    const delay = j * 0.22 + r() * 0.5
    if (age > delay + dur * 2) {
      continue
    }
    out += stream(s, 0.95, paint, { dur, begin: delay - age, repeat: '2' })
  }

  return out
}

// Idle is muted: dimmer, grey rain and no green light behind it. A turn brings
// the green and the light up quickly; when it ends they fade out slowly.
// Waiting, the rain stays green with the light half up.
const OPACITY: Record<Mood, number> = { idle: 0.55, wait: 0.8, busy: 1, storm: 1 }
const GLOW: Record<Mood, number> = { idle: 0, wait: 0.5, busy: 1, storm: 1 }
const FADE: Record<Mood, number> = { idle: 3, wait: 2, busy: 1.2, storm: 1.2 }

// How the rain is painted in each look. Dark: phosphor green on black, each
// stream's head the brightest letter, a green light behind. Light: deep green
// ink on pale paper, each head the darkest letter, a soft green wash behind.
type Look = {
  ground: string
  // The light behind the rain while Claude works: its colour at the centre,
  // and at the edge, where it has faded out.
  glow: [string, string, string]
  weight: number
  // A grey with a trace of the green in it while idle, so it still reads as
  // the same rain; green while Claude works.
  body: Record<Mood, string>
  head: Record<Mood, string>
  tool: (color: string) => string
  toHead: (color: string) => string
}

const moods = (idle: string, working: string): Record<Mood, string> => ({
  idle,
  wait: working,
  busy: working,
  storm: working,
})

// Each tool's colour on paper: the same kind of work, deep enough to read on
// the pale ground. White on black is ink on paper.
const PAPER: Record<string, string> = {
  [TOOL.read]: '#0086a3',
  [TOOL.edit]: '#bf169c',
  [TOOL.shell]: '#b06500',
  [TOOL.web]: '#6a3fd6',
  [TOOL.agent]: '#8a7200',
  [TOOL.mcp]: '#1f5dd6',
  [TOOL.other]: '#17261c',
  [TOOL.failed]: '#cf1229',
}

const LOOKS: Record<Scheme, Look> = {
  dark: {
    ground: '#010603',
    glow: ['#0a3a1c', '.5', '#000000'],
    weight: 500,
    body: moods('#93a89a', '#19ff6a'),
    head: moods('#dce6df', '#d2ffe0'),
    tool: color => color,
    toHead: color => toward(color, 255, 0.7),
  },
  light: {
    ground: '#e6f0e8',
    glow: ['#9fe3b4', '.55', '#e6f0e8'],
    // Dark letters on a light ground read thinner than glowing ones.
    weight: 600,
    body: moods('#62776a', '#0b8a3f'),
    head: moods('#26362c', '#03311a'),
    tool: color => PAPER[color] ?? color,
    toHead: color => toward(color, 0, 0.45),
  },
}

// An attribute easing from the last mood's value to this one's, from when the
// window saw the change; nothing when the value didn't change.
const ease = (view: View, now: number, of: Record<Mood, number | string>, attribute = 'opacity') =>
  of[view.from] === of[view.mood]
    ? ''
    : `<animate attributeName="${attribute}" from="${of[view.from]}" to="${of[view.mood]}" dur="${FADE[view.mood]}s" begin="${(view.tR - now).toFixed(2)}s" fill="freeze"/>`

const stop = (view: View, now: number, of: Record<Mood, string>, offset: string, opacity: string) =>
  `<stop offset="${offset}" stop-color="${of[view.mood]}" stop-opacity="${opacity}">${ease(view, now, of, 'stop-color')}</stop>`

// The paint servers every rain stream uses (`RAIN`). One stop is a solid
// colour; in user space it paints any shape, however small its box.
const rainPaint = (view: View, now: number, look: Look) =>
  `<linearGradient id="rain" gradientUnits="userSpaceOnUse">${stop(view, now, look.body, '0', '1')}</linearGradient>` +
  `<linearGradient id="rainHead" gradientUnits="userSpaceOnUse">${stop(view, now, look.head, '0', '1')}</linearGradient>` +
  `<linearGradient id="rainTrail" x1="0" y1="0" x2="0" y2="1">` +
  stop(view, now, look.body, '0', '0') +
  stop(view, now, look.body, '.55', '.55') +
  stop(view, now, look.body, '1', '1') +
  `</linearGradient>`

export const scene = (view: View, bursts: Burst[], now: number, scheme: Scheme = 'dark'): string => {
  const look = LOOKS[scheme]
  const v = virtual(view, now)
  const rain = TIERS.map((tier, i) => tier.map(c => column(c, view.tiers[i] ?? { offs: [] }, view, v, now)).join('')).join('')
  // Newest first, until the app's 131,072-character limit is near.
  let drawn = ''
  const used: string[] = []
  for (const b of [...bursts].reverse()) {
    const one = burst(b, now, look)
    if (CELLS[view.mood].length + rain.length + drawn.length + one.length > 120000) {
      break
    }
    drawn = one + drawn
    used.push(look.tool(b.color))
  }
  const colors = [...new Set(used)]

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" font-family="Menlo, monospace">
<style>
text{text-anchor:middle;font-weight:${look.weight}}
.a{font-size:11px}.b{font-size:14px}.c{font-size:18px}
</style>
<defs>
${rainPaint(view, now, look)}
${colors.map(gradient).join('\n')}
<radialGradient id="glow" cx="50%" cy="35%" r="80%"><stop offset="0" stop-color="${look.glow[0]}" stop-opacity="${look.glow[1]}"/><stop offset="1" stop-color="${look.glow[2]}" stop-opacity="0"/></radialGradient>
${CELLS[view.mood]}
</defs>
<rect width="100%" height="100%" fill="${look.ground}"/>
<rect width="100%" height="100%" fill="url(#glow)" opacity="${GLOW[view.mood]}">${ease(view, now, GLOW)}</rect>
<g opacity="${OPACITY[view.mood]}">${ease(view, now, OPACITY)}${rain}</g>
<g>${drawn}</g>
</svg>`
}
