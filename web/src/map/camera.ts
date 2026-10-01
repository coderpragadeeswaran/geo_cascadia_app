/** Camera helpers: fit a bbox, and a smooth fly-to (skipped in 2D / reduce-motion mode). */

/** 3D tilt at street level and when flying to an object. A tilted vector map loads tiles toward the horizon (JS heap:
 *  object zoom ≈ 61 MB at 50°, ≈ 43 MB flat, measured), so the tilt is kept moderate. */
export const STREET_TILT = 40
export const OBJECT_TILT = 42
export type Cam = { center: google.maps.LatLngLiteral; zoom: number; tilt?: number; heading?: number }

export function fitZoom(bbox: [number, number, number, number], w: number, h: number, pad = 80) {
  const [x0, y0, x1, y1] = bbox
  const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
  const zx = Math.log2(((w - 2 * pad) * 360) / (256 * Math.max(x1 - x0, 1e-6)))
  const zy = Math.log2(((h - 2 * pad) * 2 * Math.PI) / (256 * Math.max(merc(y1) - merc(y0), 1e-9)))
  return Math.max(3, Math.min(zx, zy, 19))
}

export const bboxCenter = (b: [number, number, number, number]): google.maps.LatLngLiteral => ({ lat: (b[1] + b[3]) / 2, lng: (b[0] + b[2]) / 2 })

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
let running = 0
let flying = false
let moving = false            // the running animation moves centre / zoom (a tilt-only one does not)
export const isFlying = () => flying

/** Arc-style fly: zooms out a little on long hops, then in. Returns when done. */
export function flyTo(map: google.maps.Map, to: Cam, opts: { instant?: boolean; duration?: number } = {}) {
  const c0 = map.getCenter()
  const from = { lat: c0?.lat() ?? to.center.lat, lng: c0?.lng() ?? to.center.lng, zoom: map.getZoom() ?? to.zoom, tilt: map.getTilt() ?? 0, heading: map.getHeading() ?? 0 }
  const target = { ...to.center, zoom: to.zoom, tilt: to.tilt ?? from.tilt, heading: to.heading ?? from.heading }
  if (opts.instant) {
    map.moveCamera({ center: to.center, zoom: target.zoom, tilt: target.tilt, heading: target.heading })
    return Promise.resolve()
  }
  const id = ++running
  flying = true
  moving = true
  const distPx = Math.hypot(target.lat - from.lat, target.lng - from.lng) * 256 * 2 ** Math.min(from.zoom, target.zoom) / 360
  const dip = Math.min(3, Math.max(0, Math.log2(distPx / 900)))       // zoom out mid-flight when the hop is long
  const duration = opts.duration ?? Math.min(2600, 900 + dip * 450 + Math.abs(target.zoom - from.zoom) * 90)
  let dh = target.heading - from.heading
  if (dh > 180) dh -= 360
  if (dh < -180) dh += 360
  const t0 = performance.now()
  return new Promise<void>((resolve) => {
    const step = (now: number) => {
      if (id !== running) return resolve()
      const t = Math.min(1, (now - t0) / duration)
      const e = ease(t)
      const zoom = from.zoom + (target.zoom - from.zoom) * e - dip * Math.sin(Math.PI * e)
      map.moveCamera({
        center: { lat: from.lat + (target.lat - from.lat) * e, lng: from.lng + (target.lng - from.lng) * e },
        zoom, tilt: from.tilt + (target.tilt - from.tilt) * e, heading: from.heading + dh * e,
      })
      if (t < 1) requestAnimationFrame(step)
      else { flying = false; resolve() }
    }
    requestAnimationFrame(step)
  })
}

export const cancelFlight = () => { running++; flying = false }

/** P7.1: tilt (and optionally turn) the map WITHOUT touching its centre or zoom, so a person zooming or panning at the
 *  same time keeps control (the band change to street level used to animate zoom too, pulling the zoom back). */
export function tiltTo(map: google.maps.Map, tilt: number, opts: { heading?: number; duration?: number } = {}) {
  const id = ++running
  flying = true
  moving = false
  const t0f = map.getTilt() ?? 0, h0 = map.getHeading() ?? 0
  let dh = (opts.heading ?? h0) - h0
  if (dh > 180) dh -= 360
  if (dh < -180) dh += 360
  const duration = opts.duration ?? 800
  const t0 = performance.now()
  return new Promise<void>((resolve) => {
    const step = (now: number) => {
      if (id !== running) return resolve()
      const t = Math.min(1, (now - t0) / duration)
      const e = ease(t)
      map.moveCamera(opts.heading == null ? { tilt: t0f + (tilt - t0f) * e } : { tilt: t0f + (tilt - t0f) * e, heading: h0 + dh * e })
      if (t < 1) requestAnimationFrame(step)
      else { flying = false; resolve() }
    }
    requestAnimationFrame(step)
  })
}

/** P7.1: a person's own wheel, drag or pinch on the map always wins over a running camera animation. */
export function yieldToUser(div: HTMLElement) {
  const stop = () => { if (flying && moving) cancelFlight() }   // a tilt-only animation never fights zoom or pan
  const opts = { capture: true, passive: true } as const
  div.addEventListener('wheel', stop, opts)
  div.addEventListener('pointerdown', stop, opts)
  div.addEventListener('touchstart', stop, opts)
  return () => {
    div.removeEventListener('wheel', stop, opts)
    div.removeEventListener('pointerdown', stop, opts)
    div.removeEventListener('touchstart', stop, opts)
  }
}
