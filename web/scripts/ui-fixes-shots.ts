/** ui-fixes live screenshots (dev server on :5173 for the dev-only hooks, API on :8000).  npx tsx scripts/ui-fixes-shots.ts [outDir]
 *  (a) 8th Street, Ganapathy selected: its Medium possible dark stretch on top of the street highlight, area and street zoom;
 *  (b) Sathy Main Road's two stretches in the dark-stretch list, then each card clicked (only that stretch highlighted,
 *  map framed on it), then the other stretch clicked ON THE MAP (its card selected), then cleared;
 *  (c) Analyse on Rathinapuri (Sanganoor) Main Road: the clicked piece only, then "include it?" switched on.
 *  Each step prints the text it checked. MODE=daylight for Daylight; ONLY=a,b,c picks steps. */
import { chromium, type Page } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

type Ui = { getState(): Record<string, unknown> }
type GMap = {
  setZoom(z: number): void; setCenter(c: { lat: number; lng: number }): void; moveCamera(c: object): void; getDiv(): HTMLElement
  getZoom(): number; getBounds(): { getNorthEast(): { lat(): number; lng(): number }; getSouthWest(): { lat(): number; lng(): number } }
}
const OUT = process.argv[2] ?? '../docs/screenshots/ui-fixes'
const APP = process.env.APP_URL ?? 'http://localhost:5173/'
const MODE = process.env.MODE ?? 'night'
const ONLY = (process.env.ONLY ?? 'a,b,c').split(',')
mkdirSync(OUT, { recursive: true })

const ui = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => { ((window as unknown as { __gcUi: Ui }).__gcUi.getState()[f as string] as (...x: unknown[]) => void)(...(a as unknown[])) }, [fn, args] as const)
const uiGet = (page: Page, expr: string) =>
  page.evaluate((e) => { const s = (window as unknown as { __gcUi: Ui }).__gcUi.getState() as Record<string, unknown>; return new Function('s', `return ${e}`)(s) }, expr)
const view = (page: Page, lat: number, lng: number, z: number) =>
  page.evaluate(([la, lo, zz]) => { (window as unknown as { __gcMap: GMap }).__gcMap.moveCamera({ center: { lat: la, lng: lo }, zoom: zz, tilt: 0, heading: 0 }) }, [lat, lng, z] as const)
