import type { Mood } from '../types'
import { circle, holes, keyed, slots, spokes, TAU, teeth, train } from './gears'
import type { Gear, TrainSpec } from './gears'

// The gear train behind the conversation, in the form the desktop app lets
// move (the same as Matrix Rain's rain): no viewBox, sized in window pixels,
// all motion SMIL, no <style>, filters or masks.
//
// The train is laid out on a 1600 x 900 sheet, hung by its centre from the
// centre of the window: a big flywheel at the bottom left drives a line of
// pinions up a diagonal to two wheels at the top right. A wider window shows
// it whole, a narrower one cuts both ends alike.
//
// Every redraw reloads the frame, so the gears are drawn from the window's
// own turning clock (`View`, kept by register.tsx): each redraw starts every
// gear at the angle it had reached and carries on at the new speed.

// The driver's speed at each level, in working turns: idle stands still,
// waiting creeps at a quarter, a storm turns 1.6 times as fast as working.
export const SPEED: Record<Mood, number> = { idle: 0, wait: 0.25, busy: 1, storm: 1.6 }

// How visible the train is: muted while idle, full in a storm.
export const STRENGTH: Record<Mood, number> = { idle: 0.26, wait: 0.55, busy: 0.9, storm: 1 }

// The driver turns once in 40 working seconds: 9° a second.
const W = 360 / 40

// Seconds to spin up to a faster speed, and to coast down to a slower one.
const SPIN_UP = 1.2
const COAST = 2.4

// Seconds to brighten, and to fade back.
const FADE_UP = 1.2
const FADE_DOWN = 2.5

export const LAYOUT: TrainSpec = {
  pitch: 26,
  driver: { x: 20, y: 780, N: 72 },
  steps: [
    { N: 18, ang: -40 },
    { N: 14, ang: -8 },
    { N: 20, ang: -44 },
    { N: 15, ang: -10 },
    { N: 22, ang: -38 },
    { N: 14, ang: 0 },
    { N: 18, ang: -36 },
    { N: 16, ang: -6 },
    { N: 36, ang: -28, role: 'medium' },
    { N: 30, ang: 52, role: 'medium' },
  ],
}

export const GEARS = train(LAYOUT)

// ── How each wheel is cast ──────────────────────────────────────────────
// In train order, the driver first. rim, hub and spoke widths are fractions of
// the wheel's radius.
type Kind = {
  body: 'spokes' | 'holes' | 'slots' | 'solid'
  n?: number
  w?: [number, number]
  twist?: number
  size?: number
  gap?: number
  rim: number
  hub: number
  bolts?: number
  hex?: boolean
  ribs?: boolean
  boss?: boolean
  dish?: boolean
  key?: boolean
  bush?: boolean
  fill: 'iron' | 'dark' | 'steel'
}

const KINDS: Kind[] = [
  // The flywheel: a heavy rim and six broad spokes tapering out from a big
  // hex-bolted hub, a rib down each.
  { body: 'spokes', n: 6, w: [0.22, 0.13], rim: 0.2, hub: 0.27, bolts: 8, hex: true, ribs: true, fill: 'iron', bush: true },
  // A solid web with three big lightening holes.
  { body: 'holes', n: 3, size: 0.4, rim: 0.12, hub: 0.3, bolts: 3, fill: 'dark', bush: true },
  // A plain keyed pinion, turned from steel, with a raised boss.
  { body: 'solid', rim: 0.1, hub: 0.44, boss: true, key: true, fill: 'steel' },
  // Four straight, thick spokes on a thin rim.
  { body: 'spokes', n: 4, w: [0.24, 0.2], rim: 0.07, hub: 0.3, bolts: 4, fill: 'iron', bush: true },
  // Dished: a recessed web and a ring of small holes, keyed.
  { body: 'holes', n: 6, size: 0.24, rim: 0.12, hub: 0.32, dish: true, key: true, fill: 'dark' },
  // Four kidney slots.
  { body: 'slots', n: 4, gap: 0.95, rim: 0.12, hub: 0.3, bolts: 4, fill: 'iron', bush: true },
  // Solid and blackened, dished, with two set screws.
  { body: 'solid', rim: 0.1, hub: 0.36, bolts: 2, dish: true, fill: 'dark', bush: true },
  // Five curved spokes in steel.
  { body: 'spokes', n: 5, w: [0.14, 0.09], twist: 0.45, rim: 0.1, hub: 0.28, fill: 'steel', bush: true },
  // Six small holes, keyed, with a boss.
  { body: 'holes', n: 6, size: 0.3, rim: 0.12, hub: 0.3, key: true, boss: true, fill: 'iron' },
  // Three broad tapered arms with ribs.
  { body: 'spokes', n: 3, w: [0.32, 0.17], rim: 0.15, hub: 0.27, bolts: 6, hex: true, ribs: true, fill: 'iron', bush: true },
  // Six thin S-curved spokes, blackened.
  { body: 'spokes', n: 6, w: [0.09, 0.06], twist: -0.5, rim: 0.11, hub: 0.24, bolts: 6, fill: 'dark', bush: true },
]

