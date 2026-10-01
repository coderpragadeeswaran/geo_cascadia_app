/** Shapes returned by the backend (backend/app/views.py). Every JSON response carries `offline`. */
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson'

export type MatchStatus = 'matched' | 'discrepancy' | 'no_record'
export type Band = 'city' | 'area' | 'street' | 'object'

export interface PublicConfig { maps_js_key: string; map_id: string; offline: boolean }

export interface AreaCard {
  slug: string
  name: string
  polygon_source: string
  /** P6: analysed from the app by a worker (can be deleted); false for the three original areas */
  live?: boolean
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
  street: string | null; area_slug: string | null
  input: { click?: { lat: number; lon: number }; polygon?: Polygon | MultiPolygon; lines?: import('geojson').MultiLineString | import('geojson').LineString; length_m?: number }
  /** P6 */
  display_status?: string; message?: string | null; started_at?: string | null; created_at?: string | null
  /** D35: the stage's number of stage_count (null before the first stage) and overall progress 0..1, from the API */
  stage_no?: number | null; stage_count?: number; progress?: number
  /** a cancel was asked while a worker runs it (shown as "Cancelling…" until the worker stops) */
  cancel_requested?: boolean
  /** the worker's note for people, e.g. "Continuing from the saved progress" */
  note?: string | null
  approved?: boolean; device?: 'gpu' | 'cpu' | null
  /** failed with an error (not cancelled, not "no Street View"): Retry queues the same job; the worker continues from
   *  the progress it saved on Drive */
  retryable?: boolean
  /** the worker's plan-time estimate when the job paused for approval (cost cap) */
  plan_estimate?: { photos?: number; usd?: number; cameras?: number; buildings?: number; cap_photos?: number; cap_usd?: number } | null
}

/** P6: the most recently seen analysis worker (GET /worker/status, also in GET /jobs) */
export interface WorkerStatus {
  connected: boolean; device: 'gpu' | 'cpu' | null; seconds_ago: number | null
  job: { id: string; street: string | null; stage: string | null; done: number | null; total: number | null } | null
}

// ------------------------------------------------------------------ P4 responses
export type { Asset, Building, UnmappedBusiness } from '@/types/export'

