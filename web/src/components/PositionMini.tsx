/** Predicted building position (D27), for "How do we know?": a small plan (metres, north up) with the footprint outline,
 *  the footprint centre, the predicted point and its uncertainty circle, plus the method badge. Pure SVG in the design
 *  tokens, so it follows Night / Daylight and costs no second map instance (D21 memory). */
import type { Building } from '@/api/types'
import { NorthPlate, ScalePlate } from '@/components/GeoMini'
import { Tip } from '@/components/ui/tooltip'
import { positionMethodLabel, positionMethodTerm, positionMethodWhy } from '@/lib/labels'
import { fmt, fmt1 } from '@/lib/utils'

const VW = 300, VH = 190, PAD = 22
const SCALES = [2, 5, 10, 20, 50]

export function PositionMini({ b }: { b: Building }) {
  const p = b.predicted_position
  const ring = b.footprint?.polygon_latlon ?? []
  if (!p || ring.length < 3) return <span className="ink3">No predicted position for this building.</span>
  const kx = 111320 * Math.cos((b.lat * Math.PI) / 180), ky = 110540
  const xy = (lat: number, lon: number): [number, number] => [(lon - b.lon) * kx, (lat - b.lat) * ky]
  const fp = ring.map(([la, lo]) => xy(la, lo))
  const pt = xy(p.lat, p.lon)
  const r = p.uncertainty_m ?? 0
  const xs = [...fp.map((q) => q[0]), pt[0] - r, pt[0] + r, 0], ys = [...fp.map((q) => q[1]), pt[1] - r, pt[1] + r, 0]
  let [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const span = Math.max(x1 - x0, y1 - y0, 12)
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  x0 = cx - span / 2; x1 = cx + span / 2; y0 = cy - span / 2; y1 = cy + span / 2
  const k = Math.min((VW - 2 * PAD) / (x1 - x0), (VH - 2 * PAD) / (y1 - y0))
  const sx = (x: number) => VW / 2 + (x - cx) * k, sy = (y: number) => VH / 2 - (y - cy) * k
  const bar = SCALES.find((m) => m * k >= 40) ?? SCALES[SCALES.length - 1]
  const dCentre = Math.hypot(pt[0], pt[1])
  return (
    <figure className="mt-1">
      <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full max-w-[340px] rounded-[var(--ns-r-control)]"
        style={{ background: 'var(--ns-bg0)', boxShadow: 'inset 0 0 0 1px var(--ns-line)' }} role="img"
        aria-label={`Footprint outline with the predicted position (${positionMethodLabel(p)}), ${p.uncertainty_m != null ? `uncertainty ${fmt1.format(p.uncertainty_m)} m` : 'uncertainty not estimated'}`}>
        <polygon points={fp.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')} fill="var(--ns-line)" stroke="var(--ns-ink2)" strokeWidth="1.5" />
        {/* footprint centre (the building's map position) */}
        <path d={`M${sx(0) - 5} ${sy(0)}h10M${sx(0)} ${sy(0) - 5}v10`} stroke="var(--ns-ink3)" strokeWidth="1.5" />
        {r > 0 && <circle cx={sx(pt[0])} cy={sy(pt[1])} r={r * k} fill="var(--ns-sodium)" fillOpacity=".12" stroke="var(--ns-sodium)" strokeWidth="1.2" strokeDasharray="4 3" />}
        <circle cx={sx(pt[0])} cy={sy(pt[1])} r="5" fill="var(--ns-sodium)" stroke="var(--ns-bg0)" strokeWidth="2" />
        {/* scale bar and north */}
        <ScalePlate x={6} y={VH - 25} barPx={bar * k} label={`${bar} m`} />
        <NorthPlate x={VW - 25} y={5} />
      </svg>
      <figcaption className="t-small mt-1.5 space-y-0.5">
        <div>
          <Tip label={positionMethodWhy(p)} side="top">
            <button type="button" className="chip chip-wrap cursor-help px-2 text-left text-[14px]" aria-label={`${positionMethodLabel(p)}. ${positionMethodWhy(p)}`}
              style={p.method === 'triangulated' ? { borderColor: 'var(--ns-sodium)', color: 'var(--ns-sodium)' } : undefined}>
              {positionMethodLabel(p)}
            </button>
          </Tip>
          <span className="ink3 text-[13px]"> · {positionMethodTerm(p.method)}</span>
          {p.reason && <div className="t-small mt-1 break-words" style={{ color: 'var(--ns-discrepancy)' }}>The camera views were not used: they put the building too far from its front wall <span className="ink3">(hover the badge for details)</span></div>}
        </div>
        <div className="ink2">{p.uncertainty_m != null
          ? <>±{fmt1.format(p.uncertainty_m)} m: the different camera pairs agree within about {fmt.format(Math.max(1, Math.round(p.uncertainty_m)))} m <span className="ink3 text-[13px]">· uncertainty, spread of camera-pair estimates</span></>
          : <>How far off it could be: <span className="ink3">not estimated{p.method === 'triangulated' ? ' (only two camera views, so nothing to compare)' : ''}</span></>}</div>
        <div className="ink3">Orange dot: where we think the building stands, {fmt1.format(dCentre)} m from the middle of its outline (+). Also shown on the map when zoomed in close.</div>
      </figcaption>
    </figure>
  )
}
