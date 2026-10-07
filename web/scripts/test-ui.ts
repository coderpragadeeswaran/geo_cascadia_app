/** Pure UI helpers (review fixes 10, 11, 13, 14), no browser: `npm run test:ui`. Exits 1 on the first failure. */
import { strict as assert } from 'node:assert'
import { placeLabels, placeMapLabels, type Rect } from '../src/lib/labelLayout'
import { byPriority, JOB_STAGES, jobStatus, matchLabel, priorityLabel, minutesText, planSlowText, planTooSlow, stageLine, stageProgress, stageShort, timeLeft } from '../src/lib/labels'
import { kpis, type Records } from '../src/lib/derive'
import { photoProblem, saveDecision } from '../src/lib/review'
import { article, costText, noun, plural, usd, withArticle } from '../src/lib/utils'
import { mainLine, pointAt, project, separate, slice } from '../src/map/trim'
import { pickedLines, streetKey } from '../src/map/analyse'
import { gapListOpen, panelOf } from '../src/store/ui'
import { CLS_LETTER, tagBoxes } from '../src/lib/photoTags'
import { answerOf, correctable, outcomeLine, reviewerSays, reviewQuestions } from '../src/lib/reviewQuestions'
import { swapNote, swapOf, swapWhen, showsBoxes, shownView, SAME_NOTE } from '../src/lib/photoSwap'

let n = 0
const t = (name: string, fn: () => void) => { fn(); n++; console.log('ok', name) }

t('plural: one helper, singular for 1', () => {
  assert.equal(plural(1, 'building'), '1 building')
  assert.equal(plural(2, 'building'), '2 buildings')
  assert.equal(plural(1, 'floor'), '1 floor')
  assert.equal(plural(0, 'street'), '0 streets')
  assert.equal(plural(1, 'dark stretch'), '1 dark stretch')
  assert.equal(plural(11, 'dark stretch'), '11 dark stretches')
  assert.equal(plural(1, 'business'), '1 business')
  assert.equal(plural(30, 'business'), '30 businesses')
  assert.equal(plural(1234, 'pole'), '1,234 poles')
  assert.equal(noun(1, 'pole or light', 'poles and lights'), 'pole or light')
})

t('cancelled job is neutral, failed stays red', () => {
  assert.deepEqual(jobStatus({ status: 'failed', message: 'cancelled by user' }), { key: 'cancelled', label: 'Cancelled', color: 'var(--ns-ink3)' })
  assert.equal(jobStatus({ status: 'failed', message: 'boom' }).label, 'Failed')
  assert.equal(jobStatus({ status: 'failed', message: 'boom' }).color, 'var(--ns-no-record)')
})

t('evidence labels stay inside the photo and never overlap', () => {
  const items = [
    { x1: 600, y1: 2, x2: 640, y2: 80, text: 'this streetlight · lamp 0.91', priority: 2 },   // top-right corner
    { x1: 590, y1: 10, x2: 638, y2: 60, text: 'pole 0.88', priority: 1 },
    { x1: 0, y1: 610, x2: 40, y2: 640, text: 'sign 0.55', priority: 1 },                     // bottom-left, under the caption
    ...Array.from({ length: 8 }, (_, i) => ({ x1: 200 + i * 6, y1: 200 + i * 4, x2: 300 + i * 6, y2: 320, text: `building 0.${60 + i}`, priority: 1 })),
  ]
  const spots = placeLabels(items)
  const placed = spots.filter((r): r is Rect => !!r)
  assert.ok(spots[0], 'the target label is always placed')
  assert.ok(placed.length >= items.length - 1, `placed ${placed.length} of ${items.length}`)
  for (const r of placed) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 640 && r.y + r.h <= 640 - 48 + 1e-9, JSON.stringify(r))
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i], b = placed[j]
    assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `overlap ${JSON.stringify([a, b])}`)
  }
})

