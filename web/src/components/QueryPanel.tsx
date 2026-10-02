/** A question's panel (docs/QUERY.md): the chips QueryEngine read (always visible, obviously editable, "+ Filter" builds a
 *  question purely by clicking), a "partly understood" state that says what was understood and what was ignored and
 *  never applies a guess silently, then the answer — list, dark stretches, one chart, or the why-empty funnel. */
import { ChevronDown, Inbox, Loader2, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { GapRow, QueryFilters, QueryResponse } from '@/api/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { diffLabel } from '@/lib/labels'
import { queryApplies, runQuery, useQueryError } from '@/lib/query'
import { useAreaData } from '@/lib/useAreaData'
import { cn, fmt, noun, plural } from '@/lib/utils'
import { useUi } from '@/store/ui'
import { BarList } from './Charts'
import { FindingsTable } from './FindingsTable'
import { GapList, type Gap } from './GapList'
import { PanelHead } from './Panel'
import { WhyEmpty } from './WhyEmpty'

type Key = 'show' | 'street' | 'use' | 'floors' | 'match_status' | 'discrepancy' | 'ref_flag' | 'group_by' | 'interval_m' | 'reason_has'
const SHOW: { v: string; label: string; f: QueryFilters }[] = [
  { v: 'buildings', label: 'Buildings', f: { intent: 'buildings' } },
  { v: 'gaps', label: 'Possible dark stretches', f: { intent: 'streetlight_gaps', interval_m: 60 } },
  { v: 'poles', label: 'Poles', f: { intent: 'assets', asset_type: 'pole' } },
  { v: 'streetlights', label: 'Streetlights', f: { intent: 'assets', asset_type: 'streetlight' } },
  { v: 'review', label: 'Review items', f: { intent: 'review' } },
]
const showOf = (f: QueryFilters) => (f.intent === 'streetlight_gaps' ? 'gaps' : f.intent === 'assets' ? (f.asset_type === 'streetlight' ? 'streetlights' : 'poles') : f.intent)
const ALLOWED: Record<QueryFilters['intent'], Key[]> = {
  buildings: ['street', 'use', 'floors', 'match_status', 'discrepancy', 'ref_flag', 'group_by'],
  streetlight_gaps: ['street', 'interval_m'], assets: ['street'], review: ['street', 'reason_has'],
}
const LABEL: Record<Key, string> = { show: 'Show', street: 'Street', use: 'Use', floors: 'Floors', match_status: 'Register', discrepancy: 'Difference',
  ref_flag: 'Google', group_by: 'Chart', interval_m: 'Within', reason_has: 'Reason' }
const OPS: { op: NonNullable<QueryFilters['floors_op']>; label: string }[] = [
  { op: '>', label: 'more than' }, { op: '>=', label: 'at least' }, { op: '<', label: 'less than' }, { op: '==', label: 'exactly' }]
const DISC = ['extra_floor', 'use_change', 'location_shift', 'area_understated']

function value(k: Key, f: QueryFilters) {
  switch (k) {
    case 'show': return SHOW.find((s) => s.v === showOf(f))?.label ?? f.intent
    case 'use': return f.use === 'commercial' ? 'shops & businesses' : 'homes'
    case 'floors': return `${OPS.find((o) => o.op === f.floors_op)?.label ?? f.floors_op} ${f.floors_n}`
    case 'match_status': return f.match_status === 'no_record' ? 'not in the register' : 'differs from it'
    case 'discrepancy': return diffLabel(f.discrepancy ?? '')
    case 'ref_flag': return 'sign not on Google'
    case 'group_by': return 'by street'
    case 'interval_m': return `${f.interval_m} m`
    case 'reason_has': return 'low-confidence floor count'
    default: return String((f as unknown as Record<string, unknown>)[k] ?? '')
  }
}
const present = (f: QueryFilters): Key[] => ['show', ...(ALLOWED[f.intent] ?? []).filter((k) => (k === 'floors' ? f.floors_op != null : (f as unknown as Record<string, unknown>)[k] != null))]
function without(f: QueryFilters, k: Key): QueryFilters {
  const n = { ...f } as Record<string, unknown>
  if (k === 'floors') { delete n.floors_op; delete n.floors_n } else delete n[k]
  return n as unknown as QueryFilters
}
const DEFAULTS: Partial<Record<Key, Partial<QueryFilters>>> = {
  use: { use: 'commercial' }, floors: { floors_op: '>', floors_n: 2 }, match_status: { match_status: 'no_record' },
  discrepancy: { discrepancy: 'use_change' }, ref_flag: { ref_flag: 'sign_not_in_google_within_40m' }, group_by: { group_by: 'street' },
  interval_m: { interval_m: 60 }, reason_has: { reason_has: 'floor count low confidence' },
}

/** "dark stretch" / "dark stretches", "building(s)", "pole(s)", "review item(s)" for a result count */
function nounOf(q: QueryResponse, n: number) {
  const one = q.intent === 'streetlight_gaps' ? 'possible dark stretch' : q.intent === 'review' ? 'review item'
    : q.intent === 'assets' ? (q.parsed_filters.asset_type ?? 'asset') : 'building'
  return noun(n, one)
}

/** One editable chip: label · value · caret (click edits), × removes. Edits re-run through QueryEngine. `typed` = what the
 *  person wrote for a loosely matched street ("sathy road"), shown in the chip's label. */
function Chip({ k, f, streets, typed }: { k: Key; f: QueryFilters; streets: string[]; typed?: string }) {
  const [open, setOpen] = useState(false)
  const apply = (nf: QueryFilters) => { setOpen(false); runQuery({ filters: nf }) }
  const Opt = ({ on, children, onClick, note }: { on?: boolean; children: React.ReactNode; onClick: () => void; note?: string }) => (
    <button onClick={onClick} className={cn('flex w-full cursor-pointer items-baseline justify-between gap-2 rounded-[var(--ns-r-control)] px-2 py-1.5 text-left text-[15.5px] hover:bg-accent-soft', on && 'text-sodium')}>
      <span>{children}</span>{note && <span className="t-small ink3">{note}</span>}
    </button>
  )
  const keep = { ...(f.street ? { street: f.street } : {}) }
  const editor = (() => {
    switch (k) {
      case 'show': return SHOW.map((s) => <Opt key={s.v} on={showOf(f) === s.v} onClick={() => apply({ ...s.f, ...keep })}>{s.label}</Opt>)
      case 'street': return <div className="max-h-64 overflow-y-auto">{streets.map((s) => <Opt key={s} on={f.street === s} onClick={() => apply({ ...f, street: s })}>{s}</Opt>)}</div>
      case 'use': return (['commercial', 'residential'] as const).map((u) => <Opt key={u} on={f.use === u} onClick={() => apply({ ...f, use: u })}>{u === 'commercial' ? 'Shops & businesses' : 'Homes'}</Opt>)
      case 'match_status': return (['no_record', 'discrepancy'] as const).map((m) => <Opt key={m} on={f.match_status === m} onClick={() => apply({ ...f, match_status: m })}>{m === 'no_record' ? 'Not in the register' : 'Differs from the register'}</Opt>)
      case 'discrepancy': return DISC.map((d) => <Opt key={d} on={f.discrepancy === d} onClick={() => apply({ ...f, discrepancy: d })}>{diffLabel(d)}</Opt>)
      case 'interval_m': return [40, 60, 100, 150].map((v) => <Opt key={v} on={f.interval_m === v} onClick={() => apply({ ...f, interval_m: v })} note={v !== 60 ? 'computed by the app' : 'stored by the pipeline'}>{v} m</Opt>)
      case 'floors': return <FloorsEditor f={f} onApply={apply} />
      default: return <p className="t-small ink3 px-2 py-1">Remove this filter with ×.</p>
    }
  })()
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span className="chip">
        <PopoverTrigger asChild>
          <button aria-label={`Change ${LABEL[k]}: ${value(k, f)}`} title={typed ? `You typed ‘${typed}’` : undefined}>
            <span className="ink3">{LABEL[k]}</span><span className="max-w-[170px] truncate font-[560]">{value(k, f)}</span><ChevronDown className="size-3.5 text-ink3" />
          </button>
        </PopoverTrigger>
        {k !== 'show' && <button onClick={() => runQuery({ filters: without(f, k) })} className="!px-1.5 text-ink3 hover:text-ink" aria-label={`Remove ${LABEL[k]}`}><X className="size-3.5" /></button>}
      </span>
      <PopoverContent align="start" className="w-64 p-1.5">{editor}</PopoverContent>
    </Popover>
  )
}

