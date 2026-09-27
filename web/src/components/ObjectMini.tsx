/** D36 / D39: the mini-map for one object (Review's right column, Explore's evidence drawer, "see real examples"): the
 *  object drawn as on the main map, the cameras whose photos are its evidence with a dashed line of sight from each,
 *  its street with the name on it, the building outlines and roads around. With one camera, the camera-to-object
 *  distance is written on the plan (the key measurement for a single-camera position). Camera positions come with the
 *  evidence views (shared cache with the evidence photos: no extra request). */
import { useMemo, type ReactNode } from 'react'
import { useEvidence } from '@/api/queries'
import type { Asset, Building, UnmappedBusiness } from '@/api/types'
import { MATCH_LEGEND } from '@/lib/mini'
import { GeoMini, metres, type MiniPoint, type MiniPolygon, type MiniRay, type MiniStreet } from './GeoMini'

export type MiniObject = { kind: 'building'; b: Building } | { kind: 'asset'; a: Asset } | { kind: 'unmapped'; u: UnmappedBusiness }

export function ObjectMini({ area, obj, streets, extra = [], label, height = 210, caption }: {
  area: string | null; obj: MiniObject; streets: MiniStreet[]; extra?: MiniPoint[]; label: string; height?: number; caption?: ReactNode
}) {
  const id = obj.kind === 'building' ? obj.b.id : obj.kind === 'asset' ? obj.a.id : obj.u.id
  const { data: views } = useEvidence(area, obj.kind, id)
  // where the lines of sight end: a building's predicted position (on its front) when known, else its map position
  const at = obj.kind === 'building'
    ? (obj.b.predicted_position ? { lat: obj.b.predicted_position.lat, lon: obj.b.predicted_position.lon } : { lat: obj.b.lat, lon: obj.b.lon })
    : obj.kind === 'asset' ? { lat: obj.a.lat, lon: obj.a.lon } : { lat: obj.u.lat, lon: obj.u.lon }
  const street = obj.kind === 'building' ? obj.b.street : obj.kind === 'asset' ? obj.a.street : obj.u.street
  const cams = useMemo(() => {
    const seen = new Map<string, { lat: number; lon: number }>()
    for (const v of views ?? []) if (v.camera && !seen.has(v.pano_id)) seen.set(v.pano_id, v.camera)
    return [...seen.values()].slice(0, 4)
  }, [views])
  const rays: MiniRay[] = cams.map((c) => ({ lat: c.lat, lon: c.lon, heading: 0, to: at, tip: `Line of sight, ${Math.round(metres(c, at))} m` }))
  const polygons: MiniPolygon[] = obj.kind === 'building' && (obj.b.footprint?.polygon_latlon?.length ?? 0) >= 3
    ? [{ ring: obj.b.footprint!.polygon_latlon as [number, number][], hl: true, legend: 'this building',
      tip: `${obj.b.attributes?.name?.value || 'This building'}: ${MATCH_LEGEND[obj.b.match_status as keyof typeof MATCH_LEGEND] ?? 'register status unknown'}` }]
    : []
  const target: MiniPoint[] = obj.kind === 'asset'
    ? [{ ...at, tone: obj.a.type === 'streetlight' ? 'sodium' : 'pole', r_m: obj.a.uncertainty_m, dashed: obj.a.method !== 'triangulated',
      legend: obj.a.type === 'streetlight' ? 'this streetlight' : 'this pole',
      tip: `${obj.a.type === 'streetlight' ? 'Streetlight' : 'Pole'} · ${obj.a.method === 'triangulated' ? 'pinpointed from 2+ cameras' : 'approximate (one camera)'}${obj.a.uncertainty_m != null ? `, could be off by ${Math.round(obj.a.uncertainty_m)} m` : ''}` }]
    : obj.kind === 'unmapped'
      ? [{ ...at, tone: 'sign', shape: 'diamond', legend: 'this business sign (position approximate)', tip: `${obj.u.name || 'Business sign'} · no building outline on the map` }]
      : obj.b.predicted_position ? [{ ...at, tone: 'sodium', legend: 'where the building stands (front)', tip: 'Predicted position of the building' }] : []
  const points: MiniPoint[] = [...extra,
    ...cams.map((c, i) => ({ lat: c.lat, lon: c.lon, tone: 'ink' as const, shape: 'ring' as const, legend: 'camera', tip: `Camera ${i + 1}: a photo of it was taken here` })),
    ...target]
  const single = cams.length === 1 ? { a: cams[0], b: at } : null
  return (
    <GeoMini area={area} outlines="auto" streets={streets} highlight={street} polygons={polygons} rays={rays} points={points} measure={single}
      height={height} minSpanM={60} frame={[at, ...cams, ...(polygons[0]?.ring.map(([lat, lon]) => ({ lat, lon })) ?? [])]} label={label}
      caption={<>{!views ? 'Loading the cameras… ' : !cams.length ? 'Camera position not recorded for this item. ' : cams.length === 1 && !caption ? 'One camera saw it: the distance is along its line of sight. ' : ''}
        {obj.kind === 'building' ? 'Register: synthetic (demo). ' : null}{caption}</>} />
  )
}
