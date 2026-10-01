/** Live screenshots of the changed screens (hotfix verification). Needs the dev server on :5173 (it exposes the map as
 *  window.__gcMap in dev builds) and the API on :8000.  npx tsx scripts/screenshots.ts [outDir]
 *  Captures: (a) city zoom with every analysed area, (b) the Analyse sheet while the estimate is computed, (c) the
 *  Analyse sheet with an estimate, (d) the Jobs page. Each step reports what it found on the page. */
import { chromium, type Page } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** the bits of the Google map the script touches (no @types/google.maps in the node scripts config) */
type GMap = { moveCamera(c: object): void; getDiv(): HTMLElement }

const OUT = process.argv[2] ?? '../docs/screenshots/hotfix'
const APP = process.env.APP_URL ?? 'http://localhost:5173/'
mkdirSync(OUT, { recursive: true })

const move = (page: Page, lat: number, lng: number, zoom: number) =>
  page.evaluate(([la, lo, z]) => {
    const m = (window as unknown as { __gcMap: GMap }).__gcMap
    m.moveCamera({ center: { lat: la, lng: lo }, zoom: z, tilt: 0, heading: 0 })
  }, [lat, lng, zoom] as const)

/** click the map at its centre (the camera was just centred on a street) */
async function clickMapCentre(page: Page) {
  const box = await page.evaluate(() => {
    const r = (window as unknown as { __gcMap: GMap }).__gcMap.getDiv().getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.mouse.click(box.x, box.y)
}

async function main() {
  const browser = await chromium.launch({ headless: process.env.HEADED !== '1', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  page.on('pageerror', (e) => console.log('page error:', e.message))
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!(window as unknown as { __gcMap?: unknown }).__gcMap, null, { timeout: 60_000 })
  await page.waitForTimeout(6000)

  // (a) city zoom: Ward 29, Sanganur Road and the two unnamed roads are a few hundred metres apart
  await move(page, 11.034, 76.976, 12.6)
  await page.waitForTimeout(5000)
  await page.screenshot({ path: join(OUT, 'a-city-zoom.png') })
  console.log('a: saved; map text badges drawn by the app:', await page.locator('canvas').count(), 'canvases')

  // (b) Analyse on an analysed street with no cost estimate yet (the 4th Street area's road): "Analyse anyway" -> estimating
  await page.getByRole('button', { name: /Analyse/ }).first().click()
  await move(page, 11.0365555, 76.9727400, 17.3)
  await page.waitForTimeout(2500)
  await clickMapCentre(page)
  await page.getByRole('button', { name: 'Analyse anyway' }).click({ timeout: 30_000 })
  await page.getByText('Estimating cost and time…').waitFor({ timeout: 20_000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(OUT, 'b-analyse-estimating.png') })
  console.log('b: saved;', await page.locator('[role=dialog]').innerText())

  // (c) a street whose estimate is already known (Sanganur Road, planned beforehand)
  await move(page, 11.03464795, 76.9694166, 17.3)
  await page.waitForTimeout(2500)
  await clickMapCentre(page)
  await page.getByRole('button', { name: 'Analyse anyway' }).click({ timeout: 30_000 })
  await page.getByText('Total ≈').waitFor({ timeout: 60_000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(OUT, 'c-analyse-estimate.png') })
  console.log('c: saved;', await page.locator('[role=dialog]').innerText())
  await page.keyboard.press('Escape')

  // (d) Jobs page
  await page.getByRole('button', { name: /Jobs/ }).first().click()
  await page.waitForTimeout(3000)
  await page.screenshot({ path: join(OUT, 'd-jobs.png') })
  console.log('d: saved')
  await browser.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
