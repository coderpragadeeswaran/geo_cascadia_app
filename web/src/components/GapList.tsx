/** Dark stretches: road with no streetlight seen within 60 m. D54: in lighting-priority order by default (High / Medium /
 *  Low with a one-line reason), or longest (recorded) first. Plain sentences; the recorded vs along-road length, the
 *  "check" note (D13) and the priority's points sit behind "How do we know?". Query 2 rows render here too. */
import { useMap } from '@vis.gl/react-google-maps'
import { useState } from 'react'
import type { GapProps, GapRow } from '@/api/types'
import { byPriority, gapPolesSentence, gapTypeLabel, PRIORITY_ORDER, priorityLabel } from '@/lib/labels'
import { propsFor, useAreaData } from '@/lib/useAreaData'
import { cn, fmt, plural } from '@/lib/utils'
import { colors, mapBase } from '@/design/tokens'
import { prioColor } from '@/map/layers'
import { flyToBounds } from '@/map/MapView'
import { useUi } from '@/store/ui'
import { OldImagery } from './EvidenceDrawer'
import { LampRecall } from './LampRecall'
import { Fact, HowWeKnow } from './HowWeKnow'

export type Gap = Pick<GapRow, 'id' | 'street' | 'length_m' | 'gap_type' | 'poles_inside' | 'display_mode' | 'along_road_m' | 'length_differs' | 'note' | 'priority' | 'priority_score' | 'priority_reason' | 'priority_points' | 'priority_road'> & Partial<Pick<GapProps, 'lit_cameras_inside' | 'longest_dark_along_road_m' | 'interval_m'>> & { computed?: boolean }

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
      {g.priority && g.priority_points && (
        <Fact k="Priority" hint="fixed points rule, not tuned">
          {priorityLabel(g.priority)}: length {g.priority_points.length} + road {g.priority_points.road}{g.priority_road ? ` (OpenStreetMap: ${g.priority_road})` : ''} + shops and businesses within 30 m {g.priority_points.activity} = <span className="t-data">{g.priority_score}</span> of 9 points (High 7–9, Medium 5–6, Low 0–4)
        </Fact>
      )}
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
  const hasPriority = rows.some((g) => g.priority)
  const scrollTo = (el: HTMLLIElement | null) => el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  const [order, setOrder] = useState<'priority' | 'length'>('priority')
  const byP = hasPriority && order === 'priority'
  const list = [...rows].sort(byP ? byPriority : (a, b) => b.length_m - a.length_m)
  const counts = PRIORITY_ORDER.map((p) => [p, rows.filter((g) => g.priority === p).length] as const)
  const total = list.reduce((n, g) => n + g.length_m, 0)
  // D57: a card selects its stretch (highlighted on the map, the others dimmed) and frames it; the same card again clears it
  const open = (g: Gap) => {
    if (selected?.kind === 'streetlight_gap' && selected.id === g.id) return select(null)
    const p = propsFor(props, 'streetlight_gap', g.id)
    if (p) select(p)
    const pts = paths.get(g.id)
    if (map && pts?.length) {
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1])
      flyToBounds(map, [Math.min(...xs) - 0.0003, Math.min(...ys) - 0.0003, Math.max(...xs) + 0.0003, Math.max(...ys) + 0.0003], { maxZoom: 18 })
    }
  }
  if (!list.length) return <p className="t-small ink3 px-5 py-6">No possible dark stretches here.</p>
  return (
    <div>
      <p className="t-small ink2 px-5 pb-2"><span className="t-data text-ink">{fmt.format(Math.round(total))} m</span> in {plural(list.length, 'stretch')}{hasPriority ? <>: {counts.filter(([, n]) => n).map(([p, n], i) => <span key={p}>{i ? ' · ' : ''}{priorityLabel(p)} <span className="t-data text-ink">{n}</span></span>)}</> : ''}.</p>
      {hasPriority ? (
        <div className="flex items-center gap-2 px-5 pb-2" role="group" aria-label="Order">
          <span className="t-small ink3">Order:</span>
          <button className="btn h-7" aria-pressed={order === 'priority'} onClick={() => setOrder('priority')}>Fix first</button>
          <button className="btn h-7" aria-pressed={order === 'length'} onClick={() => setOrder('length')}>Longest first</button>
        </div>
      ) : rows.length > 0 && <p className="t-small ink3 px-5 pb-2">Longest first. Lighting priority isn’t available right now (it needs the app’s database).</p>}
      <LampRecall className="px-5 pb-2" />
      {hasPriority && <p className="t-small ink3 px-5 pb-2">Priority ranks these possible stretches by length, road type and shops nearby; it does not confirm them.</p>}
      <ol aria-label="Possible dark stretches">
        {list.map((g) => {
          const on = selected?.kind === 'streetlight_gap' && selected.id === g.id
          return (
            <li key={g.id} ref={on ? scrollTo : undefined} aria-current={on ? 'true' : undefined} className={cn('rule-t px-5 py-2.5', on && 'bg-accent-soft')}
              style={on ? { boxShadow: 'inset 3px 0 0 var(--ns-sodium)' } : undefined}>
              <button onClick={() => open(g)} aria-pressed={on} className="block w-full cursor-pointer text-left"
                title={on ? 'Shown on the map. Click again to clear.' : 'Show this stretch on the map'}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0"><span className="t-data text-[15.5px]">{fmt.format(Math.round(g.length_m))} m</span> <span>of {g.street}</span></span>
                  {g.priority ? <PriorityTag p={g.priority} /> : <StretchSwatch />}
                </div>
                {g.priority_reason && <div className="t-small ink2 mt-0.5">{g.priority_reason}</div>}
                <div className="t-small ink3 mt-0.5">{gapPolesSentence(g.poles_inside)}</div>
                {g.display_mode === 'check' && <p className="t-small mt-1 border-l-2 pl-2 ink2" style={{ borderColor: 'var(--ns-sodium)' }}>Needs checking on the ground: the road bends here and some lights were seen part way along.</p>}
                {on && <p className="t-small mt-1 ink3">Shown on the map · click again or press Esc to clear</p>}
              </button>
              {on && <div className="mt-2"><OldImagery k={`gap:${g.id}`} /></div>}
              <GapHow g={g} />
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** D54: the priority as a word plus the map's mark */
export function PriorityTag({ p, long }: { p: string; long?: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 t-small">
      <StretchSwatch p={p} />
      <span className="font-[560]">{priorityLabel(p)}{long ? ' priority' : ''}</span>
    </span>
  )
}

/** D57: a possible dark stretch exactly as the map draws it (dark core, priority edge, casing) on a piece of road, so the
 *  key, the list and the drawer match the map in both themes; wider edge = higher priority. No priority = the plain edge. */
export function StretchSwatch({ p, width = 16 }: { p?: string | null; width?: number }) {
  const mode = useUi((s) => s.mode)
  const c = colors[mode]
  const e = p === 'high' ? 3.5 : p === 'medium' ? 2.5 : p === 'low' ? 1.5 : 1
  const edge = prioColor(c, p) ?? c.darkEdge
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center rounded-[3px] px-[7px] py-[6px]" style={{ background: mapBase[mode].arterial, boxShadow: `inset 0 0 0 1px ${c.lineStrong}` }}>
      <span className="block h-[5px] rounded-full" style={{ width, background: c.dark, boxShadow: `0 0 0 ${e}px ${edge}, 0 0 0 ${e + 1.5}px ${c.darkCasing}` }} />
    </span>
  )
}
