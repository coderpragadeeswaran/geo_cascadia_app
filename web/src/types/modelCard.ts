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
      ward29: obj({ exact: z.number(), within_1: z.number(), baseline_exact: z.number(), n: z.number() }),
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
      ward29_vlm_usd_with_router: z.number(),
      ward29_vlm_usd_without_router: z.number(),
      names_routed_vs_all_vlm_usd: obj({ routed: z.number(), all_vlm_every_view: z.number() }),
      street_view_price_usd_per_image: z.number(),
      cpu_fallback_per_street_min: z.record(z.string(), NumOrText),
    }),
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
