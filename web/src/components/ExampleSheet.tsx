/** "See real examples" (P5): up to 3 real items for one step or branch of the pipeline, each with the reason it belongs
 *  there. One example is shown at a time, so a Street View photo loads only for the example you open (never in bulk).
 *  Photos are live Street View Static images (browser key, never stored, §9.6); maps are our own SVG (no second map). */
import { MapPin, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useHoodExamples, type HoodExample } from '@/api/p5'
import type { EvidenceBox } from '@/api/types'
import { floorsText, matchLabel, positionMethodLabel, useLabel } from '@/lib/labels'
import { propsFor, useAreaData } from '@/lib/useAreaData'
import { cn, fmt1 } from '@/lib/utils'
import { useUi } from '@/store/ui'
import { EvidencePhoto } from './EvidencePhoto'
import { Boxes, EvidenceViews } from './EvidenceViews'
import { GeoMini } from './GeoMini'
import { Fact } from './HowWeKnow'
import { PositionMini } from './PositionMini'
import { useDetail } from './Detail'

export function ExampleSheet({ area, exKey, label, onClose }: { area: string; exKey: string; label: string; onClose: () => void }) {
  const { data, isPending, isError } = useHoodExamples(area, exKey)
  const [i, setI] = useState(0)
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => { close.current?.focus() }, [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [onClose])
  const ex = data?.[Math.min(i, (data?.length ?? 1) - 1)]
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'color-mix(in srgb, var(--ns-bg0) 72%, transparent)' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Real examples: ${label}`} className="sheet flex max-h-[94vh] w-[780px] max-w-full flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
          <div className="min-w-0">
            <div className="t-micro">Real examples</div>
            <h2 className="t-title mt-0.5">{label}</h2>
          </div>
          <button ref={close} className="btn btn-icon" onClick={onClose} aria-label="Close examples"><X /></button>
        </div>
        {ex && <p className="t-body px-5 pb-2">{ex.reason.charAt(0).toUpperCase() + ex.reason.slice(1)}.</p>}
        {data && data.length > 1 && (
          <div className="flex gap-4 px-5" role="tablist" aria-label="Examples" style={{ borderBottom: '1px solid var(--ns-line)' }}>
            {data.map((x, k) => (
              <button key={k} role="tab" aria-selected={k === i} onClick={() => setI(k)}
                className="t-small -mb-px max-w-[220px] cursor-pointer bg-transparent pb-1.5 pt-1 text-left transition-colors hover:text-ink"
                style={{ color: k === i ? 'var(--ns-ink)' : 'var(--ns-ink3)', borderBottom: `2px solid ${k === i ? 'var(--ns-sodium)' : 'transparent'}`, fontWeight: k === i ? 600 : 400 }}>
                <span className="block truncate">{k + 1}. {x.title}</span>
              </button>
            ))}
          </div>
        )}
        <div className="min-h-0 overflow-y-auto px-5 pb-5 pt-3">
          {isPending && <div className="aspect-[4/3] w-full animate-pulse rounded-[var(--ns-r-control)] bg-line" />}
          {isError && <p className="t-small ink2">Couldn’t load the examples. The API may be restarting; try again in a moment.</p>}
          {data && !data.length && <p className="t-small ink3">No items of this kind in this area.</p>}
          {ex && <Example key={`${exKey}-${i}`} ex={ex} onClose={onClose} exKey={exKey} />}
        </div>
      </div>
    </div>
  )
}

function Example({ ex, exKey, onClose }: { ex: HoodExample; exKey: string; onClose: () => void }) {
  const { records, streets, props } = useAreaData()
  const detail = useDetail()
  const [photo, setPhoto] = useState(false)
  const mini = streets.map((s) => ({ name: s.props.name, geometry: s.geometry }))
  const b = ex.kind === 'building' ? records?.buildings.find((x) => x.id === ex.id) : undefined
  const a = ex.kind === 'asset' ? records?.assets.find((x) => x.id === ex.id) : undefined
  const u = ex.kind === 'unmapped' ? records?.unmapped.find((x) => x.id === ex.id) : undefined
  const g = ex.kind === 'gap' ? ex : undefined
  // what the sentence talks about, drawn on the plan (H2): outlines near the example, the faced / containing outline
  // highlighted, the camera's view wedges, and sight lines from cameras to the object
  const outlines = useMemo(() => {
    const B = records?.buildings ?? []
    const at = ex.points?.[0] ?? (b ? { lat: b.lat, lon: b.lon } : a ? { lat: a.lat, lon: a.lon } : ex.rays?.[0] ?? null)
    if (!at) return []
    const kx = 111320 * Math.cos((at.lat * Math.PI) / 180)
    const near = B.filter((x) => Math.hypot((x.lon - at.lon) * kx, (x.lat - at.lat) * 110540) < 70 && (x.footprint?.polygon_latlon?.length ?? 0) > 2)
    const hl = new Set<string>([...(ex.footprints ?? []), ...(b ? [b.id] : [])])
    if (ex.inside && ex.points?.[0]) for (const x of near) if (inRing(ex.points[0], x.footprint!.polygon_latlon as [number, number][])) hl.add(x.id)
    return near.map((x) => ({ ring: x.footprint!.polygon_latlon as [number, number][], hl: hl.has(x.id) }))
  }, [records, ex, b, a])
  const lights = useMemo(() => {
    if (!g?.line || !records) return []
    const [s0, s1] = g.line
    const kx = 111320 * Math.cos((s0[0] * Math.PI) / 180)
    const d = (la: number, lo: number) => Math.min(Math.hypot((lo - s0[1]) * kx, (la - s0[0]) * 110540), Math.hypot((lo - s1[1]) * kx, (la - s1[0]) * 110540))
    const len = Math.hypot((s1[1] - s0[1]) * kx, (s1[0] - s0[0]) * 110540)
    return records.assets.filter((x) => d(x.lat, x.lon) < Math.max(120, len / 2 + 40))
      .map((x) => ({ lat: x.lat, lon: x.lon, tone: x.type === 'streetlight' ? 'sodium' as const : 'drop' as const, hollow: x.type !== 'streetlight' }))
  }, [g, records])
  const showOnMap = () => {
    const kind = b ? 'building' : a ? a.type : u ? 'unmapped_business' : g ? 'streetlight_gap' : null
    const p = kind && ex.id ? propsFor(props, kind, ex.id) : null
    onClose()
    const ui = useUi.getState()
    ui.go('explore')
    if (p) ui.select(p)
    else if (ex.street) ui.selectStreet(ex.street)
  }
  return (
    <div>
      <div className="[&_figure.aspect-square]:mx-auto [&_figure.aspect-square]:max-w-[min(100%,calc(94vh-250px))]">
        {ex.kind === 'photo' && ex.view && (
          <div className={cn('grid items-start gap-4', ex.rays?.length ? 'grid-cols-[minmax(0,1fr)_250px]' : 'grid-cols-1')}>
            <EvidencePhoto view={ex.view} label={`${ex.title} · ${Math.round(ex.view.heading)}°`}>
              <Boxes boxes={(ex.boxes ?? []) as EvidenceBox[]} all={(ex.boxes?.length ?? 0) <= 4} hidden={new Set()}
                targetName={exKey.startsWith('signs') ? 'This sign' : exKey.startsWith('bld') ? 'This building' : 'This box'} />
            </EvidencePhoto>
            {!!ex.rays?.length && (
              <div>
                <GeoMini streets={mini} label="Where the camera stood and which way it looked" polygons={outlines} height={250} minSpanM={70}
                  rays={ex.rays.map((r) => ({ ...r, len_m: 30, hl: true }))} points={(ex.points ?? []).map((p) => ({ lat: p.lat, lon: p.lon, tone: 'ink' as const, label: p.label }))} />
                <p className="t-small ink3 mt-1.5">{ex.footprints?.length
                  ? 'The wedge is the photo’s direction; the orange outline is the mapped building it faces.'
                  : 'The wedge is the photo’s direction. No building outline on the map falls inside it, so no building is checked here.'}</p>
              </div>
            )}
          </div>
        )}
        {b && ex.map && (
          <>
            <GeoMini streets={mini} label="The building outline and the cameras that looked towards it" polygons={outlines}
              rays={(ex.rays ?? []).map((r) => ({ ...r, len_m: 30 }))} points={(ex.rays ?? []).map((r) => ({ lat: r.lat, lon: r.lon, tone: 'ink' as const, label: 'camera' }))} minSpanM={70} />
            {photo ? <div className="mt-3"><EvidenceViews kind="building" id={b.id} at={{ lat: b.lat, lng: b.lon }} target="building" /></div>
              : <button className="btn btn-line mt-2" onClick={() => setPhoto(true)}>Show the nearest photo</button>}
          </>
        )}
        {b && !ex.map && (exKey.startsWith('pos.') ? (
          <>
            <PositionMini b={b} />
            {photo ? <div className="mt-3"><EvidenceViews kind="building" id={b.id} at={{ lat: b.lat, lng: b.lon }} target="building" /></div>
              : <button className="btn btn-line mt-2" onClick={() => setPhoto(true)}>Show the photo</button>}
          </>
        ) : <EvidenceViews kind="building" id={b.id} at={{ lat: b.lat, lng: b.lon }} target="building" />)}
        {a && (
          <>
            <GeoMini streets={mini} label={`${a.type} position and the cameras that saw it`} polygons={outlines}
              rays={(ex.rays ?? []).map((r) => ({ lat: r.lat, lon: r.lon, heading: r.heading, to: { lat: a.lat, lon: a.lon } }))}
              points={[...(ex.rays ?? []).map((r) => ({ lat: r.lat, lon: r.lon, tone: 'ink' as const, label: 'camera' })),
                { lat: a.lat, lon: a.lon, tone: a.type === 'streetlight' ? 'sodium' : 'ink', r_m: a.uncertainty_m, dashed: a.method !== 'triangulated', label: a.type }]} minSpanM={60} />
            <p className="t-small ink3 mt-1">{a.method === 'triangulated' ? 'Dashed lines: the sight lines from each camera; they cross at the pole.' : 'One camera saw it, so the position along its sight line is an estimate (circle = how far off it could be).'}</p>
            {photo ? <div className="mt-3"><EvidenceViews kind="asset" id={a.id} at={{ lat: a.lat, lng: a.lon }} target={a.type === 'streetlight' ? 'lamp' : 'pole'} /></div>
              : <button className="btn btn-line mt-2" onClick={() => setPhoto(true)}>Show the photo</button>}
          </>
        )}
        {u && <EvidenceViews kind="unmapped" id={u.id} at={{ lat: u.lat, lng: u.lon }} target="sign" />}
        {g?.line && <>
          <GeoMini streets={mini} label="Dark stretch with the streetlights and poles around it" lines={[{ coords: g.line, tone: 'dark' }]} points={lights} minSpanM={120} />
          <p className="t-small ink3 mt-1">Dark band: the stretch. Orange dots: streetlights seen; hollow dots: poles with no lamp seen.</p>
        </>}
        {ex.kind === 'map' && (
          <>
            <GeoMini streets={mini} label={ex.title} highlight={ex.street ?? null} polygons={outlines}
              rays={(ex.rays ?? []).map((r) => ({ ...r, len_m: 26, hl: !!r.faces }))}
              points={(ex.points ?? []).map((p) => ({ lat: p.lat, lon: p.lon, tone: p.drop ? 'drop' as const : 'sodium' as const, hollow: p.drop, label: p.label }))}
              fit={ex.points?.length ? 'items' : 'area'} minSpanM={ex.points?.length ? (ex.rays?.length || ex.inside ? 70 : 120) : 160} />
            {!!ex.rays?.length && <p className="t-small ink3 mt-1">Wedges: the directions photographed from this stop. Orange outlines: the mapped buildings they face.</p>}
            {ex.inside && <p className="t-small ink3 mt-1">Orange outline: the mapped building the camera point falls inside.</p>}
          </>
        )}
      </div>
      <div className="t-small mt-3 space-y-1">
        {b && <>
          <Fact k="Use">{useLabel(b.attributes?.use?.value)}</Fact>
          <Fact k="Floors">{floorsText(b.attributes?.floors?.value, b.attributes?.floors?.status)}</Fact>
          <Fact k="Register" hint="synthetic register">{matchLabel(b.match_status, true, !!b.attributes?.use?.value)}</Fact>
          {b.predicted_position && <Fact k="Position" hint={detail === 'technical' ? b.predicted_position.method : undefined}>{positionMethodLabel(b.predicted_position)}</Fact>}
        </>}
        {a && <>
          <Fact k="Position" hint={detail === 'technical' ? `method ${a.method}, ${a.cameras_used ?? 0} camera(s)` : undefined}>
            {a.method === 'triangulated' ? 'Pinpointed from 2 or more camera positions' : 'Approximate: seen from one camera position'}</Fact>
          {a.uncertainty_m != null && <Fact k="Could be off by">about {fmt1.format(a.uncertainty_m)} m</Fact>}
        </>}
        {(ex.facts ?? []).filter(([, v, t]) => v != null && v !== '' && (t !== 'tech' || detail === 'technical')).map(([k, v]) => <Fact key={k} k={k}>{String(v)}</Fact>)}
        {ex.note && <p className="ink3">{ex.note}</p>}
      </div>
      {(b || a || u || g) && <button className="btn mt-3" onClick={showOnMap}><MapPin /> Show on the map</button>}
    </div>
  )
}

/** ray casting: is a [lat, lon] point inside a ring */
function inRing(p: { lat: number; lon: number }, ring: [number, number][]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j]
    if ((yi > p.lat) !== (yj > p.lat) && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
