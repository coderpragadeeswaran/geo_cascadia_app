/** D60 live screenshots (dev server on :5173 for the dev-only hooks, API on :8000), 1366×768.
 *    npx tsx scripts/photo-fallback-shots.ts [outDir]      MODE=daylight for Daylight · ONLY=t,w,a,u,r,d,h · TAG=before|after
 *  (t) transport india pvt ltd (w1236978849, 2nd Street, Gandhi Nagar): Google no longer serves its panorama — Front and Sign;
 *  (w) hitech gears (w1252503923, Sathy Main Road): its photo still loads, boxes unchanged;
 *  (a) a pole on a gone panorama (asset-0001, 2nd Street, Gandhi Nagar); (u) a business sign on one (ub-0000, Sathy Main Road);
 *  (r) Review on transport india; (d) Drive 2nd Street, Gandhi Nagar at a gone stop (stop 2);
 *  (h) Under the Hood (Ward 29): the photo data note and the cost lines.
 *  Each step prints the note under the photo (data-photo-swap) and whether boxes are drawn. */
import { chromium, type Page } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

type Ui = { getState(): Record<string, unknown> }
const OUT = process.argv[2] ?? '../docs/screenshots/photo-fallback'
const APP = process.env.APP_URL ?? 'http://localhost:5173/'
const API = process.env.API_URL ?? 'http://127.0.0.1:8000'
const MODE = process.env.MODE ?? 'night'
const TAG = process.env.TAG ?? 'after'
const ONLY = (process.env.ONLY ?? 't,w,a,u,r,d,h').split(',')
mkdirSync(OUT, { recursive: true })

const ui = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => { ((window as unknown as { __gcUi: Ui }).__gcUi.getState()[f as string] as (...x: unknown[]) => void)(...(a as unknown[])) }, [fn, args] as const)
const shot = async (page: Page, name: string) => { await page.screenshot({ path: join(OUT, `${TAG}-${MODE}-${name}.png`) }); console.log(`  ${TAG}-${MODE}-${name}.png`) }
const report = async (page: Page) => {
  const r = await page.evaluate(() => ({
    note: document.querySelector('[data-photo-swap]')?.textContent ?? null,
    boxes: document.querySelectorAll('figure svg rect').length,
    gone: [...document.querySelectorAll('figure')].some((f) => /No Street View (photo|image)/.test(f.textContent ?? '')),
    badge: [...document.querySelectorAll('.tag')].map((t) => t.textContent).find((t) => t?.startsWith('Photo from')) ?? null,
  }))
  console.log(`    note: ${r.note ?? '(none)'} | box rects: ${r.boxes} | "no image" text: ${r.gone} | badge: ${r.badge}`)
}
const view = async (page: Page, name: string) => {
  const b = page.locator('button[aria-pressed]').filter({ hasText: new RegExp(`^${name}$`) }).first()
  if (await b.count()) { await b.click(); await page.waitForTimeout(3500) }
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  await ctx.addInitScript((m) => {
    try { localStorage.setItem('gc.tourSeen', '1'); localStorage.setItem('gc.mode', JSON.stringify(m)); localStorage.setItem('gc.area', JSON.stringify('ward29')); localStorage.setItem('gc.reviewer', JSON.stringify('photo-fallback check')) } catch { /* */ }
  }, MODE)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('page error:', e.message))
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!(window as unknown as { __gcUi?: unknown }).__gcUi && !!(window as unknown as { __gcMap?: unknown }).__gcMap, null, { timeout: 90_000 })
  await page.waitForTimeout(8000)

  const drawer = async (tag: string, sel: { kind: string; id: string }, extra?: string) => {
    console.log(`(${tag}) ${sel.kind} ${sel.id}`)
    await ui(page, 'select', sel); await page.waitForTimeout(7000)
    await report(page); await shot(page, `${tag}-${sel.id}`)
    if (extra) { await view(page, extra); await report(page); await shot(page, `${tag}-${sel.id}-${extra.toLowerCase()}`) }
    await ui(page, 'select', null); await page.waitForTimeout(800)
  }
  if (ONLY.includes('t')) await drawer('t', { kind: 'building', id: 'w1236978849' }, 'Sign')
  if (ONLY.includes('w')) await drawer('w', { kind: 'building', id: 'w1252503923' })
  if (ONLY.includes('a')) await drawer('a', { kind: 'pole', id: 'asset-0001' })
  if (ONLY.includes('u')) await drawer('u', { kind: 'unmapped_business', id: 'ub-0000' })
  if (ONLY.includes('r')) {
    console.log('(r) Review: transport india')
    const rows = (await (await fetch(`${API}/review?area=ward29&page_size=1000`)).json()).rows as { id: number; ref_id: string }[]
    const id = rows.find((r) => r.ref_id === 'w1236978849')?.id
    if (id != null) {
      await ui(page, 'sendToReview', { area: 'ward29', ids: [id], label: 'transport india' }); await page.waitForTimeout(7000)
      await report(page); await shot(page, 'r-review-w1236978849')
      await ui(page, 'go', 'explore'); await page.waitForTimeout(1500)
    }
  }
  if (ONLY.includes('d')) {
    console.log('(d) Drive 2nd Street, Gandhi Nagar, stop 2')
    await ui(page, 'setDrive', { street: '2nd Street, Gandhi Nagar', branch: 0, i: 1, view: 'forward' }); await page.waitForTimeout(7000)
    await shot(page, 'd-drive-gone-stop')
    await ui(page, 'setDrive', null); await page.waitForTimeout(1000)
  }
  if (ONLY.includes('h')) {
    console.log('(h) Under the Hood, Ward 29')
    await ui(page, 'go', 'hood'); await page.waitForTimeout(6000)
    const note = page.locator('[aria-label="Photos Google still serves"]').first()
    console.log('    data note:', await note.innerText().catch(() => '(not found)'))
    await note.scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(800); await shot(page, 'h1-photo-note')
    const cost = page.locator('[aria-label="Cost of this run"]').first()
    console.log('    cost lines:', (await cost.innerText().catch(() => '(not found)')).replace(/\n/g, ' | '))
    await cost.scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(800); await shot(page, 'h2-routing-cost')
    const tc = page.locator('#cost').first()
    console.log('    time and cost:', (await tc.innerText().catch(() => '(not found)')).replace(/\n/g, ' | '))
    await tc.scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(800); await shot(page, 'h3-time-and-cost')
  }
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
