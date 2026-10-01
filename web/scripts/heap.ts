/** P7 R3 (C4, D3 target ≤ 60 MB JS heap): production build (npm run build && npx vite preview --port 5173) + API :8000.
 *  npx tsx scripts/heap.ts [runs=2]
 *  Chrome DevTools Protocol: JS heap after a forced GC (Runtime.getHeapUsage) at (1) Ward 29 loaded and idle, (2) the tour's
 *  building step (evidence drawer at object zoom), (3) after the whole tour, idle. Who holds it: the sampling heap profiler
 *  (live samples only, after GC) grouped by the script that allocated them — Google Maps JS vs our bundles
 *  (deck.gl, React, the UI kit, the app). Native / code space is not in the samples. */
import { chromium, type CDPSession, type Page } from 'playwright'

const APP = process.env.APP_URL ?? 'http://localhost:5173/'
const RUNS = Number(process.argv[2] ?? 2)
type Node = { callFrame: { url: string }; selfSize: number; children: Node[] }

function bucket(url: string) {
  if (/maps\.googleapis|gstatic|google\.com/.test(url)) return 'Google Maps JS'
  const m = /assets\/([a-zA-Z]+)-[\w-]+\.js/.exec(url)
  if (m) return { deck: 'deck.gl', react: 'React', ui: 'UI kit (Radix, cmdk, motion, recharts)', index: 'app code' }[m[1]] ?? `app chunk ${m[1]}`
  return url ? 'other' : '(native / no script)'
}

async function measure(page: Page, cdp: CDPSession, label: string) {
  await page.waitForTimeout(1500)
  for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage')
  const { usedSize } = await cdp.send('Runtime.getHeapUsage') as { usedSize: number }
  const { profile } = await cdp.send('HeapProfiler.getSamplingProfile') as { profile: { head: Node } }
  const by: Record<string, number> = {}
  const walk = (n: Node) => { by[bucket(n.callFrame.url)] = (by[bucket(n.callFrame.url)] ?? 0) + n.selfSize; n.children.forEach(walk) }
  walk(profile.head)
  const tot = Object.values(by).reduce((a, b) => a + b, 0)
  const parts = Object.entries(by).sort((a, b) => b[1] - a[1]).filter(([, v]) => v / tot > 0.01)
    .map(([k, v]) => `${k} ${(100 * v / tot).toFixed(0)}%`).join(', ')
  console.log(`  ${label.padEnd(34)} ${(usedSize / 1048576).toFixed(1)} MB   (sampled live: ${parts})`)
  return usedSize / 1048576
}

async function run(i: number) {
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  await ctx.addInitScript(() => { localStorage.setItem('gc.tourSeen', '1'); localStorage.setItem('gc.area', JSON.stringify('ward29')); localStorage.setItem('gc.reviewer', JSON.stringify('heap check')) })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('HeapProfiler.enable')
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384 })
  console.log(`run ${i}`)
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.getByText('Buildings checked').first().waitFor({ timeout: 90_000 })
  await page.waitForTimeout(12_000)
  const a = await measure(page, cdp, 'Ward 29 loaded, idle (area level)')
  await page.getByRole('button', { name: 'Guided tour' }).click()
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Next' }).click()
  await page.waitForTimeout(9000)
  const b = await measure(page, cdp, 'tour step 2: building, evidence')
  for (let s = 0; s < 5; s++) { await page.getByRole('button', { name: 'Next' }).click(); await page.waitForTimeout(5000) }
  await page.getByRole('button', { name: 'Finish' }).click()
  await page.waitForTimeout(10_000)
  const c = await measure(page, cdp, 'after the whole tour, idle')
  await browser.close()
  return [a, b, c]
}

async function main() {
  const all: number[][] = []
  for (let i = 1; i <= RUNS; i++) all.push(await run(i))
  const fmt = (k: number) => all.map((r) => r[k].toFixed(1)).join(' / ')
  console.log(`\nJS heap (MB, ${RUNS} runs): idle ${fmt(0)} · building ${fmt(1)} · after tour ${fmt(2)} · target ≤ 60`)
}
main().catch((e) => { console.error(e); process.exit(1) })
