/** Query bar + result card (CLAUDE.md §9.4.1): free text → parsed filter chips (editable; edits re-run through the
 *  pipeline's QueryEngine via /query {filters}) → results on map + table; empty → the why_empty funnel, explained. */
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Loader2, Plus, Search, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import type { QueryFilters } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { runQuery, useQueryError } from '@/lib/query'
import { useAreaData } from '@/lib/useAreaData'
import { cn, fmt } from '@/lib/utils'
import { useUi } from '@/store/ui'
import { WhyEmpty } from './WhyEmpty'

export function QueryBar() {
  const [text, setText] = useState('')
  const busy = useUi((s) => s.queryBusy)
  const setPalette = useUi((s) => s.setPaletteOpen)
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (text.trim().length > 1) runQuery({ text: text.trim() }) }}
      className="glass flex h-11 min-w-0 flex-1 items-center gap-2 pl-3 pr-1.5" role="search">
      {busy ? <Loader2 className="size-4 shrink-0 animate-spin text-accent" /> : <Sparkles className="size-4 shrink-0 text-accent" />}
      <input value={text} onChange={(e) => setText(e.target.value)} aria-label="Ask a question about this area"
        placeholder="Ask: commercial buildings with >2 floors and no record…"
        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint" />
      <button type="button" onClick={() => setPalette(true)} className="hidden shrink-0 cursor-pointer rounded-md border border-glass-border px-1.5 py-0.5 text-[10.5px] text-muted hover:text-fg lg:block" aria-label="Open command palette (Ctrl K)">Ctrl K</button>
      <Button type="submit" size="icon-sm" variant="accent" aria-label="Run question" disabled={busy || text.trim().length < 2}><ArrowRight /></Button>
    </form>
  )
}

const INTENTS: { v: QueryFilters['intent']; label: string }[] = [
  { v: 'buildings', label: 'Buildings' }, { v: 'streetlight_gaps', label: 'Streetlight gaps' }, { v: 'assets', label: 'Poles / streetlights' }, { v: 'review', label: 'Review items' },
]
const OPS = ['>', '>=', '<', '=='] as const
const DISC = ['location_shift', 'area_understated', 'use_change', 'extra_floor']
const pretty = (s: string) => s.replace(/_/g, ' ')

type Key = 'intent' | 'street' | 'use' | 'floors' | 'match_status' | 'discrepancy' | 'ref_flag' | 'group_by' | 'interval_m' | 'asset_type' | 'reason_has'
const ALLOWED: Record<QueryFilters['intent'], Key[]> = {
  buildings: ['street', 'use', 'floors', 'match_status', 'discrepancy', 'group_by'],
  streetlight_gaps: ['street', 'interval_m'], assets: ['street', 'asset_type'], review: ['street', 'reason_has'],
}
const DEFAULTS: Partial<Record<Key, Partial<QueryFilters>>> = {
  use: { use: 'commercial' }, floors: { floors_op: '>', floors_n: 1 }, match_status: { match_status: 'no_record' },
  discrepancy: { discrepancy: 'use_change' }, group_by: { group_by: 'street' }, interval_m: { interval_m: 60 },
  asset_type: { asset_type: 'pole' }, reason_has: { reason_has: 'floor count low confidence' },
}
const LABEL: Record<Key, string> = { intent: 'Show', street: 'Street', use: 'Use', floors: 'Floors', match_status: 'Register', discrepancy: 'Discrepancy',
  ref_flag: 'Google', group_by: 'Group', interval_m: 'Interval', asset_type: 'Asset', reason_has: 'Reason' }

function chipValue(k: Key, f: QueryFilters) {
  switch (k) {
    case 'intent': return INTENTS.find((i) => i.v === f.intent)?.label ?? f.intent
    case 'floors': return `${f.floors_op} ${f.floors_n}`
    case 'match_status': return f.match_status === 'no_record' ? 'no matching record' : 'discrepancy'
    case 'ref_flag': return 'sign not in Google'
    case 'group_by': return 'by street'
    case 'interval_m': return `${f.interval_m} m`
    case 'reason_has': return 'low-confidence floor count'
    default: return pretty(String((f as unknown as Record<string, unknown>)[k] ?? ''))
  }
}
const keysOf = (f: QueryFilters): Key[] => ['intent', ...(['street', 'use', 'floors', 'match_status', 'discrepancy', 'ref_flag', 'group_by', 'interval_m', 'asset_type', 'reason_has'] as Key[])
  .filter((k) => (k === 'floors' ? f.floors_op != null : (f as unknown as Record<string, unknown>)[k] != null))]

