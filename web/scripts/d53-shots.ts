/** D53 live screenshots (dev server on :5173 for the dev-only hooks, API on :8000).  npx tsx scripts/d53-shots.ts [outDir]
 *  (a) Under the Hood: the map-data line (Ward 29: snapshot dates, analysed live before the copy existed), (b) the same for
 *  the Bharathiar Road live area, (c) the map with the OpenStreetMap / Microsoft attribution in the footer, (d) the
 *  question "Show not-in-register buildings within 50 m of a possible dark stretch" (chips, count, map), (e) its Near chip
 *  editor. Each step prints the text it checked. MODE=daylight for Daylight. */
import { chromium, type Page } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

type Ui = { getState(): Record<string, (...x: unknown[]) => void> }
const OUT = process.argv[2] ?? '../docs/screenshots/d53'
const APP = process.env.APP_URL ?? 'http://localhost:5173/'
const MODE = process.env.MODE ?? 'night'
mkdirSync(OUT, { recursive: true })

const ui = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => { (window as unknown as { __gcUi: Ui }).__gcUi.getState()[f as string](...(a as unknown[])) }, [fn, args] as const)
const shot = async (page: Page, name: string) => { await page.screenshot({ path: join(OUT, `${MODE}-${name}.png`) }); console.log(`${name}: saved`) }

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  await ctx.addInitScript((m) => { try { localStorage.setItem('gc.tourSeen', '1'); localStorage.setItem('gc.mode', JSON.stringify(m)); localStorage.setItem('gc.area', JSON.stringify('ward29')) } catch { /* */ } }, MODE)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('page error:', e.message))
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!(window as unknown as { __gcUi?: unknown }).__gcUi, null, { timeout: 90_000 })
  await page.waitForTimeout(7000)

  // (a) Hood, Ward 29: the coverage card with the map-data line
  await page.goto(APP + '#/hood/overview'); await page.waitForTimeout(6000)
  const line = page.locator('[aria-label="Map data source"]').first()
  await line.scrollIntoViewIfNeeded(); await page.waitForTimeout(800)
  await shot(page, 'a-hood-map-data-ward29')
  console.log('   ', (await line.innerText()).replace(/\s+/g, ' '))
  // (b) a live area analysed from the app (Bharathiar Road, 2 Oct)
  await ui(page, 'setArea', 'unnamed_road_between_bharathiar_road_and_923057'); await page.waitForTimeout(6000)
  const line2 = page.locator('[aria-label="Map data source"]').first()
  await line2.scrollIntoViewIfNeeded(); await page.waitForTimeout(800)
  await shot(page, 'b-hood-map-data-bharathiar')
  console.log('   ', (await line2.innerText()).replace(/\s+/g, ' '))

  // (c) the map: attribution in the footer
  await ui(page, 'setArea', 'ward29')
  await page.goto(APP + '#/'); await page.waitForTimeout(7000)
  await shot(page, 'c-map-attribution')
  console.log('   ', (await page.getByText(/OpenStreetMap contributors/).first().innerText()).replace(/\s+/g, ' '))

  // (d) the 50 m question
  const ask = page.locator('form[role=search] input').first()
  await ask.click(); await ask.fill('Show not-in-register buildings within 50 m of a possible dark stretch'); await ask.press('Enter')
  await page.waitForTimeout(7000)
  await shot(page, 'd-near-dark-question')
  console.log('   ', (await page.locator('[aria-label="Query result"]').innerText()).replace(/\s+/g, ' ').slice(0, 700))
  // (e) the Near chip's editor
  await page.getByRole('button', { name: /^Change Dark stretch/ }).click(); await page.waitForTimeout(800)
  await shot(page, 'e-near-chip-editor')
  await page.keyboard.press('Escape')
  await browser.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
