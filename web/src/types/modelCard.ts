/**
 * Types + runtime schema for data/model_card.json — the ONLY source of accuracy / benchmark / cost-comparison
 * numbers (CLAUDE.md §2, §4.4; docs/DECISIONS.md D2, D5). Sections are typed where the Trust page needs structure;
 * free-text findings stay strings so nothing gets re-phrased into a new number.
 */
import { z } from 'zod'
import type { SchemaMode } from './export'

const Text = z.string()
const NumOrText = z.union([z.number(), z.string()])

export function makeModelCardSchemas(mode: SchemaMode) {
  const obj = <T extends z.ZodRawShape>(shape: T) => (mode === 'strict' ? z.strictObject(shape) : z.looseObject(shape))
  const PR = obj({ P: z.number(), R: z.number() })

  const ModelCard = obj({
    _note: Text,
    detector: obj({
      production: Text, test_set: Text,
      per_class: z.record(z.string(), obj({ P: z.number(), R: z.number(), n: z.number() })),
      weighted_F1: z.number(), gpu_ms_per_view: z.number(), cpu_ms_per_view: z.number(),
      benchmark: z.array(obj({
        model: Text, F1: z.number(), pole_R: z.number(), lamp_R: z.number(), cpu_ms: z.number(), downstream: Text.optional(),
      })),
      decision: Text,
    }),
    building_use: obj({
      vlm_accuracy: obj({ value: z.number(), n: z.number(), metric: Text }),
      local_router: z.record(z.string(), z.unknown()), // nested per-dataset results; rendered as a table
      google_places_as_use_signal: obj({ value: z.number(), n: z.number(), decision: Text }),
    }),
    floors: obj({
      method: Text, // PRODUCTION variant (route tier3_vlm_fewshot)
      ward29: obj({ exact: z.number(), within_1: z.number(), baseline_exact: z.number(), n: z.number(), source: Text.optional() }),
      // D65: 30 of the current run's buildings, labelled by viewing the photos (AI check)
      measured_ward29_n30: obj({ n: z.number(), exact: z.number(), within_1: z.number(), note: Text }).optional(),
      trichy_unseen: obj({ exact: z.number(), within_1: z.number(), n: z.number(), note: Text.optional() }),
      rejected_variants: z.array(Text), // shown separately from production (D5)
    }),
    names: z.record(z.string(), z.unknown()),
    ocr: z.record(z.string(), z.unknown()),
    streetlights: z.record(z.string(), Text),
    positions: z.record(z.string(), z.unknown()),
    matching_planted_errors: obj({
      property_geometry: PR,
      asset: z.record(z.string(), PR),
      note: Text,
    }),
    withheld: z.record(z.string(), Text),
    generalisation: z.record(z.string(), z.union([Text, z.record(z.string(), NumOrText)])),
    cost_time: obj({
      ward29_full_run_gpu_minutes: z.number(),
      // D65: the current Ward 29 run (the server's T4; claim to upload) and its whole cloud-AI bill
      ward29_full_run_images: z.number().optional(), ward29_full_run_where: Text.optional(),
      ward29_vlm_usd_run: z.number().optional(), ward29_vlm_calls_run: z.number().optional(),
      names_routed_vs_all_vlm_usd: obj({ routed: z.number(), all_vlm_every_view: z.number() }),
      street_view_price_usd_per_image: z.number(),
      cpu_fallback_per_street_min: z.record(z.string(), NumOrText),
    }),
    // D65: seconds per item for every route, measured on the analysis server (tools/measure_routes.py)
    latency_per_item: obj({ machine: Text, measured: z.string(), source: Text,
      rows: z.array(obj({ step: Text, model: Text, route: z.enum(['local', 'cloud']), unit: Text, s: z.number().nullable(), n: z.number().nullable(), where: Text, note: Text.optional() })) }).optional(),
    // D45: single-camera pole error by camera distance (tools/pole_uncertainty.py)
    single_camera_by_distance: obj({
      _note: Text, generated: z.string(), n: z.number(), samples_per_area: z.record(z.string(), z.number()),
      bands: z.array(obj({ band_m: z.array(z.number()), n: z.number(), median_m: z.number().nullable(), p80_m: z.number().nullable(), surveyed_median_m: z.number().nullable().optional() })),
      used_uncertainty_m: z.array(obj({ up_to_m: z.number(), plus_minus_m: z.number(), basis: z.string().optional() })),
      rule: Text, notebook_surveyed_check: Text,
    }).optional(),
    // P7.4: the sign-linking rule (D44) and its agreement check against Google pins (tools/validate_sign_links.py)
    sign_links: obj({
      rule: Text, margin_deg: z.number(), note: Text, source: Text,
      ward29: obj({
        sign_crops: z.number().int(), moved: z.number().int(), read_signs: z.number().int(), read_moved: z.number().int(),
        google_check: obj({
          moved_read_signs_with_google_pin: z.number().int(), closer: z.number().int(), further: z.number().int(),
          same_within_1m: z.number().int(), to_or_from_no_outline: z.number().int(), median_change_m: z.number(),
        }),
      }),
    }).optional(),
    // D26/D27: building position vs the Gate 1 target (tools/eval_gate1.py); per-area tables are keyed by area slug
    gate1_position: obj({
      _note: Text, generated: z.string(), target_m: z.number(), status: z.string(), status_note: Text,
      // D33: organiser guidance and the front-wall-centre reference
      organiser_guidance: Text.optional(), front_centre_note: Text.optional(),
      'vs OSM front-wall centre': z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
      rule: z.record(z.string(), Text),
      method_counts: z.record(z.string(), z.record(z.string(), z.number())),
      self_consistency: z.record(z.string(), z.record(z.string(), z.number().nullable())),
      'vs OSM wall': z.record(z.string(), z.record(z.string(), z.unknown())),
      'vs Google pin': z.record(z.string(), z.record(z.string(), z.unknown())),
    }).optional(),
  })
  return { ModelCard }
}

export const ModelCardSchemas = makeModelCardSchemas('loose')
export type ModelCard = z.infer<typeof ModelCardSchemas.ModelCard>
