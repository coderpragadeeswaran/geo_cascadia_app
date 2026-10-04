/** extras live screenshots (dev server on :5173 for the dev-only hooks, API on :8000).  npx tsx scripts/extras-shots.ts [outDir]
 *  f4: Analyse — a street that continues outside its analysed area (Ward 29's Sakthi Main Road, Sathy Main Road near the
 *      ward edge) and Rathinapuri (the continuation measured on OpenStreetMap: 222 m);
 *  rep: the report buttons (PDF · Excel · GeoJSON · Shapefile) and real downloads of the two GIS files;
 *  q: "Businesses not in OpenStreetMap" and "OpenStreetMap shops not seen by the camera" (list + square map tags);
 *  d: the building drawer — floor confidence and OpenStreetMap's levels (w1247745270), a Medium and a Low count;
 *  h / t: Under the Hood › Businesses vs OpenStreetMap + Whole-city projection; Trust › OpenStreetMap cross-checks.
 *  Each step prints the text it checked. MODE=daylight for Daylight; ONLY=f4,rep,q,d,h,t picks steps. Reads only (no job,
 *  no review decision). */
import { chromium, type Page } from 'playwright'
import { mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

type Ui = { getState(): Record<string, unknown> }
type GMap = { moveCamera(c: object): void; getDiv(): HTMLElement
  getBounds(): { getNorthEast(): { lat(): number; lng(): number }; getSouthWest(): { lat(): number; lng(): number } } }
const OUT = process.argv[2] ?? '../docs/screenshots/extras'
const APP = process.env.APP_URL ?? 'http://localhost:5173/'
const MODE = process.env.MODE ?? 'night'
const ONLY = (process.env.ONLY ?? 'f4,rep,q,d,h,t').split(',')
mkdirSync(OUT, { recursive: true })

const ui = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => { ((window as unknown as { __gcUi: Ui }).__gcUi.getState()[f as string] as (...x: unknown[]) => void)(...(a as unknown[])) }, [fn, args] as const)
const view = (page: Page, lat: number, lng: number, z: number) =>
  page.evaluate(([la, lo, zz]) => { (window as unknown as { __gcMap: GMap }).__gcMap.moveCamera({ center: { lat: la, lng: lo }, zoom: zz, tilt: 0, heading: 0 }) }, [lat, lng, z] as const)
const pixelOf = (page: Page, lat: number, lng: number) => page.evaluate(([la, lo]) => {
  const m = (window as unknown as { __gcMap: GMap }).__gcMap; const b = m.getBounds(); const r = m.getDiv().getBoundingClientRect()
  const ne = b.getNorthEast(), sw = b.getSouthWest()
  const yN = Math.log(Math.tan(Math.PI / 4 + (ne.lat() * Math.PI) / 360)), yS = Math.log(Math.tan(Math.PI / 4 + (sw.lat() * Math.PI) / 360))
  const yP = Math.log(Math.tan(Math.PI / 4 + (la * Math.PI) / 360))
  return { x: r.left + ((lo - sw.lng()) / (ne.lng() - sw.lng())) * r.width, y: r.top + ((yN - yP) / (yN - yS)) * r.height }
}, [lat, lng] as const)
const shot = async (page: Page, name: string) => { await page.screenshot({ path: join(OUT, `${MODE}-${name}.png`) }); console.log(`${name}: saved`) }
const text = async (page: Page, sel: string) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ')

