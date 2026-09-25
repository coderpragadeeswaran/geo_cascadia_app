/** The single map instance (D3). Google vector map (Map ID) + deck.gl overlay + zoom-band behaviour. */
import { GoogleMapsOverlay } from '@deck.gl/google-maps'
import type { PickingInfo } from '@deck.gl/core'
import { Map, useMap, type MapCameraChangedEvent } from '@vis.gl/react-google-maps'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useActiveJobs, useAreaGeo, useAreas } from '@/api/queries'
import type { AnyProps } from '@/api/types'
import { useFocus } from '@/lib/useAreaData'
import { useUi } from '@/store/ui'
import { useAnalyse } from './analyse'
import { bboxCenter, fitZoom, flyTo, isFlying } from './camera'
import { buildLayers, splitFeatures, type Split } from './layers'

/** deck.gl draws in its own canvas above the vector map (tilt/heading still synced). Interleaved rendering (one shared
 *  WebGL context) stays blank with deck.gl 9.4 + Maps JS 3.65/3.66: deck sizes itself from Google's canvas, which reports
 *  0×0 when deck attaches, so it renders a 0×0 viewport. ?interleaved=1 re-tests it after library updates. */
const INTERLEAVED = typeof location !== 'undefined' && new URLSearchParams(location.search).get('interleaved') === '1'
const DPR = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 1.5)   // D3: DPR cap 1.5
const WARD29_FALLBACK = { lat: 11.0316, lng: 76.9765 }

export function MapView({ mapId }: { mapId: string }) {
  const theme = useUi((s) => s.theme)
  const mapTypeMode = useUi((s) => s.mapType)
  const band = useUi((s) => s.band)
  const setCamera = useUi((s) => s.setCamera)
  const start = useRef(useUi.getState().camera)       // keeps the view when the theme remounts the map

  const mapTypeId = mapTypeMode === 'map' ? 'roadmap' : mapTypeMode === 'satellite' ? 'hybrid' : band === 'city' ? 'roadmap' : 'hybrid'

  const onCamera = (e: MapCameraChangedEvent) => {
    const { center, zoom, heading, tilt, bounds } = e.detail
    setCamera({ lat: center.lat, lng: center.lng, zoom, heading, tilt, bounds: bounds ? [bounds.west, bounds.south, bounds.east, bounds.north] : null })
  }

  return (
    <Map
      key={theme}
      id="main"
      mapId={mapId}
      renderingType="VECTOR"
      colorScheme={theme === 'dark' ? 'DARK' : 'LIGHT'}
      mapTypeId={mapTypeId}
      defaultCenter={start.current ? { lat: start.current.lat, lng: start.current.lng } : WARD29_FALLBACK}
      defaultZoom={start.current?.zoom ?? 11.5}
      defaultTilt={start.current?.tilt ?? 0}
      defaultHeading={start.current?.heading ?? 0}
      disableDefaultUI
      clickableIcons={false}
      gestureHandling="greedy"
      isFractionalZoomEnabled
      tiltInteractionEnabled
      headingInteractionEnabled
      keyboardShortcuts
      onCameraChanged={onCamera}
      style={{ position: 'absolute', inset: 0 }}
    >
      <DeckLayers />
      <CameraDirector introDone={!!start.current} />
      <CoverageLayer />
      <DiveController />
      <AnalyseController />
    </Map>
  )
}

function DeckLayers() {
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
  const light = useUi((s) => s.theme) === 'light'
  const split = useMemo(() => (geo ? splitFeatures(geo.features) : null), [geo])
  const jobs = jobsRes?.jobs ?? []
  const focus = useFocus()
  const preview = useAnalyse((s) => s.preview)
  const analysePoly = useMemo(() => (preview ? (preview.polygon.coordinates as [number, number][][]) : null), [preview])
  useFrame(map, split, focus)

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

  // A fresh overlay per mount, finalized on cleanup: re-attaching one GoogleMapsOverlay (StrictMode / theme remount)
  // leaves interleaved rendering blank.
  useEffect(() => {
    if (!map) return
    const o = new GoogleMapsOverlay({ interleaved: INTERLEAVED, useDevicePixels: DPR, pickingRadius: 6 })
    o.setMap(map)
    setOverlay(o)
    if (import.meta.env.DEV) Object.assign(window, { __gcMap: map, __gcOverlay: o })   // dev-only hooks for scripted checks
    return () => { o.finalize(); setOverlay(null) }
  }, [map])

  const layers = useMemo(
    () => buildLayers({ band, flat, layers: layerToggles, areas: areas ?? [], activeArea: area, split, jobs, pulse: animate ? pulse : 0,
      selectedId: selected && 'id' in selected ? selected.id : null, light, focus, analysePoly }),
    [band, flat, layerToggles, areas, area, split, jobs, pulse, animate, selected, light, focus, analysePoly],
  )

  useEffect(() => {
    if (!overlay) return
    let hovering = false
    overlay.setProps({
      layers,
      onHover: (info: PickingInfo) => {
        const p = (info.object as { p?: AnyProps } | null)?.p ?? null
        useUi.getState().setHovered(p ? { props: p, x: info.x, y: info.y } : null)
        if (!!p !== hovering) { hovering = !!p; map?.setOptions({ draggableCursor: p ? 'pointer' : null }) }
      },
      onClick: (info: PickingInfo) => {
        const p = (info.object as { p?: AnyProps } | null)?.p
        const ui = useUi.getState()
        if (ui.analyse) return                                   // analyse mode: the map click picks a street
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
          flyTo(map, { center: at, zoom: Math.max(map.getZoom() ?? 18, 19), tilt: ui.flat ? 0 : 50 }, { instant: ui.flat })
        }
      },
    })
  }, [overlay, layers, map])

  return null
}

