/** Trust (VERIFIER page, D16; P5 / D29): why you can, and can't, trust each result.
 *  - Result cards (use, floors, names, streetlight seen / not seen, building position): what was measured, the sample
 *    size, the result vs the baseline, and a one-line verdict. Served by GET /trust, where every number carries `src`,
 *    its path in data/model_card.json (pytest resolves each one). Accuracy numbers come from nowhere else.
 *  - Production vs tried-and-dropped experiments as a timeline per topic.
 *  - No confusion matrix: model_card has per-class precision/recall only, so none is invented.
 *  - Stored vs computed, for all areas, with a jump to where each number appears.
 *  - Gate 1 (building position) with the same numbers as before, the detector benchmark, cost (§10 test 6), gap checks,
 *    limits and how questions are answered. Anchors: #/trust/<id> (results, use, floors, names, streetlights, detector,
 *    positions, gate1, matching, cost, rejected, consistency, gap-checks, limits, questions). */
import { ArrowRight, CircleCheck, CircleX, Minus } from 'lucide-react'
import { OsmLevelsSummary, OsmShopsSummary } from '@/components/OsmPanels'
import { SignBoxNote, SignRule } from '@/components/SignRule'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useConsistency, useRegisterTests, useTrust, type ConsistencyRow, type Experiment, type RegisterTests, type TrustCard, type TrustNum } from '@/api/p5'
import { useAreas, useModelCard } from '@/api/queries'
import type { GapProps } from '@/api/types'
import { CostPanel } from '@/components/CostPanel'
import { Badge, Card as Panel, jumpTo, REDUCED, SectionNav, Src, T, useDetail, useScrollSpy } from '@/components/Detail'
import { SYNONYM_HINTS } from '@/components/QueryHelp'
import { AlignedBars } from '@/components/viz'
import { KPI_DEFS, kpiFilter, kpis } from '@/lib/derive'
import { shortArea, cameraOnlyText } from '@/lib/labels'
import { useAreaData } from '@/lib/useAreaData'
import { cn, fmt, plural } from '@/lib/utils'
import { useUi } from '@/store/ui'

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
const pct = (v: unknown) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : String(v ?? '—'))
/** a stored / computed value as readable text: objects (counts per model route) become "local 193 / VLM 73" */
const ROUTE_WORD: Record<string, string> = { tier1_local_clip: 'local', tier3_vlm: 'VLM', tier3_vlm_fewshot: 'VLM few-shot', tier2_ocr: 'OCR',
  'tier3_vlm+ocr_gate': 'VLM + OCR gate', tier3_vlm_unverified: 'VLM only' }
const ROUTE_ORDER = ['tier1_local_clip', 'tier2_ocr', 'tier3_vlm', 'tier3_vlm_fewshot', 'tier3_vlm+ocr_gate', 'tier3_vlm_unverified']
export function readable(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'number') return fmt.format(v)
  if (Array.isArray(v)) return v.map(readable).join(', ')
  if (typeof v === 'object') {
    const e = Object.entries(v as Record<string, unknown>)
      .sort(([a], [b]) => (ROUTE_ORDER.indexOf(a) + 1 || 99) - (ROUTE_ORDER.indexOf(b) + 1 || 99))
    return e.map(([k, x]) => `${ROUTE_WORD[k] ?? k.replace(/_/g, ' ')} ${readable(x)}`).join(' / ')
  }
  return String(v)
}
const val = (x: TrustNum) => x.kind === 'pct' ? pct(x.value) : x.kind === 'pctn' ? `${x.value}%` : x.kind === 'm' ? `${x.value} m` : typeof x.value === 'number' ? fmt.format(x.value) : String(x.value)
const frac = (x: TrustNum | null) => !x || typeof x.value !== 'number' ? null : x.kind === 'pct' ? x.value : x.kind === 'pctn' ? x.value / 100 : null

const NAV: [string, string][] = [
  ['results', 'What each result is worth'], ['rejected', 'Tried and dropped'], ['detector', 'Detector'], ['positions', 'Pole & light positions'],
  ['gate1', 'Building position (Gate 1)'], ['signs', 'Which building a sign belongs to'], ['register-tests', 'Register tests (planted mistakes)'], ['matching', 'Register matching (notebook)'], ['cost', 'Cost: routed vs all-VLM'],
  ['consistency', 'Stored vs computed'], ['gap-checks', 'Gap length checks'], ['osm', 'OpenStreetMap cross-checks'], ['limits', 'Limits of this data'], ['questions', 'How questions are answered'],
]

