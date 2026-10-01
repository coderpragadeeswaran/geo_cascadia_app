/** P7.5: the guided tour, live. Dev server (:5173) or preview (APP_URL) + API on :8000.  npx tsx scripts/tour-shots.ts [outDir]
 *  For each theme: a fresh browser (no gc.tourSeen) → the tour must open by itself; a screenshot of every step, stepping
 *  with Enter (step 1), → (step 2) and the Next button (the rest); Back, then Esc closes it; a reload must NOT reopen it;
 *  the ? button on the rail starts it again. Prints each step's text for checking by eye. */
import { chromium, type Page } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT = process.argv[2] ?? '../docs/screenshots/p7r3/tour'
const APP = process.env.APP_URL ?? 'http://localhost:5173/'
mkdirSync(OUT, { recursive: true })
let fails = 0
const check = (ok: boolean, what: string) => { console.log(ok ? '  ok ' : '  FAIL', what); if (!ok) fails++ }

async function dialogText(page: Page) {
  return (await page.locator('[aria-labelledby="tour-title"]').innerText()).replace(/\s+/g, ' ')
}

async function run(mode: 'night' | 'daylight') {
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  await ctx.addInitScript((m) => { if (!sessionStorage.getItem('init')) { localStorage.setItem('gc.mode', JSON.stringify(m)); localStorage.setItem('gc.reviewer', JSON.stringify('tour check')); sessionStorage.setItem('init', '1') } }, mode)
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  console.log(`[${mode}] first visit`)
  const dlg = page.locator('[aria-labelledby="tour-title"]')
  await dlg.waitFor({ timeout: 40_000 })
  check(true, 'tour opened by itself on the first visit')
  const n = Number(/of (\d+)/i.exec(await dlg.innerText())?.[1] ?? 0)
  check(n >= 6 && n <= 8, `${n} steps (6–8)`)
  for (let i = 0; i < n; i++) {
    await page.waitForTimeout(i === 0 ? 4500 : 3500)                  // flights, page loads
    await page.screenshot({ path: join(OUT, `${mode}-${i + 1}.png`) })
    console.log(`  step ${i + 1}: ${await dialogText(page)}`)
    check(await page.evaluate(() => document.activeElement?.textContent === 'Next' || document.activeElement?.textContent === 'Finish'), `step ${i + 1}: focus on Next`)
    if (i === n - 1) break
    if (i === 0) await page.keyboard.press('Enter')
    else if (i === 1) await page.keyboard.press('ArrowRight')
    else await page.getByRole('button', { name: 'Next' }).click()
  }
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(600)
  check((await dialogText(page)).toLowerCase().includes(`${n - 1} of ${n}`), '← goes back one step')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  check(await dlg.count() === 0, 'Esc closes the tour')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(8000)
  check(await dlg.count() === 0, 'not shown again after a reload (shown once)')
  await page.getByRole('button', { name: 'Guided tour' }).click()
  await dlg.waitFor({ timeout: 5000 })
  check(true, 'the ? button starts it')
  await page.getByRole('button', { name: 'Skip tour' }).click()
  await page.waitForTimeout(400)
  check(await dlg.count() === 0, 'Skip closes it')
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
  await browser.close()
}

async function main() {
  await run('night')
  await run('daylight')
  console.log(fails ? `${fails} check(s) failed` : 'all tour checks passed')
  process.exit(fails ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
