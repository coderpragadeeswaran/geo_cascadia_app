/** D39: the same map content, named the same way, on every mini-map (GeoMini). Legend names are the plain words used
 *  in the app; the register is the synthetic demo register (every map that colours by it says so in its caption). */
import type { Asset, Building, UnmappedBusiness } from '@/api/types'
import type { MiniLine, MiniPoint, MiniPolygon, MiniStreet } from '@/components/GeoMini'

type StreetLike = { props: { name: string; length_m: number | null }; geometry: GeoJSON.MultiLineString | GeoJSON.LineString }

export const miniStreets = (streets: StreetLike[]): MiniStreet[] =>
  streets.map((s) => ({ name: s.props.name, geometry: s.geometry, length_m: s.props.length_m }))

export const MATCH_LEGEND = { matched: 'matches the register', discrepancy: 'differs from the register', no_record: 'not in the register' } as const
export const REGISTER_NOTE = 'Register colours use the synthetic register (demo).'

const bName = (b: Building) => b.attributes?.name?.value || null

/** building outlines coloured by register status (hl = the one the section is about) */
export function buildingPolys(bs: Building[], hlId?: string | null): MiniPolygon[] {
  return bs.filter((b) => (b.footprint?.polygon_latlon?.length ?? 0) >= 3).map((b) => {
    const st = b.match_status as keyof typeof MATCH_LEGEND
    const hl = b.id === hlId
    return { ring: b.footprint!.polygon_latlon as [number, number][], hl, tone: hl ? undefined : st in MATCH_LEGEND ? st : undefined,
      legend: hl ? 'this building' : MATCH_LEGEND[st] ?? 'building outline',
      tip: `${bName(b) ?? 'Building'}: ${MATCH_LEGEND[st] ?? 'register status unknown'}` }
  })
}

/** poles and streetlights as the main map draws them: lights = sodium dots, poles = small unlit dots */
export function assetPoints(as: Asset[], opts: { uncertainty?: boolean } = {}): MiniPoint[] {
  return as.map((a) => {
    const light = a.type === 'streetlight', approx = a.method !== 'triangulated'
    return { lat: a.lat, lon: a.lon, tone: light ? 'sodium' : 'pole', legend: light ? 'streetlight' : 'pole (no lamp seen)',
      r_m: opts.uncertainty ? a.uncertainty_m : null, dashed: approx,
      tip: `${light ? 'Streetlight' : 'Pole, no lamp seen'} · ${approx ? 'approximate (one camera)' : 'pinpointed (2+ cameras)'}` } as MiniPoint
  })
}

/** businesses whose sign was read on a frontage with no building outline: hollow diamonds (approximate) */
export function signPoints(us: UnmappedBusiness[]): MiniPoint[] {
  return us.map((u) => ({ lat: u.lat, lon: u.lon, tone: 'sign', shape: 'diamond', legend: 'business sign (no outline)',
    tip: `${u.name || 'Business sign'} · position approximate` }) as MiniPoint)
}

/** dark stretches (no streetlight seen within 60 m). The length written is the recorded one (the same number as every
 *  sentence about it); the along-road length is added on hover when it differs */
export function darkLines(gs: { props: { length_m: number; street: string; along_road_m?: number | null; length_differs?: boolean }; geometry: GeoJSON.LineString }[], measure = false): MiniLine[] {
  return gs.map((g) => {
    const rec = Math.round(g.props.length_m), along = g.props.along_road_m
    return { coords: (g.geometry.coordinates as [number, number][]).map(([lo, la]) => [la, lo] as [number, number]), tone: 'dark',
      legend: 'possible dark stretch (no light seen within 60 m)', measure, measureText: `${rec} m`,
      tip: `Possible dark stretch, ${rec} m on ${g.props.street}${along && g.props.length_differs ? ` (about ${Math.round(along)} m along the road)` : ''}` }
  })
}