/** D42/D43: caught / missed / false alarms per planted mistake kind, and pairing by location, per area (computed) */
const KIND_PLAIN: Record<string, string> = {
  missing_record: 'Record missing', location_shift: 'Pin in the wrong place', area_understated: 'Area too small',
  use_change: 'Wrong use', extra_floor: 'Too few floors recorded',
}
function RegisterTestsView() {
  const { data } = useRegisterTests()
  if (!data) return <p className="t-small ink3">Loading…</p>
  const t: RegisterTests['total'] = data.total
  const areas = data.areas.filter((a) => a.available)
  return (
    <div className="space-y-5">
      <div>
        <h4 className="t-micro mb-1">Planted mistakes, all areas together</h4>
        <table className="w-full max-w-[720px]"><tbody>
          <Tr head cells={['planted mistake', 'planted', 'caught', 'missed', 'false alarms']} />
          {Object.entries(t.recovery).map(([k, v]) => <Tr key={k} cells={[KIND_PLAIN[k] ?? k, v.planted, v.caught, v.missed, v.false_alarms]} />)}
        </tbody></table>
        <p className="t-small ink2 mt-2">Missed "pin in the wrong place" and the false alarms come from a moved pin that was paired with a
          neighbouring building: the record then looks like it belongs there, and its own building looks unrecorded.</p>
      </div>
      <div>
        <h4 className="t-micro mb-1">Records paired with their own building (ids hidden from the pairing)</h4>
        <p className="t-body">{fmt.format(t.pairing.paired_right)} of {fmt.format(t.pairing.records)} records ({t.pairing.right_pct}%); of the {t.pairing.moved} records whose pin was planted 15–40 m away, {t.pairing.moved_right} ({t.pairing.moved_right_pct}%).</p>
      </div>
      <div>
        <h4 className="t-micro mb-1">Per area</h4>
        <table className="w-full"><tbody>
          <Tr head cells={['area', 'records', 'paired right', 'moved pins paired right', 'mistakes planted', 'caught', 'false alarms']} />
          {areas.map((a) => {
            const rec = Object.values(a.recovery ?? {})
            return <Tr key={a.area} cells={[shortArea(a.name), a.records ?? '—', a.pairing ? `${a.pairing.all.paired_right} (${a.pairing.all.right_pct}%)` : '—',
              a.pairing && a.pairing.pin_moved.records ? `${a.pairing.pin_moved.paired_right} of ${a.pairing.pin_moved.records}` : '—',
              a.planted_total ?? '—', rec.reduce((n, r) => n + r.caught, 0), rec.reduce((n, r) => n + r.false_alarms, 0)]} />
          })}
        </tbody></table>
      </div>
      <p className="t-small ink3">{data.note}</p>
    </div>
  )
}

/** D45: single-camera pole error by camera distance (model_card) and the circle the map draws */
type PoleTable = { n: number; bands: { band_m: number[]; n: number; median_m: number | null; p80_m: number | null; surveyed_median_m?: number | null }[]; used_uncertainty_m: { up_to_m: number; plus_minus_m: number; basis?: string }[]; _note: string; notebook_surveyed_check: string }
function PoleDistance({ t }: { t: PoleTable }) {
  return (
    <div className="mt-5">
      <h4 className="t-micro mb-1">Single-camera poles: error by distance from the camera ({t.n} estimates)</h4>
      <table className="w-full max-w-[720px]"><tbody>
        <Tr head cells={['camera to pole', 'n', 'typical error (median)', '8 in 10 within', 'surveyed check (median)', 'circle on the map']} />
        {t.bands.map((b, i) => { const u = t.used_uncertainty_m[i]; return <Tr key={i} cells={[`${b.band_m[0]}–${b.band_m[1]} m`, b.n, b.median_m != null ? `${b.median_m} m` : '—', b.p80_m != null ? `${b.p80_m} m` : '—', b.surveyed_median_m != null ? `${b.surveyed_median_m} m` : '—', `±${u?.plus_minus_m ?? '—'} m${u?.basis ? ` (${u.basis.startsWith('surveyed') ? 'surveyed check' : '8 in 10'})` : ''}`]} /> })}
      </tbody></table>
      <p className="t-small ink2 mt-2">A pole seen from one camera position is placed from where its base meets the ground in the photo. For poles that two cameras pinpointed, each camera's own estimate was compared with the pinpointed spot (the "8 in 10" column). That check leans small, because only poles two cameras agreed on are in it. So each circle uses the larger of the "8 in 10" value and the earlier surveyed check at that distance, never smaller for a farther pole.</p>
      <p className="t-small ink2 mt-1">Between 8 and 15 m the surveyed check is larger (typical error 4.55 m), so those circles are ±5 m. That surveyed number is a median: about half of such poles fall inside the circle, not 8 in 10.</p>
      <p className="t-small ink3 mt-1">{t._note} Earlier surveyed check: {t.notebook_surveyed_check}.</p>
    </div>
  )
}

/** L1: every topic is its own panel with a heading, a divider and space around it */
function Sec({ id, title, children, lead }: { id: string; title: string; lead?: React.ReactNode; children: React.ReactNode }) {
  return <Panel id={id} title={title} lead={lead} className="mb-8">{children}</Panel>
}
const Tr = ({ cells, head }: { cells: React.ReactNode[]; head?: boolean }) => (
  <tr className="rule-b">{cells.map((c, i) => head ? <th key={i} className="t-micro py-1.5 pr-4 text-left font-[600]">{c}</th> : <td key={i} className={i ? 't-data py-1.5 pr-4' : 't-small py-1.5 pr-4'}>{c}</td>)}</tr>
)

