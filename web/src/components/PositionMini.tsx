/** Predicted building position (D27), for "How do we know?" and the position examples. D39: drawn with the shared
 *  mini-map: the outline, its street, the buildings and roads around, the middle of the outline (+) and the predicted
 *  point with its uncertainty circle, styled by method: camera views crossing (sight lines from each camera), one line
 *  of sight meeting the wall, the front-wall centre, or the middle of the outline. The distance from the middle of the
 *  outline to the predicted point is written on the plan. */
import { useMemo } from 'react'
import { useEvidence } from '@/api/queries'
import type { Building } from '@/api/types'
import { GeoMini, metres, type MiniPoint, type MiniRay } from '@/components/GeoMini'
import { Tip } from '@/components/ui/tooltip'
import { positionMethodLabel, positionMethodTerm, positionMethodWhy } from '@/lib/labels'
import { miniStreets } from '@/lib/mini'
import { useAreaData } from '@/lib/useAreaData'
import { fmt, fmt1 } from '@/lib/utils'

const METHOD_LEGEND: Record<string, string> = {
  triangulated: 'position: camera views cross', wall_hit: 'position: line of sight meets the wall',
  wall_centre: 'position: centre of the front wall', footprint_centre: 'position: middle of the outline',
}

export function PositionMini({ b }: { b: Building }) {
  const { area, streets } = useAreaData()
  const mini = useMemo(() => miniStreets(streets), [streets])
  const p = b.predicted_position
  const { data: views } = useEvidence(p ? area : null, 'building', b.id)
  const ring = b.footprint?.polygon_latlon ?? []
  const sighted = p?.method === 'triangulated' || p?.method === 'wall_hit'
  const cams = useMemo(() => {
    if (!sighted) return []
    const seen = new Map<string, { lat: number; lon: number }>()
    for (const v of views ?? []) if (v.camera && !seen.has(v.pano_id)) seen.set(v.pano_id, v.camera)
    return [...seen.values()].slice(0, p?.method === 'wall_hit' ? 1 : 3)
  }, [views, sighted, p?.method])
  if (!p || ring.length < 3) return <span className="ink3">No predicted position for this building.</span>
  const at = { lat: p.lat, lon: p.lon }, centre = { lat: b.lat, lon: b.lon }
  const dCentre = metres(centre, at)
  const rays: MiniRay[] = cams.map((c) => ({ lat: c.lat, lon: c.lon, heading: 0, to: at, tip: `Line of sight from a camera, ${Math.round(metres(c, at))} m` }))
  const points: MiniPoint[] = [
    ...cams.map((c) => ({ lat: c.lat, lon: c.lon, tone: 'ink' as const, shape: 'ring' as const, legend: 'camera', tip: 'Camera whose photo shows this building' })),
    ...(p.method !== 'footprint_centre' ? [{ ...centre, tone: 'drop' as const, shape: 'x' as const, legend: 'middle of the outline', tip: 'Middle of the building outline (its map position)' }] : []),
    { ...at, tone: 'sodium', r_m: p.uncertainty_m, dashed: true, legend: METHOD_LEGEND[p.method] ?? 'predicted position',
      tip: `${positionMethodLabel(p)}${p.uncertainty_m != null ? `, ±${fmt1.format(p.uncertainty_m)} m` : ''}` },
  ]
  return (
    <figure className="mt-1">
      <GeoMini area={area} outlines="auto" streets={mini} highlight={b.street} height={210} minSpanM={40}
        polygons={[{ ring: ring as [number, number][], hl: true, legend: 'this building', tip: b.attributes?.name?.value || 'This building' }]}
        rays={rays} points={points} measure={dCentre >= 1.5 && p.method !== 'footprint_centre' ? { a: centre, b: at, text: `${fmt1.format(dCentre)} m` } : null}
        frame={[at, centre, ...cams, ...ring.map(([lat, lon]) => ({ lat, lon }))]}
        label={`Building outline with the predicted position (${positionMethodLabel(p)}), ${p.uncertainty_m != null ? `uncertainty ${fmt1.format(p.uncertainty_m)} m` : 'uncertainty not estimated'}`} />
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
        <div className="ink3">{p.method === 'footprint_centre' ? 'The predicted position is the middle of the outline.' : `The predicted position is ${fmt1.format(dCentre)} m from the middle of the outline.`} Also shown on the map when zoomed in close.</div>
      </figcaption>
    </figure>
  )
}
