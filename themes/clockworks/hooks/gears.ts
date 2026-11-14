// Gear geometry and the gear train's layout.
//
// Every gear in the train has the same circular pitch p (the distance from one
// tooth to the next along the pitch circle), so a gear of N teeth has pitch
// radius r = N p / 2π, two gears that mesh sit r1 + r2 apart, and gear i turns
// N0 / Ni times as fast as the driver, the opposite way to its neighbour. Each
// gear's starting angle is set so that a tooth of one sits in a gap of the
// next: the train meshes at rest, and stays meshed at any speed.

export const TAU = Math.PI * 2

// 20° pressure angle: how much a tooth narrows from root to tip.
const PRESSURE = Math.tan((20 * Math.PI) / 180)

export const f = (n: number) => (Math.round(n * 10) / 10).toString()

const P = (R: number, a: number) => `${f(R * Math.cos(a))} ${f(R * Math.sin(a))}`

const mod = (x: number, m: number) => ((x % m) + m) % m

// The toothed outline, centred on 0,0, tooth 0 along +x.
export function teeth(N: number, r: number): string {
  const m = (2 * r) / N
  const ro = r + m
  const rr = r - 1.25 * m
  const a = TAU / N
  // A little backlash, so neighbours never touch.
  const tp = 0.74 * m
  const to = tp - m * PRESSURE
  const tr = tp + 1.25 * m * PRESSURE
  const hr = Math.min(tr / rr, 0.46 * a)
  const ho = to / ro
  let d = `M${P(rr, -hr)}`
  for (let i = 0; i < N; i++) {
    const c = i * a
    d += `L${P(ro, c - ho)}A${f(ro)} ${f(ro)} 0 0 1 ${P(ro, c + ho)}L${P(rr, c + hr)}`
    d += `A${f(rr)} ${f(rr)} 0 0 1 ${P(rr, c + a - hr)}`
  }

  return `${d}Z`
}

export const circle = (R: number, cx = 0, cy = 0) =>
  `M${f(cx + R)} ${f(cy)}A${f(R)} ${f(R)} 0 1 0 ${f(cx - R)} ${f(cy)}A${f(R)} ${f(R)} 0 1 0 ${f(cx + R)} ${f(cy)}Z`

// The windows between S spokes, from the hub (ri) to the rim (ro). `w` is a
// spoke's width, or [at the hub, at the rim] for one that tapers; `twist`
// bends it (radians). Spokes sit half a window round from angle 0.
export function spokes(S: number, ri: number, ro: number, w: number | [number, number], twist = 0): string {
  const wAt = (R: number) => (Array.isArray(w) ? w[0] + ((w[1] - w[0]) * (R - ri)) / (ro - ri) : w)
  const d0 = (R: number) => Math.asin(Math.min(0.95, wAt(R) / 2 / R))
  let out = ''
  for (let k = 0; k < S; k++) {
    const a0 = (k * TAU) / S + TAU / S / 2
    const a1 = a0 + TAU / S
    const big = a1 - a0 - d0(ro) * 2 > Math.PI ? 1 : 0
    if (twist === 0) {
      out += `M${P(ri, a0 + d0(ri))}L${P(ro, a0 + d0(ro))}A${f(ro)} ${f(ro)} 0 ${big} 1 ${P(ro, a1 - d0(ro))}`
      out += `L${P(ri, a1 - d0(ri))}A${f(ri)} ${f(ri)} 0 0 0 ${P(ri, a0 + d0(ri))}Z`
    } else {
      const rm = (ri + ro) / 2
      out += `M${P(ri, a0 + d0(ri))}Q${P(rm, a0 + d0(rm) + twist * 1.1)} ${P(ro, a0 + d0(ro) + twist)}`
      out += `A${f(ro)} ${f(ro)} 0 ${big} 1 ${P(ro, a1 - d0(ro) + twist)}`
      out += `Q${P(rm, a1 - d0(rm) + twist * 1.1)} ${P(ri, a1 - d0(ri))}A${f(ri)} ${f(ri)} 0 0 0 ${P(ri, a0 + d0(ri))}Z`
    }
  }

  return out
}

