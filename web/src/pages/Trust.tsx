/** Trust (VERIFIER page, D16): every measured number with its n, from model_card.json only (D2); what we tried and
 *  dropped; stored-vs-computed mismatches; gap-length checks; the limits of this data; how questions are answered (no
 *  LLM); cost & accuracy routed vs all-VLM (§10 test 6). Section anchors (#/trust/<id>) are the targets of "How do we
 *  know?" links. P5 extends this page (benchmark chart, per-class detail). */
import { useEffect, useMemo } from 'react'
import { useAreas, useBuildings, useModelCard } from '@/api/queries'
import type { GapProps } from '@/api/types'
import { CostPanel } from '@/components/CostPanel'
import { SYNONYM_HINTS } from '@/components/QueryHelp'
import { kpis } from '@/lib/derive'
import { shortArea } from '@/lib/labels'
import { useAreaData } from '@/lib/useAreaData'
import { fmt, plural } from '@/lib/utils'
import { useUi } from '@/store/ui'

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
const pct = (v: unknown) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : String(v ?? '—'))
/** a stored / computed value as readable text: objects (e.g. counts per model route) become "local 193 / VLM 73" */
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
const REDUCED = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const NAV: [string, string][] = [
  ['questions', 'How questions are answered'], ['detector', 'Detector'], ['use', 'Building use'], ['floors', 'Floors'], ['names', 'Shop names'],
  ['positions', 'Positions'], ['gate1', 'Building position (Gate 1)'], ['matching', 'Register matching'], ['cost', 'Cost: routed vs all-VLM'], ['rejected', 'Tried and dropped'],
  ['consistency', 'Stored vs computed'], ['gap-checks', 'Gap length checks'], ['limits', 'Limits of this data'],
]

