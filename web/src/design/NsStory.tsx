/** "Under the Hood" as a scroll story (Night Survey mock). Pipeline-internal counts (panoramas, views, boxes, quality
 *  gate) come from run_report.json; countable facts (buildings, assets, triangulated, not classified, findings) are
 *  computed from the records (D2 — e.g. 20 triangulated, not the story's 29). No timings (D1). */
import { useEffect, useRef, useState } from 'react'
import { useAreaDetail } from '@/api/queries'
import type { Records } from '@/lib/derive'
import { kpis } from '@/lib/derive'

const fmt = new Intl.NumberFormat('en-IN')
const REDUCED = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

interface Seg { v: number; label: string; kind: 'kept' | 'drop' | 'find' | 'rose' | 'glacier' }
interface Chapter { n: string; figure: number; unit: string; line: string; segs?: Seg[]; note?: string }

function useInView<T extends Element>() {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(REDUCED)
  useEffect(() => {
    if (!ref.current || seen) return
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect() } }, { threshold: 0.35 })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [seen])
  return [ref, seen] as const
}

function CountUp({ to, run }: { to: number; run: boolean }) {
  const [v, setV] = useState(REDUCED ? to : 0)
  useEffect(() => {
    if (!run || REDUCED) { if (REDUCED) setV(to); return }
    let raf = 0; const t0 = performance.now()
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / 900); setV(Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, run])
  return <>{fmt.format(v)}</>
}

const SEG_BG: Record<Seg['kind'], string> = {
  kept: 'var(--ns-sodium)', find: 'var(--ns-ink2)', rose: 'var(--ns-no-record)', glacier: 'var(--ns-discrepancy)',
  drop: 'repeating-linear-gradient(135deg, var(--ns-ink3) 0 1.5px, transparent 1.5px 5px)',
}

function Step({ c, last }: { c: Chapter; last: boolean }) {
  const [ref, seen] = useInView<HTMLLIElement>()
  const total = c.segs?.reduce((n, s) => n + s.v, 0) ?? 0
  return (
    <li ref={ref} className="relative grid grid-cols-[56px_1fr] gap-4 pb-12" style={{ opacity: seen ? 1 : 0.15, transform: seen ? 'none' : 'translateY(12px)', transition: 'opacity 600ms var(--ns-ease), transform 600ms var(--ns-ease)' }}>
      <div className="relative flex flex-col items-center">
        <span className="t-data sodium">{c.n}</span>
        {!last && <span className="mt-2 w-px flex-1" style={{ background: 'var(--ns-line-strong)' }} />}
      </div>
      <div>
        <div className="flex items-baseline gap-3">
          <span className="t-figure" style={{ fontSize: 56, fontWeight: 250 }}><CountUp to={c.figure} run={seen} /></span>
          <span className="t-title ink2" style={{ fontSize: 20 }}>{c.unit}</span>
        </div>
        <p className="t-body mt-2 max-w-[640px]">{c.line}</p>
        {c.segs && (
          <div className="mt-4 max-w-[720px]">
            <div className="flex h-3 gap-[2px] overflow-hidden" style={{ borderRadius: 3 }}>
              {c.segs.map((s) => <span key={s.label} title={`${s.label}: ${fmt.format(s.v)}`} style={{ width: seen ? `${(s.v / total) * 100}%` : '0%', background: SEG_BG[s.kind], transition: 'width 900ms var(--ns-ease)' }} />)}
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
        {c.note && <p className="t-small ink3 mt-2 max-w-[640px]">{c.note}</p>}
      </div>
    </li>
  )
}

export function NsStory({ records }: { records: Records | null }) {
  const { data: d } = useAreaDetail('ward29')
  if (!d?.run_report || !records) return <p className="t-small ink3">Loading the run…</p>
  const rr = d.run_report as Any
  const k = kpis(records, null)
  const im = rr.imagery, det = rr.detection, bl = rr.buildings
  const gate = Object.values(bl.box_rejected_by_quality_gate as Record<string, number>).reduce((a, b) => a + b, 0)
  const classified = k.buildings_analysed - k.use_not_classified
  const chapters: Chapter[] = [
    { n: '01', figure: im.panoramas_found, unit: 'panoramas', line: 'Google Street View panoramas found along the ward’s streets.',
      segs: [{ v: im.google_car, label: 'Google car', kind: 'kept' }, { v: im.user_photospheres, label: 'user photospheres (no geometry)', kind: 'drop' }] },
    { n: '02', figure: im.cameras_planned, unit: 'camera stops', line: 'Instead of shooting 12 headings at every panorama, the planner picks stops that face frontage.',
      segs: [{ v: im.cameras_planned, label: 'stops planned', kind: 'kept' }, { v: im.cameras_dropped.camera_inside_footprint, label: 'dropped: camera inside a footprint', kind: 'drop' }] },
    { n: '03', figure: im.views_planned, unit: 'views', line: 'Each stop looks left, right, obliquely and tilted up at the buildings it faces.',
      segs: [{ v: im.views_facing_mapped_building, label: 'face a mapped building', kind: 'kept' }, { v: im.views_facing_no_mapped_building, label: 'face no building outline (assets & signs only)', kind: 'drop' }] },
    { n: '04', figure: det.boxes_total, unit: 'detections', line: `The local YOLO detector drew ${fmt.format(det.by_class.building)} building, ${fmt.format(det.by_class.signboard)} sign, ${fmt.format(det.by_class.pole)} pole and ${fmt.format(det.by_class.lamp_head)} lamp boxes.`,
      segs: [{ v: det.used_for_geometry, label: 'usable for positioning', kind: 'kept' }, ...Object.entries(det.excluded_from_geometry as Record<string, number>).map(([l, v]) => ({ v, label: `excluded: ${l}`, kind: 'drop' as const }))] },
    { n: '05', figure: k.buildings_analysed, unit: 'buildings', line: `Registered from OpenStreetMap footprints. ${fmt.format(bl.usable_view)} had a view good enough for use and floors; the quality gate rejected ${fmt.format(gate)} boxes (slivers at the image edge, cut-off roofs).`,
      segs: [{ v: classified, label: 'use classified', kind: 'kept' }, { v: k.use_not_classified, label: 'use not classified', kind: 'drop' }],
      note: `Against the synthetic register: ${fmt.format(k.unmatched_properties)} with no record, ${fmt.format(k.buildings_with_discrepancy)} with a discrepancy.` },
    { n: '06', figure: k.assets, unit: 'poles & streetlights', line: `Located on the map: ${fmt.format(k.streetlights)} streetlights and ${fmt.format(k.poles)} poles. Only ${fmt.format(k.assets_triangulated)} were seen from two or more cameras and triangulated; the rest are approximate.`,
      segs: [{ v: k.assets_triangulated, label: 'triangulated', kind: 'kept' }, { v: k.assets - k.assets_triangulated, label: 'approximate (single camera)', kind: 'drop' }],
      note: `${fmt.format(k.streetlight_gaps)} stretches of road have no lamp within 60 m. (The run report’s “29 triangulated” counts assets seen by 2+ cameras; the records say 20 were triangulated.)` },
    { n: '07', figure: k.low_confidence_observations, unit: 'items for a person', line: 'Everything the models are unsure about goes to human review instead of the map as fact.' },
  ]
  return <ol className="relative">{chapters.map((c, i) => <Step key={c.n} c={c} last={i === chapters.length - 1} />)}</ol>
}