const r1 = (n: number) => (Math.round(n * 10) / 10).toString()

const ring = (R: number, attrs: string) => `<circle r="${r1(R)}" fill="none" ${attrs}/>`

const SHADOW = '#0b0d10'
const EDGE = '#8d96a1'
const BOLT = '#8e96a0'
const BRONZE = '#b3733f'

// A gear as drawn, centred on 0,0 at angle 0: everything on it turns with it.
function cast(g: Gear, K: Kind): string {
  const rr = g.r - 1.25 * g.m
  const ro = rr - Math.max(1.5 * g.m, g.r * K.rim)
  const ri = g.r * K.hub
  const bore = K.key ? Math.max(8, g.r * 0.12) : Math.max(6, g.r * 0.08)
  const hole = K.key ? keyed(bore, bore * 0.6, bore * 0.42) : circle(bore)
  let d = teeth(g.N, g.r) + hole
  if (K.body === 'spokes') {
    d += spokes(K.n ?? 5, ri, ro, [g.r * (K.w?.[0] ?? 0.1), g.r * (K.w?.[1] ?? 0.1)], K.twist ?? 0)
  } else if (K.body === 'holes') {
    d += holes(K.n ?? 5, (ri + ro) / 2, ((ro - ri) / 2) * ((K.size ?? 0.3) / 0.5) * 0.92, 0.3)
  } else if (K.body === 'slots') {
    d += slots(K.n ?? 4, ri + (ro - ri) * 0.16, ro - (ro - ri) * 0.16, K.gap ?? 0.8)
  }
  let out = `<path d="${d}" fill="url(#${K.fill})" fill-rule="evenodd" stroke="#0d0f12" stroke-width="2" stroke-linejoin="round"/>`
  // The teeth stand off the rim: a shadow at the root circle.
  out += ring(rr, `stroke="${SHADOW}" stroke-opacity=".55" stroke-width="2"`)
  if (K.body === 'spokes' || K.body === 'slots') {
    out += ring(ro + 1.5, `stroke="${EDGE}" stroke-opacity=".42" stroke-width="2"`)
  }
  if (K.dish) {
    out += ring(ro, `stroke="${SHADOW}" stroke-opacity=".75" stroke-width="2.5"`)
    out += ring(ro - 2.5, `stroke="${EDGE}" stroke-opacity=".28" stroke-width="1.5"`)
    out += ring(ri * 1.12, `stroke="${EDGE}" stroke-opacity=".28" stroke-width="1.5"`)
    out += ring(ri * 1.12 + 2.5, `stroke="${SHADOW}" stroke-opacity=".7" stroke-width="2"`)
  }
  if (K.ribs && K.body === 'spokes' && !K.twist) {
    let rib = ''
    for (let k = 0; k < (K.n ?? 0); k++) {
      const a = ((k + 0.5) * TAU) / (K.n ?? 1)
      rib += `M${r1(ri * Math.cos(a))} ${r1(ri * Math.sin(a))}L${r1(ro * Math.cos(a))} ${r1(ro * Math.sin(a))}`
    }
    out += `<path d="${rib}" stroke="#9aa3ad" stroke-opacity=".32" stroke-width="${r1(Math.max(2, g.r * 0.012))}" stroke-linecap="round"/>`
  }
  // The hub, with the bore (and its keyway) cut through it.
  out += `<path d="${circle(ri)}${hole}" fill-rule="evenodd" fill="${K.fill === 'steel' ? '#4a5058' : '#2d3137'}" stroke="#7f8893" stroke-opacity=".55" stroke-width="1.5"/>`
  if (K.boss) {
    out += ring(ri * 0.72, `stroke="${SHADOW}" stroke-opacity=".7" stroke-width="2"`)
    out += ring(ri * 0.72 - 2, 'stroke="#a2abb5" stroke-opacity=".35" stroke-width="1.2"')
  }
  if (K.bolts) {
    const R = K.boss ? ri * 0.86 : ri * 0.7
    const s = Math.max(2.8, ri * (K.hex ? 0.1 : 0.085))
    for (let k = 0; k < K.bolts; k++) {
      const a = 0.2 + (k * TAU) / K.bolts
      const cx = R * Math.cos(a)
      const cy = R * Math.sin(a)
      if (K.hex) {
        const pts = Array.from({ length: 6 }, (_, j) => `${r1(cx + s * Math.cos((j * TAU) / 6))},${r1(cy + s * Math.sin((j * TAU) / 6))}`)
        out += `<polygon points="${pts.join(' ')}" fill="${BOLT}" stroke="#15181c" stroke-width="1"/>`
      } else {
        out += `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(s)}" fill="${BOLT}"/>`
      }
    }
  }
  if (K.bush) {
    out += ring(bore + 3, `stroke="${BRONZE}" stroke-width="${r1(Math.max(3, g.r * 0.032))}"`)
  }

  return out
}

