/** P7 R3 (C1–C3): live audit. Dev server (:5173) or preview (APP_URL) + API on :8000.  npx tsx scripts/audit.ts [outDir]
 *  Per theme: every page (Explore, the evidence drawer, Analyse, Review, Under the Hood, Trust, Jobs) screenshotted;
 *  keyboard checks (Tab order with a visible focus ring, Ctrl K opens / Esc closes the palette, Esc closes the panel, the
 *  drawer and Analyse); the numbers the UI shows for Ward 29 printed as JSON (C3 compares them with the database). */
import { chromium, type Page } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = process.argv[2] ?? '../docs/screenshots/p7r3/audit'
const APP = process.env.APP_URL ?? 'http://localhost:5173/'
mkdirSync(OUT, { recursive: true })
let fails = 0
const check = (ok: boolean, what: string) => { console.log(ok ? '  ok ' : '  FAIL', what); if (!ok) fails++ }
const shot = (page: Page, mode: string, name: string) => page.screenshot({ path: join(OUT, `${mode}-${name}.png`) })

async function focusInfo(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return null
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return { name: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40),
      ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2, visible: r.width > 0 && r.height > 0 }
  })
}

async function run(mode: 'night' | 'daylight') {
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  await ctx.addInitScript((m) => {
    localStorage.setItem('gc.mode', JSON.stringify(m)); localStorage.setItem('gc.tourSeen', '1')
    localStorage.setItem('gc.reviewer', JSON.stringify('audit')); localStorage.setItem('gc.area', JSON.stringify('ward29'))
  }, mode)
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  console.log(`[${mode}]`)
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  const ribbon = page.locator('[aria-label="Key figures (click to filter)"]')
  await ribbon.getByText('Buildings checked', { exact: false }).waitFor({ timeout: 60_000 })
  await page.waitForTimeout(6000)
  await shot(page, mode, '01-explore')
  const ui: Record<string, string> = {}
  ui.kpis = (await ribbon.innerText()).replace(/\s+/g, ' ')
  await ribbon.getByRole('button', { name: /More/ }).click()
  ui.more = (await page.locator('[role="menu"]').innerText()).replace(/\s+/g, ' ')
  await page.keyboard.press('Escape')
  await ribbon.getByRole('button', { name: /More/ }).click()          // toggle closed

  // keyboard: Tab order with a visible ring
  await page.mouse.click(700, 400)                                    // focus the page (map click on empty ground)
  await page.keyboard.press('Escape')
  await page.locator('body').focus()
  const order: string[] = []
  const noRing: string[] = []
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press('Tab')
    const f = await focusInfo(page)
    if (f) { order.push(f.name); if (!f.ring || !f.visible) noRing.push(f.name) }
    if (i === 3) await shot(page, mode, '02-focus-ring')
  }
  console.log('  tab order:', order.join(' → '))
  // the map canvas is Google's (it draws its own focus frame); the ask field marks focus with its underline (design)
  const real = noRing.filter((n) => n !== 'CANVAS' && !/^Ask a question/.test(n))
  check(real.length === 0, `focus ring visible on every tab stop${noRing.length ? ` (no outline: ${noRing.join(', ')})` : ''}`)

  // Ctrl K palette
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(500)
  const palette = page.locator('[cmdk-root]')
  check(await palette.count() > 0, 'Ctrl K opens the palette')
  await shot(page, mode, '03-palette')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  check(await palette.count() === 0, 'Esc closes the palette')

  // a key number → its panel; a row → the drawer; Esc closes each
  await ribbon.getByRole('button', { name: /Not in register/i }).click()
  await page.waitForTimeout(3500)
  const panel = page.locator('[aria-label="Findings panel"]')
  check(await panel.count() > 0, 'a key number opens the panel')
  await shot(page, mode, '04-kpi-panel')
  const row = panel.locator('[role="row"], .r').nth(1)
  if (await row.count()) {
    await row.click()
    await page.waitForTimeout(5000)
    check(await page.locator('[aria-label="Evidence"]').count() > 0, 'a row opens the evidence drawer')
    await shot(page, mode, '05-drawer')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
    check(await page.locator('[aria-label="Evidence"]').count() === 0, 'Esc closes the drawer')
  } else check(false, 'no row to click in the panel')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
  check(await panel.count() === 0, 'Esc closes the panel')

  // Analyse
  await page.locator('[data-tour="analyse"]').click()
  await page.waitForTimeout(1500)
  await shot(page, mode, '06-analyse')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
  check((await page.locator('[data-tour="analyse"]').getAttribute('aria-pressed')) === 'false', 'Esc leaves Analyse')

  // pages
  for (const [k, label, wait] of [['review', 'Review', 4000], ['hood', 'Under the hood', 7000], ['trust', 'Trust', 4000], ['jobs', 'Jobs', 3000]] as const) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.waitForTimeout(wait)
    await shot(page, mode, `07-${k}`)
    if (k === 'review') ui.review = (await page.locator('text=/\\d+ waiting/').first().innerText())
    if (k === 'trust') {
      await page.evaluate(() => document.getElementById('gate1')?.scrollIntoView())
      await page.waitForTimeout(800)
      await shot(page, mode, '08-trust-gate1')
      const g = await page.locator('#gate1').innerText()
      ui.gate1_status = /Status: [^\n]+/.exec(g)?.[0] ?? ''
      ui.gate1_camera = g.split('\n').filter((l) => /Ward 29/.test(l) && /camera/i.test(l)).join(' | ').replace(/\s+/g, ' ')
      ui.trust_has_73 = String(/\b73(\.0)?\s?%/.test(await page.locator('body').innerText()))
    }
  }
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
  writeFileSync(join(OUT, `${mode}-ui-numbers.json`), JSON.stringify(ui, null, 1))
  console.log('  ui numbers:', JSON.stringify(ui))
  await browser.close()
}

async function main() {
  await run('night')
  await run('daylight')
  console.log(fails ? `${fails} check(s) failed` : 'all audit checks passed')
  process.exit(fails ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
