/** Fly the camera to a zoom band (City / Area / Street / Object pills and the command palette share this). */
import type { AreaCard, Band } from '@/api/types'
import { useUi } from '@/store/ui'
import { bboxCenter, flyTo } from './camera'
import { flyToArea } from './MapView'

export function goToBand(map: google.maps.Map, target: Band, areas: AreaCard[] | undefined) {
  const ui = useUi.getState()
  const a = areas?.find((x) => x.slug === ui.area)
  if (!a) return
  const c = map.getCenter()?.toJSON() ?? bboxCenter(a.bbox)
  const [x0, y0, x1, y1] = a.bbox
  const inArea = c.lng >= x0 && c.lng <= x1 && c.lat >= y0 && c.lat <= y1
  const tilt = ui.flat ? 0 : 45
  const sel = ui.selected && 'lat' in ui.selected && typeof ui.selected.lat === 'number'
    ? { lat: ui.selected.lat, lng: (ui.selected as { lon: number }).lon } : null
  if (target === 'area') return flyToArea(map, a.bbox, ui.flat)
  if (target === 'city') return flyTo(map, { center: bboxCenter(a.bbox), zoom: 11.8, tilt: 0, heading: 0 }, { instant: ui.flat })
  const center = target === 'object' && sel ? sel : inArea ? c : bboxCenter(a.bbox)
  return flyTo(map, { center, zoom: target === 'street' ? 17.6 : 19.2, tilt }, { instant: ui.flat })
}
