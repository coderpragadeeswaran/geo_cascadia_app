/** Hover card (follows the cursor) and the selection card. The full Street View evidence dive is P4. */
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect } from 'react'
import { useAreas } from '@/api/queries'
import type { AnyProps, BuildingProps } from '@/api/types'
import { Button } from '@/components/ui/button'
import { useUi } from '@/store/ui'
import { cn, fmt, fmt1 } from '@/lib/utils'

const STATUS: Record<string, { label: string; cls: string }> = {
  matched: { label: 'Matched', cls: 'text-matched bg-[rgb(45_212_191/0.12)]' },
  discrepancy: { label: 'Discrepancy', cls: 'text-discrepancy bg-[rgb(245_165_36/0.13)]' },
  no_record: { label: 'No record', cls: 'text-no-record bg-[rgb(244_82_91/0.13)]' },
  unrecorded_asset: { label: 'Not in register', cls: 'text-no-record bg-[rgb(244_82_91/0.13)]' },
  unconfirmed_detection: { label: 'Unconfirmed', cls: 'text-unclassified bg-[rgb(148_163_184/0.14)]' },
}
export const StatusChip = ({ s }: { s: string | null | undefined }) => {
  const x = (s && STATUS[s]) || { label: s ?? '—', cls: 'text-muted bg-hover' }
  return <span className={cn('inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-semibold', x.cls)}>{x.label}</span>
}
const KV = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 py-[2px] text-[12px]"><span className="text-muted">{k}</span><span className="tnum text-right text-fg">{v}</span></div>
)
const pretty = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ') : '—')

function floorsText(p: BuildingProps) {
  if (p.floors == null) return <span className="text-unclassified">not classified</span>
  return <>{p.floors}{p.floors_status === 'low_confidence' && <span className="ml-1 text-faint">(low confidence)</span>}</>
}

