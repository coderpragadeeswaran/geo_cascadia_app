/** Review fix 10: the two end dots of the picked street can be dragged (or moved with the arrow keys) to trim the stretch
 *  before starting. They are DOM handles placed with the map's own projection (works tilted and rotated), so dragging a
 *  dot never pans the map; each position snaps to the street line. */
import { useMap } from '@vis.gl/react-google-maps'
import { useEffect, useMemo, useReducer, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAnalyse } from './analyse'
import { mainLine, MIN_STRETCH_M, pointAt, project, type LonLat } from './trim'

export function TrimHandles() {
  const map = useMap('main')
  const preview = useAnalyse((s) => s.preview)
  const trim = useAnalyse((s) => s.trim)
  const main = useMemo(() => mainLine(preview?.lines), [preview])
  const proj = useRef<google.maps.MapCanvasProjection | null>(null)
  const [, redraw] = useReducer((x: number) => x + 1, 0)
  // an OverlayView only for its projection; draw() runs on every camera change, so the handles follow the map
  useEffect(() => {
    if (!map || !main) return
    const ov = new google.maps.OverlayView()
    ov.onAdd = () => {}
    ov.onRemove = () => {}
    ov.draw = () => { proj.current = ov.getProjection(); redraw() }
    ov.setMap(map)
    return () => { ov.setMap(null); proj.current = null }
  }, [map, main])
  if (!map || !main || !proj.current || main.length < MIN_STRETCH_M * 2) return null
  const t = trim ?? { a: 0, b: main.length }
  const px = (ll: LonLat) => proj.current!.fromLatLngToContainerPixel(new google.maps.LatLng(ll[1], ll[0]))
  const set = (k: 'a' | 'b', s: number) => {
    const next = k === 'a' ? { a: Math.max(0, Math.min(s, t.b - MIN_STRETCH_M)), b: t.b } : { a: t.a, b: Math.min(main.length, Math.max(s, t.a + MIN_STRETCH_M)) }
    // back to the whole street when both ends are (almost) at the street's ends
    useAnalyse.getState().setTrim(next.a < 1 && next.b > main.length - 1 ? null : next)
  }
  const handle = (k: 'a' | 'b') => {
    const p = px(pointAt(main, t[k]))
    if (!p) return null
    const drag = (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault(); e.stopPropagation()
      const el = e.currentTarget
      el.setPointerCapture(e.pointerId)
      const root = map.getDiv().getBoundingClientRect()
      const move = (ev: PointerEvent) => {
        const ll = proj.current?.fromContainerPixelToLatLng(new google.maps.Point(ev.clientX - root.left, ev.clientY - root.top))
        if (ll) set(k, project(main, [ll.lng(), ll.lat()]))
      }
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up) }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
    }
    const key = (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 50 : 10
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); set(k, t[k] - step) }
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); set(k, t[k] + step) }
    }
    return (
      <button key={k} type="button" onPointerDown={drag} onKeyDown={key} onClick={(e) => e.stopPropagation()}
        aria-label={`${k === 'a' ? 'Start' : 'End'} of the stretch: ${Math.round(t[k])} m along the street. Drag, or use the arrow keys (Shift for 50 m).`}
        className="trim-handle" style={{ left: p.x, top: p.y }} />
    )
  }
  return createPortal(<div className="trim-layer">{handle('a')}{handle('b')}</div>, map.getDiv())
}