// Drawn once: only the angles change from one redraw to the next.
const BODIES = GEARS.map((g, i) => cast(g, KINDS[i % KINDS.length] as Kind))

const DEFS =
  '<radialGradient id="iron" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#5d646e"/><stop offset=".7" stop-color="#3b4047"/><stop offset="1" stop-color="#25292e"/></radialGradient>' +
  '<radialGradient id="dark" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#454b53"/><stop offset=".7" stop-color="#2b2f35"/><stop offset="1" stop-color="#1a1d21"/></radialGradient>' +
  '<radialGradient id="steel" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#7a828c"/><stop offset=".7" stop-color="#555c65"/><stop offset="1" stop-color="#363b42"/></radialGradient>' +
  '<linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16181c"/><stop offset="1" stop-color="#0a0b0d"/></linearGradient>'

// ── The turning clock ───────────────────────────────────────────────────
// What the window shows: since wall second `tR` the driver has turned from
// `vR` (in working seconds) at speed `s0`, easing in a straight line to `s1`
// over `d` seconds. Since wall second `tF` the train's strength has gone from
// `o0` to `o1` over `fd` seconds.
export type View = {
  mood: Mood
  tR: number
  vR: number
  s0: number
  s1: number
  d: number
  tF: number
  o0: number
  o1: number
  fd: number
}

export const speedAt = (v: View, now: number) => {
  const t = now - v.tR

  return v.d <= 0 || t >= v.d ? v.s1 : t <= 0 ? v.s0 : v.s0 + ((v.s1 - v.s0) * t) / v.d
}

// How far the driver has turned by `now`, in working seconds.
export const virtual = (v: View, now: number) => {
  const t = Math.max(0, now - v.tR)
  if (v.d <= 0) {
    return v.vR + v.s1 * t
  }
  const r = Math.min(t, v.d)

  return v.vR + v.s0 * r + ((v.s1 - v.s0) * r * r) / (2 * v.d) + v.s1 * Math.max(0, t - v.d)
}

