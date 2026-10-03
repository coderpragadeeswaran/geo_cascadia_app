/** D54 + D55 live screenshots (dev server on :5173 for the dev-only hooks, API on :8000).  npx tsx scripts/lighting-shots.ts [outDir]
 *  (a) the possible-dark-stretch list in priority order, (b) the same list longest first, (c) a stretch's card (drawer),
 *  (d) the map: dark-stretch edges coloured by priority (area zoom) and (e) closer, (f) the question "High priority dark
 *  stretches" with its Priority chip, (g) the area panel's Download report buttons, (h) a street's report buttons — and
 *  both buttons really download (the files are saved next to the shots). Each step prints the text it checked.
 *  MODE=daylight for Daylight. */
import { chromium, type Page } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

type Ui = { getState(): Record<string, (...x: unknown[]) => void> }
type GMap = { setZoom(z: number): void; setCenter(c: { lat: number; lng: number }): void; setTilt(t: number): void }
const OUT = process.argv[2] ?? '../docs/screenshots/lighting'
const APP = process.env.APP_URL ?? 'http://localhost:5173/'
const MODE = process.env.MODE ?? 'night'
mkdirSync(OUT, { recursive: true })

const ui = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => { (window as unknown as { __gcUi: Ui }).__gcUi.getState()[f as string](...(a as unknown[])) }, [fn, args] as const)
const view = (page: Page, lat: number, lng: number, z: number) =>
  page.evaluate(([la, lo, zz]) => { const m = (window as unknown as { __gcMap: GMap }).__gcMap; m.setCenter({ lat: la, lng: lo }); m.setZoom(zz) }, [lat, lng, z] as const)
const shot = async (page: Page, name: string) => { await page.screenshot({ path: join(OUT, `${MODE}-${name}.png`) }); console.log(`${name}: saved`) }
const text = async (page: Page, sel: string) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ')

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true })
  await ctx.addInitScript((m) => { try { localStorage.setItem('gc.tourSeen', '1'); localStorage.setItem('gc.mode', JSON.stringify(m)); localStorage.setItem('gc.area', JSON.stringify('ward29')) } catch { /* */ } }, MODE)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('page error:', e.message))
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!(window as unknown as { __gcUi?: unknown }).__gcUi && !!(window as unknown as { __gcMap?: unknown }).__gcMap, null, { timeout: 90_000 })
  await page.waitForTimeout(8000)

  // (g) the area panel ("What stands out") with Download report
  await page.getByRole('button', { name: 'What stands out' }).click(); await page.waitForTimeout(2500)
  await shot(page, 'g-area-report-buttons')
  console.log('   ', await text(page, '[aria-label="Download a report for this area"]'))
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }),
    page.locator('[aria-label="Download a report for this area"] button', { hasText: 'PDF' }).click()])
  await dl.saveAs(join(OUT, `${MODE}-ui-${dl.suggestedFilename()}`)); console.log('    downloaded', dl.suggestedFilename())

  // (a) the key number "Possible dark stretches" → the list, in priority order
  await page.getByRole('button', { name: /Possible dark stretches/ }).first().click()
  await page.waitForTimeout(4000)
  await shot(page, 'a-priority-list')
  console.log('   ', (await text(page, 'ol[aria-label="Possible dark stretches"]')).slice(0, 600))
  // (d) the map at area zoom (the list's stretches; edges by priority)
  await shot(page, 'd-map-priority-area')
  // (b) longest first
  await page.getByRole('button', { name: 'Longest first' }).click(); await page.waitForTimeout(800)
  await shot(page, 'b-longest-first')
  console.log('   ', (await text(page, 'ol[aria-label="Possible dark stretches"]')).slice(0, 200))
  await page.getByRole('button', { name: 'Fix first' }).click(); await page.waitForTimeout(500)
  // (c) the first stretch's card
  await page.locator('ol[aria-label="Possible dark stretches"] li button').first().click(); await page.waitForTimeout(5000)
  await shot(page, 'c-stretch-card')
  console.log('   ', (await text(page, '[aria-label="Lighting priority"]')))
  await page.keyboard.press('Escape'); await page.waitForTimeout(800)
  await page.keyboard.press('Escape'); await page.waitForTimeout(800)
  // (e) closer: Sathy Main Road / Sakthi Main Road / Ganapathy
  await view(page, 11.0325, 76.9775, 16.2); await page.waitForTimeout(5000)
  await shot(page, 'e-map-priority-close')

  // (f) the question
  const ask = page.locator('form[role=search] input').first()
  await ask.click(); await ask.fill('High priority dark stretches'); await ask.press('Enter')
  await page.waitForTimeout(6000)
  await shot(page, 'f-high-priority-question')
  console.log('   ', (await text(page, '[aria-label="Query result"]')).slice(0, 500))
  await page.getByRole('button', { name: /^Change Priority/ }).click(); await page.waitForTimeout(800)
  await shot(page, 'f2-priority-chip-editor')
  await page.keyboard.press('Escape'); await page.waitForTimeout(400)
  await page.keyboard.press('Escape'); await page.waitForTimeout(800)

  // (h) a street: its panel with "Report for this street"
  await ui(page, 'selectStreet', 'Sathy Main Road'); await page.waitForTimeout(5000)
  await shot(page, 'h-street-report-buttons')
  const kp = await page.locator('[aria-label="Key figures (click to filter)"]').first().innerText().catch(() => '')
  console.log('    street key numbers:', kp.replace(/\s+/g, ' ').slice(0, 300))
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }),
    page.locator('[aria-label="Download a report for Sathy Main Road"] button', { hasText: 'Excel' }).click()])
  await dl2.saveAs(join(OUT, `${MODE}-ui-${dl2.suggestedFilename()}`)); console.log('    downloaded', dl2.suggestedFilename())
  await browser.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