// H round holes of radius R on a circle of radius rh.
export function holes(H: number, rh: number, R: number, phase = 0): string {
  let out = ''
  for (let k = 0; k < H; k++) {
    const a = phase + (k * TAU) / H
    out += circle(R, rh * Math.cos(a), rh * Math.sin(a))
  }

  return out
}

// n kidney slots between radii r1 and r2, round at both ends; `gap` is the
// web left between two slots, in radians.
export function slots(n: number, r1: number, r2: number, gap: number): string {
  const h = (r2 - r1) / 2
  let out = ''
  for (let k = 0; k < n; k++) {
    const a0 = (k * TAU) / n + gap / 2
    const a1 = ((k + 1) * TAU) / n - gap / 2
    const big = a1 - a0 > Math.PI ? 1 : 0
    out += `M${P(r2, a0)}A${f(r2)} ${f(r2)} 0 ${big} 1 ${P(r2, a1)}A${f(h)} ${f(h)} 0 0 1 ${P(r1, a1)}`
    out += `A${f(r1)} ${f(r1)} 0 ${big} 0 ${P(r1, a0)}A${f(h)} ${f(h)} 0 0 1 ${P(r2, a0)}Z`
  }

  return out
}

// A bore of radius b with a keyway kw wide and kd deep, cut upward.
export function keyed(b: number, kw: number, kd: number): string {
  const x = kw / 2
  const y = Math.sqrt(b * b - x * x)

  return `M${f(x)} ${f(-y)}L${f(x)} ${f(-(b + kd))}L${f(-x)} ${f(-(b + kd))}L${f(-x)} ${f(-y)}A${f(b)} ${f(b)} 0 1 0 ${f(x)} ${f(-y)}Z`
}

export type Role = 'driver' | 'pinion' | 'medium'

export type Gear = {
  x: number
  y: number
  N: number
  // Pitch radius and module (tooth size), in pixels.
  r: number
  m: number
  // The angle the gear starts at, in radians, so that it meshes.
  phase: number
  // Which way it turns, and how many times as fast as the driver.
  dir: 1 | -1
  ratio: number
  role: Role
  // The gear it meshes with, earlier in the train.
  from?: number
}

// A train from its driver: each step names the next gear's teeth and the
// direction to it from the gear before, in degrees on screen (0 right, 90 down).
export type TrainSpec = {
  pitch: number
  driver: { x: number; y: number; N: number }
  steps: { N: number; ang: number; role?: Role }[]
}

export function train(spec: TrainSpec): Gear[] {
  const p = spec.pitch
  const R = (N: number) => (N * p) / TAU
  const d = spec.driver
  const gears: Gear[] = [{ x: d.x, y: d.y, N: d.N, r: R(d.N), m: p / Math.PI, phase: 0, dir: 1, ratio: 1, role: 'driver' }]
  for (const s of spec.steps) {
    const at = gears.length - 1
    const from = gears[at] as Gear
    const r = R(s.N)
    const th = (s.ang * Math.PI) / 180
    // Where the line of centres crosses the gear before, measured from its
    // nearest tooth, as an arc; the next gear puts a gap there.
    const a1 = TAU / from.N
    const u1 = mod(th - from.phase + a1 / 2, a1) - a1 / 2
    const u2 = (p / 2 - u1 * from.r) / r
    gears.push({
      x: from.x + (from.r + r) * Math.cos(th),
      y: from.y + (from.r + r) * Math.sin(th),
      N: s.N,
      r,
      m: p / Math.PI,
      phase: th + Math.PI - u2,
      dir: from.dir === 1 ? -1 : 1,
      ratio: d.N / s.N,
      role: s.role ?? 'pinion',
      from: at,
    })
  }

  return gears
}

// Pairs of gears that don't mesh but come closer than their teeth allow.
export function clashes(gears: Gear[]): string[] {
  const out: string[] = []
  gears.forEach((a, i) => {
    gears.forEach((b, j) => {
      if (j <= i || b.from === i || a.from === j) {
        return
      }
      const need = a.r + b.r + 2 * a.m + 10
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (dist < need) {
        out.push(`${i}-${j} short by ${Math.round(need - dist)}`)
      }
    })
  })

  return out
}