t('trim: distances along the street, snapping and slicing', () => {
  // an L-shaped street ~ 200 m + 100 m near Coimbatore
  const lat = 11.03, kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540
  const pts: [number, number][] = [[77, lat], [77 + 200 / kx, lat], [77 + 200 / kx, lat + 100 / ky]]
  const m = mainLine({ type: 'MultiLineString', coordinates: [pts, [[77, lat], [77 + 10 / kx, lat]]] })!
  assert.ok(Math.abs(m.length - 300) < 0.5 && m.pieces === 2)
  const p = pointAt(m, 250)
  assert.ok(Math.abs(project(m, p) - 250) < 0.5)
  assert.ok(Math.abs(project(m, [77 + 120 / kx, lat + 30 / ky]) - 120) < 0.5)            // snaps to the nearest point
  const s = slice(m, 150, 250)
  assert.equal(s.length, 3)                                                                // keeps the corner
})

t('usd: tiny positive costs never show $0.0000', () => {
  assert.equal(usd(0.00002), '< $0.0001')
  assert.equal(usd(0.0002), '$0.0002')
  assert.equal(usd(0), '$0.0000')
  assert.equal(usd(null), '—')
  assert.equal(costText(1, 0), 'cost not recorded')              // 1 call stored at $0.0: unknown, not zero
  assert.equal(costText(0, 0), '$0.0000')
  assert.equal(costText(2, 0.00002), '< $0.0001')
  assert.equal(costText(2, 0.0012), '$0.0012')
})

t('P5: "Waiting for review" counts only items still waiting', () => {
  const q = (status: string, street = 'A') => ({ status, street }) as unknown as Records['review'][number]
  const r: Records = { buildings: [], assets: [], unmapped: [], gaps: [], review: [q('pending'), q('approved'), q('rejected'), q('pending', 'B'), q('appealed')] }
  assert.equal(kpis(r, null).waiting_for_review, 2)
  assert.equal(kpis(r, 'A').waiting_for_review, 1)
  assert.equal(kpis(r, null).low_confidence_observations, 5)                 // the queue size stays available
})

t('P5: a matched building with unknown use says "Register entry exists — use not compared"', () => {
  assert.equal(matchLabel('matched', true, false), 'Register entry exists — use not compared')
  assert.equal(matchLabel('matched', true, true), 'Matches the register')
  assert.equal(matchLabel('discrepancy', true, false), 'Differs from the register')
  assert.equal(matchLabel('no_record', false, false), 'Not in register')
})

t('a / an by sound, one helper', () => {
  for (const [w, a] of [['apartment', 'an'], ['office', 'an'], ['house', 'a'], ['shop', 'a'], ['university', 'a'], ['hour', 'an'],
    ['one-storey house', 'a'], ['institution', 'an'], ['under construction building', 'an'], ['NGO office', 'an'], ['vacant plot', 'a']] as const)
    assert.equal(article(w), a, w)
  assert.equal(withArticle('apartment', true), 'An apartment')
  assert.equal(withArticle('house'), 'a house')
})

t('P5: appeal photo limits (JPEG / PNG / WebP, ≤ 8 MB)', () => {
  const f = (type: string, size: number) => ({ type, size }) as File
  assert.equal(photoProblem(f('image/png', 1000)), null)
  assert.ok(photoProblem(f('image/gif', 1000)))
  assert.ok(photoProblem(f('image/jpeg', 8 * 1024 * 1024 + 1)))
})

async function sent(action: 'approve' | 'reject' | 'appeal') {
  let body: FormData | null = null
  globalThis.fetch = (async (_u: string, init: RequestInit) => { body = init.body as FormData; return new Response('{"offline":false}', { status: 200 }) }) as typeof fetch
  await saveDecision(1, action, { reviewer: 'test', note: 'typed in the appeal box', photo: new File(['x'], 'p.png', { type: 'image/png' }) })
  return body! as FormData
}
for (const action of ['approve', 'reject'] as const) {
  const fd = await sent(action)
  assert.equal(fd.get('note'), null, `${action} must not send the appeal note`)
  assert.equal(fd.get('photo'), null, `${action} must not send the appeal photo`)
  assert.equal(fd.get('reviewer'), 'test')
}
const ap = await sent('appeal')
assert.equal(ap.get('note'), 'typed in the appeal box')
assert.ok(ap.get('photo'))
n++; console.log('ok P5: a typed note / photo is sent only with Appeal; the reviewer name with every decision')