function FloorsEditor({ f, onApply }: { f: QueryFilters; onApply: (f: QueryFilters) => void }) {
  const [op, setOp] = useState(f.floors_op ?? '>')
  const [n, setN] = useState(f.floors_n ?? 2)
  return (
    <div className="space-y-2 p-1">
      <div className="grid grid-cols-2 gap-1">{OPS.map((o) => <button key={o.op} onClick={() => setOp(o.op)} aria-pressed={op === o.op} className="btn h-7 justify-center">{o.label}</button>)}</div>
      <div className="flex items-center gap-2">
        <button className="btn btn-icon btn-line" onClick={() => setN(Math.max(0, n - 1))} aria-label="One floor fewer">−</button>
        <span className="t-figure w-8 text-center" style={{ fontSize: 21.5 }}>{n}</span>
        <button className="btn btn-icon btn-line" onClick={() => setN(Math.min(20, n + 1))} aria-label="One floor more">+</button>
        <span className="t-small ink2">floors</span>
      </div>
      <button className="btn btn-solid w-full justify-center" onClick={() => onApply({ ...f, floors_op: op, floors_n: n })}>Apply</button>
    </div>
  )
}

/** "+ Filter": everything a question can say, by clicking (use, floors, register, street, asset type, gap interval, …) */
function AddFilter({ f, streets }: { f: QueryFilters; streets: string[] }) {
  const has = present(f)
  const opts = (ALLOWED[f.intent] ?? []).filter((k) => !has.includes(k))
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="chip chip-add px-2" aria-label="Add a filter"><Plus className="size-3.5" /> Filter</button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1.5">
        {opts.map((k) => (
          <button key={k} onClick={() => runQuery({ filters: { ...f, ...(k === 'street' ? { street: streets[0] } : DEFAULTS[k]) } as QueryFilters })}
            className="w-full cursor-pointer rounded-[var(--ns-r-control)] px-2 py-1.5 text-left text-[15.5px] hover:bg-accent-soft">
            {LABEL[k] === 'Chart' ? 'Chart by street' : LABEL[k] === 'Google' ? 'Sign not on Google' : LABEL[k] === 'Within' ? 'Gap interval' : LABEL[k]}
          </button>
        ))}
        {!opts.length && <p className="t-small ink3 px-2 py-1">Nothing more to add for this kind of question. Change “Show” for other filters.</p>}
        <p className="t-small ink3 rule-t mt-1 px-2 pt-1.5">Show poles or streetlights with the “Show” chip.</p>
      </PopoverContent>
    </Popover>
  )
}

