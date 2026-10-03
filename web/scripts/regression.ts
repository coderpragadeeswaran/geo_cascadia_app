/** Regression pass in the browser (D56), the half of `tools/regression.py` that needs a browser. Production preview (or dev
 *  server) on :5173 + API on :8000.  npx tsx scripts/regression.ts [outDir]
 *  For each theme and EVERY area: Explore loads (key numbers), "What stands out" opens, a key number's list opens and its
 *  first row opens the evidence drawer, Analyse opens and Esc leaves it, then Review, Under the Hood, Trust and Jobs.
 *  Once per theme: the guided tour, step by step. Every console error and page error fails the run (each is printed with
 *  the page it came from). Screenshots: one per area per theme (Explore) and one per page per theme for Ward 29.
 *  It reads nothing and writes nothing in the database (no review decision, no job). Exit code 1 on any failure. */
import { chromium, type Page } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = process.argv[2] ?? '../docs/screenshots/regression/browser'
const APP = process.env.APP_URL ?? 'http://localhost:5173/'
const API = process.env.API_URL ?? 'http://localhost:8000'
mkdirSync(OUT, { recursive: true })
let fails = 0
const lines: string[] = []
const log = (s: string) => { console.log(s); lines.push(s) }
const check = (ok: boolean, what: string) => { log(`${ok ? '  ok  ' : '  FAIL'} ${what}`); if (!ok) fails++ }

async function area(page: Page, errors: string[], mode: string, slug: string, name: string, first: boolean) {
  const before = errors.length
  await page.evaluate((s) => { localStorage.setItem('gc.area', JSON.stringify(s)) }, slug)
  await page.goto(APP + '#/', { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const ribbon = page.locator('[aria-label="Key figures (click to filter)"]')
  await ribbon.getByText(/Buildings? checked/).waitFor({ timeout: 60_000 })
  await page.waitForTimeout(4500)
  const figs = (await ribbon.innerText()).replace(/\s+/g, ' ')
  check(/^\d|STREET/.test(figs.trim()) && !/…/.test(figs), `[${slug}] Explore key numbers: ${figs.slice(0, 120)}`)
  await page.screenshot({ path: join(OUT, `${mode}-${slug}-explore.png`) })
  // What stands out
  await page.getByRole('button', { name: 'What stands out' }).click()
  await page.waitForTimeout(1500)
  check(await page.locator('[aria-label="Download a report for this area"]').count() > 0, `[${slug}] What stands out opens (with Download report)`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(400)
  // a key number → its list → the first row → the drawer
  await ribbon.getByRole('button', { name: /Buildings? checked/ }).click()
  await page.waitForTimeout(2500)
  const panel = page.locator('[aria-label="Findings panel"]')
  check(await panel.count() > 0, `[${slug}] a key number opens its list`)
  const row = panel.locator('[role="row"], .r').nth(1)
  if (await row.count()) {
    await row.click(); await page.waitForTimeout(4000)
    check(await page.locator('[aria-label="Evidence"]').count() > 0, `[${slug}] a row opens the evidence drawer`)
    if (first) await page.screenshot({ path: join(OUT, `${mode}-${slug}-drawer.png`) })
    await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  } else check(false, `[${slug}] the list has a row to open`)
  await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  // Analyse opens and closes (no click on the map: nothing is looked up, no job)
  await page.locator('[data-tour="analyse"]').click(); await page.waitForTimeout(1200)
  check((await page.locator('[data-tour="analyse"]').getAttribute('aria-pressed')) === 'true', `[${slug}] Analyse opens`)
  if (first) await page.screenshot({ path: join(OUT, `${mode}-analyse.png`) })
  await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  check((await page.locator('[data-tour="analyse"]').getAttribute('aria-pressed')) === 'false', `[${slug}] Esc leaves Analyse`)
  // the other pages, for this area
  for (const [k, label, wait] of [['review', 'Review', 3000], ['hood', 'Under the hood', 6000], ['trust', 'Trust', 3000], ['jobs', 'Jobs', 2500]] as const) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.waitForTimeout(wait)
    const text = (await page.locator('main, #root').first().innerText()).replace(/\s+/g, ' ')
    check(!/Couldn’t load|went wrong|server error/i.test(text), `[${slug}] ${label} loads${/Couldn’t load|went wrong|server error/i.test(text) ? ': ' + text.slice(0, 160) : ''}`)
    if (first) await page.screenshot({ path: join(OUT, `${mode}-${k}.png`), fullPage: false })
  }
  await page.getByRole('button', { name: /Explore/ }).first().click(); await page.waitForTimeout(800)
  check(errors.length === before, `[${slug}] no console or page errors${errors.length > before ? ': ' + errors.slice(before).join(' | ') : ''}`)
  void name
}

async function tour(page: Page, errors: string[], mode: string) {
  const before = errors.length
  await page.evaluate(() => localStorage.setItem('gc.area', JSON.stringify('ward29')))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[aria-label="Key figures (click to filter)"]').getByText(/Buildings? checked/).waitFor({ timeout: 60_000 })
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Guided tour' }).click()
  const dlg = page.locator('[aria-labelledby="tour-title"]')
  await dlg.waitFor({ timeout: 10_000 })
  let steps = 0
  for (let i = 0; i < 10; i++) {
    steps++
    await page.waitForTimeout(2500)
    const title = (await page.locator('#tour-title').innerText()).trim()
    log(`  tour step ${steps}: ${title}`)
    await page.screenshot({ path: join(OUT, `${mode}-tour-${steps}.png`) })
    const next = dlg.getByRole('button', { name: /^(Next|Finish)$/ })
    const fin = (await next.innerText()).trim() === 'Finish'
    await next.click()
    if (fin) break
  }
  await page.waitForTimeout(800)
  check(steps === 7 && await dlg.count() === 0, `tour: ${steps} steps, closes at Finish`)
  check(errors.length === before, `tour: no console or page errors${errors.length > before ? ': ' + errors.slice(before).join(' | ') : ''}`)
}

async function main() {
  const areas = (await (await fetch(`${API}/areas`)).json() as { areas: { slug: string; name: string }[] }).areas
  log(`areas: ${areas.map((a) => a.slug).join(', ')}`)
  for (const mode of ['night', 'daylight'] as const) {
    log(`[${mode}]`)
    const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
    await ctx.addInitScript((m) => { try { if (!sessionStorage.getItem('init')) { localStorage.setItem('gc.tourSeen', '1'); localStorage.setItem('gc.mode', JSON.stringify(m)); sessionStorage.setItem('init', '1') } } catch { /* */ } }, mode)
    const page = await ctx.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`page error: ${e.message}`))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 240)}`) })
    await page.goto(APP, { waitUntil: 'domcontentloaded' })
    // Ward 29 first (it gets the per-page screenshots), then every other area
    const order = [...areas].sort((a, b) => Number(b.slug === 'ward29') - Number(a.slug === 'ward29'))
    for (const a of order) {
      try { await area(page, errors, mode, a.slug, a.name, a.slug === 'ward29') } catch (e) { check(false, `[${a.slug}] ${(e as Error).message.split('\n')[0]}`) }
    }
    try { await tour(page, errors, mode) } catch (e) { check(false, `tour: ${(e as Error).message.split('\n')[0]}`) }
    await browser.close()
  }
  log(fails ? `${fails} browser check(s) FAILED` : 'all browser checks passed')
  writeFileSync(join(OUT, 'browser.log'), lines.join('\n') + '\n')
  process.exit(fails ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