t('P6: job stages, progress and an honest time left', () => {
  assert.deepEqual(JOB_STAGES, ['panoramas', 'area', 'plan', 'detect', 'geometry', 'ocr', 'vlm', 'reference', 'match', 'export'])
  assert.equal(stageProgress(null), 0)
  assert.equal(stageProgress('detect', 20, 40), 0.35)                 // 3 stages done + half of the 4th, of 10
  assert.equal(stageProgress('done'), 1)
  // D35 (F2): the real stage number out of the real total; counts only where they mean something to people
  assert.equal(stageLine('detect', 12, 40), 'Stage 4 of 10 · Looking at photos · 12 of 40 photos')
  assert.equal(stageLine('plan', 5, 5), 'Stage 3 of 10 · Planning photos')
  assert.equal(stageLine('area', 5, 5), 'Stage 2 of 10 · Reading the map')
  assert.equal(stageLine(null), 'Starting')
  assert.equal(stageShort('plan'), '3/10')
  const est = { gpu_minutes: 6, cpu_minutes: 11 }
  assert.equal(timeLeft(120, 'gpu', est), 'about 4 minutes left (estimate)')
  assert.equal(timeLeft(60, 'cpu', est), 'about 10 minutes left (estimate)')
  assert.equal(timeLeft(600, 'gpu', est), 'taking longer than the estimate of 6 minutes')   // never a fake countdown
  assert.equal(timeLeft(30, 'gpu', { gpu_minutes: 0.3, cpu_minutes: null }), 'taking longer than the estimate of < 1 minute')
  // P7 R2 (F3): the sheet stops waiting for the planner after 90 s
  assert.equal(planTooSlow({ status: 'running', elapsed_s: 91 }), true)
  assert.equal(planTooSlow({ status: 'running', elapsed_s: 30 }), false)
  assert.equal(planTooSlow({ status: 'done', elapsed_s: 300 }), false)
  assert.equal(planSlowText(2), 'Estimate not available right now. You can still start — the $2 cap protects you.')
  // P7.1: a duration that rounds to 0 is "< 1 minute", never "0"
  assert.equal(minutesText(0.2), '< 1 minute')
  assert.equal(minutesText(0), '< 1 minute')
  assert.equal(minutesText(0.6), '1 minute')
  assert.equal(minutesText(71.1), '71 minutes')
  assert.equal(minutesText(null), '—')
  assert.equal(timeLeft(10, 'gpu', null), null)
  assert.deepEqual(jobStatus({ status: 'needs_approval', display_status: 'needs_approval' }).label, 'Needs approval')
  assert.equal(jobStatus({ status: 'running', display_status: 'interrupted' }).label, 'Interrupted')
  assert.equal(jobStatus({ status: 'running', display_status: 'cancelling' }).label, 'Cancelling…')
})