/** Partly understood: what was understood, what was ignored, the closest supported phrasings */
function NotUnderstood({ q }: { q: QueryResponse }) {
  const u = q.understanding!
  const setQuery = useUi((s) => s.setQuery)
  const nothing = u.status === 'not_understood'
  return (
    <section className="mx-5 mb-3 border-l-2 pl-3" style={{ borderColor: 'var(--ns-sodium)' }} aria-label="Question only partly understood">
      <p className="text-[17px]">{nothing ? 'I couldn’t match this question to anything I can answer.' : 'I understood only part of this question.'}</p>
      {u.understood.length > 0 && (
        <p className="t-small mt-1.5"><span className="ink3">Understood: </span>{u.understood.map((x, i) => <span key={i}>{i ? ', ' : ''}<b className="font-[560]">{x.meaning}</b></span>)}</p>
      )}
      {u.ignored.length > 0 && (
        <p className="t-small mt-1"><span className="ink3">Ignored: </span>{u.ignored.map((x, i) => <span key={i}>{i ? ', ' : ''}<span className="sodium">‘{x}’</span></span>)}</p>
      )}
      {u.synonyms.length > 0 && <p className="t-small ink3 mt-1">Read {u.synonyms.map((s) => `“${s.from}” as “${s.to}”`).join(', ')}.</p>}
      {!nothing && (
        <button className="btn btn-sodium mt-2" onClick={() => setQuery({ ...q, accepted: true })}>
          {q.total == null ? 'Show what I understood' : `Show the ${plural(q.total, nounOf(q, 1), nounOf(q, 2))} for what I understood`}
        </button>
      )}
      {u.suggestions.length > 0 && (
        <>
          <div className="t-micro mt-3">Closest questions I can answer</div>
          <ul className="mt-1">
            {u.suggestions.map((s) => <li key={s}><button className="link t-small text-left" onClick={() => runQuery({ text: s })}>{s}</button></li>)}
          </ul>
        </>
      )}
      <p className="t-small ink3 mt-2">Or build it with the chips below: every filter is clickable.</p>
    </section>
  )
}