function Sec({ id, title, children, lead }: { id: string; title: string; lead?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 rule-t pb-10 pt-6">
      <h2 className="t-title" style={{ fontSize: 22 }}>{title}</h2>
      {lead && <p className="t-small ink2 mt-1 max-w-[680px]">{lead}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}
const Figure = ({ k, v, s }: { k: string; v: React.ReactNode; s?: React.ReactNode }) => (
  <div><div className="t-micro">{k}</div><div className="t-figure mt-1">{v}</div>{s && <div className="t-data ink3 mt-1">{s}</div>}</div>
)
const Tr = ({ cells, head }: { cells: React.ReactNode[]; head?: boolean }) => (
  <tr className="rule-b">{cells.map((c, i) => head ? <th key={i} className="t-micro py-1.5 pr-4 text-left font-[600]">{c}</th> : <td key={i} className={i ? 't-data py-1.5 pr-4' : 't-small py-1.5 pr-4'}>{c}</td>)}</tr>
)

export default function Trust() {
  const { data } = useModelCard()
  const m = data as Any
  const section = useUi((s) => s.section)
  const area = useUi((s) => s.area)
  const { records, detail, gaps } = useAreaData()
  // D2: counts come from the export, not the model_card counter (the accuracy figures are model_card's)
  const { data: w29 } = useBuildings('ward29')
  const w29Routes = useMemo(() => w29 ? { local: w29.filter((b) => b.attributes?.use?.route === 'tier1_local_clip').length,
    vlm: w29.filter((b) => b.attributes?.use?.route === 'tier3_vlm').length } : null, [w29])
  const { data: areas } = useAreas()
  useEffect(() => {
    if (!m || !section) return
    const t = setTimeout(() => document.getElementById(section)?.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }), 80)
    return () => clearTimeout(t)
  }, [m, section])
  const gapRows = useMemo(() => gaps.map((g) => g.props as GapProps).filter((g) => g.length_differs || g.display_mode === 'check').sort((a, b) => b.length_m - a.length_m), [gaps])
  if (!m) return <p className="t-small ink3 p-10">Loading the model card…</p>
  const cls = m.detector.per_class as Record<string, { P: number; R: number; n: number }>
  const k = records ? kpis(records, null) : null
  const lr = m.building_use.local_router
  return (
    <div className="grid h-full grid-cols-[220px_minmax(0,1fr)]">
      <nav className="min-h-0 overflow-y-auto px-5 py-8" style={{ borderRight: '1px solid var(--ns-line)' }} aria-label="Trust sections">
        <div className="t-micro mb-2">On this page</div>
        {NAV.map(([id, label]) => (
          <button key={id} onClick={() => useUi.getState().go('trust', id)} className="t-small block w-full cursor-pointer py-1 text-left hover:text-ink"
            style={{ color: section === id ? 'var(--ns-sodium)' : 'var(--ns-ink2)' }}>{label}</button>
        ))}
      </nav>
      <div className="min-h-0 overflow-y-auto px-10 py-8">
        <div className="mx-auto max-w-[900px]">
          <div className="t-micro">Trust · every number from model_card.json</div>
          <h1 className="t-display mt-2 mb-3">What we measured, what we dropped, and the limits</h1>
          <p className="t-small ink2 mb-6 max-w-[680px]">{m._note} Registers are SYNTHETIC with planted errors: no open municipal data exists.</p>

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

          <Sec id="detector" title={`Detector · ${m.detector.production.split(' (')[0]}`} lead={`Test set: ${m.detector.test_set}. Weighted F1 ${m.detector.weighted_F1}.`}>
            <table className="w-full max-w-[640px]"><tbody>
              <Tr head cells={['class', 'precision', 'recall', 'n']} />
              {Object.entries(cls).map(([c, v]) => <Tr key={c} cells={[c.replace('_', ' '), pct(v.P), pct(v.R), v.n]} />)}
            </tbody></table>
            <div className="t-micro mt-5">Benchmark · decision: {m.detector.decision}</div>
            <table className="mt-1 w-full max-w-[720px]"><tbody>
              <Tr head cells={['model', 'F1', 'pole recall', 'lamp recall', 'CPU ms / view']} />
              {(m.detector.benchmark as Any[]).map((b) => <Tr key={b.model} cells={[b.model, b.F1, pct(b.pole_R), pct(b.lamp_R), b.cpu_ms]} />)}
            </tbody></table>
            {(m.detector.benchmark as Any[]).filter((b) => b.downstream).map((b) => <p key={b.model} className="t-small ink2 mt-2">Why {b.model} was not adopted: {b.downstream}.</p>)}
          </Sec>

          <Sec id="use" title="Building use">
            <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
              <Figure k="VLM accuracy" v={pct(m.building_use.vlm_accuracy.value)} s={`n ${m.building_use.vlm_accuracy.n} · ${m.building_use.vlm_accuracy.metric}`} />
              <Figure k="Routed (held-out)" v={pct(lr.ward29_heldout.routed)} s={`local ${pct(lr.ward29_heldout.local_only)} · VLM ${pct(lr.ward29_heldout.vlm_only)} · n ${lr.ward29_heldout.n}`} />
              <Figure k="Trichy (unseen)" v={pct(lr.trichy_unseen.routed)} s={`n ${lr.trichy_unseen.n} · escalated ${pct(lr.trichy_unseen.escalated)}`} />
              <Figure k="Full Ward 29 run" v={w29Routes ? `${w29Routes.local} / ${w29Routes.vlm}` : '…'}
                s={<>local / VLM, counted from the export · accuracy {pct(lr.full_ward29_run.use_accuracy_after)} (n {lr.full_ward29_run.n})<br />model_card counter: {lr.full_ward29_run.local} / {lr.full_ward29_run.vlm} (VLM-stage records, see Stored vs computed)</>} />
            </div>
            <p className="t-small ink2 mt-3">Local router: {lr.method}.</p>
          </Sec>

          <Sec id="floors" title="Floors" lead={`Production method: ${m.floors.method}.`}>
            <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
              <Figure k="Ward 29 exact" v={pct(m.floors.ward29.exact)} s={`±1 floor ${pct(m.floors.ward29.within_1)} · n ${m.floors.ward29.n}`} />
              <Figure k="Baseline exact" v={pct(m.floors.ward29.baseline_exact)} s="before the few-shot prompt" />
              <Figure k="Trichy exact" v={pct(m.floors.trichy_unseen.exact)} s={`±1 ${pct(m.floors.trichy_unseen.within_1)} · n ${m.floors.trichy_unseen.n}`} />
            </div>
            {m.floors.trichy_unseen.note && <p className="t-small ink2 mt-3">Trichy: {m.floors.trichy_unseen.note}.</p>}
            <p className="t-small ink3 mt-1">Rejected variants are listed under “Tried and dropped”, separate from production.</p>
          </Sec>

          <Sec id="names" title="Shop names">
            <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
              <Figure k="Routed OCR → VLM" v={pct(m.names.crop_level_n31.routed_ocr_then_vlm)} s={`OCR only ${pct(m.names.crop_level_n31.ocr_only)} · all-VLM ${pct(m.names.crop_level_n31.all_vlm)} · n 31`} />
              <Figure k="Full views" v={pct(m.names.full_view_n16.routed)} s={`all-VLM ${pct(m.names.full_view_n16.all_vlm_per_view)} · n 16 · cost ${m.names.full_view_n16.cost_ratio}`} />
              <Figure k="On Google (Ward 29)" v={m.names.google_confirmed.ward29} s={`Trichy ${m.names.google_confirmed.trichy_unseen} · chance ${pct(m.names.google_confirmed.chance_rate)}`} />
            </div>
            <p className="t-small ink2 mt-3">{m.names.vlm_only_names_confirmed}. VLM invented names on non-business crops: {m.names.vlm_invented_names_on_non_business_crops}.</p>
            <p className="t-small ink2 mt-1">OCR: {m.ocr.engine}; fast CPU mode {m.ocr.cpu_fast_mode.sec_per_crop} s/crop, routed {pct(m.ocr.cpu_fast_mode.routed_accuracy)} (n {m.ocr.cpu_fast_mode.n}); {m.ocr.cpu_fast_mode.crop_cap}.</p>
          </Sec>

          <Sec id="positions" title="Positions of poles and streetlights">
            <table className="w-full max-w-[720px]"><tbody>
              <Tr cells={['Triangulation error (synthetic test)', m.positions.synthetic_triangulation_error_m + ' m']} />
              <Tr cells={['Independent camera check: triangulated on or near', m.positions.independent_camera_check_n30.triangulated_on_or_near]} />
              <Tr cells={['Independent camera check: single camera on or near', m.positions.independent_camera_check_n30.single_camera_on_or_near]} />
              <Tr cells={['Pin-noise stress (σ 0 m → 10 m)', `${m.positions.pin_noise_stress.sigma_0m} → ${m.positions.pin_noise_stress.sigma_10m}`]} />
            </tbody></table>
            <p className="t-small ink2 mt-2">Conclusion: {m.positions.independent_camera_check_n30.conclusion}.</p>
          </Sec>

          {m.gate1_position && <Gate1 g={m.gate1_position} names={Object.fromEntries((areas ?? []).map((a) => [a.slug, shortArea(a.name)]))} />}
          <Sec id="matching" title="Register matching (planted errors)" lead={m.matching_planted_errors.note}>
            <table className="w-full max-w-[640px]"><tbody>
              <Tr head cells={['what', 'precision', 'recall']} />
              <Tr cells={['property geometry', pct(m.matching_planted_errors.property_geometry.P), pct(m.matching_planted_errors.property_geometry.R)]} />
              {Object.entries(m.matching_planted_errors.asset as Record<string, { P: number; R: number }>).map(([k2, v]) => <Tr key={k2} cells={[`asset: ${k2.replace(/_/g, ' ')}`, pct(v.P), pct(v.R)]} />)}
            </tbody></table>
          </Sec>

          <Sec id="cost" title="Cost and accuracy: routed vs all-VLM"><CostPanel /></Sec>

          <Sec id="rejected" title="What we tried and dropped">
            <table className="w-full"><tbody>
              {[['VLM lamp check', m.streetlights.vlm_lamp_check], ['Detector “no lamp” verdicts', m.streetlights.detector_no_lamp_verdict],
                ...(m.floors.rejected_variants as string[]).map((v, i) => [i ? '' : 'Floors: other prompts', v]),
                ['Facade condition', m.withheld.facade_condition], ['Door numbers', m.withheld.door_numbers],
                ['Google Places as a use signal', `${pct(m.building_use.google_places_as_use_signal.value)} (n ${m.building_use.google_places_as_use_signal.n}) → ${m.building_use.google_places_as_use_signal.decision}`],
                ...(m.detector.benchmark as Any[]).filter((b) => b.downstream).map((b) => [b.model, b.downstream])].map(([a, b], i) => <Tr key={i} cells={[a, <span key="v" className="t-small">{b}</span>]} />)}
            </tbody></table>
          </Sec>

          <Sec id="consistency" title={`Stored vs computed · ${detail ? shortArea(detail.name) : ''}`}
            lead="Counts are computed from the records. Where a stored counter or sentence differs, both are listed here instead of hiding one (D2).">
            {detail?.consistency?.length ? (
              <table className="w-full"><tbody>
                <Tr head cells={['field', 'stored', 'computed', 'note']} />
                {detail.consistency.map((c, i) => <Tr key={i} cells={[c.field, readable(c.stored), readable(c.computed), <span key="n" className="t-small ink2">{c.note}</span>]} />)}
              </tbody></table>
            ) : <p className="t-small ink3">No differences for this area.</p>}
          </Sec>

          <Sec id="gap-checks" title={`Gap length checks · ${detail ? shortArea(detail.name) : ''}`}
            lead="The pipeline records each dark stretch’s length with a straight-line fit. The app measures it again along the street line; where they differ by more than 10 %, or lit camera stops lie inside the stretch, it is listed here. The recorded length stays the value shown everywhere (D13).">
            {gapRows.length ? (
              <table className="w-full"><tbody>
                <Tr head cells={['stretch', 'recorded', 'along the road', 'check']} />
                {gapRows.map((g) => <Tr key={g.id} cells={[`${g.id} · ${g.street}`, `${fmt.format(g.length_m)} m`, g.along_road_m != null && g.display_mode === 'along_road' ? `≈ ${fmt.format(g.along_road_m)} m` : '—',
                  <span key="c" className="t-small ink2">{g.display_mode === 'check' ? g.note : 'along-road length differs by more than 10 %'}</span>]} />)}
              </tbody></table>
            ) : <p className="t-small ink3">No gap needs a check in this area ({plural(gaps.length, 'dark stretch')}).</p>}
          </Sec>

          <Sec id="limits" title="Limits of this data">
            <ul className="t-small space-y-2">
              {k && <li><b>Use not classified:</b> {fmt.format(k.use_not_classified)} of {plural(k.buildings_analysed, 'building')} in {detail ? shortArea(detail.name) : 'this area'} had no usable view for use (shown as “use not known”, never hidden).</li>}
              {areas?.filter((a) => a.coverage.share_views_no_mapped_building != null).map((a) => (
                <li key={a.slug}><b>{shortArea(a.name)}:</b> {pct(a.coverage.share_views_no_mapped_building)} of camera views face frontage with no OpenStreetMap building outline; buildings are checked only where an outline exists ({fmt.format(a.counts.buildings)}), lights and signs everywhere.</li>
              ))}
              {k && <li><b>Positions:</b> {fmt.format(k.assets - k.assets_triangulated)} of {plural(k.assets, 'pole or streetlight')} here were seen from one camera only; they are approximate and go to review ({m.positions.independent_camera_check_n30.single_camera_on_or_near} single-camera positions were close to where a second camera placed them, a consistency check, not surveyed positions).</li>}
              <li><b>Streetlights:</b> the detector finds lamp heads in photos; it cannot tell whether a lamp works. A VLM check was rejected ({m.streetlights.vlm_lamp_check}).</li>
              <li><b>Registers:</b> synthetic, with planted errors; real municipal registers were not available.</li>
              <li><b>Withheld:</b> facade condition and door numbers are not shown as findings (see “Tried and dropped”).</li>
              <li><b>Timings:</b> the stored runs were resumed, so their stage times are not representative and are not shown; Ward 29’s full-run GPU time comes from the model card.</li>
            </ul>
            <p className="t-small ink3 mt-4">Area: {area}. Switch areas from the Explore top bar.</p>
          </Sec>
        </div>
      </div>
    </div>
  )
}

