/** P5 endpoints: Under the Hood (computed story), Trust (model_card cards), review history, jobs detail. */
import { useQueries, useQuery } from '@tanstack/react-query'
import type { ReviewEvent } from '@/lib/review'
import { api } from './client'
import type { JobFull, WorkerStatus } from './types'

export interface SankeySeg { id: string; label: string; value: number; kind: 'kept' | 'idle' | 'drop'; examples: string | null; reason: string | null }
export interface SankeyGroup { id: string; from: string[]; unit: string; segments: SankeySeg[] }
export interface SankeyCol { unit: string; title: string; segments?: SankeySeg[]; groups?: SankeyGroup[] }
export interface StorySentence { chapter: string; text: string; stored: string | null; changed: boolean; kind: 'numbers' | 'wording' | null; why: string | null }
export interface StreetRow {
  street: string; length_m: number; cameras: number; views: number; buildings: number; no_record: number; discrepancy: number
  use_unknown: number; streetlights: number; poles: number; gaps: number; gap_m: number
}
export interface CostLine { key: string; label: string; value: number | null; detail: string; source: string | null; status: 'computed' | 'model_card' | 'measured' | 'not recorded'
  /** P7.2: Street View photos the run bought (views + building photos), when computed from the run files */
  photos?: number }
export interface Hood {
  area: string; name: string; files: string[]
  /** analysed from the app by a worker (P6): its timings and costs are this run's own */
  live: boolean
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
    lines: CostLine[]; model_card: { gpu_minutes: number | null; source: string } | null; live: boolean
    records: { vlm_calls: number; vlm_usd_recorded: number; buildings_cost_not_recorded: number; source: string }
    /** representative = this run's own values (a fresh live run); badge = why not (resumed), null when they are */
    run_counters: Record<string, unknown> & { representative: boolean; badge: string | null }
    timings: { stage_seconds: Record<string, number>; total_minutes: number | null; device: string | null; representative: boolean; badge: string | null }
  }
  routing: Routing | null
  imagery: import('./types').ImagerySummary
  /** D53: where the roads and building outlines come from: the covered city's snapshot, and what this area's run used */
  map_data?: MapDataInfo
  /** D60: how many of this area's analysis photos Google still serves (tools/check_photos.py), with the plain line */
  photo_check?: { text: string; checked: string; photo_refs: number; served: number; gone: number; gone_current_available: number
    gone_current_newer: number; gone_current_same_month: number; panoramas: number; panoramas_gone: number } | null
  /** D60: what Google actually billed for Street View (data/billing.json, the owner's billing report; account-wide) */
  billing?: { line: string; billed_inr: number; photos_billed: number; source: string } | null
}
/** P8: routing and cost, computed from the run's cloud-call files (backend/app/routing.py) */
export interface RouteRow { route: 'local' | 'cloud'; model: string; label: string; n: number; unit: string; usd: number | null
  usd_status: string; usd_src: string; usd_per_call?: number | null; lat_s: number | null; lat_src: string }
export interface Routing {
  tasks: { key: string; title: string; input: number; input_unit: string; routes: RouteRow[] }[]
  totals: { calls: number; usd: number | null; status: string; run_counter: { calls: number | null; usd: number | null } }
  all_cloud: { calls: number; usd: number; extra_calls: number; extra_usd: number; src: string } | null
  every_view: { photos: number; usd_per_call: number; usd: number; minutes: number | null; workers: number; lat_s: number | null; status: 'estimate'; src: string } | null
  accuracy: { task: string; n: number; src: string; note: string; rows: { label: string; value: number; production?: boolean }[] }[]
  measured_every_view: { n: number; routed: number; all_vlm: number; usd_routed: number; usd_all_vlm: number; ratio: string; src: string } | null
  model_card_check: { stored_with: number; stored_without: number; stored_calls_with: number; stored_calls_without: number; computed_with: number | null
    computed_calls_with: number; computed_without: number | null; computed_calls_without: number | null; names_and_signs_calls: number; why: string } | null
  street_view: { photos: number; usd_per_photo: number | null; usd: number | null }
  /** D65: cloud model on everything vs routed, measured on a labelled sample (replaces the estimates when present) */
  measured: RoutingMeasured | null
}
export interface MeasuredPath { label: string; source: string; n: number; use_correct: number; use_accuracy: number | null; use_no_answer: number
  floors_n: number; floors_exact: number | null; floors_within_1: number | null; floors_no_answer: number
  usd_per_building: number; usd_sample: number; cloud_calls: number; s_per_building: number; s_per_building_mean: number }
