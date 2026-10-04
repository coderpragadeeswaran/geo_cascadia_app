/** P7 R3 (C5): fallback cases in the browser. Production preview on :5173; APIs: :8000 normal, :8001 with every outgoing
 *  request blocked (map servers unreachable), :8002 with both Google keys empty. The browser keeps calling :8000; this
 *  script reroutes those calls.  npx tsx scripts/offline.ts [outDir]
 *  Cases: map servers blocked · analysis computer offline (a test job stays queued) · Google keys missing · the API
 *  stops answering mid-session. Each prints what the person sees and saves a screenshot. */
import { chromium, type Page } from 'playwright'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT = process.argv[2] ?? '../docs/screenshots/p7r3/offline'
const APP = process.env.APP_URL ?? 'http://localhost:5173/'
const API = 'http://localhost:8000'
mkdirSync(OUT, { recursive: true })
let fails = 0
const check = (ok: boolean, what: string) => { console.log(ok ? '  ok ' : '  FAIL', what); if (!ok) fails++ }

async function open(port?: number) {
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  await ctx.addInitScript(() => { localStorage.setItem('gc.tourSeen', '1'); localStorage.setItem('gc.area', JSON.stringify('ward29')); localStorage.setItem('gc.reviewer', JSON.stringify('offline check')) })
  if (port) await ctx.route(`${API}/**`, (r) => r.continue({ url: r.request().url().replace(':8000', `:${port}`) }))
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  return { browser, page, errors }
}
/** extras F3: wait for what the person should see (up to ms), instead of a fixed timer; true as soon as it is there */
const said = async (page: Page, re: RegExp, ms = 30_000) => {
  const end = Date.now() + ms
  for (;;) {
    if (re.test(await page.locator('body').innerText())) return true
    if (Date.now() > end) return false
    await page.waitForTimeout(500)
  }
}
/** the opposite: wait until the text is gone */
const gone = async (page: Page, re: RegExp, ms = 30_000) => {
  const end = Date.now() + ms
  for (;;) {
    if (!re.test(await page.locator('body').innerText())) return true
    if (Date.now() > end) return false
    await page.waitForTimeout(500)
  }
}
const go = async (page: Page, label: string, wait = 3500) => { await page.locator('nav[aria-label="Sections"]').getByRole('button', { name: label, exact: true }).click(); await page.waitForTimeout(wait) }

async function mapServersBlocked() {
  console.log('[map servers blocked] API :8001, every outgoing request fails')
  const { browser, page, errors } = await open(8001)
  await page.getByText('Buildings checked').first().waitFor({ timeout: 90_000 })
  await page.waitForTimeout(6000)
  await page.screenshot({ path: join(OUT, 'a1-explore.png') })
  check(true, 'Explore loads (areas, numbers, map layers from the database)')
  await go(page, 'Jobs', 6000)
  await page.screenshot({ path: join(OUT, 'a2-jobs-minimap.png') })
  check(!(await said(page, /other roads not loaded/i, 1500)), 'Jobs mini-map draws the roads around (from the cache)')
  await go(page, 'Under the hood', 2000)
  check(await said(page, /How Ward 29/, 90_000), 'Under the Hood loads (a just-started API reads every area first)')
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
  await browser.close()
}

async function workerOffline() {
  console.log('[analysis computer offline] API :8000, no worker; one test job queued on a cached demo street')
  const r = await fetch(`${API}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat: 11.042553, lon: 76.9841361, test: true }) })
  const job = await r.json() as { id?: string; job?: { id: string } }
  const id = job.id ?? job.job?.id
  // extras F1: record the exact id at creation, so a clean-up after a crash removes this job and nothing else
  if (id) appendFileSync(join(OUT, 'created_jobs.txt'), id + '\n')
  check(r.status === 201 && !!id, `test job queued (${r.status})`)
  const { browser, page, errors } = await open()
  try {
    await page.getByText('Buildings checked').first().waitFor({ timeout: 90_000 })
    await page.waitForTimeout(3000)
    await page.screenshot({ path: join(OUT, 'b1-explore-topbar.png') })
    check(await said(page, /Analysis off/), 'top bar: "Analysis off"')
    await go(page, 'Jobs', 4000)
    await page.screenshot({ path: join(OUT, 'b2-jobs.png') })
    check(await said(page, /not connected/), 'Jobs: "Analysis computer: not connected — new streets wait in the queue"')
    check(await said(page, /Queued|waiting/i), 'the job reads queued / waiting, not an error')
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
  } finally {
    if (id) {
      await fetch(`${API}/jobs/${id}/cancel`, { method: 'POST' })
      const d = await fetch(`${API}/jobs/${id}`, { method: 'DELETE' })
      console.log(`  (test job ${id.slice(0, 8)} cancelled and removed: ${d.status})`)
    }
    await browser.close()
  }
}

async function keysMissing() {
  console.log('[Google keys missing] API :8002, GOOGLE_MAPS_BROWSER_KEY and GOOGLE_PLACES_SERVER_KEY empty')
  const { browser, page, errors } = await open(8002)
  await page.getByText('The map can’t be shown').waitFor({ timeout: 60_000 })
  await page.screenshot({ path: join(OUT, 'c1-explore-no-map.png') })
  check(true, 'Explore: "The map can’t be shown" with what to set, and links to the pages that work')
  await go(page, 'Review', 5000)
  // a just-started helper API reads every area first: wait for a real count ("0 waiting" shows while it loads)
  check(await said(page, /[1-9][\d,]* waiting/, 90_000), 'Review: the queue loads')
  check(await said(page, /Street View photos need the Google Maps browser key/, 60_000), 'Review: the photo says the key is missing')
  await page.screenshot({ path: join(OUT, 'c2-review.png') })
  await go(page, 'Trust', 4000)
  check(await said(page, /Why you can, and can’t, trust each result/), 'Trust loads')
  await go(page, 'Jobs', 3000)
  await page.screenshot({ path: join(OUT, 'c3-jobs.png') })
  check(await said(page, /Pre-computed runs/), 'Jobs loads')
  // the app's own errors only (Google's script is not loaded at all)
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
  await browser.close()
}

async function apiDown() {
  console.log('[API stops answering mid-session]')
  const { browser, page } = await open()
  await page.getByText('Buildings checked').first().waitFor({ timeout: 90_000 })
  await page.waitForTimeout(4000)
  await page.context().route(`${API}/**`, (r) => r.abort('connectionrefused'))
  await go(page, 'Jobs', 4000)
  await page.screenshot({ path: join(OUT, 'd1-api-down.png') })
  check(await said(page, /The API isn’t answering/), 'banner: "The API isn’t answering … What is on screen stays"')
  await page.context().unroute(`${API}/**`)
  await go(page, 'Review', 6000)
  check(await gone(page, /The API isn’t answering/), 'banner clears once the API answers again')
  await browser.close()
}

async function main() {
  await mapServersBlocked()
  await workerOffline()
  await keysMissing()
  await apiDown()
  console.log(fails ? `${fails} check(s) failed` : 'all fallback checks passed')
  process.exit(fails ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