/** D27: building position accuracy vs the FarmwiseAI Gate 1 target. Every number from model_card.json "gate1_position"
 *  (written by tools/eval_gate1.py); nothing computed here. */
const M = (v: unknown) => (typeof v === 'number' ? `${v} m` : '—')
const P = (v: unknown) => (typeof v === 'number' ? `${v}%` : '—')
const METHOD_ROWS: [string, string][] = [['triangulated', 'Triangulated'], ['wall_hit (uses map footprint)', 'Wall hit (uses map footprint: on the wall by construction)'],
  ['footprint_centre (fallback)', 'Footprint centre (fallback)']]

function Gate1({ g, names }: { g: Any; names: Record<string, string> }) {
  const slugs = Object.keys(g.method_counts ?? {}).sort((a, b) => (g.method_counts[b].buildings ?? 0) - (g.method_counts[a].buildings ?? 0))
  const nm = (s: string) => names[s] ?? s
  const wall = g['vs OSM wall'] ?? {}, pin = g['vs Google pin'] ?? {}
  return (
    <Sec id="gate1" title={`Position accuracy — target ≤ ${g.target_m} m (FarmwiseAI Gate 1)`}
      lead={<>Where each building is, predicted from the camera rays; the building&apos;s map position stays its footprint centre.</>}>
      <p className="flex flex-wrap items-center gap-2">
        <span className="chip px-2.5 text-[14.5px]" style={{ borderColor: 'var(--ns-discrepancy)', color: 'var(--ns-discrepancy)' }}>Status: {g.status === 'not verified' ? 'Not verified' : g.status}</span>
        <span className="t-small ink2">{g.status_note}</span>
      </p>
      <ul className="t-small ink2 mt-3 space-y-0.5">
        <li><b className="text-ink">Triangulated:</b> {g.rule?.triangulated}</li>
        <li><b className="text-ink">Wall hit:</b> {g.rule?.wall_hit}</li>
        <li><b className="text-ink">Footprint centre:</b> {g.rule?.footprint_centre}</li>
        <li><b className="text-ink">Uncertainty:</b> {g.rule?.uncertainty_m}</li>
        {g.rule?.plausibility && <li><b className="text-ink">Plausibility:</b> {g.rule.plausibility}</li>}
      </ul>

      <h3 className="t-micro mt-6 mb-1">Method per building</h3>
      <table className="w-full"><tbody>
        <Tr head cells={['area', 'buildings', 'triangulated', 'wall hit', 'footprint centre', 'triangulation rejected (> 10 m off)']} />
        {slugs.map((s) => { const c = g.method_counts[s]; return <Tr key={s} cells={[nm(s), fmt.format(c.buildings), fmt.format(c.triangulated), fmt.format(c.wall_hit), fmt.format(c.footprint_centre), fmt.format(c.triangulation_rejected ?? 0)]} /> })}
      </tbody></table>

      <h3 className="t-micro mt-6 mb-1">Self-consistency (precision, triangulated only)</h3>
      <p className="t-small ink3 mb-1">Each camera pair that sees both wall corners gives its own estimate; the spread is its distance from the final point. It measures precision, not accuracy.</p>
      <table className="w-full"><tbody>
        <Tr head cells={['area', 'triangulated', 'with an estimate', 'median spread', 'p90 spread', 'not estimated']} />
        {slugs.map((s) => { const c = g.self_consistency?.[s] ?? {}; return <Tr key={s} cells={[nm(s), fmt.format(c.triangulated ?? 0), fmt.format(c.n ?? 0), M(c.median_m), M(c.p90_m), fmt.format(c.not_estimated ?? 0)]} /> })}
      </tbody></table>

      <h3 className="t-micro mt-6 mb-1">vs OSM wall (distance to the road-facing footprint edge)</h3>
      <p className="t-small ink2 mb-1">The pass rate rose mainly because implausible points (&gt;10 m from the wall) were rejected, and the check and the score use the same wall, so this is a comparison, not accuracy.</p>
      <table className="w-full"><tbody>
        <Tr head cells={['area · method', 'n', 'median', 'p90', `≤ ${g.target_m} m`]} />
        {slugs.flatMap((s) => METHOD_ROWS.map(([k, label]) => { const x = wall[s]?.[k]; return x?.n ? <Tr key={s + k} cells={[`${nm(s)} · ${label}`, fmt.format(x.n), M(x.median_m), M(x.p90_m), P(x.within_3_5_m_pct)]} /> : null }))}
      </tbody></table>

      <h3 className="t-micro mt-6 mb-1">vs Google pin (Places, sign name within 50 m)</h3>
      <table className="w-full"><tbody>
        <Tr head cells={['area · method', 'n', 'median', 'p90', `≤ ${g.target_m} m`]} />
        {slugs.flatMap((s) => {
          const a = pin[s] ?? {}
          if (a.status) return [<Tr key={s} cells={[`${nm(s)} · ${a.status}`, '—', '—', '—', '—']} />]
          const mr = a.match_rate ?? {}
          return [<Tr key={s + 'm'} cells={[`${nm(s)} · matched: ${plural(mr.buildings_with_sign_text ?? 0, 'building')} with sign text → ${fmt.format(mr.used ?? 0)} with a place`, '', '', '', '']} />,
            ...METHOD_ROWS.map(([k, label]) => { const x = a[k]; return x?.n ? <Tr key={s + k} cells={[`${nm(s)} · ${label}`, fmt.format(x.n), M(x.median_m), M(x.p90_m), P(x.within_3_5_m_pct)]} /> : null })]
        })}
      </tbody></table>

      <h3 className="t-micro mt-6 mb-1">How far the two references disagree (Google pin vs OSM wall, same buildings)</h3>
      <table className="w-full"><tbody>
        <Tr head cells={['area', 'n', 'median', 'p90']} />
        {slugs.map((s) => { const d = pin[s]?.pin_vs_osm_wall; return d?.n ? <Tr key={s} cells={[nm(s), fmt.format(d.n), M(d.median_m), M(d.p90_m)]} /> : null })}
      </tbody></table>
      <p className="t-small mt-4">{g.status_note}</p>
    </Sec>
  )
}

