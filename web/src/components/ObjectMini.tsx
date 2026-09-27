/** D36: the mini-map for one object (Review's right column): its street with the name written on it, the building
 *  outlines around it, the cameras whose photos are its evidence and a dashed line of sight from each camera to the
 *  object. Framed on the object and its cameras; the N and scale plates sit in the top and bottom bands, never over it.
 *  Camera positions come with the evidence views (shared cache with the evidence photos: no extra request). */
import { useMemo } from 'react'
import { useEvidence } from '@/api/queries'
import type { Building } from '@/api/types'
import { GeoMini, type MiniPoint, type MiniPolygon, type MiniRay, type MiniStreet } from './GeoMini'

const NEAR_M = 70                      // building outlines drawn within this distance of the object

export function ObjectMini({ area, kind, id, lat, lon, street, streets, buildings, extra = [], label }: {
  area: string | null; kind: 'building' | 'asset'; id: string; lat: number; lon: number; street: string | null
  streets: MiniStreet[]; buildings: Building[]; extra?: MiniPoint[]; label: string
}) {
  const { data: views } = useEvidence(area, kind, id)
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540
  const dist = (la: number, lo: number) => Math.hypot((lo - lon) * kx, (la - lat) * ky)
  const polygons = useMemo<MiniPolygon[]>(() => buildings
    .filter((b) => (b.footprint?.polygon_latlon?.length ?? 0) >= 3 && dist(b.lat, b.lon) <= NEAR_M)
    .map((b) => ({ ring: b.footprint!.polygon_latlon as [number, number][], hl: kind === 'building' && b.id === id })),
  [buildings, id, kind, lat, lon]) // eslint-disable-line react-hooks/exhaustive-deps
  const cams = useMemo(() => {
    const seen = new Map<string, { lat: number; lon: number }>()
    for (const v of views ?? []) if (v.camera && !seen.has(v.pano_id)) seen.set(v.pano_id, v.camera)
    return [...seen.values()].slice(0, 4)
  }, [views])
  const rays: MiniRay[] = cams.map((c) => ({ lat: c.lat, lon: c.lon, heading: 0, to: { lat, lon } }))
  const points: MiniPoint[] = [
    ...extra,
    ...cams.map((c) => ({ lat: c.lat, lon: c.lon, tone: 'ink' as const, hollow: true })),
    { lat, lon, tone: 'sodium' },
  ]
  return (
    <figure>
      <GeoMini streets={streets} highlight={street} polygons={polygons} rays={rays} points={points} height={190} minSpanM={70}
        frame={[{ lat, lon }, ...cams]} label={label} />
      <figcaption className="t-small ink3 mt-1 flex flex-wrap gap-x-3">
        <span><span className="sodium">●</span> this {kind === 'asset' ? 'pole or light' : 'building'}</span>
        {cams.length > 0 && <span>○ {cams.length === 1 ? 'camera' : 'cameras'} · dashed: line of sight</span>}
        {!views && <span>loading the cameras…</span>}
        {views && !cams.length && <span>camera position not recorded</span>}
      </figcaption>
    </figure>
  )
}
