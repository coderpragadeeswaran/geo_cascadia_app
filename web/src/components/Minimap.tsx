/** Minimap without a second Google map (D3: one map instance): the area outline, streets and the current view. */
import { useMap } from '@vis.gl/react-google-maps'
import { useMemo } from 'react'
import { useAreaGeo, useAreas } from '@/api/queries'
import { healthCss } from '@/map/colors'
import { useUi } from '@/store/ui'

const W = 184
const H = 132
const PAD = 10

export function Minimap() {
  const area = useUi((s) => s.area)
  const cam = useUi((s) => s.camera)
  const { data: areas } = useAreas()
  const { data: geo } = useAreaGeo(area)
  const map = useMap('main')
  const a = areas?.find((x) => x.slug === area)

  const proj = useMemo(() => {
    if (!a) return null
    const [x0, y0, x1, y1] = a.bbox
    const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180)
    const s = Math.min((W - 2 * PAD) / ((x1 - x0) * k), (H - 2 * PAD) / (y1 - y0))
    const ox = (W - (x1 - x0) * k * s) / 2
    const oy = (H - (y1 - y0) * s) / 2
    return {
      to: (lon: number, lat: number) => [ox + (lon - x0) * k * s, H - oy - (lat - y0) * s] as const,
      from: (px: number, py: number) => ({ lng: x0 + (px - ox) / (k * s), lat: y0 + (H - oy - py) / s }),
    }
  }, [a])

  const paths = useMemo(() => {
    if (!proj || !a || !geo) return { outline: '', streets: [] as { d: string; c: string }[] }
    const line = (pts: number[][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${proj.to(x, y).map((v) => v.toFixed(1)).join(',')}`).join('')
    const rings = a.polygon.type === 'Polygon' ? [a.polygon.coordinates[0]] : a.polygon.coordinates.map((p) => p[0])
    const streets = geo.features.filter((f) => f.properties.kind === 'street').flatMap((f) => {
      const g = f.geometry as GeoJSON.MultiLineString | GeoJSON.LineString
      const lines = g.type === 'MultiLineString' ? g.coordinates : [g.coordinates]
      const per = (f.properties as { issues_per_km: number | null }).issues_per_km
      return lines.map((l) => ({ d: line(l), c: per == null ? 'var(--faint)' : healthCss(per) }))
    })
    return { outline: rings.map((r) => line(r) + 'Z').join(''), streets }
  }, [proj, a, geo])

  if (!a || !proj) return null
  const view = cam?.bounds ? (() => {
    const [w, s, e, n] = cam.bounds
    const [ax, ay] = proj.to(w, n)
    const [bx, by] = proj.to(e, s)
    return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) }
  })() : null
  const me = cam ? proj.to(cam.lng, cam.lat) : null

  return (
    <div className="glass pointer-events-auto relative overflow-hidden p-0" style={{ width: W, height: H }}>
      <svg width={W} height={H} className="block cursor-crosshair" role="img" aria-label="Minimap: click to move the map"
        onClick={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          map?.panTo(proj.from(e.clientX - r.left, e.clientY - r.top))
        }}>
        <defs>
          <clipPath id="mm-clip"><rect width={W} height={H} rx="14" /></clipPath>
        </defs>
        <g clipPath="url(#mm-clip)">
          <path d={paths.outline} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1.2" strokeOpacity=".7" />
          {paths.streets.map((s, i) => <path key={i} d={s.d} fill="none" stroke={s.c} strokeWidth="2" strokeLinecap="round" />)}
          {view && view.w < W * 3 && (
            <rect x={view.x} y={view.y} width={Math.max(view.w, 4)} height={Math.max(view.h, 4)} fill="rgb(255 255 255 / 0.07)"
              stroke="var(--fg)" strokeOpacity=".75" strokeWidth="1.2" rx="2" />
          )}
          {me && (
            <g transform={`translate(${me[0]},${me[1]}) rotate(${cam?.heading ?? 0})`}>
              <path d="M0 -9 L5 3 L0 0 L-5 3Z" fill="var(--accent)" stroke="white" strokeWidth="1" />
            </g>
          )}
        </g>
      </svg>
      <div className="eyebrow pointer-events-none absolute left-2.5 top-2">Overview</div>
    </div>
  )
}