export default function Trust() {
  const { data: mcRaw, isError: mcError } = useModelCard()
  const m = mcRaw as Any
  const trust = useTrust()
  const section = useUi((s) => s.section)
  const scroller = useRef<HTMLDivElement>(null)
  const detail = useDetail()
  const { records, detail: area, gaps } = useAreaData()
  const { data: areas } = useAreas()
  useEffect(() => {
    if (!m || !trust.data || !section) return
    const t = setTimeout(() => document.getElementById(section)?.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }), 100)
    return () => clearTimeout(t)
  }, [m, trust.data, section])
  const active = useScrollSpy(NAV.map(([id]) => id), scroller, [!!m, !!trust.data])
  const gapRows = useMemo(() => gaps.map((g) => g.props as GapProps).filter((g) => g.length_differs || g.display_mode === 'check').sort((a, b) => b.length_m - a.length_m), [gaps])
  if (mcError || trust.isError) return <p className="t-small ink2 p-10">Couldn’t load the model card from the API. <button className="link" onClick={() => trust.refetch()}>Try again</button></p>
  if (!m || !trust.data) return <div className="space-y-4 p-10" aria-busy="true">{[0, 1].map((i) => <div key={i} className="h-40 animate-pulse rounded-[var(--ns-r-sheet)] bg-line" />)}<p className="t-small ink3">Loading the model card…</p></div>
  const k = records ? kpis(records, null) : null
  const cls = m.detector.per_class as Record<string, { P: number; R: number; n: number }>
  return (
    <div className="grid h-full grid-cols-[220px_minmax(0,1fr)]">
      <div className="min-h-0 overflow-y-auto" style={{ borderRight: '1px solid var(--ns-line)' }}><SectionNav items={NAV} active={active} onJump={jumpTo} /></div>
      <div ref={scroller} className="min-h-0 overflow-y-auto px-10 py-8">
        <div className="mx-auto max-w-[920px]">
          <div className="t-micro">Trust · every accuracy figure comes from the team’s model card</div>
          <h1 className="t-display mt-2 mb-3">Why you can, and can’t, trust each result</h1>
          <p className="t-small ink2 mb-6 max-w-[700px]"><T plain="Each result below was checked against hand-labelled examples. The small numbers (n) say how many examples were checked: the fewer, the less certain. Registers are synthetic: no open municipal data exists."
            tech={<>{m._note} Every figure on this page is read from <span className="t-data">data/model_card.json</span> (GET /trust carries each value’s path; pytest resolves them). Registers are SYNTHETIC with planted errors.</>} /></p>

          <Sec id="results" title="What each result is worth" lead={<T plain="One card per kind of result: what we checked, how many examples, how often it was right, and what it is compared with." tech="cards(): result vs baseline, n and src paths into model_card.json." />}>
            <div className="grid gap-4 md:grid-cols-2">{trust.data.cards.map((c) => <Card key={c.id} c={c} />)}</div>
          </Sec>

          <Sec id="rejected" title="Tried and dropped" lead={<T plain="What we tried, what it scored, and why the version in use won. Filled dots are in use; crossed ones were rejected."
            tech="experiments(): one lane per topic, in the order tried; statuses production / replaced / tried / rejected / withheld; numbers with model_card paths (D5: floors production shown apart from the rejected variants)." />}>
            <Experiments items={trust.data.experiments} />
          </Sec>

          <Sec id="detector" title={`Detector · ${m.detector.production.split(' (')[0]}`} lead={<T plain={`Checked on ${m.detector.test_set.split(' (')[0]}. Recall = how many of the real objects it found; precision = how many of its boxes were right.`} tech={<>Test set: {m.detector.test_set}. Weighted F1 {m.detector.weighted_F1}. GPU {m.detector.gpu_ms_per_view} ms / CPU {m.detector.cpu_ms_per_view} ms per view.</>} />}>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <div className="t-micro mb-2">Per class · found (recall) and right (precision)</div>
                {Object.entries(cls).map(([c, v]) => (
                  <div key={c} className="mb-3">
                    <div className="t-small mb-1">{c.replace('_', ' ')} <span className="ink3">· n={v.n}</span></div>
                    <AlignedBars fmtV={(x) => `${Math.round(x * 100)}%`} rows={[{ key: 'R', label: 'found', value: v.R }, { key: 'P', label: 'right', value: v.P, tone: 'var(--ns-sodium-glow)' }]} />
                  </div>
                ))}
                <Src>model_card.detector.per_class.&lt;class&gt;.P / R / n</Src>
              </div>
              <div>
                <div className="t-micro mb-2">Benchmark · decision: {m.detector.decision}</div>
                {(['F1', 'pole_R', 'lamp_R', 'cpu_ms'] as const).map((key) => (
                  <div key={key} className="mb-3">
                    <div className="t-small mb-1">{{ F1: 'F1 (overall)', pole_R: 'poles found', lamp_R: 'lamp heads found', cpu_ms: 'CPU time per photo (lower is better)' }[key]}</div>
                    <AlignedBars fmtV={(x) => (key === 'F1' ? x.toFixed(3) : key === 'cpu_ms' ? `${x} ms` : `${Math.round(x * 100)}%`)}
                      rows={(m.detector.benchmark as Any[]).map((b) => ({ key: b.model, label: b.model.replace(' (production)', ' ★'), value: b[key], tone: /production/.test(b.model) ? 'var(--ns-sodium)' : 'var(--ns-ink3)' }))} />
                  </div>
                ))}
                {(m.detector.benchmark as Any[]).filter((b) => b.downstream).map((b) => <p key={b.model} className="t-small ink2">Why {b.model} was not adopted: {b.downstream}.</p>)}
              </div>
            </div>
            <SignBoxNote />
            <p className="t-small ink3 mt-3">{trust.data.confusion_note}</p>
          </Sec>

          <Sec id="positions" title="Positions of poles and streetlights" lead={<T plain="How close a pole or lamp is placed to where it really stands." tech="model_card.positions" />}>
            <table className="w-full max-w-[720px]"><tbody>
              <Tr cells={['Triangulation error (synthetic test)', m.positions.synthetic_triangulation_error_m + ' m']} />
              <Tr cells={['Independent camera check: triangulated on or near', m.positions.independent_camera_check_n30.triangulated_on_or_near]} />
              <Tr cells={['Independent camera check: single camera on or near', m.positions.independent_camera_check_n30.single_camera_on_or_near]} />
              <Tr cells={['Pin-noise stress (σ 0 m → 10 m)', `${m.positions.pin_noise_stress.sigma_0m} → ${m.positions.pin_noise_stress.sigma_10m}`]} />
            </tbody></table>
            <p className="t-small ink2 mt-2">Conclusion: {m.positions.independent_camera_check_n30.conclusion}.</p>
            {m.single_camera_by_distance && <PoleDistance t={m.single_camera_by_distance} />}
          </Sec>

          {m.gate1_position && <Gate1 g={m.gate1_position} names={Object.fromEntries((areas ?? []).map((a) => [a.slug, shortArea(a.name)]))} />}

          <Sec id="signs" title="Which building a sign belongs to" lead={<T plain="How a shop sign in a photo is linked to a building, how that was checked, and a spot-check anyone can redo."
            tech="model_card.sign_links (tools/validate_sign_links.py); /trust/sign-links: sign_spotcheck.json (tools/sign_spotcheck.py, seed 2026) + sign_spotcheck_ai.json (AI first pass)." />}>
            <SignRule />
          </Sec>
          <Sec id="register-tests" title="Register tests: planted mistakes and pairing by location"
            lead={<T plain="Each area's register is made-up: it copies what the photos show, except a few planted mistakes. Records are paired with buildings by position only (never by a shared ID). This tests the comparison logic end to end on made-up data; real accuracy needs a real register."
              tech="D42/D43. GET /trust/register: planted_register_mistakes.json and register_synthetic.json (the hidden truth) vs the exported records, per area. Computed, not typed." />}>
            <RegisterTestsView />
          </Sec>

          <Sec id="matching" title="Register matching (planted errors, notebook era)" lead={m.matching_planted_errors.note}>
            <table className="w-full max-w-[640px]"><tbody>
              <Tr head cells={['what', 'precision', 'recall']} />
              <Tr cells={['property geometry', pct(m.matching_planted_errors.property_geometry.P), pct(m.matching_planted_errors.property_geometry.R)]} />
              {Object.entries(m.matching_planted_errors.asset as Record<string, { P: number; R: number }>).map(([k2, v]) => <Tr key={k2} cells={[`asset: ${k2.replace(/_/g, ' ')}`, pct(v.P), pct(v.R)]} />)}
            </tbody></table>
          </Sec>

          <Sec id="cost" title="Cost and accuracy: routed vs all-VLM"><CostPanel /></Sec>

          <Sec id="consistency" title="Stored vs computed" lead={<T plain="Where a number saved by the pipeline disagrees with a fresh count of the results, both are listed here, and the app shows the counted one."
            tech="D2: countable facts are computed from export.json records (backend/app/derived.py, hood.py); stored counters, run_report fields and story[] sentences that differ are listed for every area (GET /trust/consistency)." />}>
            <Consistency detail={detail} />
          </Sec>

          <Sec id="gap-checks" title={`Gap length checks · ${area ? shortArea(area.name) : ''}`}
            lead="The pipeline records each dark stretch’s length with a straight-line fit. The app measures it again along the street line; where they differ by more than 10 %, or lit camera stops lie inside the stretch, it is listed here. The recorded length stays the value shown everywhere (D13).">
            {gapRows.length ? (
              <table className="w-full"><tbody>
                <Tr head cells={['stretch', 'recorded', 'along the road', 'check']} />
                {gapRows.map((g) => <Tr key={g.id} cells={[`${g.id} · ${g.street}`, `${fmt.format(g.length_m)} m`, g.along_road_m != null && g.display_mode === 'along_road' ? `≈ ${fmt.format(g.along_road_m)} m` : '—',
                  <span key="c" className="t-small ink2">{g.display_mode === 'check' ? g.note : 'along-road length differs by more than 10 %'}</span>]} />)}
              </tbody></table>
            ) : <p className="t-small ink3">No gap needs a check in this area ({plural(gaps.length, 'dark stretch')}).</p>}
          </Sec>

          <Sec id="osm" title={`OpenStreetMap cross-checks · ${area ? shortArea(area.name) : ''}`}
            lead="A real reference next to the synthetic register. OpenStreetMap is crowd-sourced (volunteers), not an official register, so these are cross-checks, not accuracy: nothing here changes our results.">
            <OsmShopsSummary area={area?.slug ?? null} />
            <div className="mt-4"><OsmLevelsSummary area={area?.slug ?? null} /></div>
          </Sec>

          <Sec id="limits" title="Limits of this data">
            <ul className="t-small space-y-2">
              {k && <li><b>Use not classified:</b> {fmt.format(k.use_not_classified)} of {plural(k.buildings_analysed, 'building')} in {area ? shortArea(area.name) : 'this area'} had no usable view for use (shown as “use not known”, never hidden). Where a register entry exists for them, the app says “Register entry exists — use not compared”.</li>}
              {areas?.filter((a) => a.coverage.share_views_no_mapped_building != null).map((a) => (
                <li key={a.slug}><b>{shortArea(a.name)}:</b> {pct(a.coverage.share_views_no_mapped_building)} of camera views face frontage with no OpenStreetMap building outline; buildings are checked only where an outline exists ({fmt.format(a.counts.buildings)}{a.counts.camera_only_buildings ? `; ${cameraOnlyText(a.counts.camera_only_buildings)}, not checked` : ''}), lights and signs everywhere.</li>
              ))}
              {k && <li><b>Positions:</b> {fmt.format(k.assets - k.assets_triangulated)} of {plural(k.assets, 'pole or streetlight')} here were seen from one camera only; they are approximate and go to review ({m.positions.independent_camera_check_n30.single_camera_on_or_near} single-camera positions were close to where a second camera placed them, a consistency check, not surveyed positions).</li>}
              <li><b>Streetlights:</b> the detector finds lamp heads in photos; it cannot tell whether a lamp works. A VLM check was rejected ({m.streetlights.vlm_lamp_check}).</li>
              <li><b>Registers:</b> synthetic, with planted errors; real municipal registers were not available.</li>
              <li><b>Withheld:</b> facade condition and door numbers are not shown as findings (see “Tried and dropped”).</li>
              <li><b>Timings:</b> the stored runs were resumed, so their stage times are not representative; they are shown greyed on Under the Hood. Ward 29’s full-run GPU time comes from the model card.</li>
            </ul>
          </Sec>

          <Sec id="questions" title="How questions are answered: rules, not an AI model"
            lead="The ask bar uses the pipeline’s own rule-based QueryEngine plus a short list of synonyms. There is no LLM in this step.">
            <ul className="t-small space-y-1.5">
              <li><b>Deterministic:</b> the same question always gives the same answer.</li>
              <li><b>Offline:</b> no model or internet call is made to read a question.</li>
              <li><b>Explainable:</b> every filter it read is shown as a chip; an empty answer shows the step that removed the last result; words no rule uses are listed as ignored, and nothing is applied until you confirm.</li>
            </ul>
            <div className="t-micro mt-4">Synonyms (docs/QUERY.md has the full list and the patterns)</div>
            <table className="mt-1"><tbody>{SYNONYM_HINTS.map(([a, b]) => <Tr key={b} cells={[a, `→ ${b}`]} />)}</tbody></table>
          </Sec>
        </div>
      </div>
    </div>
  )
}