function Body({ p }: { p: AnyProps }) {
  switch (p.kind) {
    case 'area':
      return (<>
        <Title eyebrow="Analysed area" title={p.name.replace(/^Unseen street: /, '')} />
        <KV k="Buildings" v={fmt.format(p.card.counts.buildings)} />
        <KV k="Poles & streetlights" v={fmt.format(p.card.counts.assets)} />
        <KV k="Streetlight gaps (60 m)" v={fmt.format(p.card.counts.streetlight_gaps_60m)} />
        <KV k="Unmapped businesses" v={fmt.format(p.card.counts.unmapped_businesses)} />
      </>)
    case 'street':
      return (<>
        <Title eyebrow="Street" title={p.name} />
        {p.osm_name && p.osm_name !== p.name && <div className="-mt-1 mb-1 truncate text-[10.5px] text-faint">OSM: {p.osm_name}</div>}
        <KV k="Length" v={p.length_m != null ? `${fmt.format(Math.round(p.length_m))} m` : '—'} />
        {p.has_stats ? (<>
          <KV k="Buildings" v={p.buildings ?? 0} />
          <KV k="No record · discrepancy" v={`${p.no_record ?? 0} · ${p.discrepancy ?? 0}`} />
          <KV k="Issues per km" v={p.issues_per_km != null ? fmt1.format(p.issues_per_km) : '—'} />
          <KV k="Streetlights · poles" v={`${p.streetlights ?? 0} · ${p.poles ?? 0}`} />
          <KV k="Gap length (60 m rule)" v={`${fmt.format(p.gap_m_60 ?? 0)} m`} />
        </>) : <KV k="Issues per km" v={<span className="text-unclassified">no data for this line</span>} />}
      </>)
    case 'building':
      return (<>
        <Title eyebrow={`Building · ${p.id}`} title={p.name ?? p.street} right={<StatusChip s={p.match_status} />} />
        {p.name && <KV k="Street" v={p.street} />}
        <KV k="Use" v={p.use ? pretty(p.use) : <span className="text-unclassified">not classified</span>} />
        <KV k="Floors" v={floorsText(p)} />
        {p.discrepancies.length > 0 && <KV k="Discrepancies" v={p.discrepancies.map(pretty).join(', ')} />}
        {p.review_status && <KV k="Review" v={<span className="text-review">{p.review_status}</span>} />}
      </>)
    case 'pole':
    case 'streetlight':
      return (<>
        <Title eyebrow={`${p.kind === 'pole' ? 'Utility pole' : 'Streetlight'} · ${p.id}`} title={p.street ?? '—'} right={<StatusChip s={p.register_status} />} />
        <KV k="Position" v={p.approximate ? 'approximate (single camera)' : `triangulated · ${p.cameras_used} cameras`} />
        <KV k="Uncertainty" v={p.uncertainty_m != null ? `± ${fmt1.format(p.uncertainty_m)} m` : '—'} />
        <KV k="Confidence" v={p.confidence ?? '—'} />
      </>)
    case 'streetlight_gap':
      return (<>
        <Title eyebrow="Streetlight gap · 60 m rule" title={p.street} />
        <KV k="Length (recorded)" v={`${fmt.format(p.length_m)} m`} />
        {p.display_mode === 'along_road' && p.length_differs && p.along_road_m != null &&
          <KV k="Along the road" v={`≈ ${fmt.format(p.along_road_m)} m`} />}
        <KV k="Finding" v={p.gap_type} />
        <KV k="Poles inside" v={p.poles_inside} />
        {p.display_mode === 'check' && p.note && (
          <p className="mt-1.5 rounded-md bg-[rgb(245_165_36/0.12)] px-2 py-1.5 text-[11px] leading-snug text-discrepancy">Check: {p.note}</p>
        )}
        {p.display_mode === 'along_road' && p.length_differs && p.note && (
          <p className="mt-1.5 text-[10.5px] leading-snug text-faint">{p.note}</p>
        )}
      </>)
    case 'unmapped_business':
      return (<>
        <Title eyebrow="Unmapped business · approximate" title={p.name ?? '—'} />
        <KV k="Street" v={p.street ?? '—'} />
        <KV k="Sightings" v={p.sightings ?? '—'} />
      </>)
    case 'missing_asset_record':
      return (<>
        <Title eyebrow="Register record · synthetic" title={p.id} />
        <KV k="Street" v={p.street ?? '—'} />
        <KV k="Finding" v={p.why ?? '—'} />
      </>)
  }
}

function Title({ eyebrow, title, right }: { eyebrow: string; title: string; right?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="eyebrow truncate">{eyebrow}</div>
        <div className="mt-0.5 truncate text-[13.5px] font-semibold">{title}</div>
      </div>
      {right}
    </div>
  )
}

export function HoverCard() {
  const h = useUi((s) => s.hovered)
  const selected = useUi((s) => s.selected)
  if (!h || (selected && 'id' in selected && 'id' in h.props && selected.id === h.props.id)) return null
  const left = Math.min(h.x + 16, window.innerWidth - 290)
  const top = Math.min(h.y + 16, window.innerHeight - 200)
  return (
    <div className="glass glass-strong pointer-events-none fixed z-30 w-[270px] px-3.5 py-3" style={{ left, top }} role="tooltip">
      <Body p={h.props} />
    </div>
  )
}

