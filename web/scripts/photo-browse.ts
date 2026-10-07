/** D60: the same Ward 29 click path before and after the photo fallback, counting every Street View Static photo request
 *  the browser makes and how many fail (dev server on :5173 for the dev-only hooks, API on :8000), 1366×768.
 *    npx tsx scripts/photo-browse.ts [label]
 *  Path (fixed, ids sorted): 14 buildings on 2nd Street, Gandhi Nagar + hitech gears (Sathy Main Road), each drawer's
 *  photos one by one (Front / Sign / … buttons); 8 Sathy Main Road poles / lights; 3 businesses with no building; then
 *  Review, the first 8 items (J). Prints requests, failures (HTTP status ≠ 200 or network error) and the failing panoramas. */
import { chromium, type Page } from 'playwright'

type Ui = { getState(): Record<string, unknown> }
const APP = process.env.APP_URL ?? 'http://localhost:5173/'
const API = process.env.API_URL ?? 'http://127.0.0.1:8000'
const LABEL = process.argv[2] ?? 'run'

const ui = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => { ((window as unknown as { __gcUi: Ui }).__gcUi.getState()[f as string] as (...x: unknown[]) => void)(...(a as unknown[])) }, [fn, args] as const)

async function main() {
  const ex = await (await fetch(`${API}/areas/ward29/buildings?street=${encodeURIComponent('2nd Street, Gandhi Nagar')}&page_size=500`)).json()
  const bids: string[] = (ex.rows ?? ex.items ?? []).map((r: { id: string }) => r.id).sort().slice(0, 14)
  bids.push('w1252503923')
  const as = await (await fetch(`${API}/areas/ward29/assets?street=${encodeURIComponent('Sathy Main Road')}&page_size=500`)).json()
  const assets: { id: string; type: string }[] = (as.rows ?? as.items ?? []).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)).slice(0, 8)
  const geo = await (await fetch(`${API}/areas/ward29/geojson?layers=unmapped`)).json()
  const unm: string[] = geo.features.map((f: { properties: { id: string } }) => f.properties.id).sort().slice(0, 3)

  const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  await ctx.addInitScript(() => {
    try { localStorage.setItem('gc.tourSeen', '1'); localStorage.setItem('gc.area', JSON.stringify('ward29')) } catch { /* */ }
  })
  const page = await ctx.newPage()
  const reqs: { url: string; status: number | string }[] = []
  page.on('response', (r) => { if (r.url().includes('/maps/api/streetview?')) reqs.push({ url: r.url(), status: r.status() }) })
  page.on('requestfailed', (r) => { if (r.url().includes('/maps/api/streetview?')) reqs.push({ url: r.url(), status: r.failure()?.errorText ?? 'failed' }) })
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!(window as unknown as { __gcUi?: unknown }).__gcUi, null, { timeout: 90_000 })
  await page.waitForTimeout(6000)

  const views = async () => {
    // every photo of the open drawer: the view buttons next to the date badge (Front / Sign / Camera 2 …)
    const btns = page.locator('button[aria-pressed]').filter({ hasText: /^(Front|Sign|Best photo|Nearest camera|Camera \d+.*)$/ })
    const n = await btns.count()
    for (let k = 1; k < n; k++) { await btns.nth(k).click().catch(() => {}); await page.waitForTimeout(1800) }
  }
  for (const id of bids) { await ui(page, 'select', { kind: 'building', id }); await page.waitForTimeout(2500); await views() }
  for (const a of assets) { await ui(page, 'select', { kind: a.type, id: a.id }); await page.waitForTimeout(2500); await views() }
  for (const id of unm) { await ui(page, 'select', { kind: 'unmapped_business', id }); await page.waitForTimeout(2500) }
  await ui(page, 'select', null)
  await ui(page, 'go', 'review'); await page.waitForTimeout(5000)
  for (let k = 0; k < 8; k++) { await page.keyboard.press('j'); await page.waitForTimeout(2200) }
  await page.waitForTimeout(2000)
  await browser.close()

  const bad = reqs.filter((r) => r.status !== 200)
  const pano = (u: string) => new URL(u).searchParams.get('pano')
  console.log(`[${LABEL}] path: ${bids.length} buildings, ${assets.length} poles/lights, ${unm.length} businesses, 8 Review items`)
  console.log(`[${LABEL}] Street View photo requests: ${reqs.length}, failed: ${bad.length} (${reqs.length ? Math.round((100 * bad.length) / reqs.length) : 0}%)`)
  const by = new Map<string, number>()
  for (const r of bad) by.set(`${r.status} ${pano(r.url)}`, (by.get(`${r.status} ${pano(r.url)}`) ?? 0) + 1)
  for (const [k, n] of by) console.log(`  ${k} ×${n}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