function Card({ c }: { c: TrustCard }) {
  const detail = useDetail()
  const r = frac(c.result), b = frac(c.baseline)
  const n = c.result.n ?? c.baseline?.n
  const ids: Record<string, string> = { use: 'use', floors: 'floors', names: 'names', streetlights: 'streetlights', position: 'position-card', use_sign: 'use-sign' }
  return (
    <article id={ids[c.id]} className="scroll-mt-6 flex flex-col rounded-[var(--ns-r-sheet)] p-4" style={{ boxShadow: 'inset 0 0 0 1px var(--ns-line-strong)' }}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="t-title">{c.title}</h3>
        {n != null && <Badge tone={n < 20 ? 'warn' : 'muted'}>n={n}</Badge>}
      </div>
      <p className="t-small ink3 mt-0.5">{c.measured}</p>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="t-figure" style={{ fontSize: 36, color: 'var(--ns-sodium)' }}>{val(c.result)}</span>
        <span className="t-small ink2">{c.result.label}</span>
      </div>
      {c.baseline && (r != null && b != null ? (
        <div className="mt-2">
          <AlignedBars fmtV={(x) => `${Math.round(x * 100)}%`} rows={[{ key: 'r', label: 'this method', value: r }, { key: 'b', label: 'compared with', value: b, tone: 'var(--ns-ink3)' }]} />
          <p className="t-small ink3 mt-0.5">compared with: {c.baseline.label}</p>
        </div>
      ) : <p className="t-small ink2 mt-1">Compared with: {c.baseline.label} — {val(c.baseline)}</p>)}
      <p className="t-body mt-3">{c.verdict}</p>
      {c.caveat && <p className="t-small ink3 mt-1">{c.caveat}</p>}
      {!!c.more.length && (
        <dl className="t-small mt-3 space-y-0.5">
          {c.more.map((x) => (
            <div key={x.src + x.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
              <dt className="ink2">{x.label}{x.n != null ? <span className="ink3"> (n={x.n})</span> : null}</dt><dd className={x.kind === 'text' ? 't-small text-right' : 't-data text-right'}>{val(x)}</dd>
              {detail === 'technical' && <dd className="col-span-2"><Src>{x.src}</Src></dd>}
            </div>
          ))}
        </dl>
      )}
      <p className="t-small ink3 mt-2">{c.result.src
        ? <>Source: the team’s model card, checked by hand{n != null ? ` on ${plural(n, 'example')}` : ''}. Method: {c.method}.</>
        : <>Source: a fixed rule in the analysis, not checked by hand yet. Rule: {c.method}.</>}</p>
      {detail === 'technical' && <div className="mt-2"><Src>method: {c.method}</Src><Src>result: {c.result.src}{c.result.n_src ? ` · n: ${c.result.n_src}` : ''}</Src>{c.baseline && <Src>baseline: {c.baseline.src}</Src>}</div>}
      <div className="flex-1" />
      <button className="link t-small mt-3 inline-flex items-center gap-1 self-start" onClick={() => useUi.getState().go('trust', c.section)}>More detail <ArrowRight className="size-3.5" /></button>
    </article>
  )
}

const STATUS_ICON: Record<Experiment['status'], React.ReactNode> = {
  production: <CircleCheck className="size-5" style={{ color: 'var(--ns-sodium)' }} />,
  rejected: <CircleX className="size-5" style={{ color: 'var(--ns-no-record)' }} />,
  replaced: <Minus className="size-5 ink3" />, tried: <Minus className="size-5 ink3" />, withheld: <CircleX className="size-5 ink3" />,
}
const STATUS_WORD: Record<Experiment['status'], string> = { production: 'in use', rejected: 'rejected', replaced: 'replaced', tried: 'tried, not adopted', withheld: 'withheld' }

function Experiments({ items }: { items: Experiment[] }) {
  const detail = useDetail()
  const lanes = [...new Set(items.map((x) => x.lane))]
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="space-y-6">
      {lanes.map((lane) => {
        const xs = items.filter((x) => x.lane === lane)
        return (
          <div key={lane}>
            <div className="t-micro mb-2">{lane}</div>
            <ol className="relative grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(xs.length, 1)}, minmax(0, 1fr))` }}>
              <span className="absolute left-[10px] right-4 top-[10px] h-px" style={{ background: 'var(--ns-line-strong)' }} aria-hidden />
              {xs.map((x) => {
                const id = `${lane}:${x.name}`
                return (
                  <li key={id} className="relative min-w-0">
                    <button className="flex cursor-pointer items-center gap-1.5 rounded-full pr-2 text-left" style={{ background: 'var(--ns-bg1)' }} onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id}>
                      {STATUS_ICON[x.status]}<span className="t-micro" style={{ color: x.status === 'production' ? 'var(--ns-sodium)' : 'var(--ns-ink3)' }}>{STATUS_WORD[x.status]}</span>
                    </button>
                    <div className={cn('t-small mt-1.5', x.status === 'production' ? 'text-ink' : 'ink2')} style={{ fontWeight: x.status === 'production' ? 600 : 400 }}>{x.name}</div>
                    <div className="mt-0.5 space-y-0.5">{x.numbers.map((nn) => nn.kind === 'text'
                      ? <div key={nn.src} className="t-small ink2">{x.numbers.length > 1 ? `${nn.label}: ` : ''}{String(nn.value).replace(`${x.name} `, '')}</div>
                      : <div key={nn.src} className="t-small"><span className="ink3">{nn.label}</span> <span className="t-data">{val(nn)}</span></div>)}</div>
                    {x.why && !x.numbers.some((nn) => String(nn.value).includes(x.why!)) && (open === id || detail === 'technical' || x.status === 'rejected') && <p className="t-small ink3 mt-0.5">{x.why}</p>}
                    {detail === 'technical' && x.src && <Src>{x.src}</Src>}
                  </li>
                )
              })}
            </ol>
          </div>
        )
      })}
    </div>
  )
}

