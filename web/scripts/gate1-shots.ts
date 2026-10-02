/** Gate 1 in the building drawer, live screenshots (dev server on :5173 for the dev-only hooks, API on :8000).
 *  npx tsx scripts/gate1-shots.ts [outDir]      MODE=daylight for Daylight
 *  1  a camera-derived building within the target, on a corner (w1252504250)
 *  1b a camera-derived building outside the target (w1252505716), with "How do we know?" open
 *  2  a building placed on its outline (w1252505151): "error not measured", never 0 m
 *  3  a camera-only building, opened by clicking its diamond on the map
 *  t  Trust › Gate 1, to compare the area numbers
 *  Each step prints the drawer text it checked. */
import { chromium, type Page } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

type Ui = { getState(): Record<string, (...x: unknown[]) => void> }
type GMap = { moveCamera(o: object): void; getDiv(): HTMLElement }
const OUT = process.argv[2] ?? '../docs/screenshots/gate1'
const APP = process.env.APP_URL ?? 'http://localhost:5173/'
const API = process.env.API_URL ?? 'http://127.0.0.1:8000'
const MODE = process.env.MODE ?? 'night'
mkdirSync(OUT, { recursive: true })

const ui = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => { (window as unknown as { __gcUi: Ui }).__gcUi.getState()[f as string](...(a as unknown[])) }, [fn, args] as const)
const scrollTo = (page: Page, text: string) => page.evaluate((t) => {
  const root = document.querySelector('[aria-label=Evidence]')
  const el = root && [...root.querySelectorAll('*')].find((e) => e.children.length <= 3 && (e.textContent ?? '').includes(t))
  el?.scrollIntoView({ block: 'center' })
}, text)
const shot = async (page: Page, name: string) => { await page.screenshot({ path: join(OUT, `${MODE}-${name}.png`) }); console.log(`${name}: saved ${join(OUT, `${MODE}-${name}.png`)}`) }
const drawerText = async (page: Page) => (await page.locator('[aria-label=Evidence]').innerText()).replace(/\s+/g, ' ')
/** n: which "How do we know?" (a building's first one belongs to its photo, the second to "What we saw") */
const openHow = async (page: Page, n = 0) => {
  await page.locator('[aria-label=Evidence] button', { hasText: 'How do we know' }).nth(n).click()
  await page.waitForTimeout(900)
}

async function building(page: Page, id: string, name: string) {
  await ui(page, 'select', { kind: 'building', id }); await page.waitForTimeout(6000)
  await scrollTo(page, 'Frontage'); await page.waitForTimeout(700)
  await shot(page, name)
  const t = await drawerText(page)
  const i = t.indexOf('Position')
  console.log('   ', id, '→', t.slice(i, i + 260))
  await openHow(page, 1)
  await scrollTo(page, 'Position check'); await page.waitForTimeout(700)
  await shot(page, `${name}-how`)
  const h = await drawerText(page)
  const j = h.search(/position check/i)
  console.log('    how:', h.slice(j, j + 900))
}

async function main() {
  const api = await (await fetch(`${API}/buildings/ward29/w1252504250`)).json()
  console.log('API position_check w1252504250:', JSON.stringify(api.position_check))
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  await ctx.addInitScript((m) => { try { localStorage.setItem('gc.tourSeen', '1'); localStorage.setItem('gc.mode', JSON.stringify(m)) } catch { /* */ } }, MODE)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('page error:', e.message))
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!(window as unknown as { __gcUi?: unknown }).__gcUi, null, { timeout: 90_000 })
  await page.waitForTimeout(7000)

  await building(page, 'w1252504250', '1-camera-within-corner')
  await building(page, 'w1252505716', '1b-camera-outside')
  await building(page, 'w1252505151', '2-map-outline')

  // 3: click a camera-only diamond on the map (a real click, not a store call)
  await ui(page, 'select', null); await page.waitForTimeout(800)
  const pts = await (await fetch(`${API}/areas/ward29/camera-buildings`)).json()
  const p = pts.points[2]
  await page.evaluate(([la, lo]) => { (window as unknown as { __gcMap: GMap }).__gcMap.moveCamera({ center: { lat: la, lng: lo }, zoom: 19.5, tilt: 0, heading: 0 }) }, [p.lat, p.lon])
  await page.waitForTimeout(6000)
  const box = await page.evaluate(() => { const r = (window as unknown as { __gcMap: GMap }).__gcMap.getDiv().getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  await page.mouse.move(box.x, box.y); await page.waitForTimeout(1200)
  await shot(page, '3-camera-only-hover')
  await page.mouse.click(box.x, box.y); await page.waitForTimeout(5000)
  await shot(page, '3-camera-only')
  console.log('    camera-only:', (await drawerText(page)).slice(0, 600))
  await openHow(page); await scrollTo(page, 'Why no error'); await page.waitForTimeout(700)
  await shot(page, '3-camera-only-how')

  // t: Trust › Gate 1 (the same area numbers)
  await ui(page, 'select', null)
  await page.goto(APP + '#/trust/gate1'); await page.waitForTimeout(6000)
  await page.evaluate(() => { const h = [...document.querySelectorAll('h3')].find((e) => /front wall/.test(e.textContent ?? '')); h?.scrollIntoView({ block: 'start' }) }); await page.waitForTimeout(800)
  await shot(page, 't-trust-gate1')
  const g = (await page.locator('#gate1').innerText()).replace(/\s+/g, ' ')
  const k = g.search(/vs the centre of the OSM front wall/i)
  console.log('    trust:', g.slice(k, k + 700))
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
