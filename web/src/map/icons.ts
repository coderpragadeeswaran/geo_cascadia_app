/** Crisp SVG glyphs for deck.gl IconLayer (mask icons: tinted per feature). Drawn once, cached by URL. */
const svg = (w: number, h: number, body: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)}`

export const ICONS = {
  streetlight: {
    url: svg(64, 64, `<g fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"><path d="M24 58V16a8 8 0 0 1 8-8h10"/></g>
      <path fill="#fff" d="M36 8h16a4 4 0 0 1 4 4v2a4 4 0 0 1-4 4H36z"/><path fill="#fff" opacity=".85" d="M40 22h12l4 10H36z"/>`),
    width: 64, height: 64, mask: true, anchorY: 32,
  },
  pole: {
    url: svg(64, 64, `<g stroke="#fff" stroke-width="6" stroke-linecap="round"><path d="M32 6v52"/><path d="M18 16h28"/><path d="M22 26h20"/></g>`),
    width: 64, height: 64, mask: true, anchorY: 32,
  },
  /** hollow pin = approximate position (unmapped business) */
  pin: {
    url: svg(48, 64, `<path fill="none" stroke="#fff" stroke-width="5" d="M24 60s-18-19-18-33a18 18 0 0 1 36 0c0 14-18 33-18 33z"/><circle cx="24" cy="27" r="6" fill="none" stroke="#fff" stroke-width="4"/>`),
    width: 48, height: 64, mask: true, anchorY: 62,
  },
  /** register record with nothing detected nearby */
  missing: {
    url: svg(64, 64, `<rect x="8" y="8" width="48" height="48" rx="10" fill="none" stroke="#fff" stroke-width="5" stroke-dasharray="9 6"/><path d="M23 23l18 18M41 23L23 41" stroke="#fff" stroke-width="6" stroke-linecap="round"/>`),
    width: 64, height: 64, mask: true, anchorY: 32,
  },
} as const

/** diagonal hatch atlas for "floors not classified" footprints (FillStyleExtension mask) */
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
