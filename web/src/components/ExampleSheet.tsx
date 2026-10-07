/** "See real examples" (P5): up to 3 real items for one step or branch of the pipeline, each with the reason it belongs
 *  there. One example is shown at a time, so a Street View photo loads only for the example you open (never in bulk).
 *  Photos are live Street View Static images (browser key, never stored, §9.6); maps are our own SVG (no second map). */
import { MapPin, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useHoodExamples, type HoodExample } from '@/api/p5'
import type { Building, EvidenceBox } from '@/api/types'
import { floorsText, matchLabel, positionMethodLabel, useLabel } from '@/lib/labels'
import { REGISTER_NOTE, assetPoints, buildingPolys, darkLines, miniStreets, signPoints } from '@/lib/mini'
import { propsFor, useAreaData } from '@/lib/useAreaData'
import { cn, fmt1 } from '@/lib/utils'
import { useUi } from '@/store/ui'
import { EvidencePhoto } from './EvidencePhoto'
import { Boxes, EvidenceViews, PhotoKey } from './EvidenceViews'
import { GeoMini, metres, type MiniLine, type MiniPolygon, type MiniStreet } from './GeoMini'
import { ObjectMini } from './ObjectMini'
import { Fact } from './HowWeKnow'
import { PositionMini } from './PositionMini'
import { useDetail } from './Detail'

