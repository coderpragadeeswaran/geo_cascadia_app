/**
 * Types + runtime schemas for data/areas/<slug>/export.json (CLAUDE.md §4.2, docs/DECISIONS.md D6).
 *
 * `makeExportSchemas('strict')` rejects any field not described here — used by `npm run check:data` so an
 * undocumented pipeline field can never slip through silently. The app uses the 'loose' variant, which
 * tolerates extra fields. Fields that older package versions omit are `.optional()`.
 */
import { z } from 'zod'

export type SchemaMode = 'strict' | 'loose'

const LatLon = z.tuple([z.number(), z.number()]) // [lat, lon]
const Counts = z.record(z.string(), z.number())

export const MatchStatus = z.enum(['matched', 'discrepancy', 'no_record'])
export const Severity = z.enum(['none', 'medium', 'high'])
export const FloorsStatus = z.enum(['measured', 'low_confidence', 'not_measured'])
export const UseRoute = z.enum(['tier1_local_clip', 'tier3_vlm', 'sign_text'])
export const FloorsRoute = z.enum(['tier3_vlm_fewshot'])
export const NameRoute = z.enum(['tier2_ocr', 'tier3_vlm+ocr_gate', 'tier3_vlm_unverified'])
export const NameQuality = z.enum(['good', 'fragment', 'tamil_unverified'])
export const AssetType = z.enum(['pole', 'streetlight'])
export const Confidence = z.enum(['high', 'medium', 'low'])
export const AssetMethod = z.enum(['triangulated', 'rough_mean'])
export const AssetRegisterStatus = z.enum(['matched', 'discrepancy', 'unrecorded_asset', 'unconfirmed_detection'])
export const ReviewStatus = z.enum(['pending', 'approved', 'rejected', 'appealed'])