export function QueryPanel() {
  const q = useUi((s) => s.query)
  const builder = useUi((s) => s.builder)
  const busy = useUi((s) => s.queryBusy)
  const offline = useUi((s) => s.offline)
  const sendToReview = useUi((s) => s.sendToReview)
  const error = useQueryError((s) => s.error)
  const { streets } = useAreaData()
  const names = streets.map((s) => s.props.name)
  // the click-only builder starts from "all buildings" and is refined chip by chip
  useEffect(() => { if (builder && !q && !busy) runQuery({ filters: { intent: 'buildings' } }) }, [builder, q, busy])
  const applies = queryApplies(q)
  const f = q?.parsed_filters
  const reviewIds = q?.intent === 'review' ? ((q.rows ?? []) as unknown as { id: number | null }[]).map((r) => r.id).filter((x): x is number => typeof x === 'number') : []
  const many = q ? nounOf(q, 2) : ''
  const streetHits = q?.understanding?.synonyms.filter((s) => s.street) ?? []
  return (
    <>
      <PanelHead eyebrow={builder && q?.accepted && !q.understanding ? 'Question, built by clicking' : 'Question'}
        title={q ? (q.understanding?.status === 'ok' || !q.understanding ? q.text : `“${q.text}”`) : 'Build a question'}
        right={busy ? <Loader2 className="size-4 animate-spin sodium" /> : undefined} />
      <div className={cn('flex min-h-0 flex-1 flex-col', busy && 'opacity-70')} aria-busy={busy} aria-label="Query result">
        {error && <p className="t-small mx-5 mb-2" style={{ color: 'var(--ns-no-record)' }}>{error}</p>}
        {q && q.understanding && q.understanding.status !== 'ok' && !q.accepted && <NotUnderstood q={q} />}
        {f && (
          <div className="flex flex-wrap gap-1.5 px-5 pb-3" aria-label="Filters (click to change)">
            {present(f).map((k) => <Chip key={k} k={k} f={f} streets={names} typed={k === 'street' ? streetHits[0]?.from : undefined} />)}
            <AddFilter f={f} streets={names} />
          </div>
        )}
        {f?.street && (streetHits.length > 0 || q?.understanding?.scoped_to) && (
          <p className="t-small ink2 -mt-1 px-5 pb-3" aria-label="Street">
            {streetHits.length > 0
              ? <>Street: read <span className="sodium">‘{streetHits[0].from}’</span> as <b className="font-[560] text-ink">{f.street}</b>.</>
              : <>Answered on <b className="font-[560] text-ink">{f.street}</b>, the street you had selected. Remove the Street chip (×) for the whole area.</>}
          </p>
        )}
        {q && applies && (
          <>
            <div className="flex items-center justify-between gap-2 px-5 pb-2 rule-t pt-3">
              <p className="text-[17px]">{q.total == null ? <>Not computed</> : q.total === 0 ? <>No {many} match — here is why</> : q.groups
                ? <><span className="t-data text-[15.5px]">{fmt.format(q.total)}</span> {noun(q.total, 'building')} on {plural(q.groups.length, 'street')}</>
                : <><span className="t-data text-[15.5px]">{fmt.format(q.total)}</span> {nounOf(q, q.total)}</>}</p>
              {q.intent === 'review' && !!q.total && (
                <button className="btn btn-sodium" disabled={offline || !reviewIds.length} title={offline ? 'The database can’t be reached: review is read-only for now' : undefined}
                  onClick={() => sendToReview({ area: q.area, ids: reviewIds, label: q.text })}><Inbox /> {offline ? 'Offline — read-only' : `Send ${fmt.format(reviewIds.length)} to Review`}</button>
              )}
            </div>
            {q.gaps?.computed && <p className="t-small px-5 pb-2" style={{ color: 'var(--ns-sodium)' }}>{q.gaps.interval_m} m: {q.gaps.note}. The map and list show these computed stretches.</p>}
            {q.note && <p className="t-small ink2 px-5 pb-2">{q.note}</p>}
            {q.total == null ? (
              <p className="t-small px-5 pb-4" role="status">{q.gaps?.note ?? 'This could not be computed for this area.'}</p>
            ) : q.total === 0 ? (
              <div className="px-5 pb-4"><WhyEmpty steps={q.why_empty} noun={many} /></div>
            ) : q.intent === 'streetlight_gaps' ? (
              <div className="min-h-0 flex-1 overflow-y-auto pb-4"><GapList rows={(q.rows ?? []) as unknown as Gap[] as GapRow[]} /></div>
            ) : q.groups ? (
              <GroupChart q={q} />
            ) : (
              <QueryRows q={q} />
            )}
          </>
        )}
      </div>
    </>
  )
}

