/** P8 live screenshots (dev server on :5173 for the dev-only hooks, API on :8000).  npx tsx scripts/p8-shots.ts [outDir]
 *  (a) Hood › Routing and cost, (b) Hood overview with the photo dates, (c) Hood compare, (d) a "not in register" building
 *  whose photos are old (date badge, outdated note, front wall), (e) a pole, (f) a possible dark stretch (list + card),
 *  (g) a Tamil question, (h) Trust streetlight card. Each step prints the text it checked. */
import { chromium, type Page } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

type Ui = { getState(): { select(p: object | null): void; go(p: string, s?: string | null): void } }
const OUT = process.argv[2] ?? '../docs/screenshots/p8'
const APP = process.env.APP_URL ?? 'http://localhost:5173/'
const MODE = process.env.MODE ?? 'night'
mkdirSync(OUT, { recursive: true })

const ui = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => { const s = (window as unknown as { __gcUi: Ui }).__gcUi.getState() as unknown as Record<string, (...x: unknown[]) => void>; s[f as string](...(a as unknown[])) }, [fn, args] as const)
const top = (page: Page, sel: string, text?: string) => page.evaluate(([q, t]) => {
  const root = document.querySelector(q as string)
  if (!root) return
  const el = t ? [...root.querySelectorAll('*')].find((e) => e.children.length <= 2 && (e.textContent ?? '').includes(t as string)) : null
  if (el) el.scrollIntoView({ block: 'center' })
  else root.querySelectorAll('.overflow-y-auto').forEach((x) => { x.scrollTop = 0 })
}, [sel, text ?? ''] as const)
const shot = async (page: Page, name: string) => { await page.screenshot({ path: join(OUT, `${MODE}-${name}.png`) }); console.log(`${name}: saved`) }

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  await ctx.addInitScript((m) => { try { localStorage.setItem('gc.tourSeen', '1'); localStorage.setItem('gc.mode', JSON.stringify(m)) } catch { /* */ } }, MODE)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('page error:', e.message))
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!(window as unknown as { __gcUi?: unknown }).__gcUi, null, { timeout: 90_000 })
  await page.waitForTimeout(7000)

  // (a) Under the Hood › Routing and cost
  await page.goto(APP + '#/hood/routing'); await page.waitForTimeout(5000)
  await page.evaluate(() => document.getElementById('routing')?.scrollIntoView({ block: 'start' })); await page.waitForTimeout(800)
  await shot(page, 'a-hood-routing')
  console.log('   ', (await page.locator('#routing').innerText()).replace(/\s+/g, ' ').slice(0, 900))
  await top(page, '#routing', 'Accuracy: routed'); await page.waitForTimeout(500)
  await shot(page, 'a2-hood-routing-accuracy')
  // (b) overview with the photo dates
  await page.locator('#overview').scrollIntoViewIfNeeded(); await page.waitForTimeout(600)
  await shot(page, 'b-hood-overview-dates')
  console.log('   ', (await page.locator('#overview').innerText()).split('\n').filter((l) => /Photos taken/.test(l)).join(' '))
  // (c) compare
  await page.getByRole('tab', { name: /Compare all/ }).click(); await page.waitForTimeout(4000)
  await shot(page, 'c-hood-compare')

  // (d) Explore: a building not in the register, newest photo Nov 2022
  await page.goto(APP + '#/'); await page.waitForTimeout(4000)
  await ui(page, 'select', { kind: 'building', id: 'w1252505151' }); await page.waitForTimeout(6000)
  await top(page, '[aria-label=Evidence]'); await page.waitForTimeout(1500)
  await shot(page, 'd-building-old-photos')
  const drawer = (await page.locator('[aria-label=Evidence]').innerText()).replace(/\s+/g, ' ')
  console.log('   ', drawer.slice(0, 700))
  // its "How do we know?" with the front-wall source
  await page.locator('[aria-label=Evidence] button', { hasText: 'How do we know' }).nth(1).click().catch(() => {})
  await page.waitForTimeout(800)
  await top(page, '[aria-label=Evidence]', 'Source: OpenStreetMap outline')
  await shot(page, 'd2-building-front-wall-source')
  // a recent building for comparison (photo date, no outdated note)
  await ui(page, 'select', { kind: 'building', id: 'w1252504515' }); await page.waitForTimeout(5000)
  await top(page, '[aria-label=Evidence]'); await page.waitForTimeout(1500)
  await shot(page, 'd3-building-recent')
  // (e) an asset
  await ui(page, 'select', { kind: 'pole', id: 'asset-0058' }); await page.waitForTimeout(5000)
  await top(page, '[aria-label=Evidence]'); await page.waitForTimeout(1500)
  await shot(page, 'e-pole')
  await ui(page, 'select', null)

  // (f) possible dark stretches: the key number's list, then one stretch
  await page.getByRole('button', { name: /Possible dark stretch/ }).first().click(); await page.waitForTimeout(2500)
  await shot(page, 'f-dark-list')
  await page.locator('ol[aria-label="Possible dark stretches"] li button').first().click(); await page.waitForTimeout(3500)
  await shot(page, 'f2-dark-card')
  console.log('   ', (await page.locator('[aria-label=Evidence]').innerText()).replace(/\s+/g, ' ').slice(0, 400))
  await ui(page, 'select', null); await page.keyboard.press('Escape')

  // (g) a Tamil question in the ask bar
  const ask = page.locator('form[role=search] input').first()
  await ask.click(); await ask.fill('இரண்டு மாடிகளுக்கு மேல் உள்ள, பதிவேட்டில் இல்லாத கடைகளைக் காட்டு'); await ask.press('Enter')
  await page.waitForTimeout(5000)
  await shot(page, 'g-tamil-question')
  await page.keyboard.press('Escape')
  await ask.click(); await ask.fill('60 மீட்டருக்குள் தெருவிளக்கு இல்லாத தெருக்களைக் காட்டு'); await ask.press('Enter')
  await page.waitForTimeout(5000)
  await shot(page, 'g2-tamil-dark')

  // (h) Trust › streetlight card
  await page.goto(APP + '#/trust/detector'); await page.waitForTimeout(5000)
  const card = page.getByText(/Possible dark stretches \(streetlight/).first()
  await card.scrollIntoViewIfNeeded(); await page.waitForTimeout(600)
  await shot(page, 'h-trust-dark')
  await browser.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