export function SelectionCard() {
  const sel = useUi((s) => s.selected)
  const select = useUi((s) => s.select)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') select(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [select])
  return (
    <AnimatePresence>
      {sel && sel.kind !== 'area' && (
        <motion.aside key={'id' in sel ? sel.id : 'x'} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }}
          transition={{ type: 'spring', stiffness: 380, damping: 34 }}
          className="glass glass-strong pointer-events-auto absolute right-3 top-[68px] z-20 w-[300px] px-4 pb-3.5 pt-3" aria-label="Selected object">
          <Button size="icon-sm" className="absolute right-2 top-2" onClick={() => select(null)} aria-label="Close (Esc)"><X /></Button>
          <div className="pr-6"><Body p={sel} /></div>
          <p className="mt-2 border-t border-glass-border pt-2 text-[11px] text-faint">Street View evidence opens here in the next phase.</p>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

/** Compact summary for the open area: counts computed from records, unclassified shown explicitly (D9). */
export function AreaSummary() {
  const area = useUi((s) => s.area)
  const band = useUi((s) => s.band)
  const { data: areas } = useAreas()
  const a = areas?.find((x) => x.slug === area)
  if (!a || band === 'city') return null
  const m = a.match_status
  const total = a.counts.buildings || 1
  const seg = [['matched', 'bg-matched'], ['discrepancy', 'bg-discrepancy'], ['no_record', 'bg-no-record']] as const
  return (
    <motion.section initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
      className="glass pointer-events-auto absolute left-3 top-[68px] z-10 w-[236px] px-3.5 py-3" aria-label="Area summary">
      <div className="eyebrow">Buildings · register match</div>
      <div className="tnum mt-1 text-[22px] font-semibold leading-none">{fmt.format(a.counts.buildings)}</div>
      <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-hover">
        {seg.map(([k, c]) => <div key={k} className={c} style={{ width: `${((m[k] ?? 0) / total) * 100}%` }} />)}
      </div>
      <div className="tnum mt-2 grid grid-cols-3 gap-1 text-[11px]">
        <span><b className="font-semibold text-matched">{m.matched ?? 0}</b> <span className="text-muted">matched</span></span>
        <span><b className="font-semibold text-discrepancy">{m.discrepancy ?? 0}</b> <span className="text-muted">discrep.</span></span>
        <span><b className="font-semibold text-no-record">{m.no_record ?? 0}</b> <span className="text-muted">no record</span></span>
      </div>
      <div className="tnum mt-2.5 space-y-0.5 border-t border-glass-border pt-2 text-[11.5px]">
        <KV k="Use: not classified" v={<span className="text-unclassified">{fmt.format(a.counts.use_not_classified)}</span>} />
        <KV k="Assets triangulated" v={`${a.counts.assets_triangulated} / ${a.counts.assets}`} />
      </div>
      {a.coverage.level === 'partial' && <CoverageBanner c={a.coverage} />}
      <div className="mt-2 text-[10.5px] text-faint">Synthetic register (demo)</div>
    </motion.section>
  )
}

/** Low map coverage: explains why few buildings were analysed (numbers from data: view counts from the run's coverage
 *  stats, building / asset / business counts computed from the records). */
function CoverageBanner({ c }: { c: import('@/api/types').AreaCard['coverage'] }) {
  const pct = c.share_views_no_mapped_building != null ? Math.round(c.share_views_no_mapped_building * 100) : null
  const strong = (c.share_views_no_mapped_building ?? 0) >= 0.5
  return (
    <div role="note" className="mt-2.5 rounded-lg border border-[rgb(245_165_36/0.35)] bg-[rgb(245_165_36/0.1)] px-2.5 py-2 text-[11px] leading-snug">
      <div className="mb-0.5 font-semibold text-discrepancy">{strong ? 'Low map coverage' : 'Partial map coverage'}</div>
      <p className="text-fg/85">
        {pct != null && <><b className="tnum">{pct}%</b> of camera views (<span className="tnum">{c.views_facing_no_mapped_building} of {c.views_planned}</span>) face
        frontage with no building outline in OpenStreetMap. </>}
        Buildings are analysed only where an outline exists: <b className="tnum">{c.buildings}</b> here.
        Poles, streetlights and signs were analysed everywhere: <b className="tnum">{c.assets}</b> assets and{' '}
        <b className="tnum">{c.unmapped_businesses}</b> businesses on unmapped frontage (approximate positions).
      </p>
    </div>
  )
}