async function analyse(page: Page, name: string, lat: number, lng: number, anyway: boolean) {
  await view(page, lat, lng, 17.2); await page.waitForTimeout(2500)
  const p = await pixelOf(page, lat, lng)
  await page.mouse.click(p.x, p.y)
  if (anyway) await page.getByRole('button', { name: 'Analyse anyway' }).click({ timeout: 30_000 }).catch(() => console.log('    (no "Analyse anyway")'))
  await page.locator('[role=dialog][aria-label="Confirm analysis"]').waitFor({ timeout: 60_000 }).catch(() => console.log('    (no confirm sheet)'))
  await page.waitForTimeout(3000)
  await shot(page, name)
  console.log('    sheet:', (await text(page, '[role=dialog][aria-label="Confirm analysis"]').catch(() => '(none)')).slice(0, 420))
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true })
  await ctx.addInitScript((m) => { try { localStorage.setItem('gc.tourSeen', '1'); localStorage.setItem('gc.mode', JSON.stringify(m)); localStorage.setItem('gc.area', JSON.stringify('ward29')) } catch { /* */ } }, MODE)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('page error:', e.message))
  page.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text().slice(0, 200)) })
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!(window as unknown as { __gcUi?: unknown }).__gcUi && !!(window as unknown as { __gcMap?: unknown }).__gcMap, null, { timeout: 90_000 })
  await page.waitForTimeout(8000)

  if (ONLY.includes('f4')) {
    await ui(page, 'setFlat', true); await page.waitForTimeout(1500)          // 2D: a screen pixel maps straight to lat / lon
    await page.getByRole('button', { name: /Analyse/ }).first().click(); await page.waitForTimeout(1000)
    await analyse(page, 'f4a-sakthi-continues-outside-ward29', 11.036285724069106, 76.97843636059058, true)
    await page.getByRole('button', { name: 'Pick another street' }).click().catch(() => {}); await page.waitForTimeout(800)
    await analyse(page, 'f4b-sathy-near-ward-edge', 11.029686090854295, 76.97536551065456, true)
    await page.getByRole('button', { name: 'Pick another street' }).click().catch(() => {}); await page.waitForTimeout(800)
    await analyse(page, 'f4c-rathinapuri-osm-222m', 11.035838810963222, 76.96165158517604, true)
    const sw = page.getByRole('switch', { name: /continues/ })
    if (await sw.count()) {
      await sw.click(); await page.waitForTimeout(5000)
      await shot(page, 'f4d-rathinapuri-included')
      console.log('    included:', (await text(page, '[role=dialog][aria-label="Confirm analysis"]')).slice(0, 200))
    }
    await page.keyboard.press('Escape'); await page.waitForTimeout(800)
    await page.keyboard.press('Escape'); await page.waitForTimeout(800)
    await ui(page, 'setFlat', false); await page.waitForTimeout(800)
  }

  if (ONLY.includes('rep')) {
    await view(page, 11.0335, 76.9780, 15.4); await page.waitForTimeout(2000)
    await page.getByRole('button', { name: 'What stands out' }).click(); await page.waitForTimeout(2500)
    const box = page.locator('[aria-label="Download a report for this area"]')
    await box.scrollIntoViewIfNeeded()
    await shot(page, 'rep1-report-buttons')
    console.log('    buttons:', await text(page, '[aria-label="Download a report for this area"]'))
    for (const label of ['GeoJSON', 'Shapefile']) {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), box.getByRole('button', { name: label }).click()])
      const path = join(OUT, `${MODE}-download-${dl.suggestedFilename()}`)
      await dl.saveAs(path)
      console.log(`    ${label}: ${dl.suggestedFilename()} (${statSync(path).size} bytes)`)
    }
    await page.keyboard.press('Escape'); await page.waitForTimeout(600)
  }

  if (ONLY.includes('q')) {
    for (const [i, qText] of ['Businesses not in OpenStreetMap', 'OpenStreetMap shops not seen by the camera'].entries()) {
      await ui(page, 'setQuery', null)
      const ask = page.getByLabel('Ask a question about this area')
      await ask.click(); await ask.fill(qText); await ask.press('Enter')
      await page.locator('[aria-label="Query result"]').getByText(/business/i).first().waitFor({ timeout: 60_000 }).catch(() => {})
      await view(page, 11.0335, 76.9780, i ? 16.4 : 15.6); await page.waitForTimeout(4000)
      await shot(page, `q${i + 1}-${i ? 'osm-only' : 'not-in-osm'}`)
      console.log('    answer:', (await text(page, '[aria-label="Query result"]')).slice(0, 360))
    }
    await page.keyboard.press('Escape'); await page.waitForTimeout(600)
    await ui(page, 'setQuery', null); await page.waitForTimeout(500)
  }

  if (ONLY.includes('d')) {
    for (const [id, note] of [['w1247745270', 'osm-levels'], ['w1251626330', 'medium'], ['w1252504103', 'low']] as const) {
      await ui(page, 'select', { kind: 'building', id }); await page.waitForTimeout(6000)
      const row = page.locator('[aria-label="Floor-count confidence"]').first()
      await row.scrollIntoViewIfNeeded().catch(() => {})
      await page.waitForTimeout(800)
      await shot(page, `d-${id}-${note}`)
      console.log(`    ${id}:`, (await row.innerText().catch(() => '(no confidence line)')).replace(/\s+/g, ' '))
    }
    await ui(page, 'select', null); await page.waitForTimeout(800)
  }

  if (ONLY.includes('h')) {
    await page.getByRole('button', { name: 'Under the hood', exact: true }).click(); await page.waitForTimeout(7000)
    for (const id of ['osm', 'projection']) {
      await page.evaluate((x) => document.getElementById(x)?.scrollIntoView({ block: 'start' }), id); await page.waitForTimeout(2500)
      await shot(page, `h-${id}`)
      console.log(`    hood ${id}:`, (await text(page, `#${id}`)).slice(0, 420))
    }
  }
  if (ONLY.includes('t')) {
    await page.getByRole('button', { name: 'Trust', exact: true }).click(); await page.waitForTimeout(5000)
    await page.evaluate(() => document.getElementById('osm')?.scrollIntoView({ block: 'start' })); await page.waitForTimeout(2500)
    await shot(page, 't-osm')
    console.log('    trust osm:', (await text(page, '#osm')).slice(0, 420))
  }
  await browser.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
