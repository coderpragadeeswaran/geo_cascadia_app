/** Pure UI helpers (review fixes 10, 11, 13, 14), no browser: `npm run test:ui`. Exits 1 on the first failure. */
import { strict as assert } from 'node:assert'
import { placeLabels, type Rect } from '../src/lib/labelLayout'
import { jobStatus } from '../src/lib/labels'
import { noun, plural } from '../src/lib/utils'
import { mainLine, pointAt, project, slice } from '../src/map/trim'

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

console.log(`${n} UI tests passed`)