const NONE = new Set<string>()

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
  const { records, streets, props, area, gaps } = useAreaData()
  const detail = useDetail()
  const [photo, setPhoto] = useState(false)
  const [hl, setHl] = useState<number | null>(null)          // ui-polish-2: box <-> key highlight
  const mini = useMemo(() => miniStreets(streets), [streets])
  const b = ex.kind === 'building' ? records?.buildings.find((x) => x.id === ex.id) : undefined
  const a = ex.kind === 'asset' ? records?.assets.find((x) => x.id === ex.id) : undefined
  const u = ex.kind === 'unmapped' ? records?.unmapped.find((x) => x.id === ex.id) : undefined
  const g = ex.kind === 'gap' ? ex : undefined
  // the outlines the sentence is about (faced by the camera, or the one a dropped camera stands in); every other outline
  // around is drawn by the mini-map itself (outlines="auto")
  const keyOutlines = useMemo<MiniPolygon[]>(() => {
    const B = records?.buildings ?? []
    const ids = new Set<string>(ex.footprints ?? [])
    if (ex.inside && ex.points?.[0]) for (const x of B) if ((x.footprint?.polygon_latlon?.length ?? 0) > 2 && inRing(ex.points[0], x.footprint!.polygon_latlon as [number, number][])) ids.add(x.id)
    const legend = ex.inside ? 'the building it stands in' : exKey === 'cameras.kept' ? 'building it photographs' : 'building this photo faces'
    const own = B.filter((x) => ids.has(x.id) && (x.footprint?.polygon_latlon?.length ?? 0) > 2)
      .map((x) => ({ ring: x.footprint!.polygon_latlon as [number, number][], hl: true, legend, tip: x.attributes?.name?.value || 'Mapped building outline' }))
    // a dropped camera usually stands in a building that was not analysed: its OpenStreetMap outline comes with the example
    return ex.outline && !own.length ? [{ ring: ex.outline, hl: true, legend, tip: 'Building outline (OpenStreetMap) the camera point falls inside' }] : own
  }, [records, ex, exKey])
  const showOnMap = () => {
    const kind = b ? 'building' : a ? a.type : u ? 'unmapped_business' : g ? 'streetlight_gap' : null
    const p = kind && ex.id ? propsFor(props, kind, ex.id) : null
    onClose()
    const ui = useUi.getState()
    ui.go('explore')
    if (p) ui.select(p)
    else if (ex.street) ui.selectStreet(ex.street)
  }
  const measure = ex.measure ? { a: ex.measure.a, b: ex.measure.b } : null
  const bRing = (b?.footprint?.polygon_latlon ?? []) as [number, number][]
  return (
    <div>
      <div className="[&_figure.aspect-square]:mx-auto [&_figure.aspect-square]:max-w-[min(100%,calc(94vh-250px))]">
        {ex.kind === 'photo' && ex.view && (
          <div className={cn('grid items-start gap-4', ex.rays?.length ? 'grid-cols-[minmax(0,1fr)_300px]' : 'grid-cols-1')}>
            <div>
              <EvidencePhoto view={ex.view} label={`${ex.title} · ${Math.round(ex.view.heading)}°`}>
                <Boxes boxes={(ex.boxes ?? []) as EvidenceBox[]} all={(ex.boxes?.length ?? 0) <= 4} hidden={NONE} hl={hl} setHl={setHl} />
              </EvidencePhoto>
              <PhotoKey boxes={(ex.boxes ?? []) as EvidenceBox[]} all={(ex.boxes?.length ?? 0) <= 4} hidden={NONE} hl={hl} setHl={setHl}
                targetName={exKey.startsWith('signs') ? 'This sign' : exKey.startsWith('bld') ? 'This building' : 'This box'} />
            </div>
            {!!ex.rays?.length && <PhotoMini area={area} mini={mini} ray={ex.rays[0]} faced={keyOutlines} records={records} />}
          </div>
        )}
        {b && ex.map && (
          <>
            <GeoMini area={area} outlines="auto" streets={mini} highlight={b.street} minSpanM={70} height={240}
              label="The building outline and the cameras that looked towards it"
              polygons={bRing.length > 2 ? [{ ring: bRing, hl: true, legend: 'this building' }] : []}
              rays={(ex.rays ?? []).map((r) => ({ ...r, len_m: 30, tip: `Photo direction ${Math.round(r.heading)}°` }))}
              points={(ex.rays ?? []).map((r) => ({ lat: r.lat, lon: r.lon, tone: 'ink' as const, shape: 'ring' as const, legend: 'camera', tip: 'Camera that looked towards it' }))}
              caption="Wedges: the photo directions. None of these photos showed a building box on this outline." />
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
        ) : exKey.startsWith('match.') ? (
          <>
            <MatchMini area={area} mini={mini} b={b} records={records} />
            <div className="mt-3"><EvidenceViews kind="building" id={b.id} at={{ lat: b.lat, lng: b.lon }} target="building" /></div>
          </>
        ) : <EvidenceViews kind="building" id={b.id} at={{ lat: b.lat, lng: b.lon }} target="building" />)}
        {a && (
          <>
            <ObjectMini area={area} obj={{ kind: 'asset', a }} streets={mini} height={240} label={`${a.type} position and the cameras that saw it`}
              caption={a.method === 'triangulated' ? 'The dashed lines of sight from each camera cross at the pole.' : 'One camera saw it, so the position along its line of sight is an estimate (circle: how far off it could be).'} />
            {photo ? <div className="mt-3"><EvidenceViews kind="asset" id={a.id} at={{ lat: a.lat, lng: a.lon }} target={a.type === 'streetlight' ? 'lamp' : 'pole'} /></div>
              : <button className="btn btn-line mt-2" onClick={() => setPhoto(true)}>Show the photo</button>}
          </>
        )}
        {u && <>
          <ObjectMini area={area} obj={{ kind: 'unmapped', u }} streets={mini} height={220} label="Where the business sign was seen, and from which camera" />
          <div className="mt-3"><EvidenceViews kind="unmapped" id={u.id} at={{ lat: u.lat, lng: u.lon }} target="sign" /></div>
        </>}
        {g?.line && <GapMini area={area} mini={mini} ex={g} gaps={gaps} records={records} />}
        {ex.kind === 'map' && (
          <GeoMini area={area} outlines="auto" streets={mini} highlight={ex.street ?? null} label={ex.title} height={250}
            polygons={keyOutlines} measure={measure}
            stops={exKey === 'streets' && ex.street ? { street: ex.street } : exKey.startsWith('cameras.') ? 'all' : undefined}
            rays={(ex.rays ?? []).map((r) => ({ ...r, len_m: 26, hl: !!r.faces, tip: `Photo direction ${Math.round(r.heading)}°${r.faces ? ', faces a mapped building' : ', no building outline in view'}` }))}
            points={(ex.points ?? []).map((p) => p.drop
              ? { lat: p.lat, lon: p.lon, tone: 'drop' as const, shape: 'x' as const, legend: exKey === 'cameras.inside' ? 'dropped camera position' : 'panorama not used',
                tip: exKey === 'cameras.inside' ? 'Dropped: the camera point is inside a building outline' : 'Panorama not used by the planner' }
              : { lat: p.lat, lon: p.lon, tone: 'sodium' as const, legend: exKey === 'cameras.kept' ? 'this camera stop' : 'chosen camera stop',
                tip: exKey === 'cameras.kept' ? 'The camera stop in this example' : 'A camera stop the planner chose' })}
            fit={ex.points?.length ? 'items' : 'area'} minSpanM={ex.points?.length ? (ex.rays?.length || ex.inside ? 70 : 90) : 160}
            caption={[ex.measure ? `The line with its distance: ${ex.measure.what}.` : null,
              ex.rays?.length ? 'Wedges: the directions photographed from this stop.' : null,
              exKey === 'streets' ? 'Ticks: the camera stops on this street.' : null].filter(Boolean).join(' ') || undefined} />
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

/** D39: a photo's direction with what the run located inside it (within 60 m): poles, lights, business signs and the
 *  building it faces, counted in the legend */
const WEDGE_M = 60
function inWedge(p: { lat: number; lon: number }, r: { lat: number; lon: number; heading: number; fov?: number }) {
  const kx = 111320 * Math.cos((r.lat * Math.PI) / 180)
  const dx = (p.lon - r.lon) * kx, dy = (p.lat - r.lat) * 110540
  const d = Math.hypot(dx, dy)
  if (d > WEDGE_M || d < 1) return false
  const brg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
  const off = Math.abs(((brg - r.heading + 540) % 360) - 180)
  return off <= (r.fov ?? 90) / 2
}
function PhotoMini({ area, mini, ray, faced, records }: { area: string | null; mini: MiniStreet[]; ray: NonNullable<HoodExample['rays']>[number]
  faced: MiniPolygon[]; records: ReturnType<typeof useAreaData>['records'] }) {
  const pts = useMemo(() => [...assetPoints((records?.assets ?? []).filter((x) => inWedge(x, ray))),
    ...signPoints((records?.unmapped ?? []).filter((x) => inWedge(x, ray)))], [records, ray])
  return (
    <GeoMini area={area} outlines="auto" streets={mini} polygons={faced} height={250} minSpanM={70}
      rays={[{ ...ray, len_m: WEDGE_M * 0.6, hl: true, legend: 'photo direction', tip: `Photo direction ${Math.round(ray.heading)}°` }]}
      points={[{ lat: ray.lat, lon: ray.lon, tone: 'ink', shape: 'ring', legend: 'camera', tip: 'Where the photo was taken' }, ...pts]}
      frame={[{ lat: ray.lat, lon: ray.lon }, ...pts, ...faced.flatMap((f) => f.ring.map(([lat, lon]) => ({ lat, lon })))]}
      label="Where the camera stood, which way it looked, and what was located in that direction"
      caption={`Markers: the poles, lights and signs the run located in this direction (within ${WEDGE_M} m).${faced.length ? ' Orange outline: the mapped building the photo faces.' : ' No building outline on the map falls inside it, so no building is checked here.'}`} />
  )
}

/** D39: the building among its neighbours, each coloured by register status (synthetic register) */
function MatchMini({ area, mini, b, records }: { area: string | null; mini: MiniStreet[]; b: Building; records: ReturnType<typeof useAreaData>['records'] }) {
  const near = useMemo(() => (records?.buildings ?? []).filter((x) => metres(x, b) < 90), [records, b])
  return (
    <GeoMini area={area} streets={mini} highlight={b.street} polygons={buildingPolys(near, b.id)} frame={[b]} minSpanM={140} height={220}
      label="The building and its neighbours, coloured by what the register says" caption={REGISTER_NOTE} />
  )
}

/** D39: a dark stretch along its road with its length, and the lights and poles around it */
function GapMini({ area, mini, ex, gaps, records }: { area: string | null; mini: MiniStreet[]; ex: HoodExample
  gaps: ReturnType<typeof useAreaData>['gaps']; records: ReturnType<typeof useAreaData>['records'] }) {
  const along = gaps.find((x) => x.props.id === ex.id)
  const lines = useMemo<MiniLine[]>(() => along ? darkLines([along], true) : [{ coords: ex.line!, tone: 'dark', legend: 'dark stretch (no light within 60 m)', measure: true, measureText: ex.reason.match(/^[\d,]+ m/)?.[0] }], [along, ex.line])
  const ends = useMemo(() => lines[0].coords.map(([lat, lon]) => ({ lat, lon })), [lines])
  const near = useMemo(() => (records?.assets ?? []).filter((x) => ends.some((e) => metres(e, x) < 140)), [records, ends])
  return (
    <GeoMini area={area} outlines="auto" streets={mini} highlight={along?.props.street ?? ex.street ?? null} streetLabel={false} lines={lines}
      points={assetPoints(near)} frame={ends} minSpanM={160} height={240} label="Dark stretch with the streetlights and poles around it"
      caption="The number on the dark band is its recorded length; hover the band for the length along the road when it differs." />
  )
}

