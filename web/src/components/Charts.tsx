/** One chart per question (docs/DESIGN.md declutter rule 4), plain HTML bars in the Night Survey style: thin marks with
 *  4 px rounded data ends, values in ink (never the series colour), a hover title per bar, and the list itself as the
 *  table view. Counts are computed from the records (D2). Clicking a street bar selects that street (map zooms to it). */
import { useMemo } from 'react'
import type { Building } from '@/api/types'
import { charts, type Records } from '@/lib/derive'
import { diffLabel, useLabel } from '@/lib/labels'
import { cn, fmt, noun } from '@/lib/utils'
import { useUi } from '@/store/ui'

export interface Bar { name: string; label?: string; value: number; color?: string; hatch?: boolean }

export function BarList({ data, color = 'var(--ns-sodium)', onPick, active, unit = '', caption }: {
  data: Bar[]; color?: string; onPick?: (b: Bar) => void; active?: string | null; unit?: string; caption?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  if (!data.length) return <p className="t-small ink3">Nothing to chart here.</p>
  return (
    <figure>
      {caption && <figcaption className="t-small ink3 mb-2">{caption}</figcaption>}
      <ul className="space-y-1" role="list">
        {data.map((d) => {
          const w = d.value ? Math.max(2.5, (d.value / max) * 100) : 0
          const dim = active && active !== d.name
          const Row = onPick ? 'button' : 'div'
          return (
            <li key={d.name}>
              <Row {...(onPick ? { onClick: () => onPick(d), type: 'button' as const } : {})} title={`${d.label ?? d.name}: ${fmt.format(d.value)}${unit}${onPick ? ' · click to zoom the map' : ''}`}
                className={cn('grid w-full grid-cols-[minmax(0,150px)_1fr_44px] items-center gap-3 rounded-[var(--ns-r-control)] px-1 py-[5px] text-left',
                  onPick && 'cursor-pointer hover:bg-line', dim && 'opacity-45')}>
                <span className="t-small ink2 truncate">{d.label ?? d.name}</span>
                <span className="relative h-2.5">
                  <span className="absolute inset-y-0 left-0" style={{ width: `${w}%`, borderRadius: '0 4px 4px 0',
                    background: d.hatch ? `repeating-linear-gradient(135deg, ${d.color ?? color} 0 1.5px, transparent 1.5px 5px)` : d.color ?? color,
                    boxShadow: d.hatch ? `inset 0 0 0 1px ${d.color ?? color}` : undefined }} />
                </span>
                <span className="t-data text-right">{fmt.format(d.value)}{unit}</span>
              </Row>
            </li>
          )
        })}
      </ul>
    </figure>
  )
}

/** buildings (or any records with a street) per street; clicking a bar selects the street */
export function ByStreet({ items, color, unit = '' }: { items: { street?: string | null; value?: number }[]; color: string; unit?: string }) {
  const street = useUi((s) => s.filter.street)
  const selectStreet = useUi((s) => s.selectStreet)
  const data = useMemo(() => {
    const m = new Map<string, number>()
    for (const x of items) if (x.street) m.set(x.street, (m.get(x.street) ?? 0) + (x.value ?? 1))
    return [...m.entries()].map(([name, value]) => ({ name, value: Math.round(value) })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
  }, [items])
  return <BarList data={data} color={color} unit={unit} active={street} onPick={(b) => selectStreet(street === b.name ? null : b.name)} />
}

export function UseChart({ records, street }: { records: Records; street: string | null }) {
  const c = useMemo(() => charts(records, street, []), [records, street])
  const data = c.building_use.map((r) => (r.name === 'not classified'
    ? { name: r.name, label: 'Not known (no clear photo)', value: r.value, color: 'var(--ns-ink3)', hatch: true }
    : { name: r.name, label: useLabel(r.name), value: r.value }))
  return <BarList data={data} color="var(--ns-ink2)" />
}

export function FloorsChart({ records, street }: { records: Records; street: string | null }) {
  const c = useMemo(() => charts(records, street, []), [records, street])
  return <BarList data={c.floor_distribution.map((r) => ({ name: r.name, label: `${r.name} ${noun(+r.name, 'floor')}`, value: r.value }))} color="var(--ns-ink2)"
    caption={`Only buildings whose floors could be counted (${fmt.format(c.floors_n)} of ${fmt.format(c.floors_status.reduce((n, s) => n + s.value, 0))}).`} />
}

export function DiffChart({ buildings }: { buildings: Building[] }) {
  const data = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of buildings) for (const d of b.discrepancies ?? []) if (d !== 'missing_record') m.set(d, (m.get(d) ?? 0) + 1)
    return [...m.entries()].map(([name, value]) => ({ name, label: diffLabel(name), value })).sort((a, b) => b.value - a.value)
  }, [buildings])
  return <BarList data={data} color="var(--ns-discrepancy)" caption="A building can differ in more than one way." />
}
