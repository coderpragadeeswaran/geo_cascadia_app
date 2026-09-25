/** The single map instance (D3). Google vector map (Map ID) + deck.gl overlay + zoom-band behaviour. */
import { GoogleMapsOverlay } from '@deck.gl/google-maps'
import type { PickingInfo } from '@deck.gl/core'
import { Map, useMap, type MapCameraChangedEvent } from '@vis.gl/react-google-maps'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useActiveJobs, useAreaGeo, useAreas } from '@/api/queries'
import type { AnyProps } from '@/api/types'
import { useUi } from '@/store/ui'
import { bboxCenter, fitZoom, flyTo, isFlying } from './camera'
import { buildLayers, splitFeatures } from './layers'

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
      selectedId: selected && 'id' in selected ? selected.id : null, light }),
    [band, flat, layerToggles, areas, area, split, jobs, pulse, animate, selected, light],
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
        if (!p) return ui.select(null)
        if (p.kind === 'area') {
          if (p.id !== ui.area) ui.setArea(p.id)
          else if (map) flyToArea(map, p.card.bbox, ui.flat)
          return
        }
        ui.select(p)
        const at = 'lat' in p && typeof p.lat === 'number' ? { lat: p.lat, lng: (p as { lon: number }).lon } : info.coordinate ? { lat: info.coordinate[1], lng: info.coordinate[0] } : null
        if (map && at && p.kind !== 'street' && p.kind !== 'streetlight_gap') {
          flyTo(map, { center: at, zoom: Math.max(map.getZoom() ?? 18, 19), tilt: ui.flat ? 0 : 50 }, { instant: ui.flat })
        }
      },
    })
  }, [overlay, layers, map])

  return null
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
