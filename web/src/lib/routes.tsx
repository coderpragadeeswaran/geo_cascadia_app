/** Model-route badges (Tier 1 local · Tier 2 OCR · Tier 3 VLM) with validation notes taken ONLY from model_card.json
 *  (D2: the per-building `validated` strings quote n=33 for floors; model_card says n=36, so they are not used). */
import { useModelCard } from '@/api/queries'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ModelCard } from '@/types/modelCard'

const pct = (v: unknown) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : String(v ?? '—'))
// model_card sections are typed loosely in the zod schema; these notes read known paths only
type MC = any   // eslint-disable-line @typescript-eslint/no-explicit-any

interface RouteInfo { tier: 1 | 2 | 3; label: string; note: (mc: MC) => string }
const ROUTES: Record<string, RouteInfo> = {
  tier1_local_clip: { tier: 1, label: 'Tier 1 · local CLIP',
    note: (m) => { const h = m.building_use.local_router.ward29_heldout; return `Local router (${m.building_use.local_router.method}). Ward 29 held-out: local ${pct(h.local_only)}, routed ${pct(h.routed)}, VLM-only ${pct(h.vlm_only)} (n=${h.n}).` } },
  tier3_vlm: { tier: 3, label: 'Tier 3 · VLM',
    note: (m) => `Nova Lite. Use accuracy ${pct(m.building_use.vlm_accuracy.value)} (n=${m.building_use.vlm_accuracy.n}, ${m.building_use.vlm_accuracy.metric}).` },
  tier3_vlm_fewshot: { tier: 3, label: 'Tier 3 · VLM few-shot',
    note: (m) => `${m.floors.method}. Ward 29: ${pct(m.floors.ward29.exact)} exact, ${pct(m.floors.ward29.within_1)} within ±1 floor (n=${m.floors.ward29.n}); baseline ${pct(m.floors.ward29.baseline_exact)} exact.` },
  tier2_ocr: { tier: 2, label: 'Tier 2 · OCR',
    note: (m) => `${m.ocr.engine}. Crop-level names (n=31): OCR only ${pct(m.names.crop_level_n31.ocr_only)}, routed OCR→VLM ${pct(m.names.crop_level_n31.routed_ocr_then_vlm)}.` },
  'tier3_vlm+ocr_gate': { tier: 3, label: 'Tier 3 · VLM + OCR gate',
    note: (m) => `VLM name kept because OCR supports it. Routed ${pct(m.names.crop_level_n31.routed_ocr_then_vlm)} vs all-VLM ${pct(m.names.crop_level_n31.all_vlm)} (n=31). ${m.names.vlm_only_names_confirmed}.` },
  tier3_vlm_unverified: { tier: 3, label: 'Tier 3 · VLM (unverified)',
    note: (m) => `Read by the VLM only, not supported by OCR: treat as unverified. ${m.names.vlm_only_names_confirmed}.` },
  'tier1_yolo + geometry': { tier: 1, label: 'Tier 1 · YOLO + geometry',
    note: (m) => { const c = m.detector.per_class; return `${m.detector.production}. Test set: pole P ${pct(c.pole.P)} / R ${pct(c.pole.R)} (n=${c.pole.n}), lamp P ${pct(c.lamp_head.P)} / R ${pct(c.lamp_head.R)} (n=${c.lamp_head.n}). ${m.positions.independent_camera_check_n30.conclusion}.` } },
}

const TIER_CLS = { 1: 'border-[#7dd3fc]/40 text-[#7dd3fc]', 2: 'border-accent/45 text-accent', 3: 'border-[#f0abfc]/40 text-[#f0abfc]' } as const

export function RouteBadge({ route, className }: { route: string | null | undefined; className?: string }) {
  const { data: mc } = useModelCard()
  if (!route) return null
  const r = ROUTES[route]
  const badge = (
    <span className={cn('inline-flex h-[18px] shrink-0 cursor-help items-center rounded-[5px] border px-1.5 text-[10px] font-semibold tracking-wide',
      r ? TIER_CLS[r.tier] : 'border-glass-border text-muted', className)}>
      {r ? r.label : route}
    </span>
  )
  if (!r || !mc) return badge
  return <Tip label={<span className="block max-w-[300px] leading-snug">{r.note(mc as MC)}<span className="mt-1 block text-faint">Source: model_card.json</span></span>}>{badge}</Tip>
}

export function routeNote(route: string | null | undefined, mc: ModelCard | undefined) {
  const r = route ? ROUTES[route] : undefined
  return r && mc ? r.note(mc as MC) : null
}