/** grouped answer ("… by street"): one chart; clicking a bar zooms the map to that street (§10 test 4) */
function GroupChart({ q }: { q: QueryResponse }) {
  const street = useUi((s) => s.filter.street)
  const selectStreet = useUi((s) => s.selectStreet)
  const color = q.parsed_filters.match_status === 'discrepancy' ? 'var(--ns-discrepancy)' : 'var(--ns-no-record)'
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      <BarList data={q.groups!.map((g) => ({ name: g.key, value: g.count }))} color={color} active={street}
        onPick={(b) => selectStreet(street === b.name ? null : b.name)} caption="Click a street to zoom the map to it. Synthetic register (demo)." />
    </div>
  )
}

function QueryRows({ q }: { q: QueryResponse }) {
  const { records } = useAreaData()
  if (!records) return null
  const rows = (q.rows ?? []) as unknown as { kind: string; id: string; item_type?: string; ref_id?: string }[]
  const byId = <T extends { id: string }>(xs: T[], ids: string[]) => { const m = new Map(xs.map((x) => [x.id, x])); return ids.map((i) => m.get(i)).filter(Boolean) as T[] }
  if (q.intent === 'assets') return <FindingsTable kind="asset" rows={byId(records.assets, rows.map((r) => r.id))} />
  if (q.intent === 'review') {
    const b = byId(records.buildings, rows.filter((r) => r.item_type === 'building').map((r) => r.ref_id!))
    const a = byId(records.assets, rows.filter((r) => r.item_type === 'asset').map((r) => r.ref_id!))
    return b.length ? <FindingsTable kind="building" rows={b} /> : <FindingsTable kind="asset" rows={a} />
  }
  return <FindingsTable kind="building" rows={byId(records.buildings, rows.map((r) => r.id))} />
}
