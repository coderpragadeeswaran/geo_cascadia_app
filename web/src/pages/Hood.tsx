/** Under the Hood (VERIFIER page, D16) as a scroll story (preview 07): each chapter a counted-up figure, one sentence and a
 *  kept-vs-dropped bar. Pipeline-internal counts come from run_report.json; countable facts (buildings, assets,
 *  triangulated, dark stretches, businesses, review items) are computed from the records (D2). No timings: the stored
 *  runs were resumed, so their stage times are not representative (D1). Section anchors (#/hood/<id>) are the targets
 *  of "How do we know?" links. P5 adds the Sankey, stage timeline, cost waterfall and run comparison. */
import { useEffect, useRef, useState } from 'react'
import { useAreas } from '@/api/queries'
import { kpis } from '@/lib/derive'
import { shortArea } from '@/lib/labels'
import { useAreaData } from '@/lib/useAreaData'
import { fmt, plural } from '@/lib/utils'
import { useUi } from '@/store/ui'

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
const REDUCED = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
interface Seg { v: number; label: string; kind: 'kept' | 'drop' | 'find' }
interface Chapter { id: string; n: string; figure: number; unit: string; line: string; segs?: Seg[]; note?: string }

function useInView<T extends Element>() {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(REDUCED)
  useEffect(() => {
    if (!ref.current || seen) return
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect() } }, { threshold: 0.3 })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [seen])
  return [ref, seen] as const
}

function CountUp({ to, run }: { to: number; run: boolean }) {
  const [v, setV] = useState(REDUCED ? to : 0)
  useEffect(() => {
    if (REDUCED) { setV(to); return }
    if (!run) return
    let raf = 0; const t0 = performance.now()
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / 900); setV(Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, run])
  return <>{fmt.format(v)}</>
}

const SEG_BG: Record<Seg['kind'], string> = {
  kept: 'var(--ns-sodium)', find: 'var(--ns-no-record)',
  drop: 'repeating-linear-gradient(135deg, var(--ns-ink3) 0 1.5px, transparent 1.5px 5px)',
}

function Step({ c, last }: { c: Chapter; last: boolean }) {
  const [ref, seen] = useInView<HTMLLIElement>()
  const total = c.segs?.reduce((n, s) => n + s.v, 0) ?? 0
  return (
    <li ref={ref} id={c.id} className="relative grid scroll-mt-6 grid-cols-[56px_1fr] gap-4 pb-12"
      style={{ opacity: seen ? 1 : 0.15, transform: seen ? 'none' : 'translateY(12px)', transition: 'opacity 600ms var(--ns-ease), transform 600ms var(--ns-ease)' }}>
      <div className="relative flex flex-col items-center">
        <span className="t-data sodium">{c.n}</span>
        {!last && <span className="mt-2 w-px flex-1" style={{ background: 'var(--ns-line-strong)' }} />}
      </div>
      <div>
        <div className="flex items-baseline gap-3">
          <span className="t-figure" style={{ fontSize: 54, fontWeight: 250 }}><CountUp to={c.figure} run={seen} /></span>
          <span className="t-title ink2" style={{ fontSize: 21.5 }}>{c.unit}</span>
        </div>
        <p className="t-body mt-2 max-w-[660px]">{c.line}</p>
        {c.segs && total > 0 && (
          <div className="mt-4 max-w-[720px]">
            <div className="flex h-3 gap-[2px] overflow-hidden" style={{ borderRadius: 3 }}>
              {c.segs.filter((s) => s.v > 0).map((s) => <span key={s.label} title={`${s.label}: ${fmt.format(s.v)}`} style={{ width: seen ? `${(s.v / total) * 100}%` : '0%', background: SEG_BG[s.kind], transition: 'width 900ms var(--ns-ease)' }} />)}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              {c.segs.map((s) => (
                <span key={s.label} className="t-small inline-flex items-center gap-1.5">
                  <span className="inline-block size-2.5" style={{ background: SEG_BG[s.kind], borderRadius: 2 }} />
                  <span className="t-data">{fmt.format(s.v)}</span> <span className="ink2">{s.label}</span>
                </span>
              ))}
            </div>
          </div>
        )}
        {c.note && <p className="t-small ink3 mt-2 max-w-[660px]">{c.note}</p>}
      </div>
    </li>
  )
}

