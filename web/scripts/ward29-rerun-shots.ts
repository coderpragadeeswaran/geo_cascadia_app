/** D64 live screenshots of the re-run Ward 29 (works on the production build: no dev hooks), 1366x768, both themes.
 *    APP_URL=http://65.1.253.18/ npx tsx scripts/ward29-rerun-shots.ts [outDir]
 *  Explore > "Differ from register" > the first building's drawer (photo with its orange box), Trust > Stored vs
 *  computed (the model card's Sep 2026 run row) and Trust > Gate 1. Prints the orange boxes and the photo line. */
import { chromium, type Page } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT = process.argv[2] ?? '../docs/screenshots/ward29-rerun/live'
const APP = process.env.APP_URL ?? 'http://localhost:5173/'
mkdirSync(OUT, { recursive: true })
const shot = (page: Page, mode: string, name: string) => page.screenshot({ path: join(OUT, `${mode}-${name}.png`) })

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
  await ribbon.getByRole('button', { name: /Differ from register/i }).click()
  await page.waitForTimeout(4000)
  const panel = page.locator('[aria-label="Findings panel"]')
  for (let i = 1; i <= 1; i++) {                                         // one drawer per theme
    if (!(await panel.locator('[role="row"], .r').nth(i).count())) {           // Esc closed the panel with the drawer
      await ribbon.getByRole('button', { name: /Differ from register/i }).click(); await page.waitForTimeout(3000)
    }
    await panel.locator('[role="row"], .r').nth(i).click()
    await page.waitForTimeout(9000)
    const fig = page.locator('[aria-label="Evidence"] figure').first()
    await fig.scrollIntoViewIfNeeded().catch(() => {})
    await page.waitForTimeout(1500)
    const r = await page.evaluate(() => ({
      title: document.querySelector('[aria-label="Evidence"] h2, [aria-label="Evidence"] h1')?.textContent ?? '',
      orange: document.querySelectorAll('[aria-label="Evidence"] figure svg rect[fill="rgb(255 162 58 / 0.08)"]').length,
      img: [...document.querySelectorAll('[aria-label="Evidence"] figure img')].some((x) => (x as HTMLImageElement).naturalWidth > 0),
    }))
    console.log(`  [${mode}] drawer ${i}: ${r.title} | photo loaded ${r.img} | orange boxes ${r.orange}`)
    await shot(page, mode, `drawer-${i}`)
    await page.keyboard.press('Escape'); await page.waitForTimeout(800)
  }
  await page.goto(APP + '#/trust/consistency', { waitUntil: 'domcontentloaded' })
  await page.getByText('Stored vs computed', { exact: false }).first().waitFor({ timeout: 90_000 })
  await page.waitForTimeout(6000)
  const row = page.getByText('Ward 29, Sep 2026 run (kept as a backup)', { exact: false }).first()
  console.log(`  [${mode}] Trust: model-card row shown ${await row.count() > 0}`)
  await row.scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(1000)
  await shot(page, mode, 'trust-consistency')
  await page.goto(APP + '#/trust/gate1', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(9000)
  await shot(page, mode, 'trust-gate1')
  console.log(`  [${mode}] page errors: ${errors.length ? errors.join(' | ') : 'none'}`)
  await browser.close()
}

(async () => { await run('night'); await run('daylight') })().catch((e) => { console.error(e); process.exit(1) })
