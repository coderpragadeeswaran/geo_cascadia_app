/** Bottom-right map controls: the altimeter (zoom bands, click to fly to one), zoom, compass (north up, top-down) and
 *  fit-the-area. Always on (CLAUDE.md §9.3). */
import { useMap } from '@vis.gl/react-google-maps'
import { Maximize, Minus, Plus } from 'lucide-react'
import { useAreas } from '@/api/queries'
import type { Band } from '@/api/types'
import { Tip } from '@/components/ui/tooltip'
import { goToBand } from '@/map/bands'
import { flyTo } from '@/map/camera'
import { flyToArea } from '@/map/MapView'
import { useUi } from '@/store/ui'

const BANDS: { k: Band; label: string }[] = [{ k: 'object', label: 'Object' }, { k: 'street', label: 'Street' }, { k: 'area', label: 'Area' }, { k: 'city', label: 'City' }]

export function MapControls() {
  const map = useMap('main')
  const band = useUi((s) => s.band)
  const zoom = useUi((s) => s.camera?.zoom)
  const heading = useUi((s) => s.camera?.heading ?? 0)
  const tilt = useUi((s) => s.camera?.tilt ?? 0)
  const flat = useUi((s) => s.flat)
  const area = useUi((s) => s.area)
  const { data: areas } = useAreas()
  const zoomBy = (d: number) => map && flyTo(map, { center: map.getCenter()!.toJSON(), zoom: (map.getZoom() ?? 15) + d }, { duration: 320, instant: flat })
  const reset = () => map && flyTo(map, { center: map.getCenter()!.toJSON(), zoom: map.getZoom() ?? 15, heading: 0, tilt: 0 }, { duration: 600, instant: flat })
  const fit = () => { const a = areas?.find((x) => x.slug === area); if (map && a) flyToArea(map, a.bbox, flat) }
  return (
    <div className="pointer-events-auto flex items-end gap-3">
      <nav className="flex flex-col items-end gap-1 rounded-[var(--ns-r-control)] px-2 py-1.5" style={{ background: 'color-mix(in srgb, var(--ns-bg1) 86%, transparent)' }} aria-label="Zoom level">
        {BANDS.map((b) => (
          <button key={b.k} onClick={() => map && goToBand(map, b.k, areas)} aria-current={band === b.k ? 'true' : undefined}
            className="t-micro flex cursor-pointer items-center gap-2 hover:text-ink2" style={{ color: band === b.k ? 'var(--ns-sodium)' : undefined }}>
            {b.label}<span className="h-px transition-all" style={{ width: band === b.k ? 22 : 12, background: band === b.k ? 'var(--ns-sodium)' : 'var(--ns-line-strong)' }} />
          </button>
        ))}
        {/* "zoom", not "z": Chrome's auto-translate read "z" as Polish for "from" ("from 15.8"); translate="no" as well */}
        <span className="t-data ink3 text-[13px]" aria-live="polite" translate="no">zoom {zoom != null ? zoom.toFixed(1) : '–'}</span>
      </nav>
      <div className="sheet flex flex-col items-center gap-0.5 p-1" style={{ background: 'color-mix(in srgb, var(--ns-bg1) 88%, transparent)' }}>
        <Tip label="Zoom in" side="left"><button className="btn btn-icon" onClick={() => zoomBy(1)} aria-label="Zoom in"><Plus /></button></Tip>
        <Tip label="Zoom out" side="left"><button className="btn btn-icon" onClick={() => zoomBy(-1)} aria-label="Zoom out"><Minus /></button></Tip>
        <span className="my-0.5 h-px w-5 bg-line" />
        <Tip label={`North up, top-down · heading ${Math.round(heading)}°, tilt ${Math.round(tilt)}°`} side="left">
          <button className="btn btn-icon" onClick={reset} aria-label="Reset heading and tilt">
            <svg viewBox="0 0 24 24" className="!size-5" style={{ transform: `rotate(${-heading}deg)`, transition: 'transform 60ms linear' }}>
              <path d="M12 2 16 12H8z" fill="var(--ns-sodium)" />
              <path d="M12 22 8 12h8z" fill="currentColor" opacity=".5" />
            </svg>
          </button>
        </Tip>
        <Tip label="Fit the whole area" side="left"><button className="btn btn-icon" onClick={fit} aria-label="Fit area"><Maximize /></button></Tip>
      </div>
    </div>
  )
}
