/** ui-polish-2 live screenshots (dev server on :5173 for the dev-only hooks, API on :8000), 1366×768.
 *    npx tsx scripts/ui-polish2-shots.ts [outDir]      MODE=daylight for Daylight · ONLY=s,p,r,n,o · TAG=before|after
 *  (s) the street panel's list (2nd Street, Gandhi Nagar, then Sathy Main Road), then the full list view from a tab;
 *  (p) busy photos in the Explore drawer, then "everything the detector found", then a legend item hovered:
 *      w1252503923 (hitech gears, Sathy Main Road: 17 boxes, 11 linked signs) and w1236978849 (transport india pvt ltd,
 *      2nd Street, Gandhi Nagar: Google no longer serves its panorama, so the photo shows "No Street View image");
 *  (r) the Review card for each reason type (one item each, through reviewFocus);
 *  (n) "No" with a corrected floor count on w1252504515 (8th Street, Ganapathy; floor estimate), the saved line, the drawer's "Reviewer says", then Undo;
 *  (o) Under the Hood › Businesses vs OpenStreetMap and Trust › OpenStreetMap cross-checks.
 *  Each step prints what it checked. (n) leaves the review tables as it found them (decision + undo). */
import { chromium, type Page } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

type Ui = { getState(): Record<string, unknown> }
const OUT = process.argv[2] ?? '../docs/screenshots/ui-polish-2'
const APP = process.env.APP_URL ?? 'http://localhost:5173/'
const API = process.env.API_URL ?? 'http://127.0.0.1:8000'
const MODE = process.env.MODE ?? 'night'
const TAG = process.env.TAG ?? 'after'
const ONLY = (process.env.ONLY ?? 's,p,r,n,o').split(',')
mkdirSync(OUT, { recursive: true })

const ui = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => { ((window as unknown as { __gcUi: Ui }).__gcUi.getState()[f as string] as (...x: unknown[]) => void)(...(a as unknown[])) }, [fn, args] as const)
const shot = async (page: Page, name: string) => { await page.screenshot({ path: join(OUT, `${TAG}-${MODE}-${name}.png`) }); console.log(`  ${TAG}-${MODE}-${name}.png`) }
const text = async (page: Page, sel: string) => (await page.locator(sel).first().innerText({ timeout: 5000 }).catch(() => '(not found)')).replace(/\s+/g, ' ')

/** one review item per reason type (database ids looked up from GET /review) */
const REASONS: [string, string, string][] = [
  ['not-in-register', 'sanganur_road_086d14', 'w1251629310'],
  ['not-in-register+floors', 'trichy_bharathidasan_salai', 'w1229050228'],
  ['extra-floor', 'trichy_bharathidasan_salai', 'w1229050329'],
  ['use-differs', 'rathinapuri_sanganoor_main_road_9520da', 'w1251143996'],
  ['pin+use-differ', 'vadakku_masi_veethi_f17937', 'ms_9.923059_78.116965'],
  ['floor-estimate', 'ward29', 'w1252504515'],
  ['floor-estimate-no-photo', 'ward29', 'w1236978849'],
  ['name-ai-only', 'ward29', 'w1236978168'],
  ['one-view-only', 'sanganur_road_086d14', 'w1251629682'],
  ['asset-one-photo', 'ward29', 'asset'],
]