// D39: mini-map labels (GeoMini) — small, never overlapping each other, the markers or the corner plates; at most 3
const W8 = (t: string) => t.length * 7
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const box = (l: { x: number; y: number; text: string }) => ({ x: l.x - 2, y: l.y - 13, w: W8(l.text) + 4, h: 16 })
t('map labels: at most 3, inside the plan, never overlapping', () => {
  const reqs = Array.from({ length: 8 }, (_, i) => ({ text: `Street number ${i}`, cands: [[40, 60 + i * 5], [40, 120 + i * 20]] as [number, number][] }))
  const out = placeMapLabels(reqs, [], 480, 220, W8)
  assert.ok(out.length <= 3 && out.length > 0)
  for (const [i, a] of out.entries()) {
    const r = box(a)
    assert.ok(r.x >= 4 && r.x + r.w <= 476 && r.y >= 4 && r.y + r.h <= 216, 'inside')
    for (const b of out.slice(i + 1)) assert.ok(!overlaps(r, box(b)), 'no overlap')
  }
})
t('map labels: never over the corner plates or a marker; dropped when nothing is free', () => {
  const plates: Rect[] = [{ x: 450, y: 0, w: 30, h: 42 }, { x: 0, y: 188, w: 120, h: 32 }]
  const marker: Rect = { x: 94, y: 94, w: 12, h: 12 }
  const out = placeMapLabels([{ text: '11 m', cands: [[455, 20], [10, 205], [96, 104], [120, 90]] }], [...plates, marker], 480, 220, W8)
  assert.deepEqual(out.map((l) => [l.x, l.y]), [[120, 90]])                      // the first three candidates are covered
  assert.equal(placeMapLabels([{ text: 'camera stop', cands: [[96, 104]] }], [marker], 480, 220, W8).length, 0)
})
t('map labels: priority order wins the free spot', () => {
  const out = placeMapLabels([{ text: '9 m', cands: [[200, 100]], strong: true }, { text: 'Sathy Main Road', cands: [[200, 100], [200, 150]] }], [], 480, 220, W8)
  assert.deepEqual(out.map((l) => [l.text, l.y]), [['9 m', 100], ['Sathy Main Road', 150]])
})
t('trim handles: never overlap (short street, loop, far zoom); far apart = left alone (P7.1)', () => {
  const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y)
  const far = separate({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 })
  assert.deepEqual(far, [{ x: 0, y: 0 }, { x: 100, y: 0 }])                         // nothing to fix
  const short = separate({ x: 50, y: 50 }, { x: 58, y: 50 }, { x: -1, y: 0 }, { x: 1, y: 0 })
  assert.ok(dist(short[0], short[1]) >= 28 - 1e-9 && short[0].x < 50 && short[1].x > 58)   // pushed apart along the street
  const loop = separate({ x: 10, y: 10 }, { x: 10, y: 10 }, { x: 0, y: -1 }, { x: 0, y: 1 })
  assert.ok(dist(loop[0], loop[1]) >= 28 - 1e-9 && loop[0].y < loop[1].y)          // a loop: each end along its own way out
  const same = separate({ x: 10, y: 10 }, { x: 10, y: 10 }, { x: 0, y: 0 }, { x: 0, y: 0 })
  assert.ok(dist(same[0], same[1]) >= 28 - 1e-9)                                   // no direction known: still apart
})

t('lighting priority (D54): the list orders by points, then longer, then id; words for each level', () => {
  const g = (id: string, priority: string | null, priority_score: number | null, length_m: number) => ({ id, priority, priority_score, length_m })
  const rows = [g('a', 'low', 3, 400), g('b', 'high', 7, 100), g('c', 'high', 9, 50), g('d', 'medium', 6, 300), g('e', 'medium', 6, 310), g('f', null, null, 900)]
  assert.deepEqual([...rows].sort(byPriority).map((r) => r.id), ['c', 'b', 'e', 'd', 'a', 'f'])
  assert.deepEqual(['high', 'medium', 'low', null].map(priorityLabel), ['High', 'Medium', 'Low', 'Not available'])
})

