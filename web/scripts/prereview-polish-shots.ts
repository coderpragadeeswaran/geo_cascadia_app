/** D66 screenshots (dev server or production preview), 1366×768, both themes, of every screen the pre-review polish
 *  changed, with what each shows printed: the Key panel at area / street / object zoom with and without a street (top
 *  vs the key numbers' bottom, scroll), the dark-stretch card, Trust lanes / Limits / Stored vs computed / sign check,
 *  spec question 1's footer, the ub-0000 drawer, Under the Hood without Street names, the savitha Sign photo and the
 *  8th Street Review item. Shots with Street View photos are named *-PHOTO-*.png (deleted once checked by eye).
 *    npx tsx scripts/prereview-polish-shots.ts [outDir]      API_PORT=8010: reroute the page's :8000 calls to another API
 *  (the Maps browser key only works on the referrer :5173, so the page itself always runs there) */
import { chromium, type Page } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT = process.argv[2] ?? '../docs/screenshots/prereview-polish'
const APP = process.env.APP_URL ?? 'http://localhost:5173/'
const API = 'http://localhost:8000'
const API_PORT = process.env.API_PORT
mkdirSync(OUT, { recursive: true })
type W = { __gcUi: { getState: () => Record<string, (...a: unknown[]) => void> }; __gcMap: { moveCamera: (o: { center: { lat: number; lng: number }; zoom: number }) => void } }