function Consistency({ detail }: { detail: string }) {
  const { data, isPending, isError } = useConsistency()
  const setArea = useUi((s) => s.setArea)
  if (isPending) return <p className="t-small ink3">Checking every area…</p>
  if (isError || !data) return <p className="t-small ink2">Couldn’t load the list.</p>
  if (!data.length) return <p className="t-small ink3">No differences in any area.</p>
  const jump = (r: ConsistencyRow) => {
    setArea(r.area)
    const ui = useUi.getState()
    if (r.jump.page === 'explore') {
      const street = /\(([^)]+)\)\s*$/.exec(r.field)?.[1] ?? null
      ui.go('explore')
      ui.setFilter(kpiFilter(KPI_DEFS.find((d) => d.key === 'streetlight_gaps')!, street), { kpi: 'streetlight_gaps', frame: true })
    } else ui.go(r.jump.page, r.jump.section)
  }
  const where = (r: ConsistencyRow) => r.jump.page === 'hood' ? `Under the hood › ${r.jump.section}` : r.jump.page === 'trust' ? `Trust › ${r.jump.section}` : 'on the map'
  const areas = [...new Set(data.map((r) => r.area))]
  return (
    <div className="space-y-6">
      {areas.map((a) => {
        const rows = data.filter((r) => r.area === a)
        return (
          <div key={a}>
            <div className="t-micro mb-1">{shortArea(rows[0].area_name)} · {plural(rows.length, 'difference')}</div>
            <ul>
              {rows.map((r, i) => {
                const story = r.field.startsWith('run_report.story')
                return (
                  <li key={i} className="rule-t py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="t-small" style={{ fontWeight: 560 }}>{detail === 'technical' ? <span className="t-data">{r.field}</span> : plainField(r.field)}</span>
                      <button className="link t-small inline-flex items-center gap-1" onClick={() => jump(r)}>Show {where(r)} <ArrowRight className="size-3.5" /></button>
                    </div>
                    <div className={cn('mt-1 grid gap-x-4 gap-y-0.5', story ? 'grid-cols-1' : 'grid-cols-2 max-w-[640px]')}>
                      <div className="t-small"><span className="ink3">stored: </span><span className={story ? 'line-through ink3' : 't-data'}>{readable(r.stored)}</span></div>
                      <div className="t-small"><span className="ink3">{story ? 'now: ' : 'counted: '}</span><span className={story ? '' : 't-data sodium'}>{readable(r.computed)}</span></div>
                    </div>
                    {r.note && <p className="t-small ink3 mt-0.5">{r.note}</p>}
                    <p className="t-small ink3 mt-0.5">Stored in: {plainSource(r.source)}</p>
                    {detail === 'technical' && <Src>{r.source}</Src>}
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

function plainSource(src: string) {
  if (/story/.test(src)) return 'the saved run summary'
  if (/run_report/.test(src)) return 'the saved run report'
  if (/meta\.run|meta/.test(src)) return 'the run’s saved counters'
  if (/model_card/.test(src)) return 'the model card'
  if (/streets/.test(src)) return 'the saved results and the street map'
  return 'the saved results'
}

function plainField(f: string) {
  if (f.startsWith('run_report.story')) return `A sentence of the run summary (${/\(([^)]+)\)/.exec(f)?.[1] ?? 'story'})`
  if (/buildings_use_local|use_route|full_ward29_run/.test(f)) return 'Buildings decided by the local model vs the cloud model'
  if (/triangulated_2plus|single_camera/.test(f)) return 'Poles and lights pinpointed vs approximate'
  if (/floors\.validated/.test(f)) return 'Floor accuracy quoted inside the records'
  if (f.startsWith('streetlight_gaps')) return `Length of a dark stretch (${/\(([^)]+)\)/.exec(f)?.[1] ?? ''})`
  return f
}

/** D27: building position accuracy vs the FarmwiseAI Gate 1 target. Every number from model_card.json "gate1_position"
 *  (written by tools/eval_gate1.py); nothing computed here. Same numbers as before P5. */
const M = (v: unknown) => (typeof v === 'number' ? `${v} m` : '—')
const P = (v: unknown) => (typeof v === 'number' ? `${v}%` : '—')
/** a method row of a Gate 1 table, in plain words, with whether the point comes from the map footprint itself (D33) */
const PLAIN: [RegExp, string][] = [[/^triangulated/, 'Where camera views cross (cameras only)'], [/^wall_hit/, 'Camera line of sight on the map wall'],
  [/^wall_centre/, 'Front-wall centre from the map (no camera line of sight)'], [/^footprint_centre/, 'Middle of the outline'],
  [/^camera-derived/, 'All camera-derived positions (the two camera methods together)'], [/^all buildings/, 'All buildings'],
  [/^baseline/, 'Baseline: the middle of the outline, for every building'], [/^footprint centroid/, 'Baseline: the middle of the outline']]
function rowInfo(k: string) {
  const label = PLAIN.find(([re]) => re.test(k))?.[1] ?? k
  const map = /uses (the )?map|fallback|centroid|^wall_centre|^footprint_centre|^baseline/.test(k)
  return { label, map, circular: /^wall_centre/.test(k), pooled: /^all buildings/.test(k) }
}
const statRows = (o: Any) => Object.entries(o ?? {}).filter(([, v]) => v && typeof v === 'object' && typeof (v as Any).n === 'number' && (v as Any).n > 0) as [string, Any][]
/** noPooled (P7 R3): leave out the pooled "all buildings" row where the reference is the map itself: it mixes in points that
 *  score 0 m by construction (front-wall centre; wall hit vs the wall line), so it flatters the result (D27, D33). */
function MethodTable({ data, slugs, nm, target, front, noPooled }: { data: Any; slugs: string[]; nm: (s: string) => string; target: number; front?: boolean; noPooled?: boolean }) {
  return (
    <table className="w-full"><tbody>
      <Tr head cells={['area · method', 'n', 'median', 'p90', `≤ ${target} m`]} />
      {slugs.flatMap((s) => {
        const a = data?.[s] ?? {}
        const head = a.status ? [<tr key={s + 's'} className="rule-b"><td colSpan={5} className="t-small ink3 py-1.5">{nm(s)} · {a.status}</td></tr>] : []
        return [...head, ...statRows(a).filter(([k]) => k !== 'pin_vs_osm_wall' && !(noPooled && rowInfo(k).pooled)).map(([k, x]) => {
          const r = rowInfo(k)
          return <Tr key={s + k} cells={[<span key="l" className="t-small">{nm(s)} · {r.label}{r.map && <> <Badge>uses the map</Badge></>}
            {front && r.circular && <span className="ink3"> — this is the reference point itself (0 m by construction)</span>}
            {front && r.pooled && <span className="ink3"> — includes front-wall-centre points (0 m by construction)</span>}</span>,
          fmt.format(x.n), M(x.median_m), M(x.p90_m), P(x.within_3_5_m_pct)]} />
        })]
      })}
    </tbody></table>
  )
}

function Gate1({ g, names }: { g: Any; names: Record<string, string> }) {
  const slugs = Object.keys(g.method_counts ?? {}).sort((a, b) => (g.method_counts[b].buildings ?? 0) - (g.method_counts[a].buildings ?? 0))
  const nm = (s: string) => names[s] ?? s
  const wall = g['vs OSM wall'] ?? {}, pin = g['vs Google pin'] ?? {}, front = g['vs OSM front-wall centre']
  return (
    <Sec id="gate1" title={`Position accuracy — target ≤ ${g.target_m} m (FarmwiseAI Gate 1)`}
      lead={<>Where each building is, predicted from the camera rays; the building&apos;s map position stays its footprint centre.</>}>
      {g.organiser_guidance && <p className="t-body mb-3" style={{ fontWeight: 560 }}>{g.organiser_guidance}</p>}
      <div className="flex flex-wrap items-start gap-3 rounded-[var(--ns-r-sheet)] px-4 py-3" style={{ boxShadow: 'inset 0 0 0 1px var(--ns-discrepancy)' }}>
        <Badge tone="ok">Status: {g.status === 'not verified' ? 'Not verified' : g.status}</Badge>
        <span className="t-small ink2 min-w-0 flex-1">{g.status_note} No surveyed reference exists.</span>
      </div>
      <ul className="t-small ink2 mt-3 space-y-0.5">
        <li><b className="text-ink">Triangulated:</b> {g.rule?.triangulated}</li>
        <li><b className="text-ink">Wall hit:</b> {g.rule?.wall_hit}</li>
        {g.rule?.wall_centre && <li><b className="text-ink">Front-wall centre:</b> {g.rule.wall_centre}</li>}
        <li><b className="text-ink">Middle of the outline:</b> {g.rule?.footprint_centre}</li>
        {g.rule?.wall_hit_aim && <li><b className="text-ink">Camera aim:</b> {g.rule.wall_hit_aim}</li>}
        <li><b className="text-ink">Uncertainty:</b> {g.rule?.uncertainty_m}</li>
        {g.rule?.plausibility && <li><b className="text-ink">Plausibility:</b> {g.rule.plausibility}</li>}
      </ul>

      <h3 className="t-micro mt-6 mb-2">Method per building</h3>
      <div className="space-y-2">
        {slugs.map((s) => {
          const c = g.method_counts[s]
          const tot = c.buildings || 1
          return (
            <div key={s} className="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-3">
              <span className="t-small">{nm(s)} <span className="t-data ink3">{fmt.format(c.buildings)}</span></span>
              <div>
                <div className="flex h-3 gap-[2px] overflow-hidden" style={{ borderRadius: 3 }}>
                  <span title={`triangulated ${c.triangulated}`} style={{ width: `${(100 * c.triangulated) / tot}%`, background: 'var(--ns-sodium)' }} />
                  <span title={`wall hit ${c.wall_hit}`} style={{ width: `${(100 * c.wall_hit) / tot}%`, background: 'var(--ns-sodium-glow)' }} />
                  <span title={`front-wall centre ${c.wall_centre ?? 0}`} style={{ width: `${(100 * (c.wall_centre ?? 0)) / tot}%`, background: 'var(--ns-line-strong)' }} />
                  <span title={`middle of the outline ${c.footprint_centre}`} style={{ width: `${(100 * c.footprint_centre) / tot}%`, background: 'var(--ns-unclassified)' }} />
                </div>
                <div className="t-data ink2 mt-0.5 text-[13px]">cameras cross {fmt.format(c.triangulated)} · line of sight on the wall {fmt.format(c.wall_hit)} · front-wall centre {fmt.format(c.wall_centre ?? 0)} · middle of the outline {fmt.format(c.footprint_centre)} · camera result rejected (&gt; 10 m off) {fmt.format(c.triangulation_rejected ?? 0)}</div>
              </div>
            </div>
          )
        })}
      </div>

      <h3 className="t-micro mt-6 mb-1">Self-consistency (precision, triangulated only)</h3>
      <p className="t-small ink3 mb-1">Each camera pair that sees both wall corners gives its own estimate; the spread is its distance from the final point. It measures precision, not accuracy.</p>
      <table className="w-full"><tbody>
        <Tr head cells={['area', 'triangulated', 'with an estimate', 'median spread', 'p90 spread', 'not estimated']} />
        {slugs.map((s) => { const c = g.self_consistency?.[s] ?? {}; return <Tr key={s} cells={[nm(s), fmt.format(c.triangulated ?? 0), fmt.format(c.n ?? 0), M(c.median_m), M(c.p90_m), fmt.format(c.not_estimated ?? 0)]} /> })}
      </tbody></table>

      {front && <>
        <h3 className="t-micro mt-6 mb-1">vs the centre of the OSM front wall (the organiser’s reference)</h3>
        <p className="t-small ink2 mb-1">Distance from each predicted point to the midpoint of the building’s road-facing wall on OpenStreetMap. Methods marked “uses the map” take their point from the footprint itself; the front-wall-centre method is that point, so it scores 0 m by construction and is not evidence of accuracy. The camera-derived row is the fair measure.</p>
        <MethodTable data={front} slugs={slugs} nm={nm} target={g.target_m} front noPooled />
        <p className="t-small ink3 mt-1">No pooled “all buildings” figure is shown: it would count the front-wall-centre points, which score 0 m by construction.</p>
      </>}

      <h3 className="t-micro mt-6 mb-1">vs the OSM wall line (distance to the road-facing wall anywhere along it)</h3>
      <p className="t-small ink2 mb-1">The pass rate rose mainly because implausible points (&gt;10 m from the wall) were rejected, and the check and the score use the same wall, so this is a comparison, not accuracy.</p>
      <MethodTable data={wall} slugs={slugs} nm={nm} target={g.target_m} noPooled />

      <h3 className="t-micro mt-6 mb-1">vs Google pin (Places, sign name within 50 m)</h3>
      <p className="t-small ink3 mb-1">Computed before the front-wall-centre change and not re-run (it needs new Google look-ups); the middle-of-the-outline rows there refer to the old fallback.</p>
      <MethodTable data={pin} slugs={slugs} nm={nm} target={g.target_m} />

      <h3 className="t-micro mt-6 mb-1">How far the two references disagree (Google pin vs OSM wall, same buildings)</h3>
      <table className="w-full"><tbody>
        <Tr head cells={['area', 'n', 'median', 'p90']} />
        {slugs.map((s) => { const d = pin[s]?.pin_vs_osm_wall; return d?.n ? <Tr key={s} cells={[nm(s), fmt.format(d.n), M(d.median_m), M(d.p90_m)]} /> : null })}
      </tbody></table>
      <p className="t-small mt-4">{g.status_note}</p>
    </Sec>
  )
}
