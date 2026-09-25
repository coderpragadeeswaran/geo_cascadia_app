/**
 * P0 data check: validates every data/areas/<slug>/export.json + run_report.json and data/model_card.json against
 * the STRICT schemas in src/types (an undocumented field or unexpected enum value fails), then prints counts.
 * Usage: npm run check:data
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { makeExportSchemas } from '../src/types/export'
import { makeRunReportSchemas } from '../src/types/runReport'
import { makeModelCardSchemas } from '../src/types/modelCard'
import type { z } from 'zod'

const DATA = resolve(import.meta.dirname, '..', '..', 'data')
const { AreaExport } = makeExportSchemas('strict')
const { RunReport } = makeRunReportSchemas('strict')
const { ModelCard } = makeModelCardSchemas('strict')
const read = (p: string) => JSON.parse(readFileSync(p, 'utf-8'))
let failed = 0

function check(label: string, schema: z.ZodType, data: unknown) {
  const r = schema.safeParse(data)
  if (r.success) return console.log(`  ok   ${label}`)
  failed++
  console.log(`  FAIL ${label} — ${r.error.issues.length} issue(s)`)
  for (const i of r.error.issues.slice(0, 12)) console.log(`       ${i.path.join('.')}: ${i.message}`)
}

check('model_card.json', ModelCard, read(join(DATA, 'model_card.json')))
const slugs = readdirSync(join(DATA, 'areas')).filter((s) => existsSync(join(DATA, 'areas', s, 'export.json')))
const rows: Record<string, unknown>[] = []
for (const slug of slugs) {
  const dir = join(DATA, 'areas', slug)
  const exp = read(join(dir, 'export.json'))
  check(`${slug}/export.json`, AreaExport, exp)
  const rr = join(dir, 'run_report.json')
  if (existsSync(rr)) check(`${slug}/run_report.json`, RunReport, read(rr))
  else { failed++; console.log(`  FAIL ${slug}/run_report.json missing — run: python tools/p0_setup.py`) }
  rows.push({
    slug, area: exp.meta.area, buildings: exp.buildings.length, assets: exp.assets.length,
    gaps_60m: exp.streetlight_gaps.length, review: exp.review_queue.length, unmapped: (exp.unmapped_businesses ?? []).length,
    missing_assets: exp.missing_asset_records.length,
  })
}
console.table(rows)
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1) }
console.log('all data files match the schemas')
