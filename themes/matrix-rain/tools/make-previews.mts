// Renders the README previews into screenshots/, from the theme's own scene:
//
//   live.svg      the scene itself, still moving (GitHub plays SVG animation)
//   idle.png      the slow rain while Claude waits
//   working.png   the fast rain during a reply, with tool-call streams
//   closeup.png   the same rain in a smaller window at twice the pixels
//
// Run from the theme's folder: node tools/make-previews.mts
// The stills come from headless Chrome (CHROME overrides its path) with a
// throwaway profile. Times are fixed, so every run draws the same pictures.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Burst, Mood } from '../types/index.d.ts'
import { scene } from '../hooks/scene.ts'
import type { View } from '../hooks/scene.ts'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'screenshots')
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
mkdirSync(out, { recursive: true })

const NOW = 1_000_000
const view = (mood: Mood): View => ({ mood, from: mood, tR: NOW - 100, vR: 5000, prevTR: -Infinity, prevVR: 0 })

// One burst per kind of tool, as the colour table in the README lists them.
const TOOLS = ['#26e7ff', '#ff3df2', '#ffb21e', '#a77bff', '#ffe45c', '#4f8cff', '#effff4', '#ff3346']
const bursts: Burst[] = TOOLS.map((color, i) => ({ seed: 4100 + i * 97, color, size: 4, at: NOW - 0.4 - i * 0.35 }))

// The app draws the scene to fill the window; as a file it needs a size.
const sized = (svg: string, w: number, h: number) =>
  svg.replace('width="100%" height="100%"', `width="${w}" height="${h}"`)

// A viewBox so it scales to the README's width (the app's own scene has none).
const live = sized(scene(view('busy'), bursts, NOW), 1200, 600).replace(' width="1200"', ' viewBox="0 0 1200 600" width="1200"')
writeFileSync(join(out, 'live.svg'), live)

const work = mkdtempSync(join(tmpdir(), 'matrix-previews-'))
const shoot = (name: string, svg: string, w: number, h: number, scale = 1, seconds = 2.5) => {
  const page = join(work, `${name}.svg`)
  writeFileSync(page, sized(svg, w, h))
  execFileSync(chrome, [
    '--headless=new',
    '--hide-scrollbars',
    '--no-first-run',
    `--user-data-dir=${join(work, 'profile')}`,
    `--window-size=${w},${h}`,
    `--force-device-scale-factor=${scale}`,
    `--virtual-time-budget=${Math.round(seconds * 1000)}`,
    `--screenshot=${join(out, `${name}.png`)}`,
    `file://${page}`,
  ], { stdio: 'ignore' })
  console.log('wrote', join(out, `${name}.png`))
}

try {
  shoot('idle', scene(view('idle'), [], NOW), 1600, 900)
  shoot('working', scene(view('busy'), bursts, NOW), 1600, 900)
  shoot('closeup', scene(view('busy'), bursts, NOW), 800, 450, 2)
} finally {
  rmSync(work, { recursive: true, force: true })
}
console.log('wrote', join(out, 'live.svg'))
