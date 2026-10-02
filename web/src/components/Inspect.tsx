/** Hover card (follows the cursor, plain words) and the low-coverage note. A click opens the evidence panel. */
import { useAreas, useModelCard } from '@/api/queries'
import type { AnyProps, GapProps } from '@/api/types'
import { assetRegLabel, ASSET_REG, floorsText, gapTypeLabel, matchLabel, onMapSeenIn, shortArea, useLabel } from '@/lib/labels'
import { useAreaData } from '@/lib/useAreaData'
import { fmt, noun, plural } from '@/lib/utils'
import { useUi } from '@/store/ui'
import { StatusDot } from './FindingsTable'

const Line = ({ children }: { children: React.ReactNode }) => <div className="t-small ink2 py-[1px]">{children}</div>

function Body({ p }: { p: AnyProps }) {
  switch (p.kind) {
    case 'area':
      return (<>
        <Title eyebrow="Analysed area" title={shortArea(p.name)} />
        <Line><N n={p.card.counts.buildings} /> {noun(p.card.counts.buildings, 'building')} checked · <N n={p.card.counts.streetlight_gaps_60m} /> {noun(p.card.counts.streetlight_gaps_60m, 'possible dark stretch')}</Line>
        <Line><N n={p.card.counts.unmapped_businesses} /> {noun(p.card.counts.unmapped_businesses, 'business')} with no analysed building</Line>
      </>)
    case 'street':
      return (<>
        <Title eyebrow="Street" title={p.name} />
        {p.has_stats ? (<>
          <Line><N n={p.buildings ?? 0} /> {noun(p.buildings ?? 0, 'building')} · <span className="t-data" style={{ color: 'var(--ns-no-record)' }}>{p.no_record ?? 0}</span> not in register · <span className="t-data" style={{ color: 'var(--ns-discrepancy)' }}>{p.discrepancy ?? 0}</span> {(p.discrepancy ?? 0) === 1 ? 'differs' : 'differ'}</Line>
          <Line><N n={p.streetlights ?? 0} /> {noun(p.streetlights ?? 0, 'streetlight')} · <span className="t-data text-ink">{fmt.format(Math.round(p.gap_m_60 ?? 0))} m</span> dark</Line>
        </>) : <Line>No findings joined to this line</Line>}
        <div className="t-small ink3 mt-1">Click to see this street</div>
      </>)
    case 'building':
      return (<>
        <Title eyebrow="Building" title={p.name ?? `${p.use ? useLabel(p.use) : 'Building'} on ${p.street}`} />
        <StatusDot wrap s={p.match_status} label={matchLabel(p.match_status, true, !!p.use)} />
        <Line>{p.use ? useLabel(p.use) : 'Use not known'} · {floorsText(p.floors, p.floors_status)}</Line>
      </>)
    case 'pole':
    case 'streetlight':
      return (<>
        <Title eyebrow={p.kind === 'pole' ? 'Pole, no lamp seen' : 'Streetlight'} title={p.street ?? '—'} />
        <StatusDot wrap s={ASSET_REG[p.register_status ?? '']?.status ?? null} label={assetRegLabel(p.register_status, true)} />
        <Line>{onMapSeenIn(p.kind === 'streetlight' ? 'streetlight' : 'pole', p.n_detections)}</Line>
        <Line>{p.approximate ? 'Approximate position' : `Pinpointed from ${plural(p.cameras_used ?? 0, 'camera position')}`}</Line>
      </>)
    case 'streetlight_gap':
      return (<>
        <Title eyebrow="Possible dark stretch" title={`${fmt.format(Math.round(p.length_m))} m of ${p.street}`} />
        <GapContext p={p} />
        <Line>{gapTypeLabel(p.gap_type)}</Line>
        <LampRecallLine />
        {p.display_mode === 'check' && <Line><span className="sodium">Needs checking: the road bends here</span></Line>}
      </>)
    case 'unmapped_business':
      return (<>
        <Title eyebrow="Business with no analysed building" title={p.name ?? '—'} />
        <Line>{p.street ?? '—'} · approximate position</Line>
      </>)
    case 'missing_asset_record':
      return (<>
        <Title eyebrow="In the register, not seen" title={p.id} />
        <Line>{p.street ?? '—'} · synthetic register</Line>
      </>)
  }
}

