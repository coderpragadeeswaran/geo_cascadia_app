import { useMap } from '@vis.gl/react-google-maps'
import { Crosshair, Minus, Plus } from 'lucide-react'
import { useAreas } from '@/api/queries'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { flyTo } from '@/map/camera'
import { flyToArea } from '@/map/MapView'
import { useUi } from '@/store/ui'

/** Zoom, compass (click = north-up, top-down) and "fit area". Always on (CLAUDE.md §9.3). */
export function MapControls() {
  const map = useMap('main')
  const heading = useUi((s) => s.camera?.heading ?? 0)
  const tilt = useUi((s) => s.camera?.tilt ?? 0)
  const flat = useUi((s) => s.flat)
  const area = useUi((s) => s.area)
  const { data: areas } = useAreas()
  const zoomBy = (d: number) => map && flyTo(map, { center: map.getCenter()!.toJSON(), zoom: (map.getZoom() ?? 15) + d }, { duration: 320, instant: flat })
  const reset = () => map && flyTo(map, { center: map.getCenter()!.toJSON(), zoom: map.getZoom() ?? 15, heading: 0, tilt: 0 }, { duration: 600, instant: flat })
  const fit = () => { const a = areas?.find((x) => x.slug === area); if (map && a) flyToArea(map, a.bbox, flat) }

  return (
    <div className="glass pointer-events-auto flex flex-col items-center gap-0.5 p-1">
      <Tip label="Zoom in" side="left"><Button size="icon" onClick={() => zoomBy(1)} aria-label="Zoom in"><Plus /></Button></Tip>
      <Tip label="Zoom out" side="left"><Button size="icon" onClick={() => zoomBy(-1)} aria-label="Zoom out"><Minus /></Button></Tip>
      <span className="my-0.5 h-px w-5 bg-[var(--glass-border)]" />
      <Tip label={`North up, top-down · heading ${Math.round(heading)}°, tilt ${Math.round(tilt)}°`} side="left">
        <Button size="icon" onClick={reset} aria-label="Reset heading and tilt">
          <svg viewBox="0 0 24 24" className="!size-5" style={{ transform: `rotate(${-heading}deg)`, transition: 'transform 60ms linear' }}>
            <path d="M12 2 16 12H8z" fill="var(--no-record)" />
            <path d="M12 22 8 12h8z" fill="currentColor" opacity=".55" />
            <circle cx="12" cy="12" r="1.6" fill="var(--bg)" />
          </svg>
        </Button>
      </Tip>
      <Tip label="Fit the whole area" side="left"><Button size="icon" onClick={fit} aria-label="Fit area"><Crosshair /></Button></Tip>
    </div>
  )
}
