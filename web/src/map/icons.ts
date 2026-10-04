/** Crisp SVG glyphs for deck.gl IconLayer (mask icons: tinted per feature). Drawn once, cached by URL. */
const svg = (w: number, h: number, body: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)}`

export const ICONS = {
  /** register record with nothing detected nearby (synthetic register) */
  missing: {
    url: svg(64, 64, `<rect x="8" y="8" width="48" height="48" rx="10" fill="none" stroke="#fff" stroke-width="5" stroke-dasharray="9 6"/><path d="M23 23l18 18M41 23L23 41" stroke="#fff" stroke-width="6" stroke-linecap="round"/>`),
    width: 64, height: 64, mask: true, anchorY: 32,
  },
  /** P7.3: a building seen by the camera only (no map outline): a diamond outline with a centre dot */
  /** extras 3: an OpenStreetMap shop / business point (a square tag: the map's entry, not something our camera saw) */
  osmPoint: {
    url: svg(64, 64, `<rect x="10" y="10" width="44" height="44" rx="6" fill="#fff" fill-opacity="0.35" stroke="#fff" stroke-width="6"/><circle cx="32" cy="32" r="6" fill="#fff"/>`),
    width: 64, height: 64, mask: true, anchorY: 32,
  },
  cameraBuilding: {
    url: svg(64, 64, `<path d="M32 6 58 32 32 58 6 32Z" fill="none" stroke="#fff" stroke-width="6" stroke-linejoin="round"/><circle cx="32" cy="32" r="7" fill="#fff"/>`),
    width: 64, height: 64, mask: true, anchorY: 32,
  },
  /** drive the street: direction of travel (points up = north at angle 0; lies flat on the map) */
  arrow: {
    url: svg(64, 64, `<path d="M32 4 52 44 32 34 12 44Z" fill="#fff"/>`),
    width: 64, height: 64, mask: true, anchorY: 36,
  },
} as const

/** diagonal hatch atlas for "floors not known" footprints (FillStyleExtension mask) */
let hatchUrl: string | null = null
export function hatchAtlas(): string {
  if (hatchUrl) return hatchUrl
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const g = c.getContext('2d')!
  g.strokeStyle = '#fff'
  g.lineWidth = 5
  for (let i = -32; i <= 64; i += 12) { g.beginPath(); g.moveTo(i, 32); g.lineTo(i + 32, 0); g.stroke() }
  hatchUrl = c.toDataURL()
  return hatchUrl
}
export const HATCH_MAPPING = { hatch: { x: 0, y: 0, width: 32, height: 32, mask: true } }
