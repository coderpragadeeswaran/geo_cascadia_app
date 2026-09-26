/** Dark stretches: road with no streetlight seen within 60 m, longest (recorded) first. Plain sentences; the recorded
 *  vs along-road length and the "check" note (D13) sit behind "How do we know?". Query 2 rows render here too. */
import { useMap } from '@vis.gl/react-google-maps'
import type { GapProps, GapRow } from '@/api/types'
import { gapTypeLabel } from '@/lib/labels'
import { propsFor, useAreaData } from '@/lib/useAreaData'
import { cn, fmt, plural } from '@/lib/utils'
import { flyToBounds } from '@/map/MapView'
import { useUi } from '@/store/ui'
import { Fact, HowWeKnow } from './HowWeKnow'

export type Gap = Pick<GapRow, 'id' | 'street' | 'length_m' | 'gap_type' | 'poles_inside' | 'display_mode' | 'along_road_m' | 'length_differs' | 'note'> & Partial<Pick<GapProps, 'lit_cameras_inside' | 'longest_dark_along_road_m' | 'interval_m'>> & { computed?: boolean }

export function GapHow({ g }: { g: Gap }) {
  return (
    <HowWeKnow summary={<>Along this {fmt.format(g.length_m)} m stretch the detector saw no streetlight within {g.interval_m ?? 60} m of the camera stops{g.poles_inside ? `; ${plural(g.poles_inside, 'pole')} ${g.poles_inside === 1 ? 'stands' : 'stand'} here without a lamp` : ''}. It sees lamps in photos; it cannot tell whether a lamp works.</>}
      links={[{ page: 'trust', section: 'gap-checks', label: 'Gap length checks' }, { page: 'hood', section: 'streetlights', label: 'How lamps are found' }]}>
      <Fact k="Rule" hint={g.computed ? 'computed by the app with the pipeline’s method; the pipeline stored only 60 m' : 'pipeline, stored 60 m interval'}>No streetlight seen within {g.interval_m ?? 60} m along the road</Fact>
      <Fact k="Length" hint="recorded, straight-line fit"><span className="t-data">{fmt.format(g.length_m)} m</span>, measured in a straight line</Fact>
      {g.display_mode === 'along_road' && g.along_road_m != null && (
        <Fact k="Along the bends"><span className="t-data">≈ {fmt.format(g.along_road_m)} m</span> following the road{g.length_differs ? <span className="ink3">: more than 10% different from the straight-line length</span> : <span className="ink3">: within 10% of the straight-line length</span>}</Fact>
      )}
      <Fact k="On the map">{g.display_mode === 'along_road' ? 'Drawn along the street' : g.display_mode === 'check' ? 'Drawn straight, as recorded, and marked to check' : 'Drawn straight, as recorded'}</Fact>
      <Fact k="Poles here" hint={g.gap_type}><span className="t-data">{g.poles_inside}</span>: {gapTypeLabel(g.gap_type)}</Fact>
      {g.display_mode === 'check' && <Fact k="Check">{g.note}</Fact>}
      <Fact k="ID"><span className="t-data">{g.id}</span></Fact>
    </HowWeKnow>
  )
}

export function GapList({ rows }: { rows: Gap[] }) {
  const { gaps, props } = useAreaData()
  const select = useUi((s) => s.select)
  const selected = useUi((s) => s.selected)
  const map = useMap('main')
  const paths = new Map(gaps.map((g) => [g.props.id, g.geometry.coordinates as [number, number][]]))
  const list = [...rows].sort((a, b) => b.length_m - a.length_m)
  const total = list.reduce((n, g) => n + g.length_m, 0)
  const open = (g: Gap) => {
    const p = propsFor(props, 'streetlight_gap', g.id)
    if (p) select(p)
    const pts = paths.get(g.id)
    if (map && pts?.length) {
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1])
      flyToBounds(map, [Math.min(...xs) - 0.0003, Math.min(...ys) - 0.0003, Math.max(...xs) + 0.0003, Math.max(...ys) + 0.0003], { maxZoom: 18 })
    }
  }
  if (!list.length) return <p className="t-small ink3 px-5 py-6">No dark stretches here.</p>
  return (
    <div>
      <p className="t-small ink2 px-5 pb-2"><span className="t-data text-ink">{fmt.format(Math.round(total))} m</span> in {plural(list.length, 'stretch')}, longest first.</p>
      <ol aria-label="Dark stretches">
        {list.map((g) => {
          const on = selected?.kind === 'streetlight_gap' && selected.id === g.id
          return (
            <li key={g.id} className={cn('rule-t px-5 py-2.5', on && 'bg-accent-soft')}>
              <button onClick={() => open(g)} className="block w-full cursor-pointer text-left">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0"><span className="t-data text-[15.5px]">{fmt.format(Math.round(g.length_m))} m</span> <span>of {g.street}</span></span>
                  <span className="mt-1 h-2 w-8 shrink-0 rounded-sm" style={{ background: 'var(--ns-dark)', boxShadow: '0 0 0 1px var(--ns-dark-edge)' }} aria-hidden />
                </div>
                <div className="t-small ink3 mt-0.5">{gapTypeLabel(g.gap_type)}</div>
                {g.display_mode === 'check' && <p className="t-small mt-1 border-l-2 pl-2 ink2" style={{ borderColor: 'var(--ns-sodium)' }}>Needs checking on the ground: the road bends here and some lights were seen part way along.</p>}
              </button>
              <GapHow g={g} />
            </li>
          )
        })}
      </ol>
    </div>
  )
}
