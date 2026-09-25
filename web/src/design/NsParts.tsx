/** NIGHT SURVEY interface parts for the design preview (real Ward 29 data). Flat: space, thin rules and type
 *  hierarchy instead of glass cards; sodium is the only accent; status colours only where there is a status. */
import { ChevronDown, Crosshair, Inbox, Moon, Search, Sun, X } from 'lucide-react'
import { useState } from 'react'
import { useConfig } from '@/api/queries'
import type { Building, GapRow, JobPreview } from '@/api/types'
import { kpis, type Records } from '@/lib/derive'
import { colors, type Mode } from './tokens'

const fmt = new Intl.NumberFormat('en-IN')
const pretty = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ') : '—')
const STATUS_VAR: Record<string, string> = { matched: 'var(--ns-matched)', discrepancy: 'var(--ns-discrepancy)', no_record: 'var(--ns-no-record)' }
const STATUS_LABEL: Record<string, string> = { matched: 'Matched', discrepancy: 'Discrepancy', no_record: 'No record' }

export const Status = ({ s, label = true }: { s: string | null | undefined; label?: boolean }) => (
  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
    <span className="dot" style={{ background: STATUS_VAR[s ?? ''] ?? 'var(--ns-unclassified)' }} />
    {label && <span className="t-small">{STATUS_LABEL[s ?? ''] ?? pretty(s)}</span>}
  </span>
)

