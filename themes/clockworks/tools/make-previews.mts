// Renders the README previews into screenshots/, from the theme's own scene:
//
//   live.svg      the scene itself, turning (GitHub plays SVG animation)
//   idle.png      the gears standing still and muted while Claude waits
//   working.png   the gears turning at full strength during a reply
//   closeup.png   the flywheel and the first pinions at twice the pixels
//
// Run from the theme's folder: node tools/make-previews.mts
// The stills come from headless Chrome (CHROME overrides its path) with a
// throwaway profile. Times are fixed, so every run draws the same pictures.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The hooks import each other without a suffix, as the engine allows; Node
// needs one, so a relative import that doesn't resolve is tried again as .ts.
register(
  'data:text/javascript,' +
    encodeURIComponent(
      'export async function resolve(s, c, next) { try { return await next(s, c) } catch (e) { if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]sx?$/.test(s)) return next(s + ".ts", c); throw e } }',
    ),
)

const { scene, shift, start } = await import('../hooks/scene.ts')
type Mood = 'idle' | 'wait' | 'busy' | 'storm'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'screenshots')
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
mkdirSync(out, { recursive: true })

// A level long since reached: no spin-up or fade left in the drawing, the
// train some way round from where it meshes at rest.
const NOW = 1_000_000
const view = (mood: Mood) => ({ ...shift(start('idle', NOW - 100), mood, NOW - 100), vR: 37 })

// The app draws the scene to fill the window; as a file it needs a size.
const sized = (svg: string, w: number, h: number) => svg.replace('width="100%" height="100%"', `width="${w}" height="${h}"`)

// A viewBox so it scales to the README's width (the app's own scene has none).
const live = sized(scene(view('busy'), NOW), 1600, 900).replace(' width="1600"', ' viewBox="0 0 1600 900" width="1600"')
writeFileSync(join(out, 'live.svg'), live)

const work = mkdtempSync(join(tmpdir(), 'clockworks-previews-'))
const shoot = (name: string, svg: string, w: number, h: number, scale = 1, seconds = 2.5) => {
  const page = join(work, `${name}.svg`)
  writeFileSync(page, sized(svg, w, h))
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--hide-scrollbars',
      '--no-first-run',
      // Chrome refuses to run as root without it, as in a container.
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      `--user-data-dir=${join(work, 'profile')}`,
      `--window-size=${w},${h}`,
      `--force-device-scale-factor=${scale}`,
      `--virtual-time-budget=${Math.round(seconds * 1000)}`,
      `--screenshot=${join(out, `${name}.png`)}`,
      `file://${page}`,
    ],
    { stdio: 'ignore' },
  )
  console.log('wrote', join(out, `${name}.png`))
}

try {
  shoot('idle', scene(view('idle'), NOW), 1600, 900)
  shoot('working', scene(view('busy'), NOW), 1600, 900)
  // A smaller window shows the middle of the sheet: the train's diagonal.
  shoot('closeup', scene(view('busy'), NOW), 800, 450, 2)
} finally {
  rmSync(work, { recursive: true, force: true })
}
console.log('wrote', join(out, 'live.svg'))