const camera = (page: Page) => page.evaluate(() => {
  const m = (window as unknown as { __gcMap: GMap }).__gcMap; const b = m.getBounds()
  return { zoom: +m.getZoom().toFixed(2), ne: [+b.getNorthEast().lat().toFixed(5), +b.getNorthEast().lng().toFixed(5)], sw: [+b.getSouthWest().lat().toFixed(5), +b.getSouthWest().lng().toFixed(5)] }
})
/** screen pixel of a lat/lon on the main map (Mercator over the map div's bounds; tilt 0) */
const pixelOf = (page: Page, lat: number, lng: number) => page.evaluate(([la, lo]) => {
  const m = (window as unknown as { __gcMap: GMap }).__gcMap; const b = m.getBounds(); const r = m.getDiv().getBoundingClientRect()
  const ne = b.getNorthEast(), sw = b.getSouthWest()
  const yN = Math.log(Math.tan(Math.PI / 4 + (ne.lat() * Math.PI) / 360)), yS = Math.log(Math.tan(Math.PI / 4 + (sw.lat() * Math.PI) / 360))
  const yP = Math.log(Math.tan(Math.PI / 4 + (la * Math.PI) / 360))
  return { x: r.left + ((lo - sw.lng()) / (ne.lng() - sw.lng())) * r.width, y: r.top + ((yN - yP) / (yN - yS)) * r.height }
}, [lat, lng] as const)
const shot = async (page: Page, name: string) => { await page.screenshot({ path: join(OUT, `${MODE}-${name}.png`) }); console.log(`${name}: saved`) }
const text = async (page: Page, sel: string) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ')
const selectedId = (page: Page) => uiGet(page, 's.selected ? s.selected.id : null')

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  await ctx.addInitScript((m) => { try { localStorage.setItem('gc.tourSeen', '1'); localStorage.setItem('gc.mode', JSON.stringify(m)); localStorage.setItem('gc.area', JSON.stringify('ward29')) } catch { /* */ } }, MODE)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('page error:', e.message))
  page.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text().slice(0, 200)) })
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!(window as unknown as { __gcUi?: unknown }).__gcUi && !!(window as unknown as { __gcMap?: unknown }).__gcMap, null, { timeout: 90_000 })
  await page.waitForTimeout(8000)

  if (ONLY.includes('a')) {
    // (a) 8th Street, Ganapathy selected (gap60-003, Medium, 313 m)
    await ui(page, 'selectStreet', '8th Street, Ganapathy'); await page.waitForTimeout(3000)
    await view(page, 11.0314, 76.9730, 16.2); await page.waitForTimeout(4000)
    await shot(page, 'a1-8th-street-selected-area-zoom')
    await view(page, 11.0314, 76.9730, 17.6); await page.waitForTimeout(5000)
    await shot(page, 'a2-8th-street-selected-street-zoom')
    await ui(page, 'selectStreet', null); await page.waitForTimeout(1000)
    // no selection: the whole ward at area zoom, every priority
    await view(page, 11.0335, 76.9780, 15.6); await page.waitForTimeout(4000)
    await shot(page, 'a3-all-stretches-area-zoom')
    await page.locator('button', { hasText: /^\s*Key\s*$/ }).first().click().catch(() => console.log('   (no Key button)'))
    await page.waitForTimeout(800)
    await shot(page, 'a4-key')
    console.log('    key:', (await text(page, '[aria-label="Map key"]').catch(() => '(not found)')).slice(0, 400))
    await page.locator('button', { hasText: /^\s*Key\s*$/ }).first().click().catch(() => {})   // close the key again
    await page.waitForTimeout(500)
  }

  if (ONLY.includes('b')) {
    // (b) the dark-stretch list for Sathy Main Road
    await page.getByRole('button', { name: /Possible dark stretches/ }).first().click(); await page.waitForTimeout(2500)
    await ui(page, 'selectStreet', 'Sathy Main Road'); await page.waitForTimeout(4000)
    await shot(page, 'b0-sathy-list')
    const list = page.locator('ol[aria-label="Possible dark stretches"] li > button')
    console.log('    list:', (await text(page, 'ol[aria-label="Possible dark stretches"]')).slice(0, 300))
    for (const [i, id] of [[0, 'gap60-001'], [1, 'gap60-002']] as const) {
      await list.nth(i).click(); await page.waitForTimeout(4500)
      console.log(`    card ${i + 1} clicked → selected ${await selectedId(page)} (expect ${id}); camera`, JSON.stringify(await camera(page)))
      await shot(page, `b${i + 1}-sathy-${id}-clicked`)
    }
    // click the OTHER stretch (gap60-001) on the map: its card must be the selected one
    await view(page, 11.0335, 76.9775, 16.4); await page.waitForTimeout(4000)
    // a vertex in the middle of gap60-001's drawn path (the API's own geometry), so the click lands on the band
    const [mlon, mlat] = await page.evaluate(async () => {
      const g = await (await fetch('http://127.0.0.1:8000/areas/ward29/geojson?layers=gaps')).json()
      const c = g.features.find((f: { properties: { id: string } }) => f.properties.id === 'gap60-001').geometry.coordinates
      return c[Math.floor(c.length / 2)]
    })
    const mid = await pixelOf(page, mlat, mlon)
    await page.mouse.click(mid.x, mid.y); await page.waitForTimeout(2500)
    console.log('    map click on gap60-001 → selected', await selectedId(page))
    await shot(page, 'b3-sathy-gap60-001-map-click')
    const onCard = await page.locator('ol[aria-label="Possible dark stretches"] li[aria-current="true"]').first().innerText().catch(() => '(no current card)')
    console.log('    current card:', onCard.replace(/\s+/g, ' ').slice(0, 120))
    // the same card again clears it
    await page.locator('ol[aria-label="Possible dark stretches"] li[aria-current="true"] > button').first().click().catch(() => console.log('    (no current card to click)'))
    await page.waitForTimeout(1500)
    console.log('    clicked again → selected', await selectedId(page))
    await shot(page, 'b4-sathy-cleared')
    // Esc clears a selected stretch and keeps the list
    await list.nth(1).click(); await page.waitForTimeout(3000)
    await page.keyboard.press('Escape'); await page.waitForTimeout(1200)
    console.log('    Esc → selected', await selectedId(page), '· list still open:', await page.locator('ol[aria-label="Possible dark stretches"]').count() === 1)
    await page.keyboard.press('Escape'); await page.waitForTimeout(500)
    await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  }

  if (ONLY.includes('c')) {
    // (c) Analyse: Rathinapuri (Sanganoor) Main Road, the eastern piece (the analysed area is ignored with "Analyse anyway")
    await page.getByRole('button', { name: /Analyse/ }).first().click(); await page.waitForTimeout(1000)
    const [lat, lng] = (process.env.RATHI ?? '11.035838810963222,76.96165158517604').split(',').map(Number)
    await view(page, lat, lng, 17.2); await page.waitForTimeout(2500)
    const p = await pixelOf(page, lat, lng)
    await page.mouse.click(p.x, p.y)
    await page.getByRole('button', { name: 'Analyse anyway' }).click({ timeout: 30_000 }).catch(() => console.log('    (no "Analyse anyway")'))
    await page.getByText(/Total ≈|No estimate/).first().waitFor({ timeout: 120_000 }).catch(() => console.log('    (estimate still running)'))
    await page.waitForTimeout(1500)
    await shot(page, 'c1-rathinapuri-clicked-piece')
    console.log('    handles:', await page.locator('.trim-handle').count())
    console.log('    sheet:', (await text(page, '[role=dialog]')).slice(0, 500))
    const toggle = page.getByRole('switch', { name: /continues elsewhere/ })
    if (await toggle.count()) {
      await toggle.click(); await page.waitForTimeout(2500)
      await page.getByText('updating…').first().waitFor({ state: 'detached', timeout: 120_000 }).catch(() => console.log('    (estimate still updating)'))
      await page.waitForTimeout(2500)
      await shot(page, 'c2-rathinapuri-both-pieces')
      console.log('    handles:', await page.locator('.trim-handle').count())
      console.log('    sheet:', (await text(page, '[role=dialog]')).slice(0, 500))
      // off again: back to the clicked piece, handles back
      await toggle.click(); await page.waitForTimeout(3000)
      console.log('    switched off → handles:', await page.locator('.trim-handle').count(), '·', (await text(page, '[role=dialog]')).slice(0, 120))
    } else console.log('    (no "continues elsewhere" switch)')
  }
  await browser.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
