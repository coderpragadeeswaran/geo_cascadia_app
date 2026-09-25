/** Charts tab (CLAUDE.md §9.4.1): computed from the records under the global filter (D2). One measure per chart →
 *  one hue, no legend, title names it; match status uses the reserved status colours with labels; "not classified"
 *  is grey and always shown (D9). "Unmatched by street" bars zoom the map to the street (fixed display-name join, D13). */
import { useMemo } from 'react'
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { charts, NOT_CLASSIFIED } from '@/lib/derive'
import { useAreaData } from '@/lib/useAreaData'
import { cn, fmt } from '@/lib/utils'
import { useUi } from '@/store/ui'
import { CostPanel } from './CostPanel'

const STATUS_FILL: Record<string, string> = { matched: 'var(--matched)', discrepancy: 'var(--discrepancy)', no_record: 'var(--no-record)' }
const pretty = (s: string) => s.replace(/_/g, ' ')

interface Row { name: string; value: number; [k: string]: unknown }

function HBar({ data, fill, onPick, active, labelWidth = 128, unit = '' }: {
  data: Row[]; fill: (r: Row) => string; onPick?: (r: Row) => void; active?: string | null; labelWidth?: number; unit?: string }) {
  if (!data.length) return <p className="py-2 text-[12px] text-muted">No data under the current filter.</p>
  return (
    <ResponsiveContainer width="100%" height={data.length * 26 + 8}>
      <BarChart data={data} layout="vertical" margin={{ top: 2, right: 34, bottom: 2, left: 0 }} barCategoryGap={4}>
        <XAxis type="number" hide domain={[0, 'dataMax']} />
        <YAxis type="category" dataKey="name" width={labelWidth} axisLine={false} tickLine={false} interval={0}
          tick={{ fill: 'var(--muted)', fontSize: 11 }} tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : pretty(v))} />
        <Tooltip cursor={{ fill: 'var(--hover)' }} isAnimationActive={false}
          content={({ active: a, payload }) => a && payload?.length ? (
            <div className="glass glass-strong px-2.5 py-1.5 text-[12px]">
              <div className="font-medium">{pretty(String(payload[0].payload.name))}</div>
              <div className="tnum text-muted">{fmt.format(Number(payload[0].value))}{unit}{onPick ? ' · click to zoom' : ''}</div>
            </div>) : null} />
        <Bar dataKey="value" barSize={13} radius={[0, 4, 4, 0]} isAnimationActive={false} cursor={onPick ? 'pointer' : undefined}
          onClick={onPick ? (d: unknown) => onPick((d as { payload: Row }).payload) : undefined}>
          {data.map((r) => <Cell key={r.name} fill={fill(r)} fillOpacity={active && active !== r.name ? 0.35 : 1} />)}
          <LabelList dataKey="value" position="right" fill="var(--fg)" fontSize={11} formatter={(v: unknown) => fmt.format(Number(v))} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function Card({ title, note, children, highlight }: { title: string; note?: React.ReactNode; children: React.ReactNode; highlight?: boolean }) {
  return (
    <section className={cn('rounded-xl border border-glass-border px-3 pb-2 pt-2.5', highlight && 'border-accent/60 bg-accent-soft/40')}>
      <h3 className="text-[12.5px] font-semibold">{title}</h3>
      {note && <p className="mb-1 text-[11px] leading-snug text-faint">{note}</p>}
      <div className="mt-1">{children}</div>
    </section>
  )
}

export function ChartsTab() {
  const { records, streets } = useAreaData()
  const street = useUi((s) => s.filter.street)
  const query = useUi((s) => s.query)
  const selectStreet = useUi((s) => s.selectStreet)
  const c = useMemo(() => (records ? charts(records, street, streets.map((s) => s.props.name)) : null), [records, street, streets])
  if (!c) return <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-hover" />)}</div>
  const groups = query?.groups
  const pick = (r: Row) => selectStreet(street === r.name ? null : r.name)
  return (
    <div className="space-y-2.5 px-3 pb-4">
      <p className="text-[11px] text-faint">{street ? <>Showing <b className="text-fg/85">{street}</b>, click the street chip or the bar again to clear.</> : 'All streets in this area.'} Counts computed from the records.</p>
      {groups && (
        <Card title={`Query: ${query!.text}`} note="Result of the plain-English query (QueryEngine), grouped by street. Click a bar to zoom the map to that street." highlight>
          <HBar data={groups.map((g) => ({ name: g.key, value: g.count }))} fill={() => 'var(--no-record)'} onPick={pick} active={street} labelWidth={150} />
        </Card>
      )}
      <Card title="Unmatched buildings by street" note="Buildings with no register record (synthetic register). Click a bar to zoom the map to that street.">
        <HBar data={c.unmatched_by_street} fill={() => 'var(--no-record)'} onPick={pick} active={street} labelWidth={150} />
      </Card>
      <Card title="Register match status" note="Synthetic register (demo)">
        <HBar data={c.match_status.map((r) => ({ ...r }))} fill={(r) => STATUS_FILL[r.name] ?? 'var(--unclassified)'} labelWidth={96} />
      </Card>
      <Card title="Building use" note={`Observed use. "${NOT_CLASSIFIED}" = no usable view (shown, never hidden).`}>
        <HBar data={c.building_use} fill={(r) => (r.name === NOT_CLASSIFIED ? 'var(--unclassified)' : 'var(--accent)')} labelWidth={118} />
      </Card>
      <Card title={`Floor distribution · measured only (n = ${fmt.format(c.floors_n)})`}
        note={c.floors_status.map((s) => `${fmt.format(s.value)} ${pretty(s.name)}`).join(' · ')}>
        <HBar data={c.floor_distribution.map((r) => ({ ...r, name: `${r.name} floor${r.name === '1' ? '' : 's'}` }))} fill={() => 'var(--accent)'} labelWidth={70} />
      </Card>
      <Card title="Assets by type">
        <HBar data={c.asset_type} fill={() => 'var(--accent)'} labelWidth={80} />
      </Card>
      <Card title="Discrepancy types" note="A building can have more than one.">
        <HBar data={c.discrepancy_type} fill={() => 'var(--discrepancy)'} labelWidth={128} />
      </Card>
      <CostPanel />
    </div>
  )
}