const N = ({ n }: { n: number }) => <span className="t-data text-ink">{fmt.format(n)}</span>

/** Walkthrough 2 fix 6: "1 of 3 dark stretches on Uthukuli Road (516 m total)", from the same stretches the map shows
 *  (the stored 60 m ones, or a question's computed interval), ranked longest first; lengths are the recorded ones (D13). */
function GapContext({ p }: { p: GapProps }) {
  const { gaps } = useAreaData()
  const q = useUi((s) => s.query)
  const computed = !!q?.gaps?.computed && (q.rows ?? []).some((r) => r.id === p.id)
  const all = (computed ? (q!.rows as unknown as GapProps[]) : gaps.map((g) => g.props as GapProps)).filter((g) => g.street === p.street)
  if (!all.length) return null
  const rank = [...all].sort((a, b) => b.length_m - a.length_m).findIndex((g) => g.id === p.id) + 1
  const total = all.reduce((s, g) => s + g.length_m, 0)
  return (
    <Line>{all.length === 1 ? 'The only possible dark stretch' : <>{rank} of {plural(all.length, 'possible dark stretch')}</>} on {p.street}
      {all.length > 1 && <> (<span className="t-data text-ink">{fmt.format(Math.round(total))} m</span> total)</>}
      {computed && <span className="ink3"> · within {p.interval_m} m, computed</span>}</Line>
  )
}

function Title({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-1 min-w-0">
      <div className="t-micro">{eyebrow}</div>
      <div className="mt-0.5 break-words text-[16.5px] font-[580] leading-snug">{title}</div>
    </div>
  )
}

export function HoverCard() {
  const h = useUi((s) => s.hovered)
  const selected = useUi((s) => s.selected)
  const page = useUi((s) => s.page)
  if (!h || page !== 'explore' || (selected && 'id' in selected && 'id' in h.props && selected.id === h.props.id)) return null
  const stage = document.querySelector('[data-map-stage]')?.getBoundingClientRect()
  const left = Math.min(h.x + 16, (stage?.width ?? window.innerWidth) - 320)
  const top = Math.min(h.y + 16, (stage?.height ?? window.innerHeight) - 190)
  return (
    <div className="map-card sheet pointer-events-none absolute z-40 px-3.5 py-3" style={{ left, top }} role="tooltip">
      <Body p={h.props} />
    </div>
  )
}

/** Low building-map coverage (Trichy / Tiruppur): why few buildings were analysed. Numbers from data (view counts from
 *  the run's coverage stats; buildings, assets, businesses counted from the records). */
export function CoverageNotice() {
  const area = useUi((s) => s.area)
  const band = useUi((s) => s.band)
  const analyse = useUi((s) => s.analyse)
  const { data: areas } = useAreas()
  const a = areas?.find((x) => x.slug === area)
  if (!a || band === 'city' || analyse || a.coverage.level !== 'partial') return null
  const c = a.coverage
  const pct = c.share_views_no_mapped_building != null ? Math.round(c.share_views_no_mapped_building * 100) : null
  return (
    <p className="sheet t-small ink2 pointer-events-auto mx-5 mt-2 max-w-[640px] border-l-2 px-3 py-2" role="note"
      style={{ borderLeftColor: 'var(--ns-sodium)', background: 'color-mix(in srgb, var(--ns-bg1) 90%, transparent)' }}>
      <b className="text-ink">Few buildings are on the map here.</b>{' '}
      {pct != null && <>{pct}% of the camera views face frontage with no building outline on the map. </>}
      Buildings were checked only where an outline exists ({c.buildings}); streetlights, poles and signs were checked everywhere ({plural(c.assets, 'pole or light', 'poles and lights')}, {plural(c.unmapped_businesses, 'business')} with no analysed building).
    </p>
  )
}

/** P8: the hover card's short form of the lamp detector's recall (model card) */
function LampRecallLine() {
  const { data: mc } = useModelCard()
  const lh = (mc as { detector?: { per_class?: Record<string, { R: number; n: number }> } } | undefined)?.detector?.per_class?.lamp_head
  return lh ? <Line><span className="ink3">The detector finds about {Math.round(lh.R * 100)}% of lamps, so some may be missed</span></Line> : null
}