export function makeExportSchemas(mode: SchemaMode) {
  const obj = <T extends z.ZodRawShape>(shape: T) => (mode === 'strict' ? z.strictObject(shape) : z.looseObject(shape))

  /** 640×640 Street View Static image at heading/pitch/fov; box in pixels. */
  const BoxView = obj({
    pano_id: z.string(), heading: z.number(), pitch: z.number(), fov: z.number(),
    x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(),
  })

  const Review = obj({
    queued: z.boolean(),
    priority: z.number().int().nullable(),
    reasons: z.array(z.string()),
    status: ReviewStatus.nullable(),
    appeal_photo_path: z.string().nullable().optional(),
    appeal_note: z.string().nullable().optional(),
  })

  const Building = obj({
    id: z.string(), // OSM w…/r… or ms_…
    type: z.literal('building'),
    lat: z.number(), lon: z.number(), street: z.string(),
    footprint: obj({
      source: z.string(), osm_id: z.string(), area_m2: z.number(), frontage_m: z.number(),
      depth_m: z.number().nullable(),
      polygon_latlon: z.array(LatLon).nullable(),
    }),
    attributes: obj({
      use: obj({ value: z.string().nullable(), route: UseRoute.nullable(), validated: z.string() }),
      property_identifiers: z.array(z.string()).optional(), // unverified; absent in older runs
      floors: obj({
        value: z.number().int().nullable(), status: FloorsStatus, route: FloorsRoute.nullable(),
        validated: z.string(), // stored per-building string; UI shows model_card numbers instead (D2)
      }),
      name: obj({
        value: z.string().nullable(), quality: NameQuality.nullable(), route: NameRoute.nullable(),
        google_confirmed: z.boolean().nullable(), google_name: z.string().nullable(), google_place_id: z.string().nullable(),
      }),
      shop_units: z.number().int().nullable(),
      condition: obj({ value: z.string().nullable(), withheld: z.literal(true), why: z.string() }), // never shown as a finding
    }),
    // D27/D33: predicted position (triangulated / wall_hit / wall_centre / footprint_centre); lat/lon above stay the footprint centroid
    predicted_position: obj({
      lat: z.number(), lon: z.number(), method: z.enum(['triangulated', 'wall_hit', 'wall_centre', 'footprint_centre']),
      n_cameras: z.number().int(), uncertainty_m: z.number().nullable(),
      reason: z.string().nullable().optional(),          // e.g. "triangulation rejected: implausible (14.2 m from footprint)"
    }).nullable().optional(),
    register: obj({
      source: z.enum(['SYNTHETIC', 'IMPORTED']),
      property_id: z.string().nullable(), record_use: z.string().nullable(), record_floors: z.number().int().nullable(),
      record_area_m2: z.number().nullable(), record_dist_m: z.number().nullable(),
      // D43: paired with the building by location (never by id): how sure, and the gap to the next-best building
      match_confidence: z.enum(['high', 'medium', 'low']).nullable().optional(), match_margin_m: z.number().nullable().optional(),
    }),
    match_status: MatchStatus,
    discrepancies: z.array(z.string()),
    reasons: z.array(z.string()),
    evidence_basis: z.record(z.string(), z.string()),
    severity: Severity,
    google_flags: z.array(z.string()),
    review: Review,
    evidence: obj({
      views: z.array(obj({
        pano_id: z.string(), heading: z.number(), pitch: z.number(), dist_m: z.number().nullable(), side: z.string().nullable(),
      })),
      attribute_view: BoxView.nullable(),
      sign_view: obj({
        pano_id: z.string(), heading: z.number(), pitch: z.number(), fov: z.number(),
        ocr_text: z.string().nullable(), ocr_conf: z.number().nullable(), tier: z.number().int(),
      }).nullable(),
    }),
    cost: obj({ vlm_calls: z.number().int(), vlm_usd: z.number(), recorded: z.boolean().optional() }),   // P6: exact cost recorded
  })

  const Asset = obj({
    id: z.string(), type: AssetType, lat: z.number(), lon: z.number(), street: z.string().nullable(),
    confidence: Confidence, n_detections: z.number().int(), cameras_used: z.number().int(), method: AssetMethod,
    uncertainty_m: z.number(), uncertainty_basis: z.string(), route: z.string(),
    camera_distance_m: z.number().nullable().optional(),   // D45: single-camera assets, distance from their camera
    register: obj({
      source: z.literal('SYNTHETIC'), status: AssetRegisterStatus, flags: z.array(z.string()),
      // present only when a register record was paired (matched / discrepancy)
      asset_no: z.string().optional(), record_type: z.string().optional(), dist_m: z.number().optional(),
    }),
    review: Review,
    evidence: obj({
      views: z.array(obj({ pano_id: z.string(), heading: z.number(), pitch: z.number(), fov: z.number(), source: z.string().nullable() })),
    }),
  })

  const MissingAssetRecord = obj({ asset_no: z.string(), lat: z.number(), lon: z.number(), street: z.string(), why: z.string() })

  const StreetlightGap = obj({
    id: z.string(), type: z.literal('streetlight_gap'), interval_m: z.number(), street: z.string(), carriageway: z.number(),
    length_m: z.number(), start: LatLon, end: LatLon, poles_inside: z.number().int(), gap_type: z.string(),
  })

  const UnmappedBusiness = obj({
    id: z.string(), type: z.literal('unmapped_business'), name: z.string(), ocr_text: z.string(),
    lat: z.number(), lon: z.number(), // approximate
    street: z.string(), sightings: z.number().int(), position: z.string(), evidence: BoxView,
    on_outline: z.string().nullable().optional(),        // D44: the sign hits an outline that is not an analysed building
  })

  /** Asset rows carry no asset id: join on (lat, lon rounded to 7 dp, asset_cls = type) — D6. */
  const ReviewQueueItem = z.discriminatedUnion('item_type', [
    obj({
      item_type: z.literal('building'), building_id: z.string(), street: z.string(), lat: z.number(), lon: z.number(),
      reasons: z.array(z.string()), priority: z.number().int(), discrepancies: z.array(z.string()), status: z.string(),
      appeal_photo_path: z.string().nullable().optional(), appeal_note: z.string().nullable().optional(),
    }),
    obj({
      item_type: z.literal('asset'), asset_cls: AssetType, street: z.string().nullable(), lat: z.number(), lon: z.number(),
      reasons: z.array(z.string()), priority: z.number().int(), status: z.string(),
      appeal_photo_path: z.string().nullable().optional(), appeal_note: z.string().nullable().optional(),
    }),
  ])

  const PlantedScore = obj({ planted: z.number(), tp: z.number(), fp: z.number(), fn: z.number().optional() })
  /** D42: planted-mistake recovery (caught / missed / false alarms per kind) */
  const Recovery = obj({ planted: z.number(), caught: z.number(), missed: z.number(), false_alarms: z.number() })
  const Pairing = obj({ records: z.number(), paired_right: z.number(), paired_wrong: z.number(), unpaired: z.number(), right_pct: z.number().nullable() })

  const Coverage = obj({
    panoramas: z.number(), user_photospheres: z.number(), cameras_planned: z.number(), views_planned: z.number(),
    views_facing_no_mapped_building: z.number(), footprints: Counts, osm_built_fraction: z.number(),
    buildings_registered: z.number(), buildings_by_source: Counts, verdict: z.string(),
  })

  /** meta.run == dashboard.cost_panel. Timing/request counters come from resumed runs: see D1. */
  const RunStats = obj({
    coverage: Coverage,
    street_view_requests: z.number(), street_view_cost_usd_notional: z.number(), views_planned: z.number(),
    sign_crops_total: z.number(), crops_read_by_ocr: z.number(), crops_discarded_no_text: z.number(),
    crops_escalated: z.number(), crops_skipped_fast_mode: z.number(), ocr_mode: z.string(), ocr_sec_per_crop: z.number(),
    buildings_use_local: z.number().optional(), buildings_use_vlm: z.number().optional(), // absent in older runs
    buildings_use_sign: z.number().optional(),            // D32: use filled from a readable business sign
    vlm_calls: z.number(), vlm_cost_usd: z.number(), places_calls: z.number(), device: z.string(),
    floors_examples_found: z.boolean().optional(),
    stage_seconds: Counts, total_minutes: z.number(),
    validation: z.record(z.string(), z.string()),
    planted_error_scores: z.record(z.string(), z.union([PlantedScore, Recovery])).nullable(),
    asset_register_scores: z.record(z.string(), PlantedScore),
    // D43 / D44 / P7a re-apply
    register_matching: obj({ records: z.number(), records_unmatched: z.number(),
      pairing: obj({ all: Pairing, pin_moved: Pairing, pin_not_moved: Pairing }).nullable() }).nullable().optional(),
    signs_relinked: z.number().optional(),
    p7a_reapplied: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])).optional(),
  })

  const Meta = obj({
    area: z.string(), generated: z.string(),
    pipeline: obj({
      detector: z.string(), ocr: z.string(), vlm: z.string(), name_gate: z.number(), footprints: z.string(), reference: z.string(),
    }),
    registers: z.string(),
    counts: obj({
      buildings: z.number(), assets: z.number(), missing_asset_records: z.number(), streetlight_gaps_60m: z.number(),
      review_items: z.number(), unmapped_businesses: z.number().optional(),
    }),
    run: RunStats,
  })

  const Kpi = obj({
    streets_covered: z.number(), buildings_analysed: z.number(), unmatched_properties: z.number(),
    buildings_with_discrepancy: z.number(), streetlights: z.number(), poles: z.number(), named_businesses: z.number(),
    sign_text_unverified: z.number(), names_confirmed_by_google: z.number(), low_confidence_observations: z.number(),
    unmapped_businesses: z.number().optional(),
  })

  const StreetStats = obj({
    buildings: z.number(), no_record: z.number(), discrepancy: z.number(), streetlights: z.number(), poles: z.number(), gap_m_60: z.number(),
  })

  // Chart keys vary per area (missing key = 0).
  const Dashboard = obj({
    kpi: Kpi,
    charts: obj({
      building_use: Counts, floor_distribution: Counts, floors_status: Counts, asset_type: Counts,
      match_status: Counts, discrepancy_type: Counts, by_street: z.record(z.string(), StreetStats),
    }),
    cost_panel: RunStats,
    streets: z.array(z.string()),
  })

  const AreaExport = obj({
    meta: Meta,
    dashboard: Dashboard,
    buildings: z.array(Building),
    assets: z.array(Asset),
    missing_asset_records: z.array(MissingAssetRecord),
    streetlight_gaps: z.array(StreetlightGap),
    review_queue: z.array(ReviewQueueItem),
    unmapped_businesses: z.array(UnmappedBusiness).optional(), // absent in older runs
    // D43: register records with no building nearby
    register_unmatched: z.array(obj({ property_id: z.string(), lat: z.number(), lon: z.number(), street: z.string().nullable(), why: z.string() })).optional(),
  })

  return {
    AreaExport, Meta, RunStats, Dashboard, Building, Asset, MissingAssetRecord, StreetlightGap,
    UnmappedBusiness, ReviewQueueItem, BoxView,
  }
}

export const ExportSchemas = makeExportSchemas('loose')

export type AreaExport = z.infer<typeof ExportSchemas.AreaExport>
export type Meta = z.infer<typeof ExportSchemas.Meta>
export type RunStats = z.infer<typeof ExportSchemas.RunStats>
export type Dashboard = z.infer<typeof ExportSchemas.Dashboard>
export type Building = z.infer<typeof ExportSchemas.Building>
export type Asset = z.infer<typeof ExportSchemas.Asset>
export type MissingAssetRecord = z.infer<typeof ExportSchemas.MissingAssetRecord>
export type StreetlightGap = z.infer<typeof ExportSchemas.StreetlightGap>
export type UnmappedBusiness = z.infer<typeof ExportSchemas.UnmappedBusiness>
export type ReviewQueueItem = z.infer<typeof ExportSchemas.ReviewQueueItem>
export type BoxView = z.infer<typeof ExportSchemas.BoxView>
