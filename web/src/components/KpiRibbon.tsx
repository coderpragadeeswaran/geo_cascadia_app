/** KPI ribbon (CLAUDE.md §9.4.1): computed from the records (D2), "use: not classified" as its own number (D9).
 *  Each card applies a filter to the one global store → map, table and charts follow; the street filter is kept. */
import { X } from 'lucide-react'
import { useMemo } from 'react'
import { KPI_DEFS, kpiFilter, kpis } from '@/lib/derive'
import { useAreaData } from '@/lib/useAreaData'
import { cn, fmt } from '@/lib/utils'
import { useUi } from '@/store/ui'

const TONE = { 'no-record': 'text-no-record', discrepancy: 'text-discrepancy', unclassified: 'text-unclassified', review: 'text-review', matched: 'text-matched' } as const

export function KpiRibbon() {
  const { records } = useAreaData()
  const filter = useUi((s) => s.filter)
  const active = useUi((s) => s.kpi)
  const query = useUi((s) => s.query)
  const setFilter = useUi((s) => s.setFilter)
  const selectStreet = useUi((s) => s.selectStreet)
  const setTab = useUi((s) => s.setTab)
  const k = useMemo(() => (records ? kpis(records, filter.street) : null), [records, filter.street])

  return (
    <div className="pointer-events-auto flex min-w-0 items-stretch gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]" role="toolbar" aria-label="Key figures (click to filter)">
      {filter.street && (
        <div className="glass flex shrink-0 items-center gap-1.5 px-2.5 text-[12px]">
          <span className="text-muted">Street</span>
          <span className="max-w-[160px] truncate font-semibold">{filter.street}</span>
          <button onClick={() => selectStreet(null)} className="cursor-pointer rounded p-0.5 text-muted hover:bg-hover hover:text-fg" aria-label="Clear street filter"><X className="size-3.5" /></button>
        </div>
      )}
      {KPI_DEFS.map((d) => {
        const on = active === d.key && !query
        return (
          <button key={d.key} aria-pressed={on}
            onClick={() => {
              if (d.tab) return setTab(d.tab)
              if (on) setFilter({ ...kpiFilter({ key: d.key, label: '' }, filter.street) }, { kpi: null })
              else { setFilter(kpiFilter(d, filter.street), { kpi: d.key, frame: true }); setTab('findings') }
            }}
            className={cn('glass flex min-w-[92px] shrink-0 cursor-pointer flex-col items-start px-3 py-1.5 text-left transition-colors hover:bg-hover',
              on && 'ring-2 ring-accent/70')}>
            <span className={cn('tnum text-[18px] font-semibold leading-tight', d.tone && TONE[d.tone])}>
              {k ? fmt.format(k[d.key]) : <span className="inline-block h-4 w-8 animate-pulse rounded bg-hover" />}
            </span>
            <span className="whitespace-nowrap text-[11px] leading-tight text-muted">{d.label}</span>
            {d.sub && k && <span className="whitespace-nowrap text-[10px] leading-tight text-faint">{d.sub(k)}</span>}
          </button>
        )
      })}
    </div>
  )
}