// ------------------------------------------------------------------ top bar: wordmark · area · the question · actions
export function NsTopBar({ area, query, mode, setMode, analyse, onAnalyse }: {
  area: string; query?: string; mode: Mode; setMode?: (m: Mode) => void; analyse?: boolean; onAnalyse?: () => void }) {
  return (
    <header className="flex h-[58px] items-center gap-5 px-5">
      <div className="flex items-baseline gap-3">
        <span style={{ fontWeight: 700, fontStretch: '75%', letterSpacing: '0.16em', fontSize: 13 }}>GEO·CASCADIA</span>
        <button className="btn -ml-1 px-1.5" aria-label="Switch area"><span className="t-title" style={{ fontSize: 16 }}>{area}</span><ChevronDown className="size-3.5 ink3" /></button>
      </div>
      <label className="flex h-9 min-w-0 flex-1 items-center gap-2.5 border-b" style={{ borderColor: 'var(--ns-line-strong)' }}>
        <Search className="size-4 sodium" />
        <input defaultValue={query} placeholder="Ask about this area…" aria-label="Ask a question" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[color:var(--ns-ink3)]" style={{ fontSize: 14 }} />
        <span className="t-data ink3">Ctrl K</span>
      </label>
      <nav className="flex items-center gap-1">
        <button className={`btn ${analyse ? 'btn-solid' : 'btn-sodium'}`} onClick={onAnalyse}><Crosshair className="size-4" /> Analyse</button>
        <button className="btn" aria-label="Review"><Inbox className="size-4" /></button>
        <button className="btn t-data" style={{ fontSize: 11 }} aria-pressed="true">3D</button>
        {setMode && (
          <button className="btn" onClick={() => setMode(mode === 'night' ? 'daylight' : 'night')} aria-label="Night / daylight">
            {mode === 'night' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        )}
      </nav>
    </header>
  )
}

// ------------------------------------------------------------------ 5 key numbers + more (no scrolling ribbon)
export function NsKpis({ records }: { records: Records }) {
  const k = kpis(records, null)
  const [more, setMore] = useState(false)
  const main = [
    { v: k.buildings_analysed, l: 'Buildings' },
    { v: k.unmatched_properties, l: 'No record', c: 'var(--ns-no-record)' },
    { v: k.buildings_with_discrepancy, l: 'Discrepancy', c: 'var(--ns-discrepancy)' },
    { v: k.streetlight_gaps, l: 'Dark stretches', sub: 'no lamp ≤ 60 m' },
    { v: k.use_not_classified, l: 'Use not classified', c: 'var(--ns-ink3)' },
  ]
  const rest = [
    ['Streetlights', k.streetlights], ['Poles', k.poles], ['Triangulated', `${k.assets_triangulated} of ${k.assets}`],
    ['Named businesses', k.named_businesses], ['Google-confirmed', k.names_confirmed_by_google], ['In review', k.low_confidence_observations],
    ['Unmapped businesses', k.unmapped_businesses], ['Streets', k.streets_covered],
  ] as const
  return (
    <div className="relative flex items-stretch px-5">
      {main.map((x, i) => (
        <button key={x.l} className={`flex cursor-pointer flex-col items-start py-1 pr-6 text-left ${i ? 'rule-l pl-5' : ''}`}>
          <span className="t-figure" style={{ color: x.c ?? 'var(--ns-ink)' }}>{fmt.format(x.v)}</span>
          <span className="t-micro mt-1.5">{x.l}</span>
        </button>
      ))}
      <button className="btn rule-l ml-1 self-center pl-4" onClick={() => setMore(!more)} aria-expanded={more}>More <ChevronDown className="size-3.5" /></button>
      {more && (
        <div className="sheet absolute left-5 top-full z-10 mt-2 grid w-[440px] grid-cols-2 gap-x-6 gap-y-2 p-4">
          {rest.map(([l, v]) => <div key={l} className="flex items-baseline justify-between rule-b pb-1.5"><span className="t-small ink2">{l}</span><span className="t-data">{typeof v === 'number' ? fmt.format(v) : v}</span></div>)}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ query 2 result: dark stretches
export function NsGapsPanel({ rows, query }: { rows: GapRow[]; query: string }) {
  const total = rows.reduce((n, g) => n + g.length_m, 0)
  return (
    <section className="surface flex h-full flex-col" aria-label="Query result">
      <div className="px-5 pb-3 pt-4">
        <div className="t-micro">Question</div>
        <p className="t-small ink2 mt-1">{query}</p>
        <div className="mt-2 flex flex-wrap gap-1.5"><span className="tag">streetlight gaps</span><span className="tag">60 m</span></div>
        <div className="mt-4 flex items-baseline gap-2"><span className="t-figure">{rows.length}</span><span className="t-small ink2">dark stretches · <span className="t-data">{fmt.format(total)} m</span> recorded</span></div>
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((g) => (
          <li key={g.id} className="rule-t px-5 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate" title={g.street}>{g.street}</span>
              <span className="t-data shrink-0" style={{ fontSize: 13 }}>{fmt.format(g.length_m)} m</span>
            </div>
            <div className="mt-0.5 flex items-baseline justify-between gap-3">
              <span className="t-small ink3 min-w-0 truncate" title={g.gap_type}>{g.gap_type} · {g.poles_inside} poles</span>
              {g.display_mode === 'along_road' && g.length_differs && g.along_road_m != null && <span className="t-data sodium shrink-0 whitespace-nowrap">≈ {fmt.format(g.along_road_m)} m on road</span>}
            </div>
            {g.display_mode === 'check' && <p className="t-small mt-1.5 border-l-2 pl-2 ink2" style={{ borderColor: 'var(--ns-sodium)' }}>Check: {g.note}</p>}
          </li>
        ))}
      </ol>
    </section>
  )
}

// ------------------------------------------------------------------ findings table that fits its panel (column priority)
export function NsFindingsTable({ rows }: { rows: Building[] }) {
  // priority: 1 id · name/street · status   2 use · floors   3 review   (location, routes → row tooltip / drawer)
  return (
    <div className="ns-table" style={{ containerType: 'inline-size' }}>
      <style>{`
        .ns-table .r { display: grid; grid-template-columns: 92px minmax(0,1fr) 108px; gap: 0 12px; align-items: center; }
        .ns-table .p2, .ns-table .p3 { display: none; }
        @container (min-width: 460px) { .ns-table .r { grid-template-columns: 92px minmax(0,1fr) 96px 52px 108px; } .ns-table .p2 { display: block; } }
        @container (min-width: 600px) { .ns-table .r { grid-template-columns: 92px minmax(0,1fr) 96px 52px 108px 70px; } .ns-table .p3 { display: block; } }
      `}</style>
      <div className="r rule-b px-4 py-2 t-micro"><span>ID</span><span>Name · street</span><span className="p2">Use</span><span className="p2">Fl.</span><span>Register</span><span className="p3">Review</span></div>
      {rows.map((b) => {
        const name = b.attributes?.name?.quality === 'good' ? b.attributes.name.value : null
        const use = b.attributes?.use?.value
        const fl = b.attributes?.floors
        return (
          <div key={b.id} className="r rule-b cursor-pointer px-4 py-2 hover:bg-[color:var(--ns-line)]"
            title={`${b.id} · ${b.street} · ${b.lat.toFixed(5)}, ${b.lon.toFixed(5)}${use ? ` · use via ${b.attributes?.use?.route}` : ''}`}>
            <span className="t-data truncate">{b.id}</span>
            <span className="min-w-0"><span className="block truncate">{name ?? b.street}</span>{name && <span className="t-small ink3 block truncate">{b.street}</span>}</span>
            <span className="p2 t-small truncate">{use ? pretty(use) : <span className="ink3">not classified</span>}</span>
            <span className="p2 t-data">{fl?.value ?? <span className="ink3">—</span>}</span>
            <Status s={b.match_status} />
            <span className="p3 t-small ink2">{b.review?.status ?? '—'}</span>
          </div>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------ one chart: unmatched by street (plain SVG, 4 px ends)
export function NsChart({ data }: { data: { name: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <figure>
      <figcaption className="mb-3"><div className="t-title">Buildings with no register record, by street</div><div className="t-small ink3 mt-0.5">Synthetic register (demo) · click a street to fly there</div></figcaption>
      <ul className="space-y-2">
        {data.map((d) => (
          <li key={d.name} className="grid cursor-pointer grid-cols-[minmax(0,160px)_1fr_28px] items-center gap-3" title={`${d.name}: ${d.value}`}>
            <span className="t-small truncate ink2">{d.name}</span>
            <span className="h-2.5"><span className="block h-full" style={{ width: `${Math.max(d.value ? 3 : 0, (d.value / max) * 100)}%`, background: 'var(--ns-no-record)', borderRadius: '0 4px 4px 0' }} /></span>
            <span className="t-data text-right">{d.value}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

// ------------------------------------------------------------------ evidence drawer
export function NsEvidence({ b, onClose }: { b: Building; onClose?: () => void }) {
  const { data: cfg } = useConfig()
  const v = b.evidence?.attribute_view
  const src = cfg && v ? `https://maps.googleapis.com/maps/api/streetview?size=640x640&pano=${encodeURIComponent(v.pano_id)}&heading=${v.heading}&pitch=${v.pitch ?? 0}&fov=${v.fov ?? 90}&return_error_code=true&key=${encodeURIComponent(cfg.maps_js_key)}` : null
  const at = b.attributes, reg = b.register
  const Row = ({ k, v: val, tag }: { k: string; v: React.ReactNode; tag?: string | null }) => (
    <div className="grid grid-cols-[110px_1fr_auto] items-baseline gap-3 rule-t py-2"><span className="t-small ink3">{k}</span><span>{val}</span>{tag ? <span className="tag">{tag}</span> : <span />}</div>
  )
  const route = (r?: string | null) => (r ? ({ tier1_local_clip: 'T1 · local', tier3_vlm: 'T3 · VLM', tier3_vlm_fewshot: 'T3 · VLM', tier2_ocr: 'T2 · OCR', 'tier3_vlm+ocr_gate': 'T3 · VLM+OCR' } as Record<string, string>)[r] ?? r : null)
  return (
    <aside className="surface flex h-full flex-col" aria-label="Evidence">
      <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <div className="t-micro">Building · <span className="t-data" style={{ letterSpacing: 0, textTransform: 'none' }}>{b.id}</span></div>
          <div className="t-title mt-1 truncate">{at?.name?.quality === 'good' ? at.name.value : b.street}</div>
          <div className="mt-1.5"><Status s={b.match_status} /></div>
        </div>
        {onClose && <button className="btn px-1.5" onClick={onClose} aria-label="Close"><X className="size-4" /></button>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {src && v && (
          <figure className="relative aspect-square overflow-hidden" style={{ borderRadius: 'var(--ns-r-control)', background: '#000' }}>
            <img src={src} alt="Street View evidence" className="absolute inset-0 size-full object-cover" />
            <svg viewBox="0 0 640 640" className="absolute inset-0 size-full" aria-hidden>
              {v.x1 != null && <rect x={v.x1} y={v.y1!} width={v.x2! - v.x1} height={v.y2! - v.y1!} fill="none" stroke="var(--ns-sodium)" strokeWidth="3" />}
            </svg>
            <figcaption className="t-data absolute inset-x-0 bottom-0 flex justify-between px-2.5 py-1.5" style={{ background: 'linear-gradient(transparent, rgb(0 0 0 / 0.7))', color: '#fff', fontSize: 10 }}>
              <span>{Math.round(v.heading)}° · pitch {Math.round(v.pitch ?? 0)}° · fov {v.fov}°</span><span>Imagery © Google</span>
            </figcaption>
          </figure>
        )}
        <div className="mt-3 flex justify-end"><button className="btn btn-sodium">Live 360°</button></div>
        <div className="t-micro mt-4 mb-1">Observed</div>
        <Row k="Use" v={at?.use?.value ? pretty(at.use.value) : <span className="ink3">not classified</span>} tag={route(at?.use?.route)} />
        <Row k="Floors" v={at?.floors?.value != null ? <span className="t-data" style={{ fontSize: 13 }}>{at.floors.value}</span> : <span className="ink3">not measured</span>} tag={route(at?.floors?.route)} />
        <Row k="Sign text" v={at?.name?.value ?? '—'} tag={route(at?.name?.route)} />
        <div className="mt-4 mb-1 flex items-center justify-between"><span className="t-micro">Register record</span><span className="tag">SYNTHETIC</span></div>
        <Row k="Property" v={<span className="t-data">{reg?.property_id ?? '—'}</span>} />
        <Row k="Recorded" v={`${pretty(reg?.record_use)} · ${reg?.record_floors ?? '—'} floors`} />
        <Row k="Reasons" v={<span className="t-small">{(b.reasons ?? []).join('; ') || '—'}</span>} />
      </div>
    </aside>
  )
}

// ------------------------------------------------------------------ analyse: confirm sheet
export function NsAnalyseSheet({ p }: { p: JobPreview }) {
  const e = p.estimate
  return (
    <div className="sheet w-[420px] p-5" role="dialog" aria-label="Confirm analysis">
      <div className="t-micro">Analyse this street</div>
      <div className="t-title mt-1">{p.street}</div>
      <div className="t-data ink2 mt-1">{fmt.format(p.length_m)} m · {p.osm_ways} OSM way</div>
      {p.already_analysed_in.length > 0 && <p className="t-small mt-3 border-l-2 pl-2 ink2" style={{ borderColor: 'var(--ns-sodium)' }}>Already inside {p.already_analysed_in.join(', ')}.</p>}
      {e && (
        <dl className="mt-4 grid grid-cols-3">
          {[['Street View', `≈ ${e.street_view_images}`, `≈ $${e.street_view_usd}`], ['GPU', `≈ ${e.gpu_minutes}`, 'min, Colab'], ['CPU', `${e.cpu_minutes_full_ocr}`, 'min, full OCR']].map(([k, v, s], i) => (
            <div key={k} className={i ? 'rule-l pl-4' : ''}><dt className="t-micro">{k}</dt><dd className="t-figure mt-1" style={{ fontSize: 20 }}>{v}</dd><dd className="t-small ink3">{s}</dd></div>
          ))}
        </dl>
      )}
      <p className="t-small ink3 mt-3">Estimate scaled from the Ward 29 run (model_card). VLM calls not included.</p>
      <div className="mt-5 flex justify-end gap-2"><button className="btn">Cancel</button><button className="btn btn-solid" disabled title="Preview only">Start analysis</button></div>
    </div>
  )
}

// ------------------------------------------------------------------ contextual key (collapsed by default) + altimeter
export function NsKey({ mode, level }: { mode: Mode; level: 'area' | 'street' }) {
  const [open, setOpen] = useState(false)
  const c = colors[mode]
  const Item = ({ sw, children }: { sw: React.ReactNode; children: React.ReactNode }) => <li className="flex items-center gap-2.5 py-1 t-small">{sw}{children}</li>
  return (
    <div className="absolute bottom-5 left-5">
      <button className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>Key <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} /></button>
      {open && (
        <ul className="sheet mb-2 w-[220px] px-4 py-3" style={{ position: 'absolute', bottom: '100%' }}>
          <Item sw={<span className="h-1 w-5 rounded" style={{ background: c.sodium, boxShadow: `0 0 8px ${c.sodium}` }} />}>Lit road (analysed)</Item>
          <Item sw={<span className="h-2 w-5 rounded" style={{ background: c.dark, boxShadow: `0 0 0 1px ${c.darkEdge}` }} />}>Dark stretch: no lamp ≤ 60 m</Item>
          <Item sw={<span className="dot" style={{ background: '#fff4e0', boxShadow: `0 0 8px 3px ${c.sodiumGlow}` }} />}>Streetlight</Item>
          <Item sw={<span className="dot" style={{ background: c.ink3, width: 5, height: 5 }} />}>Pole, no lamp</Item>
          <Item sw={<span className="dot" style={{ background: c.noRecord }} />}>No register record</Item>
          <Item sw={<span className="dot" style={{ background: c.discrepancy }} />}>Discrepancy</Item>
          <Item sw={<span className="dot" style={{ background: c.matched }} />}>Matched</Item>
          {level === 'street' && <Item sw={<span className="h-3 w-5" style={{ backgroundImage: `repeating-linear-gradient(135deg, ${c.ink3} 0 1.5px, transparent 1.5px 5px)` }} />}>Floors not classified (flat)</Item>}
          <Item sw={<span className="dot" style={{ border: `1.5px solid ${c.ink2}`, background: 'transparent' }} />}>Unmapped business (approx.)</Item>
          <li className="t-micro mt-1.5">Registers synthetic (demo)</li>
        </ul>
      )}
    </div>
  )
}

export function NsAltimeter({ level }: { level: 'city' | 'area' | 'street' | 'object' }) {
  return (
    <nav className="absolute bottom-5 right-5 flex flex-col items-end gap-1" aria-label="Zoom level">
      {(['object', 'street', 'area', 'city'] as const).map((b) => (
        <button key={b} className="t-micro flex cursor-pointer items-center gap-2" style={{ color: b === level ? 'var(--ns-sodium)' : undefined }}>
          {b}<span className="h-px" style={{ width: b === level ? 22 : 12, background: b === level ? 'var(--ns-sodium)' : 'var(--ns-line-strong)' }} />
        </button>
      ))}
    </nav>
  )
}
