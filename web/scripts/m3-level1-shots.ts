/** D62 live screenshots (dev server on :5173 for the dev-only hooks, API on :8000), 1366×768.
 *    npx tsx scripts/m3-level1-shots.ts [outDir]      MODE=daylight for Daylight
 *  Unnamed road between Bharathiar Road and Sankara Linganar Street:
 *  (w) #27 the small building in front of national hardwares' warehouse (ms_11.047238_76.969304);
 *  (c) #28 the compound-wall case (ms_11.047309_76.968961);
 *  (n) #30 a "can't tell" photo (ms_11.047564_76.969306), in the drawer and in Review (item 10597).
 *  Each step prints the orange box, the can't-tell line and the question. */
import { chromium, type Page } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

type Ui = { getState(): Record<string, unknown> }
const OUT = process.argv[2] ?? '../docs/screenshots/m3-level1'
const APP = process.env.APP_URL ?? 'http://localhost:5173/'
const MODE = process.env.MODE ?? 'night'
const AREA = 'unnamed_road_between_bharathiar_road_and_923057'
mkdirSync(OUT, { recursive: true })

const ui = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => { ((window as unknown as { __gcUi: Ui }).__gcUi.getState()[f as string] as (...x: unknown[]) => void)(...(a as unknown[])) }, [fn, args] as const)
const shot = async (page: Page, name: string) => { await page.screenshot({ path: join(OUT, `${MODE}-${name}.png`) }); console.log(`  ${MODE}-${name}.png`) }
const report = async (page: Page) => {
  const r = await page.evaluate(() => ({
    target: document.querySelectorAll('figure svg rect[fill="rgb(255 162 58 / 0.08)"]').length,
    cant: document.querySelector('[data-box-choice="cant_tell"]')?.textContent ?? null,
    q: [...document.querySelectorAll('h2, h3, p')].map((e) => e.textContent ?? '').find((t) => /orange box|can’t tell which box/i.test(t) && t.length < 200) ?? null,
  }))
  console.log(`    orange boxes: ${r.target} | line: ${r.cant ?? '(none)'} | question: ${r.q ?? '(none)'}`)
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  await ctx.addInitScript(([m, a]) => {
    try { localStorage.setItem('gc.tourSeen', '1'); localStorage.setItem('gc.mode', JSON.stringify(m)); localStorage.setItem('gc.area', JSON.stringify(a)); localStorage.setItem('gc.reviewer', JSON.stringify('m3 screenshots')) } catch { /* */ }
  }, [MODE, AREA])
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('page error:', e.message))
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!(window as unknown as { __gcUi?: unknown }).__gcUi && !!(window as unknown as { __gcMap?: unknown }).__gcMap, null, { timeout: 90_000 })
  await page.waitForTimeout(8000)
  for (const [tag, id] of [['w27-warehouse', 'ms_11.047238_76.969304'], ['c28-compound-wall', 'ms_11.047309_76.968961'], ['n30-cant-tell', 'ms_11.047564_76.969306']]) {
    console.log(`(${tag}) ${id}`)
    await ui(page, 'select', { kind: 'building', id }); await page.waitForTimeout(7000)
    await page.locator('figure').first().scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(800)
    await report(page); await shot(page, tag)
    await ui(page, 'select', null); await page.waitForTimeout(800)
  }
  console.log('(r) Review item 10597')
  await ui(page, 'sendToReview', { area: AREA, ids: [10597], label: 'can’t tell' }); await page.waitForTimeout(7000)
  await report(page); await shot(page, 'r30-review-cant-tell')
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
