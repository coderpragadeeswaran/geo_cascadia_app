/** Shapes returned by the backend (backend/app/views.py). Every JSON response carries `offline`. */
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson'

export type MatchStatus = 'matched' | 'discrepancy' | 'no_record'
export type Band = 'city' | 'area' | 'street' | 'object'

export interface PublicConfig { maps_js_key: string; map_id: string; offline: boolean }

export interface AreaCard {
  slug: string
  name: string
  polygon_source: string
  polygon: Polygon | MultiPolygon
  bbox: [number, number, number, number]
  coverage_verdict: string | null
  counts: {
    buildings: number; assets: number; streets: number; streetlight_gaps_60m: number; review_items: number
    unmapped_businesses: number; missing_asset_records: number; use_not_classified: number; assets_triangulated: number
  }
  match_status: Partial<Record<MatchStatus, number>>
  /** view counts from meta.run.coverage; building / business counts computed from records */
  coverage: {
    level: 'full' | 'partial' | null; verdict: string | null; views_planned: number | null
    views_facing_no_mapped_building: number | null; share_views_no_mapped_building: number | null
    osm_footprints: number | null; buildings: number; unmapped_businesses: number; assets: number
  }
}

export interface StreetProps {
  kind: 'street'; id: string; name: string; osm_name: string | null; length_m: number | null; road_type: string | null; coverage: number | null
  /** false = no building stats joined for this line → "no data" (grey), never a healthy 0 */
  has_stats: boolean
  buildings?: number; no_record?: number; discrepancy?: number; streetlights?: number; poles?: number; gap_m_60?: number
  issues_per_km: number | null
}
export interface BuildingProps {
  kind: 'building'; id: string; street: string; lat: number; lon: number; use: string | null; use_route: string | null
  floors: number | null; floors_status: 'measured' | 'low_confidence' | 'not_measured' | null; match_status: MatchStatus
  severity: string | null; discrepancies: string[]; name: string | null; google_confirmed: boolean; review_status: string | null
}
export interface AssetProps {
  kind: 'pole' | 'streetlight'; id: string; street: string | null; confidence: string | null; method: string | null
  approximate: boolean; cameras_used: number | null; uncertainty_m: number | null; register_status: string | null
  review_status: string | null
}
export interface GapProps {
  kind: 'streetlight_gap'; id: string; street: string; length_m: number; interval_m: number; poles_inside: number; gap_type: string
  /** along_road = drawn along the street; check = drawn as recorded, lit camera stops lie on the road between its ends */
  display_mode: 'along_road' | 'check' | 'straight'; along_road_m: number | null; length_differs: boolean
  lit_cameras_inside: number | null; longest_dark_along_road_m: number | null; note: string | null
}
export interface UnmappedProps { kind: 'unmapped_business'; id: string; name: string | null; street: string | null; sightings: number | null; approximate: true }
export interface MissingProps { kind: 'missing_asset_record'; id: string; street: string | null; why: string | null; register: 'SYNTHETIC' }

export interface AreaProps { kind: 'area'; id: string; name: string; card: AreaCard }

export type AnyProps = AreaProps | StreetProps | BuildingProps | AssetProps | GapProps | UnmappedProps | MissingProps
export type AreaFeature = Feature<Geometry, AnyProps>
export type AreaGeoJSON = FeatureCollection<Geometry, AnyProps> & { offline: boolean }

export interface Job {
  id: string; kind: string; status: string; stage: string | null; done: number | null; total: number | null
  street: string | null; area_slug: string | null; input: { click?: { lat: number; lon: number }; polygon?: Polygon }
}