export default function Hood() {
  const { records, detail, gaps } = useAreaData()
  const area = useUi((s) => s.area)
  const setArea = useUi((s) => s.setArea)
  const section = useUi((s) => s.section)
  const { data: areas } = useAreas()
  const scroller = useRef<HTMLDivElement>(null)
  const ready = !!(detail?.run_report && records)
  useEffect(() => {
    if (!ready || !section) return
    const t = setTimeout(() => document.getElementById(section)?.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }), 80)
    return () => clearTimeout(t)
  }, [ready, section, area])

  const rr = detail?.run_report as Any
  let chapters: Chapter[] = []
  if (ready && rr) {
    const k = kpis(records!, null)
    const im = rr.imagery, det = rr.detection, bl = rr.buildings, sg = rr.signs, ub = rr.unmapped_businesses
    const gate = Object.values((bl.box_rejected_by_quality_gate ?? {}) as Record<string, number>).reduce((a, b) => a + b, 0)
    const classified = k.buildings_analysed - k.use_not_classified
    const dark = gaps.reduce((n, g) => n + g.props.length_m, 0)
    const tiers = (sg?.tiers ?? {}) as Record<string, number>
    chapters = [
      { id: 'imagery', n: '01', figure: im.panoramas_found, unit: 'panoramas', line: 'Google Street View panoramas found along the streets. User photospheres have no reliable camera geometry, so they are not used for positions.',
        segs: [{ v: im.google_car, label: 'Google car', kind: 'kept' }, { v: im.user_photospheres, label: 'user photospheres (no geometry)', kind: 'drop' }] },
      { id: 'stops', n: '02', figure: im.cameras_planned, unit: 'camera stops', line: 'Instead of shooting 12 headings at every panorama, the planner picks the stops that face the frontage.',
        segs: [{ v: im.cameras_planned, label: 'stops planned', kind: 'kept' }, ...Object.entries((im.cameras_dropped ?? {}) as Record<string, number>).map(([l, v]) => ({ v, label: `dropped: ${l.replace(/_/g, ' ')}`, kind: 'drop' as const }))] },
      { id: 'views', n: '03', figure: im.views_planned, unit: 'views', line: 'Each stop looks left, right, obliquely and tilted up at the buildings it faces.',
        segs: [{ v: im.views_facing_mapped_building, label: 'face a mapped building', kind: 'kept' }, { v: im.views_facing_no_mapped_building, label: 'face no building outline (lights and signs only)', kind: 'drop' }],
        note: `Map coverage verdict: ${rr.maps?.verdict ?? '—'}.` },
      { id: 'detection', n: '04', figure: det.boxes_total, unit: 'detections', line: `The local YOLO detector drew ${fmt.format(det.by_class.building ?? 0)} building, ${fmt.format(det.by_class.signboard ?? 0)} sign, ${fmt.format(det.by_class.pole ?? 0)} pole and ${fmt.format(det.by_class.lamp_head ?? 0)} lamp boxes.`,
        segs: [{ v: det.used_for_geometry, label: 'usable for positioning', kind: 'kept' }, ...Object.entries(det.excluded_from_geometry as Record<string, number>).map(([l, v]) => ({ v, label: `excluded: ${l}`, kind: 'drop' as const }))] },
      { id: 'buildings', n: '05', figure: k.buildings_analysed, unit: 'buildings', line: `Registered from OpenStreetMap outlines. ${fmt.format(bl.usable_view)} had a view good enough for use and floors; the quality gate rejected ${fmt.format(gate)} boxes (slivers at the image edge, cut-off roofs and bases).`,
        segs: [{ v: classified, label: 'use classified', kind: 'kept' }, { v: k.use_not_classified, label: 'use not classified', kind: 'drop' }],
        note: `Against the synthetic register: ${fmt.format(k.unmatched_properties)} with no record, ${fmt.format(k.buildings_with_discrepancy)} with a discrepancy.` },
      { id: 'assets', n: '06', figure: k.assets, unit: 'poles & streetlights', line: `Located on the map: ${plural(k.streetlights, 'streetlight')} and ${plural(k.poles, 'pole')} with no lamp seen. ${fmt.format(k.assets_triangulated)} were seen from two or more cameras and triangulated; the rest are approximate and go to review.`,
        segs: [{ v: k.assets_triangulated, label: 'triangulated', kind: 'kept' }, { v: k.assets - k.assets_triangulated, label: 'approximate (single camera)', kind: 'drop' }],
        note: rr.assets?.triangulated_2plus_cameras != null && rr.assets.triangulated_2plus_cameras !== k.assets_triangulated
          ? `The run report counts ${rr.assets.triangulated_2plus_cameras} assets “seen by 2+ cameras”; the records say ${k.assets_triangulated} were triangulated (the rest fell back to a single-camera estimate). The records are shown.` : undefined },
      { id: 'streetlights', n: '07', figure: k.streetlight_gaps, unit: 'dark stretches', line: `Stretches of road with no streetlight detected within 60 m: ${fmt.format(Math.round(dark))} m in total (recorded lengths). The detector sees lamp heads in photos; it cannot tell whether a lamp works.`,
        note: 'Lengths are the pipeline’s straight-line fit; where the road bends, the along-road length is checked on the Trust page.' },
      { id: 'signs', n: '08', figure: sg?.crops ?? 0, unit: 'sign crops', line: `Signs were read by OCR first; only unclear ones went to the vision-language model, and a VLM name is kept only if OCR supports it. ${plural(k.named_businesses, 'building')} got a good name; ${fmt.format(k.names_confirmed_by_google)} of them are also on Google Maps.`,
        segs: Object.entries(tiers).map(([l, v]) => ({ v, label: l, kind: /OCR/.test(l) ? 'kept' as const : /VLM/.test(l) ? 'find' as const : 'drop' as const })),
        note: ub ? `${plural(ub.sign_candidates_checked_by_vlm, 'sign')} on frontage with no building outline were checked; ${fmt.format(k.unmapped_businesses)} kept as businesses not on the map (the VLM said ${fmt.format(ub.vlm_said_not_business)} were not businesses).` : undefined },
      { id: 'review', n: '09', figure: k.low_confidence_observations, unit: 'items for a person', line: 'Everything the models are unsure about goes to human review instead of onto the map as fact.' },
    ]
  }
  return (
    <div ref={scroller} className="h-full overflow-y-auto px-10 py-8">
      <div className="mx-auto max-w-[960px]">
        <div className="t-micro">Under the hood</div>
        <h1 className="t-display mt-2 mb-2">{detail ? `How ${shortArea(detail.name)} was analysed` : 'Loading the run…'}</h1>
        <p className="t-small ink2 mb-3 max-w-[680px]">What happened behind the scenes, from Street View panoramas to the items a person checks. Pipeline counts from <span className="t-data">run_report.json</span>; every countable finding is counted from the records. No timings: the stored runs were resumed.</p>
        <div className="mb-10 flex flex-wrap gap-1" role="tablist" aria-label="Area">
          {[...(areas ?? [])].sort((a, b) => b.counts.buildings - a.counts.buildings).map((a) => <button key={a.slug} role="tab" aria-selected={a.slug === area} aria-pressed={a.slug === area} className="btn btn-line" onClick={() => setArea(a.slug)}>{shortArea(a.name)}</button>)}
        </div>
        {ready ? <ol className="relative">{chapters.map((c, i) => <Step key={`${area}-${c.id}`} c={c} last={i === chapters.length - 1} />)}</ol>
          : <p className="t-small ink3">{detail && !detail.run_report ? 'This area has no run report yet (tools/build_run_report.py).' : 'Loading…'}</p>}
      </div>
    </div>
  )
}
