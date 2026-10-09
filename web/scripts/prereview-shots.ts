/** D65 screenshots (production build or dev server; APP_URL for the live site), 1366x768, both themes:
 *  Explore (the "+ N seen only by camera" line), Under the Hood > Routing and cost (measured comparison + time per item),
 *  Trust > Cost (the cost panel from this run) and Trust > Building position (pole circles). Prints what each shows.
 *    npx tsx scripts/prereview-shots.ts [outDir]          APP_URL=http://65.1.253.18/ for the live site */
import { chromium, type Page } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT = process.argv[2] ?? '../docs/screenshots/prereview'
const APP = process.env.APP_URL ?? 'http://localhost:5173/'
mkdirSync(OUT, { recursive: true })
const shot = (page: Page, mode: string, name: string) => page.screenshot({ path: join(OUT, `${mode}-${name}.png`) })

async function section(page: Page, hash: string, text: string, mode: string, name: string) {
  await page.goto(APP + hash, { waitUntil: 'domcontentloaded' })
  const el = page.getByText(text, { exact: false }).first()
  await el.waitFor({ timeout: 90_000 })
  await page.waitForTimeout(2500)
  await el.scrollIntoViewIfNeeded()
  await page.waitForTimeout(800)
  await shot(page, mode, name)
  return el
}

async function run(mode: 'night' | 'daylight') {
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  await ctx.addInitScript((m) => {
    localStorage.setItem('gc.mode', JSON.stringify(m)); localStorage.setItem('gc.tourSeen', '1'); localStorage.setItem('gc.area', JSON.stringify('ward29'))
  }, mode)
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  const ribbon = page.locator('[aria-label="Key figures (click to filter)"]')
  await ribbon.getByText('Buildings checked', { exact: false }).waitFor({ timeout: 90_000 })
  await page.waitForTimeout(5000)
  console.log(`  [${mode}] Explore: ${(await ribbon.innerText()).replace(/\s+/g, ' ').slice(0, 120)}`)
  await shot(page, mode, 'explore')
  await section(page, '#/hood/routing', 'measured, n = 30', mode, 'hood-measured')
  console.log(`  [${mode}] Hood: ${(await page.locator('[aria-label="Measured comparison"]').innerText()).replace(/\s+/g, ' ').slice(0, 260)}`)
  await page.locator('[aria-label="Time per item"]').scrollIntoViewIfNeeded(); await page.waitForTimeout(600)
  await shot(page, mode, 'hood-latency')
  await section(page, '#/trust/cost', 'seconds per building', mode, 'trust-cost')
  await page.locator('[aria-label="Time per item by route"]').scrollIntoViewIfNeeded(); await page.waitForTimeout(600)
  await shot(page, mode, 'trust-latency')
  await section(page, '#/trust/positions', '2.6', mode, 'trust-positions')
  console.log(`  [${mode}] page errors: ${errors.length ? errors.join(' | ') : 'none'}`)
  await browser.close()
}

(async () => { await run('night'); await run('daylight') })().catch((e) => { console.error(e); process.exit(1) })