t('D57: a stretch picked in a dark-stretch list keeps the list (card highlighted); elsewhere it opens the drawer', () => {
  const gap = { kind: 'streetlight_gap', id: 'gap60-002' } as never
  const base = { drive: null, query: null, builder: false, kpi: 'streetlight_gaps', panelOpen: false, analyse: false,
    filter: { gaps: true, street: 'Sathy Main Road' } } as never as Parameters<typeof panelOf>[0]
  assert.equal(panelOf({ ...base, selected: gap }), 'kpi')
  assert.equal(panelOf({ ...base, selected: { kind: 'building', id: 'w1' } as never }), 'evidence')
  assert.equal(panelOf({ ...base, kpi: null, filter: { street: 'Sathy Main Road' } as never, selected: gap }), 'evidence')
  const q = { intent: 'streetlight_gaps', rows: [] } as never
  assert.ok(gapListOpen({ ...base, kpi: null, filter: {} as never, query: q }))
  assert.ok(!gapListOpen({ ...base, kpi: null, filter: {} as never, query: { intent: 'buildings', rows: [] } as never }))
})
t('D57: two pieces of one street name are two streets; "include it" adds the other piece', () => {
  const lines = (c: number[][][]) => ({ type: 'MultiLineString' as const, coordinates: c })
  const one = { way_ids: [2, 1], street: 'X', length_m: 300, lines: lines([[[0, 0], [1, 0]]]) } as never
  assert.equal(streetKey(one), '1,2')                                               // a one-piece street: as before
  const a = { way_ids: [1, 2], street: 'X', length_m: 327, lines: lines([[[0, 0], [1, 0]]]), elsewhere: { length_m: 65, pieces: 1, lines: lines([[[5, 5], [6, 5]]]) } } as never
  const b = { way_ids: [1, 2], street: 'X', length_m: 65, lines: lines([[[5, 5], [6, 5]]]), elsewhere: { length_m: 327, pieces: 1, lines: lines([[[0, 0], [1, 0]]]) } } as never
  assert.notEqual(streetKey(a), streetKey(b))
  assert.equal(pickedLines(a, false)!.coordinates.length, 1)
  assert.equal(pickedLines(a, true)!.coordinates.length, 2)
  assert.equal(pickedLines(one, true)!.coordinates.length, 1)
})

t('ui-polish-2: photo tags are short letters, numbered per kind left to right; the orange box has none', () => {
  const box = (cls: 'building' | 'pole' | 'lamp_head' | 'signboard', x1: number, extra: object = {}) => ({ cls, x1, y1: 100, target: false, ...extra })
  const boxes = [box('building', 300, { target: true }), box('signboard', 400, { linked: true }), box('signboard', 100, { linked: true }),
    box('pole', 50), box('building', 500), box('lamp_head', 20)]
  const plain = tagBoxes(boxes, false)
  assert.deepEqual(plain.map((b) => [b.cls, b.tag]), [['signboard', 'S1'], ['signboard', 'S2'], ['building', null]])   // target last, no tag
  assert.equal(plain.find((b) => b.tag === 'S1')!.x1, 100)                         // numbered left to right
  const all = tagBoxes(boxes, true)
  assert.deepEqual(all.filter((b) => b.tag).map((b) => b.tag), ['B', 'L', 'P', 'S1', 'S2'])   // a single box of its kind: no number
  assert.deepEqual(tagBoxes(boxes, true, new Set(['pole'])).filter((b) => b.tag).map((b) => b.tag), ['B', 'L', 'S1', 'S2'])
  assert.equal(CLS_LETTER.lamp_head, 'L')
})