/** Visible map width left of the right panel (the panel floats over the map). */
export const PANEL_W = 408
export function visibleWidth(map: google.maps.Map) {
  const w = map.getDiv().clientWidth
  return useUi.getState().panelOpen && w > 900 ? w - PANEL_W : w
}

/** Fit a lon/lat bbox into the part of the map not covered by the right panel. */
export function flyToBounds(map: google.maps.Map, bb: [number, number, number, number], opts: { maxZoom?: number; minZoom?: number } = {}) {
  const ui = useUi.getState()
  const div = map.getDiv()
  const vw = visibleWidth(map)
  const zoom = Math.max(opts.minZoom ?? 3, Math.min(opts.maxZoom ?? 17.4, fitZoom(bb, vw, div.clientHeight - 150, 70)))
  const shiftPx = (div.clientWidth - vw) / 2                                  // keep the target centred in the visible part
  const center = bboxCenter(bb)
  center.lng += (shiftPx * 360) / (256 * 2 ** zoom)
  const near = zoom >= 16.5
  return flyTo(map, { center, zoom, tilt: ui.flat || !near ? 0 : 45, heading: 0 }, { instant: ui.flat })
}

const bboxOf = (pts: [number, number][]): [number, number, number, number] | null => {
  if (!pts.length) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  const pad = 0.0004
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad]
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
    if (bb) flyToBounds(map, bb, { maxZoom: pts.length <= 2 ? 18.2 : 17.4 })
  }, [map, split, focus, tick])
}

export function flyToArea(map: google.maps.Map, bbox: [number, number, number, number], flat: boolean) {
  const div = map.getDiv()
  const zoom = Math.min(15.8, fitZoom(bbox, div.clientWidth, div.clientHeight, 150))
  return flyTo(map, { center: bboxCenter(bbox), zoom, tilt: 0, heading: 0 }, { instant: flat })
}

/** Band transitions: tilt into 3D at street level, back to top-down above it; area changes fly to the area. */
function CameraDirector({ introDone }: { introDone: boolean }) {
  const map = useMap('main')
  const band = useUi((s) => s.band)
  const flat = useUi((s) => s.flat)
  const area = useUi((s) => s.area)
  const { data: areas } = useAreas()
  const intro = useRef(introDone)
  const lastArea = useRef<string | null>(introDone ? area : null)

  useEffect(() => {
    if (!map || !areas || !area) return
    const a = areas.find((x) => x.slug === area)
    if (!a || lastArea.current === area) return
    const delay = intro.current ? 0 : 450                // first load: start at city level, then fly in
    const t = setTimeout(() => { lastArea.current = area; intro.current = true; flyToArea(map, a.bbox, flat) }, delay)
    return () => clearTimeout(t)
  }, [map, areas, area, flat])

  useEffect(() => {
    if (!map) return
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
      if (near && tilt < 10) flyTo(map, { center: c.toJSON(), zoom: map.getZoom() ?? 17, tilt: 45 }, { duration: 900 })
      if (!near && tilt > 0) flyTo(map, { center: c.toJSON(), zoom: map.getZoom() ?? 15, tilt: 0, heading: 0 }, { duration: 700 })
    }
    apply()
    return () => clearTimeout(timer)
  }, [map, band, flat])

  return null
}

function CoverageLayer() {
  const map = useMap('main')
  const on = useUi((s) => s.layers.coverage)
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
 *  updates svCam, which the minimap draws as a camera marker. Google attribution stays on the panorama. */
function DiveController() {
  const map = useMap('main')
  const dive = useUi((s) => s.dive)
  const flat = useUi((s) => s.flat)
  const shown = useRef(false)
  useEffect(() => {
    if (!map) return
    const sv = map.getStreetView()
    const veil = veilFor(map)
    let cancelled = false
    const listeners: google.maps.MapsEventListener[] = []
    const fade = (on: boolean) => new Promise<void>((res) => {
      if (flat) { veil.style.opacity = '0'; return res() }
      veil.style.opacity = on ? '1' : '0'
      setTimeout(res, 260)
    })
    const run = async () => {
      if (dive) {
        if (dive.at && !flat) await flyTo(map, { center: dive.at, zoom: 19.6, tilt: 60 }, { duration: 900 })
        if (cancelled) return
        await fade(true)
        sv.setOptions({
          pano: dive.pano, pov: { heading: dive.heading, pitch: dive.pitch }, zoom: Math.max(0, Math.log2(180 / (dive.fov || 90))),
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
  }, [map, dive, flat])
  return null
}

function veilFor(map: google.maps.Map) {
  const host = map.getDiv()
  let v = host.querySelector<HTMLDivElement>(':scope > .gc-veil')
  if (!v) {
    v = document.createElement('div')
    v.className = 'gc-veil'
    Object.assign(v.style, { position: 'absolute', inset: '0', background: '#05070b', opacity: '0', transition: 'opacity 250ms ease',
      pointerEvents: 'none', zIndex: '5' })
    host.appendChild(v)
  }
  return v
}

/** Analyse mode: crosshair cursor, Street View coverage shown as the snapping guide, a map click picks the street. */
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
