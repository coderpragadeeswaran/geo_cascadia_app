/** Fly the camera to a zoom band (City / Area / Street / Object pills and the command palette share this). */
import type { AreaCard, Band } from '@/api/types'
import { useUi } from '@/store/ui'
import { bboxCenter, flyTo, STREET_TILT } from './camera'
import { flyToArea } from './MapView'

export function goToBand(map: google.maps.Map, target: Band, areas: AreaCard[] | undefined) {
  const ui = useUi.getState()
  const a = areas?.find((x) => x.slug === ui.area)
  if (!a) return
  const c = map.getCenter()?.toJSON() ?? bboxCenter(a.bbox)
  const [x0, y0, x1, y1] = a.bbox
  const inArea = c.lng >= x0 && c.lng <= x1 && c.lat >= y0 && c.lat <= y1
  const tilt = ui.flat ? 0 : STREET_TILT
  const sel = ui.selected && 'lat' in ui.selected && typeof ui.selected.lat === 'number'
    ? { lat: ui.selected.lat, lng: (ui.selected as { lon: number }).lon } : null
  if (target === 'area') return flyToArea(map, a.bbox, ui.flat)
  if (target === 'city') return flyTo(map, { center: bboxCenter(a.bbox), zoom: 11.8, tilt: 0, heading: 0 }, { instant: ui.flat })
  const center = target === 'object' && sel ? sel : inArea ? c : bboxCenter(a.bbox)
  return flyTo(map, { center, zoom: target === 'street' ? 17.6 : 19.2, tilt }, { instant: ui.flat })
}

/** Night ↔ Daylight. Google fixes a map's colour scheme at creation, so a switch creates (or reuses) the other map, and the
 *  map left behind keeps the tiles it loaded. At street / object zoom those are many close-zoom vector tiles, so the
 *  camera first flies out to area level (top-down) and the switch happens there (docs/DECISIONS.md D21). */
let switching = false
export async function switchMode(map: google.maps.Map | null) {
  if (switching) return
  switching = true
  try {
    const ui = useUi.getState()
    const next = ui.mode === 'night' ? 'daylight' : 'night'
    if (map && (ui.band === 'street' || ui.band === 'object')) {
      if (ui.dive) ui.setDive(null)
      const c = map.getCenter()?.toJSON()
      if (c) await flyTo(map, { center: c, zoom: 15.6, tilt: 0, heading: 0 }, { instant: ui.flat, duration: 900 })
    }
    useUi.getState().setMode(next)
  } finally {
    switching = false
  }
}