t('ui-polish-2 (D59): every review reason in the data has a plain question; Yes = the finding is right', () => {
  const B = (o: object = {}) => ({ attributes: { use: { value: 'commercial' }, floors: { value: 2, status: 'measured' }, name: { value: 'zinco' } },
    register: { record_use: 'residential', record_floors: 1, record_area_m2: 80, record_dist_m: 26 }, footprint: { area_m2: 140 }, ...o })
  const ask = (reasons: string[], b: object | null, discrepancies: string[] = [], item_type: 'building' | 'asset' = 'building', asset_cls: string | null = null) =>
    reviewQuestions({ item_type, reasons, discrepancies, asset_cls }, b as never, item_type === 'asset' ? { type: asset_cls } : null)
  const HS = 'high-severity discrepancy', AD = 'attribute discrepancy � verify on imagery', ONE = 'building seen from one view only'
  const FL = 'floor count low confidence (roofline not visible)', VLM = 'name read by VLM only (not supported by OCR)', SD = 'single-detection asset'
  let q = ask([HS], B({ match_status: 'no_record' }), ['missing_record'])
  assert.equal(q.main.text, 'Is there a building here that’s missing from the register?'); assert.deepEqual(q.main.values, [])
  q = ask([HS, FL], B({ match_status: 'no_record' }), ['missing_record'])
  assert.equal(q.main.kind, 'missing'); assert.equal(q.also[0].text, 'Does this building have 2 floors?'); assert.deepEqual(correctable(q).map((v) => v.kind), ['floors'])
  q = ask([AD], B({ match_status: 'discrepancy' }), ['extra_floor'])
  assert.equal(q.main.text, 'The register says 1 floor, the photo suggests 2 floors. Is the photo right?'); assert.equal(q.main.values[0].kind, 'floors')
  q = ask([AD, ONE], B({ match_status: 'discrepancy' }), ['use_change'])
  assert.equal(q.main.text, 'The register says residential, the photo suggests commercial. Is the photo right?')
  assert.equal(q.hint, 'Seen from one camera position only, so look closely.')
  q = ask([HS, AD, ONE], B({ match_status: 'discrepancy' }), ['location_shift', 'use_change'])
  assert.equal(q.main.text, 'The photo and the register differ. Is the photo right?')
  assert.deepEqual(q.main.lines, ['The register’s pin for this building is 26 m away from it.', 'The register says residential, the photo suggests commercial.'])
  q = ask([HS], B({ match_status: 'discrepancy' }), ['location_shift'])
  assert.equal(q.main.text, 'The register’s pin for this building is 26 m away from it. Is the pin in the wrong place?')
  q = ask([HS], B({ match_status: 'discrepancy' }), ['area_understated'])
  assert.equal(q.main.text, 'The register says 80 m², the map outline is 140 m². Is the building bigger than recorded?')
  assert.equal(ask([FL], B({ match_status: 'matched' })).main.text, 'Does this building have 2 floors?')
  assert.equal(ask([VLM], B({ match_status: 'matched' })).main.text, 'Does the sign say “zinco”?')
  assert.equal(ask([ONE], B({ match_status: 'discrepancy' }), ['area_understated']).main.text, 'Does the orange box show this building?')
  assert.equal(ask([SD], null, [], 'asset', 'streetlight').main.text, 'Is there a streetlight in the orange box?')
  assert.equal(ask([SD], null, [], 'asset', 'pole').main.text, 'Is there a pole in the orange box?')
  assert.equal(ask(['use low confidence'], B()).main.text, 'Is this building commercial?')
  assert.equal(ask(['something new'], B()).main.text, 'Something new. Is that right?')
})

t('ui-polish-2 (D59): one line after deciding says what was saved; the reviewer value is words, not a code', () => {
  const fl = reviewQuestions({ item_type: 'building', reasons: ['floor count low confidence (roofline not visible)'] }, { attributes: { floors: { value: 2 } } })
  assert.equal(outcomeLine(fl, 'yes'), 'Saved: reviewer confirmed 2 floors.')
  assert.equal(outcomeLine(fl, 'no', { floors: 3 }), 'Saved: reviewer says it has 3 floors, not 2.')
  assert.equal(outcomeLine(fl, 'no'), 'Saved: reviewer says it doesn’t have 2 floors.')
  const miss = reviewQuestions({ item_type: 'building', reasons: ['high-severity discrepancy'], discrepancies: ['missing_record'] }, { match_status: 'no_record' })
  assert.equal(outcomeLine(miss, 'yes'), 'Saved: reviewer confirmed it’s missing from the register.')
  assert.equal(outcomeLine(miss, 'no', { floors: 1 }), 'Saved: reviewer says it’s not a building missing from the register. Reviewer says: 1 floor.')
  assert.equal(reviewerSays({ floors: 2, use: 'mixed', name: 'Zinco' }), '2 floors · Shop + home · sign reads “Zinco”')
  assert.equal(reviewerSays(null), null)
  assert.equal(answerOf('approved'), 'Yes'); assert.equal(answerOf('rejected'), 'No')
})

