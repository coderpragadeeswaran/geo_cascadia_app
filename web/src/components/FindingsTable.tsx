/** Findings table that FITS its panel (docs/DESIGN.md declutter rule 3): no horizontal scroll; columns drop by priority
 *  with container queries. Plain words; IDs, coordinates and model routes are in the row tooltip, the evidence drawer and
 *  "How do we know?". Rows are virtualised; a row click opens the evidence and flies the map there. */
import { useVirtualizer } from '@tanstack/react-virtual'
import { useMap } from '@vis.gl/react-google-maps'
import { ArrowDown, ArrowUp, Maximize2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { Asset, Building, UnmappedBusiness } from '@/api/types'
import { assetRegLabel, ASSET_REG, floorsText, matchLabel, reviewLabel, useLabel } from '@/lib/labels'
import { nameOf, useOf } from '@/lib/derive'
import { propsFor, useAreaData } from '@/lib/useAreaData'
import { cn, plural } from '@/lib/utils'
import { flyTo, OBJECT_TILT } from '@/map/camera'
import { useUi } from '@/store/ui'

const DOT: Record<string, string> = { matched: 'var(--ns-matched)', discrepancy: 'var(--ns-discrepancy)', no_record: 'var(--ns-no-record)' }
/** `wrap`: in cards the label wraps onto a second line (tables keep one truncated line) */
export const StatusDot = ({ s, label, wrap }: { s: string | null | undefined; label: string; wrap?: boolean }) => (
  <span className={wrap ? 'flex min-w-0 items-start gap-1.5' : 'inline-flex min-w-0 items-center gap-1.5'}>
    <span className={cn('dot', wrap && 'mt-[7px] shrink-0')} style={{ background: s ? DOT[s] ?? 'var(--ns-unclassified)' : 'transparent', boxShadow: s ? undefined : 'inset 0 0 0 1.5px var(--ns-ink3)' }} />
    <span className={cn('t-small', wrap ? 'min-w-0 break-words' : 'truncate')}>{label}</span>
  </span>
)

type Kind = 'building' | 'asset' | 'unmapped'
interface Col<T> { id: string; head: string; p: 1 | 2 | 3; w: string; sort?: (x: T) => string | number; cell: (x: T) => React.ReactNode }

const B_COLS: Col<Building>[] = [
  { id: 'what', head: 'Building', p: 1, w: 'minmax(0,1fr)', sort: (b) => nameOf(b)?.value ?? b.street, cell: (b) => {
    const n = nameOf(b)
    const title = n?.quality === 'good' && n.value ? n.value : useOf(b) ? useLabel(useOf(b)) : 'Building'
    return <span className="min-w-0"><span className="block truncate">{title}</span><span className="t-small ink3 block truncate">{b.street}</span></span>
  } },
  { id: 'use', head: 'Use', p: 2, w: '104px', sort: (b) => useOf(b) ?? '~', cell: (b) => <span className={cn('t-small truncate', !useOf(b) && 'ink3')}>{useOf(b) ? useLabel(useOf(b)) : 'not known'}</span> },
  { id: 'floors', head: 'Floors', p: 2, w: '52px', sort: (b) => b.attributes?.floors?.value ?? -1, cell: (b) => {
    const f = b.attributes?.floors
    return f?.value != null ? <span className="t-data">{f.value}{f.status === 'low_confidence' ? '?' : ''}</span> : <span className="ink3">—</span>
  } },
  { id: 'reg', head: 'Register', p: 1, w: '118px', sort: (b) => b.match_status, cell: (b) => <StatusDot s={b.match_status} label={matchLabel(b.match_status, false, !!b.attributes?.use?.value)} /> },
  { id: 'review', head: 'Review', p: 3, w: '76px', sort: (b) => b.review?.status ?? '', cell: (b) => <span className={cn('t-small', b.review?.status !== 'pending' && 'ink3')}>{b.review?.status === 'pending' ? 'waiting' : b.review?.status ?? '—'}</span> },
  { id: 'id', head: 'ID', p: 3, w: '96px', sort: (b) => b.id, cell: (b) => <span className="t-data ink3 truncate">{b.id}</span> },
]
const A_COLS: Col<Asset>[] = [
  { id: 'what', head: 'Seen', p: 1, w: 'minmax(0,1fr)', sort: (a) => a.type, cell: (a) => (
    <span className="min-w-0"><span className="block truncate">{a.type === 'streetlight' ? 'Streetlight' : 'Pole, no lamp seen'}</span><span className="t-small ink3 block truncate">{a.street ?? '—'}</span></span>) },
  { id: 'pos', head: 'Position', p: 2, w: '82px', sort: (a) => (a.method === 'triangulated' ? 0 : 1), cell: (a) => <span className={cn('t-small', a.method !== 'triangulated' && 'ink3')}>{a.method === 'triangulated' ? 'pinpointed' : 'approximate'}</span> },
  { id: 'reg', head: 'Register', p: 1, w: '118px', sort: (a) => a.register?.status ?? '', cell: (a) => <StatusDot s={ASSET_REG[a.register?.status ?? '']?.status ?? null} label={assetRegLabel(a.register?.status)} /> },
  { id: 'review', head: 'Review', p: 3, w: '76px', sort: (a) => a.review?.status ?? '', cell: (a) => <span className={cn('t-small', a.review?.status !== 'pending' && 'ink3')}>{a.review?.status === 'pending' ? 'waiting' : a.review?.status ?? '—'}</span> },
  { id: 'id', head: 'ID', p: 3, w: '90px', sort: (a) => a.id, cell: (a) => <span className="t-data ink3 truncate">{a.id}</span> },
]
const U_COLS: Col<UnmappedBusiness>[] = [
  { id: 'what', head: 'Business (sign)', p: 1, w: 'minmax(0,1fr)', sort: (u) => u.name ?? '', cell: (u) => (
    <span className="min-w-0"><span className="block truncate">{u.name ?? '—'}</span><span className="t-small ink3 block truncate">{u.street ?? '—'}</span></span>) },
  { id: 'seen', head: 'Photos', p: 1, w: '64px', sort: (u) => u.sightings ?? 0, cell: (u) => <span className="t-data">{u.sightings ?? '—'}</span> },
  { id: 'id', head: 'ID', p: 3, w: '84px', sort: (u) => u.id, cell: (u) => <span className="t-data ink3 truncate">{u.id}</span> },
]
const COLS = { building: B_COLS, asset: A_COLS, unmapped: U_COLS } as const

const tip = (kind: Kind, x: Building | Asset | UnmappedBusiness) => {
  const base = `${x.id} · ${x.street ?? '—'} · ${x.lat.toFixed(5)}, ${x.lon.toFixed(5)}`
  if (kind === 'building') { const b = x as Building; return `${base} · ${floorsText(b.attributes?.floors?.value, b.attributes?.floors?.status)} · ${reviewLabel(b.review?.status)}` }
  return base
}

/** onExpand (ui-polish-2): the footer offers "Open the full list" (the street panel's larger view) */
export function FindingsTable({ kind, rows, empty = 'Nothing matches.', onExpand }: { kind: Kind; rows: (Building | Asset | UnmappedBusiness)[]; empty?: string; onExpand?: () => void }) {
  const cols = COLS[kind] as Col<Building | Asset | UnmappedBusiness>[]
  const [sort, setSort] = useState<{ id: string; desc: boolean } | null>(null)
  const sorted = useMemo(() => {
    if (!sort) return rows
    const c = cols.find((x) => x.id === sort.id)
    if (!c?.sort) return rows
    const v = (x: Building | Asset | UnmappedBusiness) => c.sort!(x)
    return [...rows].sort((a, b) => { const A = v(a), B = v(b); const r = A < B ? -1 : A > B ? 1 : 0; return sort.desc ? -r : r })
  }, [rows, sort, cols])
  const scroller = useRef<HTMLDivElement>(null)
  const virt = useVirtualizer({ count: sorted.length, getScrollElement: () => scroller.current, estimateSize: () => 46, overscan: 8 })
  const { props } = useAreaData()
  const map = useMap('main')
  const select = useUi((s) => s.select)
  const selected = useUi((s) => s.selected)
  const selId = selected && 'id' in selected ? selected.id : null
  const open = (x: Building | Asset | UnmappedBusiness) => {
    const p = propsFor(props, kind === 'asset' ? (x as Asset).type : kind === 'unmapped' ? 'unmapped_business' : 'building', x.id)
    if (!p) return
    select(p)
    if (map) flyTo(map, { center: { lat: x.lat, lng: x.lon }, zoom: Math.max(map.getZoom() ?? 18, 19), tilt: useUi.getState().flat ? 0 : OBJECT_TILT }, { instant: useUi.getState().flat })
  }
  // grid templates per container width (column priority 1 → 2 → 3)
  const tpl = (maxP: number) => cols.filter((c) => c.p <= maxP).map((c) => c.w).join(' ')
  const cls = `ft-${kind}`
  if (!rows.length) return <p className="t-small ink3 px-5 py-6">{empty}</p>
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', cls)} style={{ containerType: 'inline-size' }}>
      <style>{`
        .${cls} .r { display: grid; grid-template-columns: ${tpl(1)}; column-gap: 12px; align-items: center; }
        .${cls} .p2, .${cls} .p3 { display: none; }
        @container (min-width: 440px) { .${cls} .r { grid-template-columns: ${tpl(2)}; } .${cls} .p2 { display: flex; } }
        @container (min-width: 600px) { .${cls} .r { grid-template-columns: ${tpl(3)}; } .${cls} .p3 { display: flex; } }
      `}</style>
      <div role="row" className="r rule-b px-5 py-1.5">
        {cols.map((c) => (
          <button key={c.id} role="columnheader" className={cn('t-micro flex cursor-pointer items-center gap-1 text-left hover:text-ink2', c.p > 1 && `p${c.p}`)}
            onClick={() => setSort((s) => (s?.id === c.id ? (s.desc ? null : { id: c.id, desc: true }) : { id: c.id, desc: false }))}
            aria-sort={sort?.id === c.id ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
            {c.head}{sort?.id === c.id && (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
          </button>
        ))}
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden" role="table" aria-rowcount={sorted.length} aria-label="Findings">
        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {virt.getVirtualItems().map((vi) => {
            const x = sorted[vi.index]
            return (
              <div key={x.id} role="row" tabIndex={0} data-index={vi.index} ref={virt.measureElement} title={tip(kind, x)}
                onClick={() => open(x)} onKeyDown={(e) => { if (e.key === 'Enter') open(x) }}
                className={cn('r rule-b absolute left-0 w-full cursor-pointer px-5 py-2 hover:bg-line focus-visible:bg-line', selId === x.id && 'bg-accent-soft')}
                style={{ transform: `translateY(${vi.start}px)` }}>
                {cols.map((c) => <div key={c.id} role="cell" className={cn('min-w-0', c.p > 1 && `p${c.p}`)}>{c.cell(x)}</div>)}
              </div>
            )
          })}
        </div>
      </div>
      <div className="t-data ink3 rule-t flex items-center justify-between gap-2 px-5 py-1.5">
        <span>{kind === 'building' ? plural(sorted.length, 'building') : kind === 'asset' ? plural(sorted.length, 'pole or streetlight', 'poles & streetlights') : plural(sorted.length, 'business')}</span>
        {onExpand && <button className="link t-small inline-flex items-center gap-1 font-sans" onClick={onExpand}><Maximize2 className="size-3.5" /> Open the full list</button>}
      </div>
    </div>
  )
}
