/** Review fix 10 / P7.1: the picked street's start and end handles: the ONLY dots drawn for it (the map layer draws no
 *  vertex or end dots). They can be dragged (or moved with the arrow keys) to trim the stretch before starting. They are
 *  DOM handles placed with the map's own projection (works tilted and rotated), so dragging a handle never pans the map;
 *  each position snaps to the street line. They never overlap: when the two ends are closer on screen than a handle
 *  (a very short street, a loop, a far zoom) they are pushed apart along the street, and a drag keeps its grab offset.
 *  A street too short to trim still shows its two ends, as fixed markers. */
import { useMap } from '@vis.gl/react-google-maps'
import { useEffect, useMemo, useReducer, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAnalyse } from './analyse'
import { mainLine, MIN_STRETCH_M, pointAt, project, separate, type LonLat, type Px } from './trim'

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
  if (!map || !main || !proj.current || main.length <= 0) return null
  const trimmable = main.length >= MIN_STRETCH_M * 2
  const t = trim ?? { a: 0, b: main.length }
  const px = (ll: LonLat): Px | null => {
    const p = proj.current!.fromLatLngToContainerPixel(new google.maps.LatLng(ll[1], ll[0]))
    return p ? { x: p.x, y: p.y } : null
  }
  const pa = px(pointAt(main, t.a)), pb = px(pointAt(main, t.b))
  if (!pa || !pb) return null
  // each end's outward direction on screen (from a point 5 m inside the stretch towards the end)
  const inA = px(pointAt(main, Math.min(t.b, t.a + 5))), inB = px(pointAt(main, Math.max(t.a, t.b - 5)))
  const out = (p: Px, q: Px | null): Px => (q ? { x: p.x - q.x, y: p.y - q.y } : { x: 0, y: 0 })
  const [va, vb] = separate(pa, pb, out(pa, inA), out(pb, inB))
  const set = (k: 'a' | 'b', s: number) => {
    const next = k === 'a' ? { a: Math.max(0, Math.min(s, t.b - MIN_STRETCH_M)), b: t.b } : { a: t.a, b: Math.min(main.length, Math.max(s, t.a + MIN_STRETCH_M)) }
    // back to the whole street when both ends are (almost) at the street's ends
    useAnalyse.getState().setTrim(next.a < 1 && next.b > main.length - 1 ? null : next)
  }
  const handle = (k: 'a' | 'b') => {
    const truth = k === 'a' ? pa : pb, shown = k === 'a' ? va : vb
    const label = k === 'a' ? 'Start' : 'End'
    if (!trimmable) {
      return <span key={k} className="trim-handle trim-handle-fixed" role="img" aria-label={`${label} of the street (too short to trim)`} style={{ left: shown.x, top: shown.y }} />
    }
    const drag = (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault(); e.stopPropagation()
      const el = e.currentTarget
      el.setPointerCapture(e.pointerId)
      const root = map.getDiv().getBoundingClientRect()
      // keep the grab offset: the street point follows the pointer exactly as it was held (handles may be pushed apart)
      const gx = e.clientX - root.left - truth.x, gy = e.clientY - root.top - truth.y
      const move = (ev: PointerEvent) => {
        const ll = proj.current?.fromContainerPixelToLatLng(new google.maps.Point(ev.clientX - root.left - gx, ev.clientY - root.top - gy))
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
        aria-label={`${label} of the stretch: ${Math.round(t[k])} m along the street. Drag, or use the arrow keys (Shift for 50 m).`}
        className="trim-handle" style={{ left: shown.x, top: shown.y }} />
    )
  }
  return createPortal(<div className="trim-layer">{handle('a')}{handle('b')}</div>, map.getDiv())
}