t('D60: a photo Google no longer serves: current photo, plain label, "newer" only when it is', () => {
  const cur = { pano_id: 'N', heading: 146, pitch: 0, fov: 90, date: '2026-02', lat: 11, lon: 77, moved_m: 0.2 }
  assert.equal(swapOf(true, null, '2026-02').state, 'served')
  assert.equal(swapOf(null, null).state, 'served')                      // unknown: shown as before
  assert.equal(swapOf(undefined, undefined).state, 'served')
  const same = swapOf(false, cur, '2026-02')
  assert.equal(same.state, 'swapped'); assert.equal(swapWhen(same), 'same_month')
  assert.equal(swapNote(same), 'Current photo (Feb 2026) — Google no longer serves the photo used in the analysis, so its boxes can’t be shown. Taken on the same drive, less than 1 m from the analysis camera: a neighbouring photo, not the one the analysis used.')
  const newer = swapOf(false, { ...cur, date: '2026-05', moved_m: 3.4 }, '2022-11')
  assert.equal(swapNote(newer), 'Newer photo (May 2026) — Google no longer serves the photo used in the analysis, so its boxes can’t be shown.')
  assert.ok(swapNote(swapOf(false, { ...cur, date: '2021-01' }, '2022-11'))!.startsWith('Current photo (Jan 2021)'))
  assert.ok(swapNote(swapOf(false, { ...cur, moved_m: 4.7 }, '2026-02'))!.includes('same drive, 5 m from the analysis camera'))
  const none = swapOf(false, null, '2026-02')
  assert.equal(none.state, 'none'); assert.ok(swapNote(none)!.startsWith('No Street View photo available here any more'))
  assert.equal(swapNote(swapOf(true, null)), null)
})

t('D61: only a verified re-issue (same image) keeps the stored view and its boxes', () => {
  const cur = { pano_id: 'N', heading: 10, pitch: 0, fov: 90, date: '2026-02', lat: 11, lon: 77, moved_m: 0.1 }
  const view = { pano_id: 'OLD', heading: 146, pitch: 22, fov: 60 }
  const same = swapOf(false, { ...cur, same_image: true }, '2026-02')
  assert.equal(same.state, 'same'); assert.ok(showsBoxes(same)); assert.equal(swapNote(same), SAME_NOTE)
  assert.deepEqual(shownView(same, view), { ...view, pano_id: 'N' })      // new id, stored heading / pitch / fov
  const near = swapOf(false, cur, '2026-02')
  assert.equal(near.state, 'swapped'); assert.ok(!showsBoxes(near)); assert.equal(shownView(near, view), near.current)
  assert.ok(showsBoxes(swapOf(true, null))); assert.equal(shownView(swapOf(true, null), view), view)
})

await (async () => {
  let body: FormData | null = null
  globalThis.fetch = (async (_u: string, init: RequestInit) => { body = init.body as FormData; return new Response('{"offline":false}', { status: 200 }) }) as typeof fetch
  await saveDecision(1, 'reject', { reviewer: 'test', note: 'typed in the appeal box', photo: new File(['x'], 'p.png', { type: 'image/png' }), noNote: 'roof behind tree', corrected: { floors: 3 } })
  const fd = body! as FormData
  assert.equal(fd.get('note'), 'roof behind tree'); assert.equal(fd.get('photo'), null); assert.equal(fd.get('corrected'), '{"floors":3}')
  await saveDecision(1, 'approve', { reviewer: 'test', noNote: 'x', corrected: null })
  assert.equal((body! as FormData).get('note'), null); assert.equal((body! as FormData).get('corrected'), null)
})()
n++; console.log('ok ui-polish-2 (D59): a No sends its own note and the right value; the appeal box text still never goes with Yes / No')

console.log(`${n} UI tests passed`)
