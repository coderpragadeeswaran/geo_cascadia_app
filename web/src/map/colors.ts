/** deck.gl colours — mirror the CSS tokens in index.css (one palette for map, legend and tables). */
type RGBA = [number, number, number, number]
const hex = (h: string, a = 255): RGBA => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a]

export const C = {
  accent: hex('#4f9dff'),
  matched: hex('#2dd4bf'),
  discrepancy: hex('#f5a524'),
  noRecord: hex('#f4525b'),
  review: hex('#a78bfa'),
  unclassified: hex('#94a3b8'),
  unmapped: hex('#7dd3fc'),
  white: hex('#ffffff'),
  ink: hex('#0b0f16'),
}

export const withAlpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], a]

export const matchColor = (s: string | null | undefined): RGBA =>
  s === 'matched' ? C.matched : s === 'discrepancy' ? C.discrepancy : s === 'no_record' ? C.noRecord : C.unclassified

/** asset register status → the same status palette (synthetic register) */
export const registerColor = (s: string | null | undefined): RGBA =>
  s === 'matched' ? C.matched : s === 'discrepancy' ? C.discrepancy : s === 'unrecorded_asset' ? C.noRecord : C.unclassified

/** street health: discrepancies + no-record buildings per km → teal … amber … red */
// stops span the observed range (Ward 29 streets: 0–41 issues/km) so the worst streets stay distinguishable
const RAMP: [number, RGBA][] = [[0, hex('#2dd4bf')], [10, hex('#a3d977')], [20, hex('#f5a524')], [40, hex('#f4525b')]]
export const HEALTH_STOPS = RAMP.map(([v]) => v)
export function healthColor(perKm: number | null | undefined, a = 235): RGBA {
  if (perKm == null) return withAlpha(C.unclassified, 160)
  for (let i = 1; i < RAMP.length; i++) {
    const [v1, c1] = RAMP[i]
    const [v0, c0] = RAMP[i - 1]
    if (perKm <= v1) {
      const t = (perKm - v0) / (v1 - v0)
      return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * t)).concat(a) as RGBA
    }
  }
  return withAlpha(RAMP[RAMP.length - 1][1], a)
}
export const healthCss = (v: number) => { const c = healthColor(v); return `rgb(${c[0]} ${c[1]} ${c[2]})` }

export const DENSITY_RANGE: RGBA[] = [
  [255, 214, 102, 70], [255, 178, 60, 110], [250, 140, 50, 140], [244, 100, 70, 165], [236, 72, 90, 190], [214, 50, 110, 210],
]