async function reviewId(slug: string, ref: string) {
  const rows = (await (await fetch(`${API}/review?area=${slug}&page_size=1000`)).json()).rows as { id: number; ref_id: string; item_type: string }[]
  return (ref === 'asset' ? rows.find((r) => r.item_type === 'asset') : rows.find((r) => r.ref_id === ref))?.id ?? null
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  await ctx.addInitScript((m) => {
    try {
      localStorage.setItem('gc.tourSeen', '1'); localStorage.setItem('gc.mode', JSON.stringify(m)); localStorage.setItem('gc.area', JSON.stringify('ward29'))
      localStorage.setItem('gc.reviewer', JSON.stringify('ui-polish-2 check'))
    } catch { /* */ }
  }, MODE)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('page error:', e.message))
  page.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text().slice(0, 200)) })
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!(window as unknown as { __gcUi?: unknown }).__gcUi && !!(window as unknown as { __gcMap?: unknown }).__gcMap, null, { timeout: 90_000 })
  await page.waitForTimeout(8000)

  if (ONLY.includes('s')) {
    console.log('(s) street panel list')
    for (const [street, tag] of [['2nd Street, Gandhi Nagar', 's1-2nd-street'], ['Sathy Main Road', 's2-sathy']] as const) {
      await ui(page, 'selectStreet', street); await page.waitForTimeout(4000)
      await shot(page, tag)
      const box = await page.locator('[aria-label="Street list"]').first().boundingBox().catch(() => null)
      console.log(`    ${street}: list box`, box ? `${Math.round(box.height)} px high` : '(no [aria-label="Street list"])',
        '· rows visible:', await page.evaluate(() => {
          const l = document.querySelector('[aria-label="Street list"]'); if (!l) return null
          const sc = l.querySelector('[role=table]')!.getBoundingClientRect()
          return [...l.querySelectorAll('[role=table] [role=row]')].filter((x) => { const b = x.getBoundingClientRect(); return b.top >= sc.top - 1 && b.bottom <= sc.bottom + 1 && b.height > 0 }).length
        }))
    }
    const tab = page.getByRole('tab', { name: /^Buildings \d+/ }).first()
    if (await tab.count()) {
      await tab.click(); await page.waitForTimeout(800)
      await shot(page, 's3-sathy-full-list')
      console.log('    full list:', (await text(page, '[role=dialog][aria-label*="list"]')).slice(0, 200))
      await page.keyboard.press('Escape'); await page.waitForTimeout(600)
      console.log('    Esc → full list closed:', (await page.locator('[role=dialog][aria-label*="list"]').count()) === 0)
    } else console.log('    (no "Buildings N" tab)')
    await ui(page, 'selectStreet', null); await page.waitForTimeout(800)
  }

  if (ONLY.includes('p')) {
   for (const bid of (process.env.BUSY ?? 'w1252503923,w1236978849').split(',')) {
    console.log(`(p) busy photo ${bid}`)
    await ui(page, 'select', { kind: 'building', id: bid }); await page.waitForTimeout(7000)
    await shot(page, `p1-${bid}-drawer`)
    console.log('    legend:', (await text(page, '[aria-label="Photo key"]')).slice(0, 300))
    const how = page.getByRole('button', { name: /everything the detector found/ }).first()
    await how.click().catch(() => console.log('    (no "everything the detector found")')); await page.waitForTimeout(1500)
    await page.locator('figure').first().scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(500)
    await shot(page, `p2-${bid}-drawer-everything`)
    console.log('    legend (everything):', (await text(page, '[aria-label="Photo key"]')).slice(0, 400))
    const item = page.locator('[aria-label="Photo key"] [data-box]').nth(1)
    if (await item.count()) {
      await item.hover(); await page.waitForTimeout(500)
      await shot(page, `p3-${bid}-legend-hover`)
      console.log('    hovered:', await item.innerText(), '· highlighted on photo:', await page.locator('svg [data-hl="1"]').count())
    }
    await how.click().catch(() => {}); await page.waitForTimeout(500)
    await ui(page, 'select', null); await page.waitForTimeout(800)
   }
  }

  if (ONLY.includes('r') || ONLY.includes('p')) {
    console.log('(r) Review cards')
    for (const [tag, slug, ref] of (ONLY.includes('r') ? REASONS : REASONS.filter(([t]) => t.startsWith('floor-estimate')))) {
      const id = await reviewId(slug, ref)
      if (id == null) { console.log(`    ${tag}: no review item`); continue }
      await ui(page, 'setArea', slug); await page.waitForTimeout(3000)
      await ui(page, 'sendToReview', { area: slug, ids: [id], label: tag }); await page.waitForTimeout(7000)
      await shot(page, `r-${tag}`)
      console.log(`    ${tag} (#${id}):`, (await text(page, '[aria-label="Decision"]')).slice(0, 260))
    }
    await ui(page, 'setArea', 'ward29'); await page.waitForTimeout(2000)
    await ui(page, 'go', 'explore'); await page.waitForTimeout(3000)
  }

  if (ONLY.includes('n')) {
    console.log('(n) No with a corrected floor count')
    const id = await reviewId('ward29', 'w1252504515')
    await ui(page, 'sendToReview', { area: 'ward29', ids: [id], label: 'corrected value' }); await page.waitForTimeout(7000)
    await page.keyboard.press('r'); await page.waitForTimeout(800)
    await page.getByLabel(/Actual floors/).fill('3').catch(() => console.log('    (no "Actual floors" field)'))
    await page.getByLabel(/Note/).first().fill('Three floors; the top floor is set back behind the tree.').catch(() => console.log('    (no note field)'))
    await shot(page, 'n1-no-with-value')
    await page.getByRole('button', { name: /^Save answer/ }).click().catch(() => console.log('    (no "Save answer")')); await page.waitForTimeout(3500)
    await page.getByRole('button', { name: /^History|Show its history/ }).first().click().catch(() => {}); await page.waitForTimeout(2500)
    await shot(page, 'n2-saved')
    console.log('    saved:', (await text(page, '[aria-label="Decision"]')).slice(0, 400))
    const row = (await (await fetch(`${API}/review/${id}`)).json()) as { status: string; corrected?: unknown; note?: string }
    console.log('    API:', JSON.stringify({ status: row.status, corrected: row.corrected, note: row.note }))
    await ui(page, 'go', 'explore'); await page.waitForTimeout(2500)
    await ui(page, 'select', { kind: 'building', id: 'w1252504515' }); await page.waitForTimeout(6000)
    await page.getByText(/Reviewer says/).first().scrollIntoViewIfNeeded().catch(() => console.log('    (no "Reviewer says" in the drawer)'))
    await page.waitForTimeout(600)
    await shot(page, 'n3-drawer-reviewer-says')
    console.log('    drawer:', (await page.getByText(/Reviewer says/).allInnerTexts()).join(' | '))
    // undo through the API: the item goes back to exactly what it was
    const evs = (await (await fetch(`${API}/review/${id}/events`)).json()).events as { id: number; action: string; undone_by: number | null }[]
    const live = evs.find((e) => e.action !== 'undo' && !e.undone_by)
    if (live) {
      const u = await fetch(`${API}/review/${id}/undo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_id: id, event_id: live.id, reviewer: 'ui-polish-2 check' }) })
      const back = (await (await fetch(`${API}/review/${id}`)).json()) as { status: string; corrected?: unknown }
      console.log('    undo:', u.status, '→', JSON.stringify({ status: back.status, corrected: back.corrected ?? null }))
    }
    await ui(page, 'select', null); await page.waitForTimeout(800)
  }

  if (ONLY.includes('o')) {
    console.log('(o) OSM shops')
    await page.getByRole('button', { name: 'Under the hood', exact: true }).click(); await page.waitForTimeout(7000)
    await page.evaluate(() => document.getElementById('osm')?.scrollIntoView({ block: 'start' })); await page.waitForTimeout(2500)
    await shot(page, 'o1-hood-osm')
    console.log('    hood:', (await text(page, '#osm')).slice(0, 600))
    console.log('    projection section present:', await page.locator('#projection').count())
    await page.getByRole('button', { name: 'Trust', exact: true }).click(); await page.waitForTimeout(5000)
    await page.evaluate(() => document.getElementById('osm')?.scrollIntoView({ block: 'start' })); await page.waitForTimeout(2500)
    await shot(page, 'o2-trust-osm')
    console.log('    trust:', (await text(page, '#osm')).slice(0, 400))
  }
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
