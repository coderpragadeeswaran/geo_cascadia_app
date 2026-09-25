/** Findings table (CLAUDE.md §9.4.1 spec columns): id, street, location, use, floors, OCR text / name, route badges,
 *  matched record, review status. Rows follow the one global filter / query; row click opens the evidence drawer. */
import { type ColumnDef, flexRender, getCoreRowModel, getSortedRowModel, type SortingState, useReactTable } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useMap } from '@vis.gl/react-google-maps'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { Asset, Building, UnmappedBusiness } from '@/api/types'
import { matchAsset, matchBuilding, matchUnmapped, nameOf, useOf } from '@/lib/derive'
import { RouteBadge } from '@/lib/routes'
import { propsFor, useAreaData } from '@/lib/useAreaData'
import { cn, fmt } from '@/lib/utils'
import { flyTo } from '@/map/camera'
import { useUi, type Subject } from '@/store/ui'
import { StatusChip } from './Inspect'
import { WhyEmpty } from './WhyEmpty'

const pretty = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ') : '—')
const loc = (lat: number, lon: number) => <span className="tnum text-[11px] text-muted">{lat.toFixed(5)}<br />{lon.toFixed(5)}</span>
const Review = ({ s }: { s: string | null | undefined }) => s ? <span className={cn('text-[11.5px] font-medium', s === 'pending' ? 'text-review' : 'text-muted')}>{s}</span> : <span className="text-faint">—</span>

const B_COLS: ColumnDef<Building>[] = [
  { id: 'id', header: 'ID', accessorFn: (b) => b.id, size: 104, cell: ({ row: { original: b } }) => <span className="font-mono text-[11px]">{b.id}</span> },
  { id: 'street', header: 'Street', accessorFn: (b) => b.street, size: 150, cell: ({ getValue }) => <span className="line-clamp-2 text-[12px]">{String(getValue() ?? '—')}</span> },
  { id: 'loc', header: 'Location', accessorFn: (b) => b.lat, size: 84, cell: ({ row: { original: b } }) => loc(b.lat, b.lon) },
  { id: 'use', header: 'Use', accessorFn: (b) => useOf(b) ?? '~', size: 132, cell: ({ row: { original: b } }) => (
    <div className="flex flex-col items-start gap-0.5">{useOf(b) ? <span className="text-[12.5px]">{pretty(useOf(b))}</span> : <span className="text-[12px] text-unclassified">not classified</span>}<RouteBadge route={b.attributes?.use?.route} /></div>) },
  { id: 'floors', header: 'Floors', accessorFn: (b) => b.attributes?.floors?.value ?? -1, size: 130, cell: ({ row: { original: b } }) => {
    const f = b.attributes?.floors
    return <div className="flex flex-col items-start gap-0.5">{f?.value != null ? <span className="tnum text-[12.5px]">{f.value} <span className="text-[11px] text-muted">{f.status === 'low_confidence' ? 'low conf.' : ''}</span></span> : <span className="text-[12px] text-unclassified">not measured</span>}<RouteBadge route={f?.route} /></div>
  } },
  { id: 'name', header: 'Name / OCR text', accessorFn: (b) => nameOf(b)?.value ?? b.evidence?.sign_view?.ocr_text ?? '', size: 170, cell: ({ row: { original: b } }) => {
    const n = nameOf(b); const ocr = b.evidence?.sign_view?.ocr_text
    return <div className="flex min-w-0 flex-col items-start gap-0.5">
      <span className="line-clamp-1 text-[12.5px]">{n?.value ?? (ocr ? <span className="text-muted">“{ocr}”</span> : '—')}</span>
      {n?.value && <span className="flex items-center gap-1"><RouteBadge route={n.route} />{n.google_confirmed && <span className="text-[10px] font-semibold text-matched">Google ✓</span>}</span>}
    </div>
  } },
  { id: 'match', header: 'Register match', accessorFn: (b) => b.match_status, size: 150, cell: ({ row: { original: b } }) => (
    <div className="flex flex-col items-start gap-0.5"><StatusChip s={b.match_status} />
      <span className="text-[10.5px] text-faint">{b.register?.property_id ? `${b.register.property_id} · ${pretty(b.register.record_use)} · ${b.register.record_floors ?? '—'} fl` : 'no record'}</span></div>) },
  { id: 'review', header: 'Review', accessorFn: (b) => b.review?.status ?? '', size: 82, cell: ({ row: { original: b } }) => <Review s={b.review?.status} /> },
]