export interface LatencyRow { step: string; model: string; route: 'local' | 'cloud'; unit: string; s: number | null; n: number | null; where: string; note?: string }
export interface RoutingMeasured {
  measured: string; machine: string; n: number; routed_decided_locally: number
  sample: { rule: string; seed: number; labeller: string; labelled: string }
  paths: { routed: MeasuredPath; all_cloud: MeasuredPath }
  latency: LatencyRow[]
  spend: { street_view_photos: number; street_view_usd: number; nova_usd: number; nova_calls: number }
}
export interface HoodBox { cls: 'building' | 'pole' | 'lamp_head' | 'signboard'; conf: number; x1: number; y1: number; x2: number; y2: number; geom_ok: boolean; target: boolean }
export interface HoodExample {
  kind: 'photo' | 'building' | 'asset' | 'unmapped' | 'gap' | 'map'
  /** [label, value, 'tech'?]: 'tech' = developer detail, Technical only */
  id?: string; title: string; reason: string; facts?: [string, unknown, string?][]
  rays?: { lat: number; lon: number; heading: number; fov?: number; faces?: string | null }[]; footprints?: string[]; inside?: boolean; map?: boolean
  view?: { pano_id: string; heading: number; pitch: number; fov: number }; boxes?: HoodBox[]; note?: string
  points?: { lat: number; lon: number; label?: string; drop?: boolean }[]; line?: [number, number][]; street?: string | null
  /** D39: the key measurement drawn on the example's mini-map (e.g. the spacing to the nearest chosen camera stop) */
  measure?: { a: { lat: number; lon: number }; b: { lat: number; lon: number }; what: string } | null
  /** D39: the OpenStreetMap outline a dropped camera stands in ([lat, lon] ring), when found */
  outline?: [number, number][] | null
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
/** D42/D43: per area, planted-mistake recovery and register pairing by location, computed from the records */
export interface Recovery { planted: number; caught: number; missed: number; false_alarms: number }
export interface PairingScore { records: number; paired_right: number; paired_wrong: number; unpaired: number; right_pct: number | null }
export interface RegisterTestArea {
  area: string; name: string; buildings: number; register_source: string | null; available: boolean
  recovery?: Record<string, Recovery>; planted_total?: number; records?: number; records_unmatched?: number | null
  pairing?: { all: PairingScore; pin_moved: PairingScore; pin_not_moved: PairingScore }; match_confidence?: Record<string, number>
}
export interface RegisterTests {
  areas: RegisterTestArea[]; note: string
  total: { recovery: Record<string, Recovery>; pairing: { records: number; paired_right: number; moved: number; moved_right: number; right_pct: number | null; moved_right_pct: number | null } }
}
export const useRegisterTests = () =>
  useQuery({ queryKey: ['trust-register'], queryFn: () => api<RegisterTests>('/trust/register'), staleTime: 60_000 })
export const useConsistency = () =>
  useQuery({ queryKey: ['trust-consistency'], queryFn: () => api<{ rows: ConsistencyRow[] }>('/trust/consistency').then((r) => r.rows), staleTime: 60_000 })

export const useReviewEvents = (id: number | null | undefined) =>
  useQuery({ queryKey: ['review-events', id], queryFn: () => api<{ events: ReviewEvent[] }>(`/review/${id}/events`).then((r) => r.events),
    enabled: id != null, staleTime: 0, refetchOnMount: 'always', retry: false })

/** P7.2: the estimate from the pipeline's own camera planner (POST /jobs/preview, /jobs/plan-estimate; stored on the job) */
export interface JobEstimate { method: 'planner'; panoramas: number; cameras: number; views: number; buildings_faced: number
  street_view_images: number; street_view_usd: number | null; cloud_ai_usd: number | null; places_calls: number | null
  total_usd: number | null; gpu_minutes: number | null; cpu_minutes: number | null; cap_usd: number | null; over_cap: boolean
  note?: string | null; basis: string; is_estimate: true }
export interface PlanStatus { key: string; status: 'running' | 'done' | 'failed' | 'unknown'; elapsed_s?: number; error?: string; estimate?: JobEstimate }
export interface JobP5 extends JobFull {
  display_status: 'queued' | 'running' | 'interrupted' | 'done' | 'failed' | 'cancelled' | 'no_street_view' | 'expired_token' | 'needs_approval' | 'cancelling'
  is_test: boolean; heartbeat_at: string | null; worker_id: string | null; message: string | null
  input: JobFull['input'] & { length_m?: number; lines?: GeoJSON.MultiLineString | GeoJSON.LineString; name?: string; trimmed?: boolean; slug?: string }
}
export const useJobs = () =>
  useQuery({ queryKey: ['jobs', 'all'], queryFn: () => api<{ jobs: JobP5[]; worker_online: boolean; worker: WorkerStatus; offline: boolean }>('/jobs'),
    refetchInterval: (q) => (q.state.data?.jobs.some((j) => j.status === 'running') ? 5_000 : 15_000) })
export const useJob = (id: string | null) =>
  useQuery({ queryKey: ['job', id], queryFn: () => api<{ job: JobP5; worker_online: boolean; estimate: JobEstimate | null }>(`/jobs/${id}`),
    enabled: !!id, refetchInterval: (q) => (q.state.data?.job.status === 'running' ? 5_000 : 15_000) })

/** D53: a covered city (OpenStreetMap + Microsoft footprints held in the app's database) */
export interface MapCity { city: string; name: string; osm_snapshot: string | null; ms_release: string | null; counts: Record<string, number> | null }
export interface MapDataInfo {
  city: MapCity | null
  /** snapshot = the run's map questions were answered from the app's copy; live = OpenStreetMap's servers at run time */
  run: { kind: 'snapshot' | 'live'; date?: string | null; osm_snapshot?: string | null; ms_release?: string | null; answers?: Record<string, Record<string, number>> }
  attribution: { osm: string; microsoft: string }
}
