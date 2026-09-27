/** P5 endpoints: Under the Hood (computed story), Trust (model_card cards), review history, jobs detail. */
import { useQueries, useQuery } from '@tanstack/react-query'
import type { ReviewEvent } from '@/lib/review'
import { api } from './client'
import type { JobFull } from './types'

export interface SankeySeg { id: string; label: string; value: number; kind: 'kept' | 'idle' | 'drop'; examples: string | null; reason: string | null }
export interface SankeyGroup { id: string; from: string[]; unit: string; segments: SankeySeg[] }
export interface SankeyCol { unit: string; title: string; segments?: SankeySeg[]; groups?: SankeyGroup[] }
export interface StorySentence { chapter: string; text: string; stored: string | null; changed: boolean; kind: 'numbers' | 'wording' | null; why: string | null }
export interface StreetRow {
  street: string; length_m: number; cameras: number; views: number; buildings: number; no_record: number; discrepancy: number
  use_unknown: number; streetlights: number; poles: number; gaps: number; gap_m: number
}
export interface CostLine { key: string; label: string; value: number | null; detail: string; source: string | null; status: 'computed' | 'model_card' | 'not recorded' }
export interface Hood {
  area: string; name: string; files: string[]
  pipeline: { detector?: string; ocr?: string; vlm?: string; name_gate?: number; footprints?: string; reference?: string }
  /** every number, computed; its source is src[key] */
  n: Record<string, number> & { use_values: Record<string, number>; discrepancy_types: Record<string, number> }
  src: Record<string, string>
  coverage: { level: 'full' | 'partial' | null; verdict: string | null; share_views_unmapped: number | null; views: number; views_unmapped: number; buildings: number; unmapped_kept: number }
  sankey: { columns: SankeyCol[] }
  sign_funnel: { key: string; label: string; value: number; unit: string; examples: string }[]
  routes: { use: { local: number; vlm: number; sign: number; unknown: number }; names: { ocr: number; vlm_gate: number; vlm_only: number } }
  streets: StreetRow[]
  story: StorySentence[]
  corrections: StorySentence[]
  cost: {
    lines: CostLine[]; model_card: { gpu_minutes: number | null; source: string } | null
    records: { vlm_calls: number; vlm_usd_recorded: number; buildings_cost_not_recorded: number; source: string }
    run_counters: Record<string, unknown> & { representative: false; badge: string }
    timings: { stage_seconds: Record<string, number>; total_minutes: number | null; device: string | null; representative: false; badge: string }
  }
}
export interface HoodBox { cls: 'building' | 'pole' | 'lamp_head' | 'signboard'; conf: number; x1: number; y1: number; x2: number; y2: number; geom_ok: boolean; target: boolean }
export interface HoodExample {
  kind: 'photo' | 'building' | 'asset' | 'unmapped' | 'gap' | 'map'
  /** [label, value, 'tech'?]: 'tech' = developer detail, Technical only */
  id?: string; title: string; reason: string; facts?: [string, unknown, string?][]
  rays?: { lat: number; lon: number; heading: number; fov?: number; faces?: string | null }[]; footprints?: string[]; inside?: boolean; map?: boolean
  view?: { pano_id: string; heading: number; pitch: number; fov: number }; boxes?: HoodBox[]; note?: string
  points?: { lat: number; lon: number; label?: string; drop?: boolean }[]; line?: [number, number][]; street?: string
}

export const useHood = (slug: string | null) =>
  useQuery({ queryKey: ['hood', slug], queryFn: () => api<Hood & { offline: boolean }>(`/areas/${slug}/hood`), enabled: !!slug, staleTime: 60_000 })
export const useHoods = (slugs: string[]) =>
  useQueries({ queries: slugs.map((s) => ({ queryKey: ['hood', s], queryFn: () => api<Hood & { offline: boolean }>(`/areas/${s}/hood`), staleTime: 60_000 })) })
export const useHoodExamples = (slug: string | null, key: string | null) =>
  useQuery({ queryKey: ['hood-ex', slug, key], queryFn: () => api<{ examples: HoodExample[] }>(`/areas/${slug}/hood/examples?key=${encodeURIComponent(key!)}`).then((r) => r.examples),
    enabled: !!(slug && key), staleTime: Infinity })

export interface TrustNum { label: string; value: number | string; kind: 'pct' | 'num' | 'm' | 'pctn' | 'text'; src: string | null; n?: number; n_src?: string }
export interface TrustCard { id: string; title: string; measured: string; method: string; result: TrustNum; baseline: TrustNum | null; more: TrustNum[]; verdict: string; caveat: string; section: string }
export interface Experiment { lane: string; name: string; status: 'production' | 'rejected' | 'replaced' | 'tried' | 'withheld'; numbers: TrustNum[]; why: string | null; src: string | null }
export interface ConsistencyRow {
  area: string; area_name: string; field: string; stored: unknown; computed: unknown; source: string; note: string | null
  kind?: string; jump: { page: 'hood' | 'trust' | 'explore'; section: string }
}
export const useTrust = () =>
  useQuery({ queryKey: ['trust'], queryFn: () => api<{ cards: TrustCard[]; experiments: Experiment[]; confusion_matrix: null; confusion_note: string }>('/trust'), staleTime: Infinity })
export const useConsistency = () =>
  useQuery({ queryKey: ['trust-consistency'], queryFn: () => api<{ rows: ConsistencyRow[] }>('/trust/consistency').then((r) => r.rows), staleTime: 60_000 })

export const useReviewEvents = (id: number | null | undefined) =>
  useQuery({ queryKey: ['review-events', id], queryFn: () => api<{ events: ReviewEvent[] }>(`/review/${id}/events`).then((r) => r.events),
    enabled: id != null, staleTime: 0, refetchOnMount: 'always', retry: false })

export interface JobEstimate { street_view_images: number; street_view_usd: number | null; gpu_minutes: number | null
  cpu_minutes_full_ocr: number | string | null; cpu_minutes_fast_ocr: string | null; basis: string; is_estimate: true }
export interface JobP5 extends JobFull {
  display_status: 'queued' | 'running' | 'interrupted' | 'done' | 'failed' | 'cancelled' | 'no_street_view' | 'expired_token'
  is_test: boolean; heartbeat_at: string | null; worker_id: string | null; message: string | null
  input: JobFull['input'] & { length_m?: number; lines?: GeoJSON.MultiLineString | GeoJSON.LineString; name?: string; trimmed?: boolean; slug?: string }
}
export const useJobs = () =>
  useQuery({ queryKey: ['jobs', 'all'], queryFn: () => api<{ jobs: JobP5[]; worker_online: boolean; offline: boolean }>('/jobs'), refetchInterval: 15_000 })
export const useJob = (id: string | null) =>
  useQuery({ queryKey: ['job', id], queryFn: () => api<{ job: JobP5; worker_online: boolean; estimate: JobEstimate | null }>(`/jobs/${id}`),
    enabled: !!id, refetchInterval: 15_000 })