const A_COLS: ColumnDef<Asset>[] = [
  { id: 'id', header: 'ID', accessorFn: (a) => a.id, size: 96, cell: ({ row: { original: a } }) => <span className="font-mono text-[11px]">{a.id}</span> },
  { id: 'type', header: 'Type', accessorFn: (a) => a.type, size: 96, cell: ({ row: { original: a } }) => <div className="flex flex-col items-start gap-0.5"><span className="text-[12.5px]">{a.type}</span><RouteBadge route={a.route} /></div> },
  { id: 'street', header: 'Street', accessorFn: (a) => a.street, size: 150, cell: ({ getValue }) => <span className="line-clamp-2 text-[12px]">{String(getValue() ?? '—')}</span> },
  { id: 'loc', header: 'Location', accessorFn: (a) => a.lat, size: 84, cell: ({ row: { original: a } }) => loc(a.lat, a.lon) },
  { id: 'pos', header: 'Position', accessorFn: (a) => a.uncertainty_m, size: 130, cell: ({ row: { original: a } }) => (
    <span className="text-[12px]">{a.method === 'triangulated' ? `triangulated · ${a.cameras_used} cams` : <span className="text-muted">approximate</span>}<br /><span className="tnum text-[11px] text-faint">± {a.uncertainty_m?.toFixed(1)} m · {a.confidence} conf.</span></span>) },
  { id: 'reg', header: 'Register', accessorFn: (a) => a.register?.status, size: 150, cell: ({ row: { original: a } }) => (
    <div className="flex flex-col items-start gap-0.5"><StatusChip s={a.register?.status} /><span className="text-[10.5px] text-faint">{a.register?.asset_no ?? '—'}</span></div>) },
  { id: 'review', header: 'Review', accessorFn: (a) => a.review?.status ?? '', size: 82, cell: ({ row: { original: a } }) => <Review s={a.review?.status} /> },
]

const U_COLS: ColumnDef<UnmappedBusiness>[] = [
  { id: 'id', header: 'ID', accessorFn: (u) => u.id, size: 84, cell: ({ row: { original: u } }) => <span className="font-mono text-[11px]">{u.id}</span> },
  { id: 'name', header: 'Name', accessorFn: (u) => u.name, size: 150, cell: ({ getValue }) => <span className="text-[12.5px]">{String(getValue() ?? '—')}</span> },
  { id: 'ocr', header: 'OCR text', accessorFn: (u) => u.ocr_text, size: 170, cell: ({ getValue }) => <span className="line-clamp-2 text-[12px] text-muted">“{String(getValue() ?? '')}”</span> },
  { id: 'street', header: 'Street', accessorFn: (u) => u.street, size: 150, cell: ({ getValue }) => <span className="line-clamp-2 text-[12px]">{String(getValue() ?? '—')}</span> },
  { id: 'loc', header: 'Location (approx.)', accessorFn: (u) => u.lat, size: 100, cell: ({ row: { original: u } }) => loc(u.lat, u.lon) },
  { id: 'sight', header: 'Sightings', accessorFn: (u) => u.sightings, size: 76, cell: ({ getValue }) => <span className="tnum text-[12px]">{String(getValue() ?? '—')}</span> },
]

