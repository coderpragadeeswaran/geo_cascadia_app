/** Streetlights tab: 60 m gap list, longest recorded length first. Shows BOTH the recorded length (pipeline, D13) and
 *  "≈ X m along the road" where they differ by > 10 %, the gap type, and the "check" note (gap60-006). Query 2 results
 *  (QueryEngine rows) render here with the same fields. */
import { useMap } from '@vis.gl/react-google-maps'
import { AlertTriangle } from 'lucide-react'
import { useMemo } from 'react'
import type { GapProps, GapRow } from '@/api/types'
import { propsFor, useAreaData } from '@/lib/useAreaData'
import { cn, fmt } from '@/lib/utils'
import { flyToBounds } from '@/map/MapView'
import { useUi } from '@/store/ui'
import { WhyEmpty } from './WhyEmpty'

type G = Pick<GapRow, 'id' | 'street' | 'length_m' | 'gap_type' | 'poles_inside' | 'display_mode' | 'along_road_m' | 'length_differs' | 'note'>

export function StreetlightsTab() {
  const { gaps, props } = useAreaData()
  const street = useUi((s) => s.filter.street)
  const query = useUi((s) => s.query)
  const select = useUi((s) => s.select)
  const selected = useUi((s) => s.selected)
  const map = useMap('main')
  const fromQuery = query?.intent === 'streetlight_gaps'
  const list: G[] = useMemo(() => {
    const src: G[] = fromQuery ? ((query!.rows ?? []) as unknown as G[]) : gaps.map((g) => g.props as GapProps).filter((g) => !street || g.street === street)
    return [...src].sort((a, b) => b.length_m - a.length_m)
  }, [fromQuery, query, gaps, street])
  const paths = useMemo(() => new Map(gaps.map((g) => [g.props.id, g.geometry.coordinates as [number, number][]])), [gaps])
  const total = list.reduce((n, g) => n + g.length_m, 0)
  const byType = list.reduce<Record<string, number>>((m, g) => ({ ...m, [g.gap_type]: (m[g.gap_type] ?? 0) + 1 }), {})

  const open = (g: G) => {
    const p = propsFor(props, 'streetlight_gap', g.id)
    if (p) select(p)
    const pts = paths.get(g.id)
    if (map && pts?.length) {
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1])
      flyToBounds(map, [Math.min(...xs) - 0.0003, Math.min(...ys) - 0.0003, Math.max(...xs) + 0.0003, Math.max(...ys) + 0.0003], { maxZoom: 18 })
    }
  }
  if (fromQuery && !list.length) return <div className="px-3.5 py-2"><p className="mb-2 text-[13px] font-semibold">No gaps for this question</p><WhyEmpty steps={query!.why_empty} noun="gaps" /></div>
  return (
    <div className="px-3 pb-4">
      <div className="mb-2 rounded-xl border border-glass-border px-3 py-2">
        <div className="text-[12.5px] font-semibold">{fromQuery ? `Query: ${query!.text}` : 'Streets with no streetlight detected within 60 m'}</div>
        <div className="tnum mt-0.5 text-[11.5px] text-muted">{list.length} gaps · {fmt.format(total)} m recorded{street && !fromQuery ? ` · ${street}` : ''}</div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {Object.entries(byType).map(([t, n]) => (
            <span key={t} className="rounded-md bg-hover px-1.5 py-0.5 text-[11px]"><b className="tnum">{n}</b> {t}</span>
          ))}
        </div>
        <p className="mt-1.5 text-[10.5px] leading-snug text-faint">Recorded = pipeline length (sorted by it). “≈ along the road” = measured on the street line where it differs by more than 10 %.</p>
      </div>
      <ol className="space-y-1.5">
        {list.map((g) => {
          const on = selected?.kind === 'streetlight_gap' && selected.id === g.id
          return (
            <li key={g.id}>
              <button onClick={() => open(g)} className={cn('w-full cursor-pointer rounded-xl border px-3 py-2 text-left transition-colors hover:bg-hover',
                on ? 'border-accent/60 bg-accent-soft/40' : 'border-glass-border', g.display_mode === 'check' && 'border-[rgb(245_165_36/0.45)]')}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-[12.5px] font-medium">{g.street}</span>
                  <span className="tnum shrink-0 text-[15px] font-semibold">{fmt.format(g.length_m)} m <span className="text-[10.5px] font-normal text-faint">recorded</span></span>
                </div>
                {g.display_mode === 'along_road' && g.length_differs && g.along_road_m != null && (
                  <div className="tnum text-right text-[11.5px] text-accent">≈ {fmt.format(g.along_road_m)} m along the road</div>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className={cn('rounded-md px-1.5 py-0.5', g.gap_type.startsWith('poles') ? 'bg-[rgb(245_165_36/0.13)] text-discrepancy' : 'bg-[rgb(244_82_91/0.13)] text-no-record')}>{g.gap_type}</span>
                  <span className="text-muted">{g.poles_inside} poles inside</span>
                  <span className="font-mono text-faint">{g.id}</span>
                </div>
                {g.display_mode === 'check' && g.note && (
                  <p className="mt-1.5 flex gap-1.5 rounded-md bg-[rgb(245_165_36/0.12)] px-2 py-1.5 text-[11px] leading-snug text-discrepancy">
                    <AlertTriangle className="mt-px size-3.5 shrink-0" /> <span>Check: {g.note}</span>
                  </p>
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