async function run(mode: 'night' | 'daylight') {
  // scroll bars shown as in a normal browser (headless Chromium hides them by default), so the Key's scroll bar is visible
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'], ignoreDefaultArgs: ['--hide-scrollbars'] })
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  await ctx.addInitScript((m) => {
    localStorage.setItem('gc.mode', JSON.stringify(m)); localStorage.setItem('gc.tourSeen', '1'); localStorage.setItem('gc.area', JSON.stringify('ward29'))
    localStorage.setItem('gc.reviewer', JSON.stringify('screenshot'))
  }, mode)
  if (API_PORT) await ctx.route(`${API}/**`, (r) => r.continue({ url: r.request().url().replace(':8000', `:${API_PORT}`) }))
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const shot = (name: string) => page.screenshot({ path: join(OUT, `${mode}-${name}.png`) })
  const say = (s: string) => console.log(`  [${mode}] ${s}`)
  const explore = async () => {
    await page.goto(APP, { waitUntil: 'domcontentloaded' })
    await page.locator('[aria-label="Key figures (click to filter)"]').getByText('Buildings checked', { exact: false }).waitFor({ timeout: 90_000 })
    await page.waitForFunction(() => !!(window as unknown as { __gcUi?: unknown; __gcMap?: unknown }).__gcUi && !!(window as unknown as { __gcMap?: unknown }).__gcMap, null, { timeout: 60_000 })
    await page.waitForTimeout(3500)
  }
  const ui = (fn: string, ...args: unknown[]) => page.evaluate(([f, a]) => (window as unknown as W).__gcUi.getState()[f as string](...(a as unknown[])), [fn, args] as const)
  const camera = (lat: number, lng: number, zoom: number) => page.evaluate(([la, ln, z]) => { const m = (window as unknown as W).__gcMap; m.moveCamera({ center: { lat: la, lng: ln }, zoom: z }) }, [lat, lng, zoom] as const)
  const props = (layer: string, id: string) => page.evaluate(async ([api, l, i]) => {
    const g = await (await fetch(`${api}/areas/ward29/geojson?layers=${l}`)).json()
    return g.features.find((f: { properties: { id: string } }) => f.properties.id === i)?.properties ?? null
  }, [API, layer, id] as const)

  // 1. the Key panel: area / street / object zoom, without and with a street selected (Sathy Main Road)
  await explore()
  for (const street of [null, 'Sathy Main Road']) {
    await ui('selectStreet', street)
    await page.waitForTimeout(1500)
    for (const [band, z] of [['area', 15.2], ['street', 17.4], ['object', 19.0]] as const) {
      await camera(11.0335, 76.9745, z)
      await page.waitForTimeout(2500)
      const btn = page.getByRole('button', { name: 'Key', exact: true })
      if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click()
      await page.waitForTimeout(800)
      const m = await page.evaluate(() => {
        const key = document.querySelector<HTMLElement>('[data-map-key]')!
        const scrim = document.querySelector<HTMLElement>('[data-top-scrim]')!
        const rib = document.querySelector<HTMLElement>('[aria-label="Key figures (click to filter)"]')
        const k = key.getBoundingClientRect()
        const cam = [...key.querySelectorAll('li')].find((l) => /camera only/.test(l.textContent ?? ''))
        return { keyTop: Math.round(k.top), keyH: Math.round(k.height), ribbonBottom: rib ? Math.round(rib.getBoundingClientRect().bottom) : null,
          scrimContentBottom: Math.round(scrim.getBoundingClientRect().bottom - parseFloat(getComputedStyle(scrim).paddingBottom)),
          scrolls: key.scrollHeight > key.clientHeight, rows: key.querySelectorAll('li').length, fontPx: getComputedStyle(key.querySelector('li')!).fontSize,
          camRow: cam?.textContent ?? null }
      })
      say(`Key ${band}${street ? ' + street' : ''}: top ${m.keyTop} px, ribbon bottom ${m.ribbonBottom} px, gap ${m.ribbonBottom != null ? m.keyTop - m.ribbonBottom : '—'} px, ${m.rows} rows, scrolls ${m.scrolls}, text ${m.fontPx}${m.camRow ? `, "${m.camRow}"` : ''}`)
      await shot(`key-${band}${street ? '-street' : ''}`)
    }
  }
  // the More list open: the key shrinks under it
  await page.getByRole('button', { name: 'More', exact: false }).first().click()
  await page.waitForTimeout(800)
  const more = await page.evaluate(() => {
    const key = document.querySelector<HTMLElement>('[data-map-key]')!.getBoundingClientRect()
    const menu = document.querySelector<HTMLElement>('[data-top-scrim] [role="menu"]')?.getBoundingClientRect()
    return { keyTop: Math.round(key.top), menuBottom: menu ? Math.round(menu.bottom) : null }
  })
  say(`Key with "More" open: key top ${more.keyTop} px, menu bottom ${more.menuBottom} px`)
  await shot('key-object-street-more-open')
  await page.keyboard.press('Escape')
  await ui('selectStreet', null)

  if (process.env.ONLY === 'key') { await browser.close(); return }
  if (process.env.ONLY === 'trust') { await trust(); await browser.close(); return }
  // 2. the dark-stretch card (the key number's list)
  await explore()
  await page.locator('[aria-label="Key figures (click to filter)"]').getByText('Possible dark stretches', { exact: false }).click()
  const list = page.getByRole('list', { name: 'Possible dark stretches' })
  await list.waitFor({ timeout: 30_000 })
  await page.waitForTimeout(2500)
  say(`dark-stretch cards: ${(await list.locator('li').allInnerTexts()).slice(0, 3).map((t) => t.split('\n').filter((x) => /pole|lamp/.test(x)).join(' ')).join(' | ')}`)
  await shot('dark-stretch-list')

  // 3. spec question 1: the result footer
  await explore()
  const ask = page.getByPlaceholder('Ask about this area', { exact: false })
  await ask.click()
  await ask.fill('Show commercial buildings with more than two visible floors that do not have a matching property record')
  await ask.press('Enter')
  await page.waitForTimeout(6000)
  const foot = await page.locator('[role="table"][aria-label="Findings"] + div span').first().innerText().catch(() => '(no table)')
  say(`spec question 1 footer: "${foot}"`)
  await shot('spec-q1-footer')

  // 4. business sign ub-0000 (on outline w1236978188): the drawer, "How do we know?" open
  await explore()
  const ub = await props('unmapped', 'ub-0000')
  await ui('select', ub)
  await page.waitForTimeout(3500)
  const how = page.getByRole('button', { name: /How do we know\?$/ }).first()
  await how.click().catch(() => {})
  await page.waitForTimeout(1200)
  await page.getByText('It sits on a building outline', { exact: false }).first().scrollIntoViewIfNeeded().catch(() => {})
  const ubText = await page.locator('aside, [role="complementary"]').last().innerText().catch(() => '')
  say(`ub-0000: ${/not one of the analysed buildings, so it is not compared/.test(await page.content()) ? 'outline sentence shown' : 'outline sentence MISSING'}; no-outline sentence ${/OpenStreetMap has no building outline here/.test(await page.content()) ? 'STILL SHOWN' : 'gone'} ${ubText ? '' : ''}`)
  await shot('PHOTO-ub-0000-drawer')

  // 5. Under the Hood: Ward 29 has no street-name list → no section, no nav entry; the photo cost line
  await page.goto(APP + '#/hood/overview', { waitUntil: 'domcontentloaded' })
  await page.getByText('Coverage and the run in brief', { exact: false }).first().waitFor({ timeout: 90_000 })
  await page.waitForTimeout(3000)
  const nav = await page.locator('nav, [aria-label="On this page"]').first().innerText().catch(() => '')
  say(`Hood nav has "Street names": ${/Street names/.test(nav)}; section on page: ${await page.locator('#street-names').count()}`)
  await page.locator('#streets-table').scrollIntoViewIfNeeded(); await page.waitForTimeout(800)
  await shot('hood-no-street-names')
  await page.locator('#cost').scrollIntoViewIfNeeded(); await page.waitForTimeout(800)
  say(`Hood time and cost: ${(await page.locator('#cost').innerText()).replace(/\s+/g, ' ').slice(0, 260)}`)
  await shot('hood-time-cost')

  // 6. the savitha Sign photo (Hood › 06 › "cloud model, OCR agrees" › 1. savitha dry cleaner › Sign)
  await page.goto(APP + '#/hood/routed', { waitUntil: 'domcontentloaded' })
  await page.getByText('Names kept from signs', { exact: false }).first().waitFor({ timeout: 90_000 })
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: /cloud model, OCR agrees/ }).first().dispatchEvent('click')
  const dlg = page.getByRole('dialog')
  await dlg.getByRole('button', { name: 'Sign', exact: true }).click({ timeout: 30_000 })
  await page.waitForTimeout(4000)
  const sv = await dlg.evaluate((d) => ({
    orange: [...d.querySelectorAll('figure svg rect')].some((r) => r.getAttribute('stroke') === '#ffa23a'),
    key: [...d.querySelectorAll('[aria-label="Photo key"]')].map((k) => k.textContent).join(' '),
    lost: !!d.querySelector('[data-sign-lost]'),
  }))
  say(`savitha Sign photo: orange box drawn ${sv.orange}; key "${sv.key.slice(0, 60)}"; not-matched line ${sv.lost}`)
  await shot('PHOTO-savitha-sign')
  await page.keyboard.press('Escape')

  // 7. Trust: Tried and dropped (Building use lane), Stored vs computed, sign check source, Limits, questions
  await trust()
  async function trust() {
  for (const [sec, text] of [['rejected', 'cloud cost per building'], ['consistency', 'Stored in:'], ['signs', 'Source: the team’s check of this run’s saved files'], ['limits', 'Timings:'], ['questions', 'question reader']] as const) {
    await page.goto(APP + `#/trust/${sec}`, { waitUntil: 'domcontentloaded' })
    const el = page.getByText(text, { exact: false }).first()
    await el.waitFor({ timeout: 90_000 })
    await page.waitForTimeout(2000)
    await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(800)
    if (sec === 'rejected') say(`Trust lane: ${(await page.locator('li', { hasText: 'cloud cost per building' }).allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').slice(0, 120)).join(' | ')}`)
    if (sec === 'limits') say(`Trust Limits: ${(await page.locator('li', { hasText: 'Timings:' }).innerText()).replace(/\s+/g, ' ')}`)
    await shot(`trust-${sec}`)
  }
  }

  // 8. Review: the 8th Street building whose only planned photo is a user photosphere
  await page.goto(APP + '#/review', { waitUntil: 'domcontentloaded' })
  const items = page.getByRole('list', { name: 'Items' })
  await items.waitFor({ timeout: 90_000 })
  await page.waitForTimeout(3000)
  const cands = items.locator('button', { hasText: '8th Street, Ganapathy' })
  let found = false
  for (let k = 0; k < Math.min(await cands.count(), 30) && !found; k++) {
    await cands.nth(k).click()
    await page.waitForTimeout(1500)
    found = /taken by a Street View user/.test(await page.locator('[aria-label="Evidence"]').innerText())
  }
  say(`Review 8th Street item: ${found ? '"Nearest camera" photo says it is a Street View user’s photo (the only planned photo; no Google-car one faces it)' : 'NOT FOUND'}`)
  await page.waitForTimeout(2500)
  await shot('PHOTO-review-8th-street')

  say(`page errors: ${errors.length ? errors.join(' | ') : 'none'}`)
  await browser.close()
}

(async () => { await run('night'); await run('daylight') })().catch((e) => { console.error(e); process.exit(1) })
