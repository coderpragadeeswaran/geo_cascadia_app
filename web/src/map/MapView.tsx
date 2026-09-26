/** The single map instance (D3). Google vector map (Map ID, Cloud style per mode) + deck.gl overlay + zoom-band behaviour.
 *  Night = the Map ID's dark-mode style on roadmap (Cloud dark mode does not apply to satellite); Daylight = light-mode
 *  style, with satellite as an option. Tilt and extrusion only at street zoom (docs/DESIGN.md). */
import { GoogleMapsOverlay } from '@deck.gl/google-maps'
import type { PickingInfo } from '@deck.gl/core'
import { Map, useMap, type MapCameraChangedEvent } from '@vis.gl/react-google-maps'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useActiveJobs, useAreaGeo, useAreas, useBuildings } from '@/api/queries'
import type { AnyProps, GapProps, QueryResponse } from '@/api/types'
import { colors, motion } from '@/design/tokens'
import { queryApplies } from '@/lib/query'
import { useFocus } from '@/lib/useAreaData'
import { useUi } from '@/store/ui'
import { useAnalyse } from './analyse'
import { bboxCenter, fitZoom, flyTo, isFlying, OBJECT_TILT, STREET_TILT } from './camera'
import { useDriveMark } from './drive'
import { mainLine, slice } from './trim'
import { TrimHandles } from './TrimHandles'
import { buildLayers, splitFeatures, type Position, type Split } from './layers'

/** deck.gl draws in its own canvas above the vector map (tilt/heading still synced). Interleaved rendering (one shared
 *  WebGL context) stays blank with deck.gl 9.4 + Maps JS 3.65/3.66: deck sizes itself from Google's canvas, which reports
 *  0×0 when deck attaches, so it renders a 0×0 viewport. ?interleaved=1 re-tests it after library updates. */
const INTERLEAVED = typeof location !== 'undefined' && new URLSearchParams(location.search).get('interleaved') === '1'
const DPR = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 1.5)   // D3: DPR cap 1.5
const REDUCED = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const WARD29_FALLBACK = { lat: 11.0316, lng: 76.9765 }
const LIGHTS_ON = 'gc:lights-on'

/** colorScheme is fixed when a Google map is created, so Night ↔ Daylight remounts the map. `reuseMaps` keeps one
 *  cached instance per scheme (vis.gl caches by Map ID + rendering type + colour scheme): without it every switch left
 *  another map instance in memory (≈ +10 MB per switch, measured). */
export function MapView({ mapId }: { mapId: string }) {
  const mode = useUi((s) => s.mode)
  return <MapInstance key={mode} mapId={mapId} />
}

function MapInstance({ mapId }: { mapId: string }) {
  const mode = useUi((s) => s.mode)
  const mapType = useUi((s) => s.mapType)
  const band = useUi((s) => s.band)
  const setCamera = useUi((s) => s.setCamera)
  const start = useRef(useUi.getState().camera)       // the view at this (re)mount: kept across a mode switch
  const near = band === 'street' || band === 'object'
  // Night: roadmap only (the Cloud dark-mode style); satellite is a Daylight option
  const mapTypeId = mode === 'daylight' && mapType === 'satellite' ? 'hybrid' : 'roadmap'

  const onCamera = (e: MapCameraChangedEvent) => {
    const { center, zoom, heading, tilt, bounds } = e.detail
    setCamera({ lat: center.lat, lng: center.lng, zoom, heading, tilt, bounds: bounds ? [bounds.west, bounds.south, bounds.east, bounds.north] : null })
  }

  return (
    <Map
      reuseMaps
      id="main"
      mapId={mapId}
      renderingType="VECTOR"
      colorScheme={mode === 'night' ? 'DARK' : 'LIGHT'}
      mapTypeId={mapTypeId}
      defaultCenter={start.current ? { lat: start.current.lat, lng: start.current.lng } : WARD29_FALLBACK}
      defaultZoom={start.current?.zoom ?? 11.5}
      defaultTilt={start.current?.tilt ?? 0}
      defaultHeading={start.current?.heading ?? 0}
      disableDefaultUI
      clickableIcons={false}
      gestureHandling="greedy"
      isFractionalZoomEnabled
      // tilt only at street zoom: a tilted map at area zoom smears (docs/DESIGN.md)
      tiltInteractionEnabled={near}
      headingInteractionEnabled
      keyboardShortcuts
      backgroundColor={colors[mode].bg0}
      onCameraChanged={onCamera}
      style={{ position: 'absolute', inset: 0 }}
    >
      <RestoreCamera cam={start.current} />
      <DeckLayers introDone={!!start.current} />
      <CameraDirector introDone={!!start.current} />
      <CoverageLayer />
      <DiveController />
      <AnalyseController />
      <TrimHandles />
    </Map>
  )
}