export const strengthAt = (v: View, now: number) => {
  const t = now - v.tF

  return v.fd <= 0 || t >= v.fd ? v.o1 : t <= 0 ? v.o0 : v.o0 + ((v.o1 - v.o0) * t) / v.fd
}

// The first view a window draws: at rest at its level, every gear where it
// meshes from.
export const start = (mood: Mood, now: number): View => ({
  mood,
  tR: now,
  vR: 0,
  s0: SPEED[mood],
  s1: SPEED[mood],
  d: 0,
  tF: now,
  o0: STRENGTH[mood],
  o1: STRENGTH[mood],
  fd: 0,
})

// The view once the level changes at `now`: the train carries on from where
// it is, at the speed it has, easing to the new one; the strength likewise.
export const shift = (was: View, mood: Mood, now: number): View => {
  const s = speedAt(was, now)
  const o = strengthAt(was, now)
  const s1 = SPEED[mood]
  const o1 = STRENGTH[mood]

  return {
    mood,
    tR: now,
    vR: virtual(was, now),
    s0: s,
    s1,
    d: s1 === s ? 0 : s1 > s ? SPIN_UP : COAST,
    tF: now,
    o0: o,
    o1,
    fd: o1 === o ? 0 : o1 > o ? FADE_UP : FADE_DOWN,
  }
}

const n2 = (x: number) => (Math.round(x * 100) / 100).toString()
const n3 = (x: number) => (Math.round(x * 1000) / 1000).toString()

// A gear's angle when the drawing starts, and how it turns from there: the
// rest of any change of speed (a spline that eases its angle as the speed
// changes in a straight line), then steady turns at the new speed.
export function turning(g: Gear, view: View, now: number): { at: number; anim: string } {
  const k = g.dir * g.ratio * W
  const raw = (g.phase * 180) / Math.PI + k * virtual(view, now)
  const at = ((raw % 360) + 360) % 360
  const s = speedAt(view, now)
  const s1 = view.s1
  const rem = view.d > 0 ? Math.max(0, view.tR + view.d - now) : 0
  let anim = ''
  let to = at
  let begin = 0
  if (rem > 0 && s + s1 > 0) {
    to = at + (k * (s + s1) * rem) / 2
    const q = s / (s + s1)
    anim +=
      `<animateTransform attributeName="transform" type="rotate" from="${n2(at)}" to="${n2(to)}" dur="${n3(rem)}s" fill="freeze"` +
      ` calcMode="spline" keyTimes="0;1" keySplines=".333 ${n3((2 * q) / 3)} .667 ${n3(1 / 3 + (2 * q) / 3)}"/>`
    begin = rem
  }
  if (s1 > 0) {
    anim += `<animateTransform attributeName="transform" type="rotate" from="${n2(to)}" to="${n2(to + Math.sign(k) * 360)}" dur="${n3(360 / (Math.abs(k) * s1))}s" begin="${n3(begin)}s" repeatCount="indefinite"/>`
  }

  return { at, anim }
}

const strength = (view: View, now: number) => {
  const o = n3(view.o1)
  if (view.fd > 0 && now < view.tF + view.fd) {
    return `<g opacity="${o}"><animate attributeName="opacity" from="${n3(view.o0)}" to="${o}" dur="${view.fd}s" begin="${n3(view.tF - now)}s" fill="freeze"/>`
  }

  return `<g opacity="${o}">`
}

export const scene = (view: View, now: number): string => {
  const gears = GEARS.map((g, i) => {
    const { at, anim } = turning(g, view, now)

    return `<g transform="translate(${r1(g.x)} ${r1(g.y)})"><g transform="rotate(${n2(at)})">${anim}${BODIES[i]}</g></g>`
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
<defs>${DEFS}</defs>
<rect width="100%" height="100%" fill="url(#ground)"/>
<svg x="50%" y="50%" width="1" height="1" overflow="visible"><g transform="translate(-800 -450)">
${strength(view, now)}
${gears.join('\n')}
</g></g></svg>
</svg>`
}
