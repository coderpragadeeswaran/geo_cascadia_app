/** Five key numbers + More, on the map scrim (docs/DESIGN.md declutter rule 2), in plain words. Computed from the
 *  records (D2); "use not known" is one of the five (D9). A click opens that finding's list in the one panel and
 *  filters the map; the selected street is kept. */
import { ChevronDown, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { KPI_DEFS, kpiFilter, kpiLabel, kpis, type KpiDef } from '@/lib/derive'
import { CAMERA_ONLY_TIP, cameraOnlyText } from '@/lib/labels'
import { useAreaData } from '@/lib/useAreaData'
import { cn, fmt } from '@/lib/utils'
import { useUi } from '@/store/ui'

const TONE: Record<string, string> = {
  'no-record': 'var(--ns-no-record)', discrepancy: 'var(--ns-discrepancy)', unclassified: 'var(--ns-ink3)', review: 'var(--ns-ink)', matched: 'var(--ns-matched)',
}

export function KpiRibbon() {
  const { records, detail } = useAreaData()
  const street = useUi((s) => s.filter.street)
  const cam = street ? 0 : detail?.counts?.camera_only_buildings ?? 0       // D56: the camera-only points have no street
  const active = useUi((s) => s.kpi)
  const query = useUi((s) => s.query)
  const selectStreet = useUi((s) => s.selectStreet)
  const [more, setMore] = useState(false)
  const k = useMemo(() => (records ? kpis(records, street) : null), [records, street])

  const apply = (d: KpiDef) => {
    const ui = useUi.getState()
    setMore(false)
    if (d.overview) { ui.resetFilter(); ui.setPanelOpen(true); return }
    if (active === d.key && !query) { ui.setFilter(kpiFilter({ key: d.key, label: '' }, street), { kpi: null }); return }
    ui.setFilter(kpiFilter(d, street), { kpi: d.key, frame: true })
  }
  const main = KPI_DEFS.filter((d) => d.main)
  const rest = KPI_DEFS.filter((d) => !d.main)

  return (
    <div className="pointer-events-auto relative flex items-stretch px-5" role="toolbar" aria-label="Key figures (click to filter)">
      {street && (
        <div className="mr-5 flex items-center gap-1.5 self-center">
          <span className="t-micro">Street</span>
          <span className="max-w-[180px] truncate text-[16px] font-[560]">{street}</span>
          <button onClick={() => selectStreet(null)} className="btn btn-icon h-6 w-6" aria-label="Clear street filter"><X /></button>
        </div>
      )}
      {main.map((d, i) => {
        const on = active === d.key && !query
        return (
          <button key={d.key} aria-pressed={on} onClick={() => apply(d)}
            className={cn('group relative flex cursor-pointer flex-col items-start py-1 pr-5 text-left', i ? 'rule-l pl-5' : '')}>
            <span className="t-figure" style={{ color: d.tone ? TONE[d.tone] : 'var(--ns-ink)' }}>
              {k ? fmt.format(k[d.key]) : <span className="inline-block h-5 w-9 animate-pulse rounded-sm bg-line" />}
            </span>
            <span className={cn('t-micro mt-1.5 max-w-[9.5rem] leading-[1.15] group-hover:text-ink2', on && '!text-sodium')}>{kpiLabel(d, k?.[d.key])}</span>
            {d.key === 'buildings_analysed' && cam > 0 && <span className="t-small ink3 mt-0.5 text-[13px]" title={CAMERA_ONLY_TIP}>{cameraOnlyText(cam)}</span>}
            {d.sub && <span className="t-small ink3 mt-0.5 hidden text-[13.5px] min-[1500px]:block">{d.sub}</span>}
            {on && <span className="absolute -bottom-1 left-0 right-5 h-[2px]" style={{ background: 'var(--ns-sodium)', left: i ? 20 : 0 }} />}
          </button>
        )
      })}
      <button className="btn rule-l ml-1 self-center pl-4" onClick={() => setMore(!more)} aria-expanded={more}>More <ChevronDown className={cn('transition-transform', more && 'rotate-180')} /></button>
      {more && (
        <div className="sheet absolute left-5 top-full z-30 mt-2 grid w-[460px] grid-cols-2 gap-x-6 gap-y-0.5 p-3" role="menu">
          {rest.map((d) => (
            <button key={d.key} role="menuitem" onClick={() => apply(d)}
              className={cn('flex cursor-pointer items-baseline justify-between gap-3 rounded-[var(--ns-r-control)] px-2 py-1.5 text-left hover:bg-accent-soft', active === d.key && 'text-sodium')}>
              <span className="t-small ink2">{kpiLabel(d, k?.[d.key])}</span><span className="t-data">{k ? fmt.format(k[d.key]) : '…'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
