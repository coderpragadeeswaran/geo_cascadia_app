/**
 * Types + runtime schemas for data/areas/<slug>/run_report.json (built by tools/build_run_report.py; CLAUDE.md §4.3).
 * Every section is always emitted, but values copied from meta.run may be null.
 * Per docs/DECISIONS.md D1/D2: `cost_time` comes from resumed runs (badge "resumed run, not representative"),
 * and counts that export.json can answer are recomputed from export.json, not taken from here or from `story[]`.
 */
import { z } from 'zod'
import type { SchemaMode } from './export'

const Counts = z.record(z.string(), z.number())
const num = z.number().nullable()

export function makeRunReportSchemas(mode: SchemaMode) {
  const obj = <T extends z.ZodRawShape>(shape: T) => (mode === 'strict' ? z.strictObject(shape) : z.looseObject(shape))
  const Score = obj({ planted: z.number(), tp: z.number(), fp: z.number(), fn: z.number().optional() })

  const RunReport = obj({
    run_dir: z.string(),
    area: z.string().nullable(),
    generated: z.string().nullable(),
    pipeline: z.record(z.string(), z.union([z.string(), z.number()])).nullable(),
    imagery: obj({
      panoramas_found: z.number(), google_car: z.number(), user_photospheres: z.number(),
      cameras_planned: z.number(), cameras_dropped: Counts, views_planned: z.number(), views_by_type: Counts,
      views_facing_mapped_building: z.number(), views_facing_no_mapped_building: z.number(), views_fetched_ok: z.number(),
      street_view_requests: num, street_view_cost_usd_notional: num,
      by_street: z.record(z.string(), obj({ cameras: z.number(), views: z.number() })),
    }),
    maps: obj({
      footprints: Counts.nullable().optional(), osm_built_fraction: num.optional(), buildings_registered: num.optional(),
      buildings_by_source: Counts.nullable().optional(), verdict: z.string().nullable().optional(),
    }),
    detection: obj({
      boxes_total: z.number(), by_class: Counts, used_for_geometry: z.number(),
      excluded_from_geometry: Counts, mean_conf_by_class: Counts,
    }),
    assets: obj({
      located: z.number(), by_type: Counts, by_confidence: Counts,
      triangulated_2plus_cameras: z.number(), // = cameras_used >= 2, NOT method=triangulated (see D2)
      single_camera_approximate: z.number(), register_status: Counts,
      streetlight_gaps_60m: z.number(), missing_asset_records: z.number(),
    }),
    buildings: obj({
      registered: z.number(), with_a_building_box: z.number(), no_building_box_detected: z.number(),
      box_rejected_by_quality_gate: Counts, usable_view: z.number(), vlm_said_wrong_target: z.number(),
      use_route: Counts, use_values: Counts, floors_status: Counts, floor_values: Counts,
    }),
    signs: obj({
      crops: z.number(), tiers: Counts, ocr_seconds_per_crop: num, ocr_mode: z.string().nullable(),
      vlm_name_calls: z.number(), vlm_name_verdicts: Counts, buildings_named: z.number(),
      name_route: Counts, name_quality: Counts, google_confirmed: z.number(),
    }),
    unmapped_businesses: obj({
      sign_candidates_checked_by_vlm: z.number(), kept: z.number(), vlm_said_not_business: z.number(),
      examples: z.array(z.string().nullable()),
    }),
    matching: obj({
      match_status: Counts, discrepancy_types: Counts,
      planted_error_scores: z.record(z.string(), Score).nullable(),
      asset_register_scores: z.record(z.string(), Score).nullable(),
      register_note: z.string().nullable(),
    }),
    review: obj({ items: z.number(), by_priority: Counts, by_reason: Counts }),
    /** Resumed-run values — never presented as real timings/cost (D1). */
    cost_time: obj({
      stage_seconds: Counts.nullable(), total_minutes: num, vlm_calls: num, vlm_cost_usd: num,
      places_calls: num, device: z.string().nullable(), buildings_use_local: num, buildings_use_vlm: num,
    }),
    story: z.array(z.string()),
  })

  return { RunReport }
}

export const RunReportSchemas = makeRunReportSchemas('loose')
export type RunReport = z.infer<typeof RunReportSchemas.RunReport>