function without(f: QueryFilters, k: Key): QueryFilters {
  const n = { ...f } as Record<string, unknown>
  if (k === 'floors') { delete n.floors_op; delete n.floors_n } else delete n[k]
  return n as unknown as QueryFilters
}

function Chip({ k, f, streets }: { k: Key; f: QueryFilters; streets: string[] }) {
  const [open, setOpen] = useState(false)
  const apply = (nf: QueryFilters) => { setOpen(false); runQuery({ filters: nf }) }
  const Opt = ({ on, children, onClick }: { on?: boolean; children: React.ReactNode; onClick: () => void }) => (
    <button onClick={onClick} className={cn('w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-hover', on && 'bg-accent-soft text-accent')}>{children}</button>
  )
  const editor = (() => {
    switch (k) {
      case 'intent': return INTENTS.map((i) => <Opt key={i.v} on={f.intent === i.v} onClick={() => apply({ intent: i.v, ...(f.street ? { street: f.street } : {}), ...(i.v === 'streetlight_gaps' ? { interval_m: 60 } : i.v === 'assets' ? { asset_type: 'pole' } : {}) })}>{i.label}</Opt>)
      case 'street': return <div className="max-h-60 overflow-y-auto">{streets.map((s) => <Opt key={s} on={f.street === s} onClick={() => apply({ ...f, street: s })}>{s}</Opt>)}</div>
      case 'use': return (['commercial', 'residential'] as const).map((u) => <Opt key={u} on={f.use === u} onClick={() => apply({ ...f, use: u })}>{u}</Opt>)
      case 'match_status': return (['no_record', 'discrepancy'] as const).map((m) => <Opt key={m} on={f.match_status === m} onClick={() => apply({ ...f, match_status: m })}>{m === 'no_record' ? 'no matching record' : 'discrepancy'}</Opt>)
      case 'discrepancy': return DISC.map((d) => <Opt key={d} on={f.discrepancy === d} onClick={() => apply({ ...f, discrepancy: d })}>{pretty(d)}</Opt>)
      case 'interval_m': return [40, 60, 100].map((v) => <Opt key={v} on={f.interval_m === v} onClick={() => apply({ ...f, interval_m: v })}>{v} m{v !== 60 ? ' (not computed in this run)' : ''}</Opt>)
      case 'asset_type': return (['pole', 'streetlight'] as const).map((a) => <Opt key={a} on={f.asset_type === a} onClick={() => apply({ ...f, asset_type: a })}>{a}s</Opt>)
      case 'floors': return <FloorsEditor f={f} onApply={apply} />
      default: return <p className="px-2 py-1 text-[12px] text-muted">Remove this filter with ×.</p>
    }
  })()
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span className="inline-flex h-7 items-center overflow-hidden rounded-lg border border-glass-border bg-hover text-[12px]">
        <PopoverTrigger asChild>
          <button className="flex h-full cursor-pointer items-center gap-1 px-2 hover:bg-[var(--glass-border)]" aria-label={`Edit ${LABEL[k]} filter`}>
            <span className="text-muted">{LABEL[k]}</span><span className="max-w-[150px] truncate font-medium">{chipValue(k, f)}</span>
          </button>
        </PopoverTrigger>
        {k !== 'intent' && (
          <button onClick={() => runQuery({ filters: without(f, k) })} className="flex h-full cursor-pointer items-center px-1.5 text-muted hover:bg-[var(--glass-border)] hover:text-fg" aria-label={`Remove ${LABEL[k]} filter`}><X className="size-3" /></button>
        )}
      </span>
      <PopoverContent align="start" className="w-64 p-1.5">{editor}</PopoverContent>
    </Popover>
  )
}

function FloorsEditor({ f, onApply }: { f: QueryFilters; onApply: (f: QueryFilters) => void }) {
  const [op, setOp] = useState(f.floors_op ?? '>')
  const [n, setN] = useState(f.floors_n ?? 1)
  return (
    <div className="space-y-2 p-1">
      <div className="grid grid-cols-4 gap-1">{OPS.map((o) => <button key={o} onClick={() => setOp(o)} className={cn('cursor-pointer rounded-md py-1 text-[12.5px]', op === o ? 'bg-accent-soft text-accent' : 'bg-hover')}>{o}</button>)}</div>
      <input type="number" min={0} max={20} value={n} onChange={(e) => setN(Math.max(0, Math.min(20, Number(e.target.value) || 0)))} aria-label="Number of floors"
        className="w-full rounded-md border border-glass-border bg-hover px-2 py-1 text-[12.5px] outline-none focus:border-accent" />
      <Button size="sm" variant="accent" className="w-full" onClick={() => onApply({ ...f, floors_op: op, floors_n: n })}>Apply</Button>
    </div>
  )
}