/** a cached map comes back where it was left (default* props only apply to a new map): put it on the current view */
function RestoreCamera({ cam }: { cam: ReturnType<typeof useUi.getState>['camera'] }) {
  const map = useMap('main')
  useEffect(() => {
    if (!map) return
    if (cam) map.moveCamera({ center: { lat: cam.lat, lng: cam.lng }, zoom: cam.zoom, tilt: cam.tilt, heading: cam.heading })
  }, [map, cam])
  return null
}

function DeckLayers({ introDone }: { introDone: boolean }) {
  const map = useMap('main')
  const [overlay, setOverlay] = useState<GoogleMapsOverlay | null>(null)
  const { data: areas } = useAreas()
  const area = useUi((s) => s.area)
  const { data: geo } = useAreaGeo(area)
  const { data: jobsRes } = useActiveJobs()
  const band = useUi((s) => s.band)
  const flat = useUi((s) => s.flat)
  const layerToggles = useUi((s) => s.layers)
  const selected = useUi((s) => s.selected)
  const mode = useUi((s) => s.mode)
  const stored = useMemo(() => (geo ? splitFeatures(geo.features) : null), [geo])
  const query = useUi((s) => s.query)
  const split = useMemo(() => withComputedGaps(stored, query), [stored, query])
  const jobs = jobsRes?.jobs ?? []
  const focus = useFocus()
  const preview = useAnalyse((s) => s.preview)
  const trim = useAnalyse((s) => s.trim)
  const main = useMemo(() => mainLine(preview?.lines), [preview])
  // trimmed (fix 10): the kept stretch is the bright line; the rest of the street stays as a faint guide
  const analysePoly = useMemo(() => (preview && !trim ? (preview.polygon.coordinates as Position[][]) : null), [preview, trim])
  const analyseLines = useMemo(() => (!preview?.lines ? null : trim && main ? [slice(main, trim.a, trim.b) as Position[]]
    : (preview.lines.coordinates as Position[][])), [preview, trim, main])
  const analyseRest = useMemo(() => (trim && preview?.lines ? (preview.lines.coordinates as Position[][]) : null), [preview, trim])
  const drive = useDriveMark()
  // D27: the selected building's predicted position (from its record), drawn at object zoom
  const { data: bRecords } = useBuildings(area)
  const predicted = useMemo(() => {
    if (!selected || !('kind' in selected) || selected.kind !== 'building' || !('id' in selected)) return null
    const p = bRecords?.find((x) => x.id === selected.id)?.predicted_position
    return p ? { position: [p.lon, p.lat] as Position, radius_m: p.uncertainty_m } : null
  }, [selected, bRecords])
  useFrame(map, split, focus)

  // opening: the streetlights fade on after the fly-in (reduced motion / 2D: lit at once)
  const [lightsOn, setLightsOn] = useState(introDone || REDUCED || useUi.getState().flat ? 1 : 0)
  useEffect(() => {
    if (lightsOn >= 1) return
    let raf = 0
    const run = () => {
      const t0 = performance.now()
      const tick = (t: number) => { const k = Math.min(1, (t - t0) / motion.lightsOn); setLightsOn(k); if (k < 1) raf = requestAnimationFrame(tick) }
      raf = requestAnimationFrame(tick)
    }
    window.addEventListener(LIGHTS_ON, run, { once: true })
    const fallback = setTimeout(run, 6000)          // never leave the city dark if the flight is interrupted
    return () => { window.removeEventListener(LIGHTS_ON, run); clearTimeout(fallback); cancelAnimationFrame(raf) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // pulse for running jobs (only animates while a job is running and motion is allowed)
  const [pulse, setPulse] = useState(0)
  const animate = jobs.length > 0 && !flat && band !== 'street' && band !== 'object'
  useEffect(() => {
    if (!animate) return
    let raf = 0, last = 0
    const loop = (t: number) => {
      if (t - last > 50) { setPulse((t % 1600) / 1600); last = t }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [animate])

  // A fresh overlay per mount, finalized on cleanup, created one tick later: StrictMode's immediate cleanup then cancels
  // it before Google calls onAdd on a finalized overlay ("reading 'addListener'" inside deck.gl).
  useEffect(() => {
    if (!map) return
    let o: GoogleMapsOverlay | null = null
    const t = setTimeout(() => {
      o = new GoogleMapsOverlay({ interleaved: INTERLEAVED, useDevicePixels: DPR, pickingRadius: 6 })
      o.setMap(map)
      setOverlay(o)
      if (import.meta.env.DEV) Object.assign(window, { __gcMap: map, __gcOverlay: o })   // dev-only hooks for scripted checks
    }, 0)
    return () => { clearTimeout(t); o?.finalize(); setOverlay(null) }
  }, [map])

  const layers = useMemo(
    () => buildLayers({ mode, band, flat, layers: layerToggles, areas: areas ?? [], activeArea: area, split, jobs, pulse: animate ? pulse : 0,
      selectedId: selected && 'id' in selected ? selected.id : null, focus, lightsOn, analyseLines, analysePoly, analyseRest, drive, predicted }),
    [mode, band, flat, layerToggles, areas, area, split, jobs, pulse, animate, selected, focus, lightsOn, analyseLines, analysePoly, analyseRest, drive, predicted],
  )

  useEffect(() => {
    if (!overlay) return
    let hovering = false
    overlay.setProps({
      layers,
      onHover: (info: PickingInfo) => {
        const ui = useUi.getState()
        const p = ui.analyse || ui.drive ? null : (info.object as { p?: AnyProps } | null)?.p ?? null
        ui.setHovered(p ? { props: p, x: info.x, y: info.y } : null)
        if (!!p !== hovering) { hovering = !!p; map?.setOptions({ draggableCursor: p ? 'pointer' : null }) }
      },
      onClick: (info: PickingInfo) => {
        const p = (info.object as { p?: AnyProps } | null)?.p
        const ui = useUi.getState()
        if (ui.analyse || ui.drive) return                       // analyse: the map click picks a street; drive: the strip steers
        if (!p) return ui.select(null)
        if (p.kind === 'street') return ui.selectStreet(ui.filter.street === p.name ? null : p.name)   // filters everything
        if (p.kind === 'area') {
          if (p.id !== ui.area) ui.setArea(p.id)
          else if (map) flyToArea(map, p.card.bbox, ui.flat)
          return
        }
        ui.select(p)
        const at = 'lat' in p && typeof p.lat === 'number' ? { lat: p.lat, lng: (p as { lon: number }).lon } : info.coordinate ? { lat: info.coordinate[1], lng: info.coordinate[0] } : null
        if (map && at && p.kind !== 'streetlight_gap') {
          flyTo(map, { center: at, zoom: Math.max(map.getZoom() ?? 18, 19), tilt: ui.flat ? 0 : OBJECT_TILT }, { instant: ui.flat })
        }
      },
    })
  }, [overlay, layers, map])

  return null
}

/** Visible map width left of the right panel (the panel floats over the map). */
export const PANEL_W = 420
export function visibleWidth(map: google.maps.Map) {
  const w = map.getDiv().clientWidth
  const s = useUi.getState()
  const open = !!(s.selected || s.query || s.kpi || s.filter.street || s.panelOpen || s.drive) && !s.analyse
  return open && w > 900 ? w - PANEL_W : w
}

/** Fit a lon/lat bbox into the part of the map not covered by the right panel (and, with bottomPx, above a bottom
 *  sheet such as Analyse's confirm sheet, so the street's end dots are never under it). */
export function flyToBounds(map: google.maps.Map, bb: [number, number, number, number], opts: { maxZoom?: number; minZoom?: number; bottomPx?: number } = {}) {
  const ui = useUi.getState()
  const div = map.getDiv()
  const vw = visibleWidth(map)
  const bottom = opts.bottomPx ?? 0
  const zoom = Math.max(opts.minZoom ?? 3, Math.min(opts.maxZoom ?? 17.4, fitZoom(bb, vw, div.clientHeight - 170 - bottom, 70)))
  const shiftPx = (div.clientWidth - vw) / 2                                  // keep the target centred in the visible part
  const center = bboxCenter(bb)
  center.lng += (shiftPx * 360) / (256 * 2 ** zoom)
  center.lat -= ((bottom / 2) * 360 * Math.cos((center.lat * Math.PI) / 180)) / (256 * 2 ** zoom)   // target sits above the sheet
  const near = zoom >= 16.5
  return flyTo(map, { center, zoom, tilt: ui.flat || !near ? 0 : STREET_TILT, heading: 0 }, { instant: ui.flat })
}

const bboxOf = (pts: [number, number][]): [number, number, number, number] | null => {
  if (!pts.length) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  const pad = 0.0004
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad]
}

/** A dark-stretch question at an interval the pipeline did not store (fix 2): its computed stretches replace the stored
 *  60 m ones on the map while the question is open (drawn along the road from the API's display path). */
function withComputedGaps(split: Split | null, q: QueryResponse | null): Split | null {
  if (!split || !q?.gaps?.computed || !queryApplies(q)) return split
  const rows = (q.rows ?? []) as unknown as (GapProps & { path?: Position[] | null; start: [number, number]; end: [number, number] })[]
  return { ...split, gaps: rows.map((r) => ({ p: { ...r, kind: 'streetlight_gap' as const }, path: r.path ?? [[r.start[1], r.start[0]], [r.end[1], r.end[0]]] })) }
}

/** When a KPI, query, street or bar click asks for it (frameTick), frame the emphasised objects / street. */
function useFrame(map: google.maps.Map | null, split: Split | null, focus: ReturnType<typeof useFocus>) {
  const tick = useUi((s) => s.frameTick)
  const last = useRef(tick)
  useEffect(() => {
    if (!map || !split || tick === last.current) return
    last.current = tick
    let pts: [number, number][] = []
    const street = useUi.getState().filter.street                // a selected street always wins
    const streets = street ? new Set([street]) : focus.streets
    if (streets) pts = split.streets.filter((d) => streets.has(d.p.name)).flatMap((d) => d.path)
    if (!pts.length) {
      pts = [
        ...(focus.buildings ? [...split.extruded, ...split.unclassified].filter((d) => focus.buildings!.has(d.p.id)).map((d) => [d.p.lon, d.p.lat] as [number, number]) : []),
        ...(focus.assets ? split.assets.filter((d) => focus.assets!.has(d.p.id)).map((d) => d.position) : []),
        ...(focus.unmapped ? split.unmapped.filter((d) => focus.unmapped!.has(d.p.id)).map((d) => d.position) : []),
        ...(focus.gaps ? split.gaps.filter((d) => focus.gaps!.has(d.p.id)).flatMap((d) => d.path) : []),
      ]
    }
    const bb = bboxOf(pts)
    if (bb) flyToBounds(map, bb, { maxZoom: pts.length <= 2 ? 18.2 : 16.4 })
  }, [map, split, focus, tick])
}

export function flyToArea(map: google.maps.Map, bbox: [number, number, number, number], flat: boolean) {
  const div = map.getDiv()
  const zoom = Math.min(15.8, fitZoom(bbox, div.clientWidth, div.clientHeight, 150))
  return flyTo(map, { center: bboxCenter(bbox), zoom, tilt: 0, heading: 0 }, { instant: flat })
}

/** Band transitions: tilt into 3D at street level, back to top-down above it; area changes fly to the area.
 *  The first flight is the opening (over the dark city), after which the streetlights fade on. */
function CameraDirector({ introDone }: { introDone: boolean }) {
  const map = useMap('main')
  const band = useUi((s) => s.band)
  const flat = useUi((s) => s.flat)
  const area = useUi((s) => s.area)
  const drive = useUi((s) => !!s.drive)
  const { data: areas } = useAreas()
  const intro = useRef(introDone)
  const lastArea = useRef<string | null>(introDone ? area : null)

  useEffect(() => {
    if (!map || !areas || !area) return
    const a = areas.find((x) => x.slug === area)
    if (!a || lastArea.current === area) return
    const first = !intro.current
    const delay = first ? 450 : 0                // first load: start at city level, then fly in
    const t = setTimeout(async () => {
      lastArea.current = area; intro.current = true
      await flyToArea(map, a.bbox, flat)
      if (first) window.dispatchEvent(new Event(LIGHTS_ON))
    }, delay)
    return () => clearTimeout(t)
  }, [map, areas, area, flat])

  useEffect(() => {
    if (!map || drive) return                   // the drive controls its own camera
    if (flat) {
      if ((map.getTilt() ?? 0) > 0 || (map.getHeading() ?? 0) !== 0) map.moveCamera({ tilt: 0, heading: 0 })
      return
    }
    const near = band === 'street' || band === 'object'
    let timer = 0
    const apply = () => {
      if (isFlying()) { timer = window.setTimeout(apply, 120); return }   // let a zoom/fly finish, then tilt
      const c = map.getCenter()
      const tilt = map.getTilt() ?? 0
      if (!c) return
      if (near && tilt < 10) flyTo(map, { center: c.toJSON(), zoom: map.getZoom() ?? 17, tilt: STREET_TILT }, { duration: 900 })
      if (!near && tilt > 0) flyTo(map, { center: c.toJSON(), zoom: map.getZoom() ?? 15, tilt: 0, heading: 0 }, { duration: 700 })
    }
    apply()
    return () => clearTimeout(timer)
  }, [map, band, flat, drive])

  return null
}

/** Street View coverage (layer toggle; Analyse mode has its own, limited by the flashlight) */
function CoverageLayer() {
  const map = useMap('main')
  const on = useUi((s) => s.layers.coverage && !s.analyse)
  useEffect(() => {
    if (!map || !on) return
    const layer = new google.maps.StreetViewCoverageLayer()
    layer.setMap(map)
    return () => layer.setMap(null)
  }, [map, on])
  return null
}

/** Street View dive (CLAUDE.md §9.3): fly to the object, cross-fade the map into the map's own StreetViewPanorama
 *  (one map instance, D3) at the stored pano / heading / pitch; "Back to map" reverses it. Moving inside the panorama
 *  updates svCam (minimap camera marker, 360° pins). Google attribution stays on the panorama. */
function DiveController() {
  const map = useMap('main')
  const dive = useUi((s) => s.dive)
  const flat = useUi((s) => s.flat)
  const mode = useUi((s) => s.mode)
  const shown = useRef(false)
  useEffect(() => {
    if (!map) return
    const sv = map.getStreetView()
    const veil = veilFor(map, colors[mode].bg0)
    let cancelled = false
    const listeners: google.maps.MapsEventListener[] = []
    const fade = (on: boolean) => new Promise<void>((res) => {
      if (flat) { veil.style.opacity = '0'; return res() }
      veil.style.opacity = on ? '1' : '0'
      setTimeout(res, 260)
    })
    const run = async () => {
      if (dive) {
        if (dive.at && !flat) await flyTo(map, { center: dive.at, zoom: 19.6, tilt: 55 }, { duration: 900 })
        if (cancelled) return
        await fade(true)
        sv.setOptions({
          pano: dive.pano, pov: { heading: dive.heading, pitch: dive.pitch }, zoom: panoZoom(dive.fov || 90),
          visible: true, addressControl: false, fullscreenControl: false, enableCloseButton: false, motionTracking: false,
          motionTrackingControl: false, showRoadLabels: true, zoomControl: true, panControl: false, linksControl: true, clickToGo: true,
        })
        shown.current = true
        const upd = () => {
          const pos = sv.getPosition()
          const pov = sv.getPov()
          if (pos) useUi.getState().setSvCam({ lat: pos.lat(), lng: pos.lng(), heading: pov.heading ?? 0 })
        }
        listeners.push(sv.addListener('position_changed', upd), sv.addListener('pov_changed', upd))
        upd()
        await fade(false)
      } else if (shown.current) {
        await fade(true)
        sv.setVisible(false)
        shown.current = false
        await fade(false)
      }
    }
    run()
    return () => { cancelled = true; listeners.forEach((l) => l.remove()) }
  }, [map, dive, flat, mode])
  return null
}

/** live panorama zoom for a horizontal field of view: tan(fov/2) = 2^(1 − zoom) (zoom 1 = 90°), as PanoPins assumes */
export const panoZoom = (fov: number) => Math.max(0, 1 - Math.log2(Math.tan(((fov * Math.PI) / 180) / 2)))

function veilFor(map: google.maps.Map, color: string) {
  const host = map.getDiv()
  let v = host.querySelector<HTMLDivElement>(':scope > .gc-veil')
  if (!v) {
    v = document.createElement('div')
    v.className = 'gc-veil'
    Object.assign(v.style, { position: 'absolute', inset: '0', opacity: '0', transition: 'opacity 250ms ease', pointerEvents: 'none', zIndex: '5' })
    host.appendChild(v)
  }
  v.style.background = color
  return v
}

/** Analyse mode: Street View coverage is the snapping guide (shown only near the pointer by the flashlight overlay),
 *  a crosshair cursor, and a map click picks the street under it (a new click cancels a pending lookup). */
function AnalyseController() {
  const map = useMap('main')
  const on = useUi((s) => s.analyse)
  useEffect(() => {
    if (!map || !on) return
    const cov = new google.maps.StreetViewCoverageLayer()
    cov.setMap(map)
    map.setOptions({ draggableCursor: 'crosshair' })
    const l = map.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (e.latLng) useAnalyse.getState().pick(e.latLng.lat(), e.latLng.lng())
    })
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { useUi.getState().setAnalyse(false); useAnalyse.getState().reset() } }
    window.addEventListener('keydown', esc)
    return () => { cov.setMap(null); l.remove(); map.setOptions({ draggableCursor: null }); window.removeEventListener('keydown', esc) }
  }, [map, on])
  return null
}