export interface QueryFilters {
  intent: 'buildings' | 'streetlight_gaps' | 'assets' | 'review'
  street?: string; use?: 'commercial' | 'residential'; floors_op?: '>' | '>=' | '<' | '=='; floors_n?: number
  match_status?: 'no_record' | 'discrepancy'; discrepancy?: string; ref_flag?: string; group_by?: 'street'
  interval_m?: number; asset_type?: 'pole' | 'streetlight'; reason_has?: string
}
export interface GapRow {
  kind: 'streetlight_gap'; id: string; street: string; length_m: number; interval_m: number; start: [number, number]
  end: [number, number]; poles_inside: number; gap_type: string; display_mode: 'along_road' | 'check' | 'straight'
  along_road_m: number | null; length_differs: boolean; lit_cameras_inside: number | null
  longest_dark_along_road_m: number | null; note: string | null
}
export interface ReviewItem {
  id: number | null; item_type: 'building' | 'asset'; ref_id: string; building_id: string | null; asset_cls: string | null
  street: string | null; lat: number; lon: number; priority: number | null; reasons: string[]; discrepancies: string[]
  status: 'pending' | 'approved' | 'rejected' | 'appealed'; reviewer: string | null; note: string | null
  appeal_photo_path: string | null; updated_at: string | null
}
export type ReviewRow = ReviewItem & { area: string; object: Record<string, string | number | null> }
/** How the rule-based parser read a question (docs/QUERY.md): what it understood, what it ignored, synonyms applied */
export interface Understanding {
  status: 'ok' | 'partial' | 'not_understood'
  understood: { phrase: string; meaning: string }[]
  ignored: string[]
  synonyms: { from: string; to: string; street?: boolean }[]
  /** the typed question named no street and was answered on the street the person had selected */
  scoped_to?: string
  suggestions: string[]
  /** the text QueryEngine actually parsed (after synonyms) */
  read_as: string
}
export interface QueryResponse {
  area: string; text: string; parsed_filters: QueryFilters; intent: QueryFilters['intent']
  rows: (Record<string, unknown> & { kind: string; id: string | number | null })[] | null
  /** null = the answer could not be computed (e.g. a gap interval without the camera plan) — never shown as 0 */
  groups: { key: string; count: number }[] | null; total: number | null; why_empty: { step: string; count: number }[]
  understanding?: Understanding
  /** dark-stretch questions: which interval, and whether the app computed it (only 60 m is stored by the pipeline) */
  gaps?: { interval_m: number; computed: boolean; available: boolean; note: string }
  /** a sentence that puts the count in context (e.g. businesses vs all named buildings not on Google) */
  note?: string | null
  /** client-side: the person accepted a partly understood question (or built it by clicking) */
  accepted?: boolean
}
export interface AreaDetail extends AreaCard {
  meta: { area: string; run?: Record<string, unknown> }
  dashboard: {
    kpi: Record<string, number>
    charts: { by_street: Record<string, { buildings: number; no_record: number; discrepancy: number; streetlights: number; poles: number; gap_m_60: number }> } & Record<string, unknown>
  }
  consistency: { field: string; stored: unknown; computed: unknown; source: string; note: string }[]
  cost: { model_card: Record<string, unknown> | null; run_stats: Record<string, unknown>; run_stats_representative: false; run_stats_badge: string }
  streets: { name: string; osm_name: string | null; length_m: number | null }[]
  /** run_report.json as built by tools/build_run_report.py (pipeline-internal counts; timings are from resumed runs, D1) */
  run_report: Record<string, unknown> | null
}
/** POST /jobs/preview: the street under a click, resolved without creating a job (design pass B §3) */
export interface JobPreview {
  /** display name: street_names for streets of analysed areas, the OSM name outside them, never "(unnamed … #id)" */
  street: string; name_source: 'street_names' | 'osm' | 'unnamed'; osm_name: string | null
  length_m: number; osm_ways: number; way_ids: number[]; polygon: Polygon | MultiPolygon
  /** the exact snapped street geometry (lon/lat) */
  lines: import('geojson').MultiLineString
  /** where the street geometry came from: an analysed area's streets.json, the Overpass cache, or a live Overpass call */
  source: 'area' | 'cache' | 'overpass'
  /** the clicked street overlaps a street already analysed (same OSM ways, or ≥ 30 % of its length within 15 m) */
  already: { slug: string; area: string; street: string; by: 'way_ids' | 'geometry'; overlap: number }[]
  already_analysed_in: string[]
  /** set when OpenStreetMap was busy and the nearest already-analysed street is offered instead */
  note?: string
  /** P7.1: false when OpenStreetMap was too slow for the details (the named street's full length, the roads at its
   *  ends); Retry completes it from the cache once the background lookup lands */
  osm_details?: false
  /** P7.2: the real-planner estimate, planned in the background (poll GET /jobs/plan-estimate/{key}) */
  plan_estimate: import('./p5').PlanStatus
  /** the default cost cap per job (backend JOB_COST_CAP_USD) */
  cost_cap_usd: number
}
/** one evidence photo with every detection box on it (GET /areas/{slug}/evidence/{kind}/{id}) */
export interface EvidenceBox {
  cls: 'building' | 'pole' | 'lamp_head' | 'signboard'; conf: number; x1: number; y1: number; x2: number; y2: number
  geom_ok: boolean; target: boolean; from_heading?: number
}
export interface EvidenceViewData {
  key: string; label: string; pano_id: string; heading: number; pitch: number; fov: number
  /** exact = the pipeline's own view; projected = an aimed asset view with boxes projected from the same panorama */
  source: 'exact' | 'projected' | 'none'; projected_from?: number[]
  boxes: EvidenceBox[]; target: 'box' | 'record_box' | 'crosshair' | 'none'; note: string | null; aim_offset_deg?: number
  /** a plain sentence shown under the photo (e.g. why no box is marked as this building) */
  user_note?: string | null
  /** D36: where the camera stood (from the run's panoramas), for the mini-map; null when unknown */
  camera?: { lat: number; lon: number } | null
}
export interface JobFull extends Job { message: string | null; created_at: string | null; started_at: string | null; finished_at: string | null }
