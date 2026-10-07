/** D61 live screenshots (dev server on :5173 for the dev-only hooks, API on :8000), 1366×768.
 *    npx tsx scripts/box-restore-shots.ts [outDir]      MODE=daylight for Daylight · ONLY=t,x,w,h · TAG=before|after
 *  (t) transport india pvt ltd (w1236978849, 2nd Street, Gandhi Nagar): retired panorama — Front and Sign;
 *  (x) w1236978077: its panorama is one of the 3 that passed the spot-check alone; the area gate failed, so no boxes;
 *  (w) hitech gears (w1252503923, Sathy Main Road): still served; the "sign boxes" line;
 *  (h) Under the Hood (Ward 29): the photo data note.
 *  Each step prints the note under the photo, the drawer's sign line and whether boxes are drawn. */
import { chromium, type Page } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

type Ui = { getState(): Record<string, unknown> }
const OUT = process.argv[2] ?? '../docs/screenshots/box-restore'
const APP = process.env.APP_URL ?? 'http://localhost:5173/'
const MODE = process.env.MODE ?? 'night'
const TAG = process.env.TAG ?? 'after'
const ONLY = (process.env.ONLY ?? 't,x,w,h').split(',')
mkdirSync(OUT, { recursive: true })

const ui = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => { ((window as unknown as { __gcUi: Ui }).__gcUi.getState()[f as string] as (...x: unknown[]) => void)(...(a as unknown[])) }, [fn, args] as const)
const shot = async (page: Page, name: string) => { await page.screenshot({ path: join(OUT, `${TAG}-${MODE}-${name}.png`) }); console.log(`  ${TAG}-${MODE}-${name}.png`) }
const report = async (page: Page) => {
  const r = await page.evaluate(() => ({
    note: document.querySelector('[data-photo-swap]')?.textContent ?? null,
    boxes: document.querySelectorAll('figure svg rect').length,
    signs: [...document.querySelectorAll('p')].map((p) => p.textContent ?? '').find((t) => /^1 building · /.test(t)) ?? null,
    img: (document.querySelector('figure img') as HTMLImageElement | null)?.src.replace(/key=[^&]+/, 'key=…').replace(/^.*\?/, '') ?? null,
  }))
  console.log(`    note: ${r.note ?? '(none)'}\n    box rects: ${r.boxes} | sign line: ${r.signs ?? '(none)'}\n    photo: ${r.img}`)
}
const view = async (page: Page, name: string) => {
  const b = page.locator('button[aria-pressed]').filter({ hasText: new RegExp(`^${name}$`) }).first()
  if (await b.count()) { await b.click(); await page.waitForTimeout(3500) }
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  await ctx.addInitScript((m) => {
    try { localStorage.setItem('gc.tourSeen', '1'); localStorage.setItem('gc.mode', JSON.stringify(m)); localStorage.setItem('gc.area', JSON.stringify('ward29')) } catch { /* */ }
  }, MODE)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('page error:', e.message))
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!(window as unknown as { __gcUi?: unknown }).__gcUi && !!(window as unknown as { __gcMap?: unknown }).__gcMap, null, { timeout: 90_000 })
  await page.waitForTimeout(8000)

  const drawer = async (tag: string, sel: { kind: string; id: string }, extra?: string) => {
    console.log(`(${tag}) ${sel.kind} ${sel.id}`)
    await ui(page, 'select', sel); await page.waitForTimeout(7000)
    const photo = async () => { await page.locator('figure').first().scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(800) }
    await photo(); await report(page); await shot(page, `${tag}-${sel.id}`)
    if (extra) { await view(page, extra); await photo(); await report(page); await shot(page, `${tag}-${sel.id}-${extra.toLowerCase()}`) }
    await ui(page, 'select', null); await page.waitForTimeout(800)
  }
  if (ONLY.includes('t')) await drawer('t', { kind: 'building', id: 'w1236978849' }, 'Sign')
  if (ONLY.includes('x')) await drawer('x', { kind: 'building', id: 'w1236978077' })
  if (ONLY.includes('w')) await drawer('w', { kind: 'building', id: 'w1252503923' })
  if (ONLY.includes('h')) {
    console.log('(h) Under the Hood, Ward 29')
    await ui(page, 'go', 'hood'); await page.waitForTimeout(6000)
    const note = page.locator('[aria-label="Photos Google still serves"]').first()
    console.log('    data note:', await note.innerText().catch(() => '(not found)'))
    await note.scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(800); await shot(page, 'h-photo-note')
  }
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