function AddFilter({ f, streets }: { f: QueryFilters; streets: string[] }) {
  const present = keysOf(f)
  const opts = ALLOWED[f.intent].filter((k) => !present.includes(k))
  if (!opts.length) return null
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-dashed border-glass-border px-2 text-[12px] text-muted hover:text-fg" aria-label="Add a filter"><Plus className="size-3" /> Filter</button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-1.5">
        {opts.map((k) => (
          <button key={k} onClick={() => runQuery({ filters: { ...f, ...(k === 'street' ? { street: streets[0] } : DEFAULTS[k]) } as QueryFilters })}
            className="w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-hover">{LABEL[k]}</button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

export function QueryCard() {
  const q = useUi((s) => s.query)
  const setQuery = useUi((s) => s.setQuery)
  const sendToReview = useUi((s) => s.sendToReview)
  const offline = useUi((s) => s.offline)
  const busy = useUi((s) => s.queryBusy)
  const error = useQueryError((s) => s.error)
  const { streets } = useAreaData()
  const names = streets.map((s) => s.props.name)
  if (!q && !error) return null
  const reviewIds = q?.intent === 'review' ? ((q.rows ?? []) as unknown as { id: number | null }[]).map((r) => r.id).filter((x): x is number => typeof x === 'number') : []
  const summary = !q ? '' : q.groups ? `${fmt.format(q.total)} buildings on ${q.groups.length} streets`
    : `${fmt.format(q.total)} ${q.intent === 'streetlight_gaps' ? 'streetlight gaps' : q.intent === 'review' ? 'review items' : q.intent === 'assets' ? `${q.parsed_filters.asset_type ?? 'asset'}s` : 'buildings'}`
  return (
    <AnimatePresence>
      <motion.section initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
        className={cn('glass pointer-events-auto px-3.5 py-3', busy && 'opacity-70')} aria-label="Query result" aria-busy={busy}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="eyebrow flex items-center gap-1"><Search className="size-3" /> Question</div>
            {q && <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-fg/85">{q.text}</p>}
          </div>
          <Button size="icon-sm" onClick={() => { setQuery(null); useQueryError.getState().set(null) }} aria-label="Clear question"><X /></Button>
        </div>
        {error && <p className="mt-2 rounded-md bg-[rgb(244_82_91/0.12)] px-2 py-1.5 text-[12px] text-no-record">{error}</p>}
        {q && (
          <>
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Parsed filters (click to edit)">
              {keysOf(q.parsed_filters).map((k) => <Chip key={k} k={k} f={q.parsed_filters} streets={names} />)}
              <AddFilter f={q.parsed_filters} streets={names} />
            </div>
            <div className="mt-2.5 border-t border-glass-border pt-2">
              {q.total === 0 ? (
                <>
                  <p className="mb-1.5 text-[13px] font-semibold">No results, here is why</p>
                  <WhyEmpty steps={q.why_empty} noun={q.intent === 'review' ? 'review items' : q.intent === 'assets' ? 'assets' : q.intent === 'streetlight_gaps' ? 'gaps' : 'buildings'} />
                </>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <p className="tnum text-[13px] font-semibold">{summary}</p>
                  {q.intent === 'review' && (
                    <Button size="sm" variant="accent" disabled={offline || !reviewIds.length} onClick={() => sendToReview({ area: q.area, ids: reviewIds, label: q.text })}
                      title={offline ? 'Offline data mode: review is read-only' : undefined}>
                      Send {reviewIds.length} to Review
                    </Button>
                  )}
                </div>
              )}
              {q.total > 0 && <p className="mt-1 text-[11px] text-faint">Highlighted on the map · {q.intent === 'streetlight_gaps' ? 'listed in Streetlights' : q.groups ? 'charted in Charts' : 'listed in Findings'}</p>}
            </div>
          </>
        )}
      </motion.section>
    </AnimatePresence>
  )
}