export function FindingsTable() {
  const { records, props } = useAreaData()
  const filter = useUi((s) => s.filter)
  const query = useUi((s) => s.query)
  const setFilter = useUi((s) => s.setFilter)

  const sets = useMemo(() => {
    if (!records) return null
    if (query?.rows && query.intent !== 'streetlight_gaps') {
      const rows = query.rows as unknown as { kind: string; id: string; item_type?: string; ref_id?: string }[]
      const bIds = rows.flatMap((r) => (r.kind === 'building' ? [r.id] : r.item_type === 'building' ? [r.ref_id!] : []))
      const aIds = rows.flatMap((r) => (r.kind === 'pole' || r.kind === 'streetlight' ? [r.id] : r.item_type === 'asset' ? [r.ref_id!] : []))
      const byId = <T extends { id: string }>(xs: T[], ids: string[]) => { const m = new Map(xs.map((x) => [x.id, x])); return ids.map((i) => m.get(i)).filter(Boolean) as T[] }
      return { buildings: byId(records.buildings, bIds), assets: byId(records.assets, aIds), unmapped: [] as UnmappedBusiness[] }
    }
    return { buildings: records.buildings.filter((b) => matchBuilding(b, filter)), assets: records.assets.filter((a) => matchAsset(a, filter)),
      unmapped: records.unmapped.filter((u) => matchUnmapped(u, filter)) }
  }, [records, filter, query])

  const subject: Subject = query?.rows && query.intent === 'assets' ? 'assets'
    : query?.rows && query.intent === 'review' && sets && !sets.buildings.length ? 'assets'
    : query ? (filter.subject === 'unmapped' ? 'buildings' : filter.subject) : filter.subject

  if (!sets) return <div className="space-y-2 p-3">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-hover" />)}</div>

  const counts = { buildings: sets.buildings.length, assets: sets.assets.length, unmapped: sets.unmapped.length }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 px-3 pb-2" role="tablist" aria-label="Record type">
        {(['buildings', 'assets', 'unmapped'] as const).map((s) => (
          <button key={s} role="tab" aria-selected={subject === s} onClick={() => setFilter({ subject: s })}
            disabled={!!query && s === 'unmapped'}
            className={cn('h-7 cursor-pointer rounded-lg px-2.5 text-[12px] font-medium disabled:cursor-default disabled:opacity-35',
              subject === s ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-fg')}>
            {s === 'unmapped' ? 'Unmapped' : s[0].toUpperCase() + s.slice(1)} <span className="tnum opacity-80">{fmt.format(counts[s])}</span>
          </button>
        ))}
      </div>
      {query && query.total === 0 && query.intent !== 'streetlight_gaps' ? (
        <div className="px-3.5 py-2">
          <p className="mb-2 text-[13px] font-semibold">No results for this question</p>
          <WhyEmpty steps={query.why_empty} noun={query.intent === 'review' ? 'review items' : query.intent === 'assets' ? 'assets' : 'buildings'} />
        </div>
      ) : subject === 'buildings' ? <Grid data={sets.buildings} cols={B_COLS} kind="building" props={props} />
        : subject === 'assets' ? <Grid data={sets.assets} cols={A_COLS} kind="asset" props={props} />
          : <Grid data={sets.unmapped} cols={U_COLS} kind="unmapped_business" props={props} />}
    </div>
  )
}

function Grid<T extends { id: string; lat: number; lon: number; type?: string }>({ data, cols, kind, props }: {
  data: T[]; cols: ColumnDef<T>[]; kind: string; props: ReturnType<typeof useAreaData>['props'] }) {
  const [sorting, setSorting] = useState<SortingState>([])
  const table = useReactTable({ data, columns: cols, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() })
  const rows = table.getRowModel().rows
  const scroller = useRef<HTMLDivElement>(null)
  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => 50, overscan: 8 })
  const map = useMap('main')
  const select = useUi((s) => s.select)
  const selected = useUi((s) => s.selected)
  const selId = selected && 'id' in selected ? selected.id : null
  const template = cols.map((c) => `${c.size ?? 120}px`).join(' ')
  const width = cols.reduce((n, c) => n + (c.size ?? 120), 0)
  const open = (x: T) => {
    const p = propsFor(props, kind === 'asset' ? x.type! : kind, x.id)
    if (!p) return
    select(p)
    if (map) flyTo(map, { center: { lat: x.lat, lng: x.lon }, zoom: Math.max(map.getZoom() ?? 18, 19), tilt: useUi.getState().flat ? 0 : 50 }, { instant: useUi.getState().flat })
  }
  if (!data.length) return <p className="px-3.5 py-6 text-center text-[12.5px] text-muted">Nothing matches the current filters.</p>
  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-auto" role="table" aria-rowcount={rows.length}>
      <div style={{ width }} className="min-w-full">
        <div role="row" className="sticky top-0 z-10 grid border-b border-glass-border bg-[var(--glass-strong)] backdrop-blur" style={{ gridTemplateColumns: template }}>
          {table.getHeaderGroups()[0].headers.map((h) => (
            <button key={h.id} role="columnheader" onClick={h.column.getToggleSortingHandler()}
              className="flex cursor-pointer items-center gap-1 px-2 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wider text-faint hover:text-fg">
              {flexRender(h.column.columnDef.header, h.getContext())}
              {h.column.getIsSorted() === 'asc' ? <ArrowUp className="size-3" /> : h.column.getIsSorted() === 'desc' ? <ArrowDown className="size-3" /> : null}
            </button>
          ))}
        </div>
        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {virt.getVirtualItems().map((vi) => {
            const row = rows[vi.index]
            return (
              <div key={row.id} role="row" tabIndex={0} data-index={vi.index} ref={virt.measureElement}
                onClick={() => open(row.original)} onKeyDown={(e) => { if (e.key === 'Enter') open(row.original) }}
                className={cn('absolute left-0 grid w-full cursor-pointer items-center border-b border-glass-border/60 hover:bg-hover focus-visible:bg-hover',
                  selId === row.original.id && 'bg-accent-soft')}
                style={{ transform: `translateY(${vi.start}px)`, gridTemplateColumns: template }}>
                {row.getVisibleCells().map((c) => <div key={c.id} role="cell" className="min-w-0 px-2 py-1.5">{flexRender(c.column.columnDef.cell, c.getContext())}</div>)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
