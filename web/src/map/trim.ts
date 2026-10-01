/** Trim a picked street (review fix 10): distances along its main (longest) piece in metres, the point at a distance,
 *  the nearest distance to a point, and the stretch between two distances. Equirectangular metres (fine over ~1 km). */
import type { MultiLineString } from 'geojson'

export type LonLat = [number, number]
export interface MainLine { pts: LonLat[]; cum: number[]; length: number; kx: number; ky: number; pieces: number }
export const MIN_STRETCH_M = 20                      // backend streetpick.MIN_TRIM_M

export function mainLine(lines: MultiLineString | null | undefined): MainLine | null {
  const all = (lines?.coordinates ?? []).filter((l) => l.length >= 2) as LonLat[][]
  if (!all.length) return null
  const lat0 = all[0][0][1]
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540
  const len = (l: LonLat[]) => l.slice(1).reduce((s, p, i) => s + Math.hypot((p[0] - l[i][0]) * kx, (p[1] - l[i][1]) * ky), 0)
  const pts = all.reduce((a, b) => (len(b) > len(a) ? b : a))
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot((pts[i][0] - pts[i - 1][0]) * kx, (pts[i][1] - pts[i - 1][1]) * ky))
  return { pts, cum, length: cum[cum.length - 1], kx, ky, pieces: all.length }
}

export function pointAt(m: MainLine, s: number): LonLat {
  const d = Math.max(0, Math.min(m.length, s))
  let i = 1
  while (i < m.cum.length - 1 && m.cum[i] < d) i++
  const seg = m.cum[i] - m.cum[i - 1] || 1
  const t = (d - m.cum[i - 1]) / seg
  const a = m.pts[i - 1], b = m.pts[i]
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/** distance along the line of the point nearest to p */
export function project(m: MainLine, p: LonLat): number {
  let best = { d: Infinity, s: 0 }
  for (let i = 1; i < m.pts.length; i++) {
    const a = m.pts[i - 1], b = m.pts[i]
    const ax = (p[0] - a[0]) * m.kx, ay = (p[1] - a[1]) * m.ky
    const bx = (b[0] - a[0]) * m.kx, by = (b[1] - a[1]) * m.ky
    const L2 = bx * bx + by * by || 1
    const t = Math.max(0, Math.min(1, (ax * bx + ay * by) / L2))
    const d = Math.hypot(ax - t * bx, ay - t * by)
    if (d < best.d) best = { d, s: m.cum[i - 1] + t * Math.sqrt(L2) }
  }
  return best.s
}

/** the stretch between distances a < b, as a path */
export function slice(m: MainLine, a: number, b: number): LonLat[] {
  const out: LonLat[] = [pointAt(m, a)]
  for (let i = 1; i < m.pts.length - 1; i++) if (m.cum[i] > a && m.cum[i] < b) out.push(m.pts[i])
  out.push(pointAt(m, b))
  return out
}

/** P7.1: the start / end handles never overlap on screen */
const HANDLE_PX = 22
const GAP_PX = 6                                   // free space kept between the two handles
export type Px = { x: number; y: number }

/** where to draw the two handles: their true screen points, pushed apart when closer than a handle plus a gap */
export function separate(a: Px, b: Px, outA: Px, outB: Px, min = HANDLE_PX + GAP_PX): [Px, Px] {
  const dx = b.x - a.x, dy = b.y - a.y
  const d = Math.hypot(dx, dy)
  if (d >= min) return [a, b]
  // direction to push along: from a to b; for (nearly) coincident ends (a loop), each end's own outward direction
  let ux = dx, uy = dy
  if (d < 1) { ux = outB.x - outA.x; uy = outB.y - outA.y }
  let n = Math.hypot(ux, uy)
  if (n < 1e-6) { ux = 1; uy = 0; n = 1 }
  ux /= n; uy /= n
  const half = (min - (d < 1 ? 0 : d)) / 2
  return [{ x: a.x - ux * half, y: a.y - uy * half }, { x: b.x + ux * half, y: b.y + uy * half }]
}
