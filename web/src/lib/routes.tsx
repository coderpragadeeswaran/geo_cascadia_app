/** Model routes (Tier 1 local · Tier 2 OCR · Tier 3 VLM) with accuracy notes taken ONLY from model_card.json
 *  (D2: the per-building `validated` strings quote n=33 for floors; model_card says n=36, so they are not used).
 *  Shown only behind "How do we know?" and on the verifier pages (D16). */
import { useModelCard } from '@/api/queries'
import type { HowLink } from '@/components/HowWeKnow'
import type { ModelCard } from '@/types/modelCard'

const pct = (v: unknown) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : String(v ?? '—'))
// model_card sections are typed loosely in the zod schema; these notes read known paths only
type MC = any   // eslint-disable-line @typescript-eslint/no-explicit-any

interface RouteInfo { tier: 1 | 2 | 3; label: string; note: (mc: MC) => string; link: HowLink }
const ROUTES: Record<string, RouteInfo> = {
  tier1_local_clip: { tier: 1, label: 'T1 · local CLIP router', link: { page: 'trust', section: 'use', label: 'Building use accuracy' },
    note: (m) => { const h = m.building_use.local_router.ward29_heldout; return `Local router (${m.building_use.local_router.method}). Ward 29 held-out: local ${pct(h.local_only)}, routed ${pct(h.routed)}, VLM-only ${pct(h.vlm_only)} (n=${h.n}).` } },
  tier3_vlm: { tier: 3, label: 'T3 · VLM (Nova Lite)', link: { page: 'trust', section: 'use', label: 'Building use accuracy' },
    note: (m) => `Use accuracy ${pct(m.building_use.vlm_accuracy.value)} (n=${m.building_use.vlm_accuracy.n}, ${m.building_use.vlm_accuracy.metric}).` },
  tier3_vlm_fewshot: { tier: 3, label: 'T3 · VLM few-shot', link: { page: 'trust', section: 'floors', label: 'Floor count accuracy' },
    note: (m) => `${m.floors.method}. Ward 29: ${pct(m.floors.ward29.exact)} exact, ${pct(m.floors.ward29.within_1)} within ±1 floor (n=${m.floors.ward29.n}); baseline ${pct(m.floors.ward29.baseline_exact)} exact.` },
  tier2_ocr: { tier: 2, label: 'T2 · OCR (PaddleOCR)', link: { page: 'trust', section: 'names', label: 'Shop name accuracy' },
    note: (m) => `${m.ocr.engine}. Crop-level names (n=31): OCR only ${pct(m.names.crop_level_n31.ocr_only)}, routed OCR→VLM ${pct(m.names.crop_level_n31.routed_ocr_then_vlm)}.` },
  'tier3_vlm+ocr_gate': { tier: 3, label: 'T3 · VLM + OCR gate', link: { page: 'trust', section: 'names', label: 'Shop name accuracy' },
    note: (m) => `VLM name kept because OCR supports it. Routed ${pct(m.names.crop_level_n31.routed_ocr_then_vlm)} vs all-VLM ${pct(m.names.crop_level_n31.all_vlm)} (n=31). ${m.names.vlm_only_names_confirmed}.` },
  tier3_vlm_unverified: { tier: 3, label: 'T3 · VLM, not supported by OCR', link: { page: 'trust', section: 'names', label: 'Shop name accuracy' },
    note: (m) => `Read by the VLM only, not supported by OCR: treated as unverified. ${m.names.vlm_only_names_confirmed}.` },
  'tier1_yolo + geometry': { tier: 1, label: 'T1 · YOLO detector + geometry', link: { page: 'trust', section: 'detector', label: 'Detector accuracy' },
    note: (m) => { const c = m.detector.per_class; return `${m.detector.production}. Test set: pole P ${pct(c.pole.P)} / R ${pct(c.pole.R)} (n=${c.pole.n}), lamp P ${pct(c.lamp_head.P)} / R ${pct(c.lamp_head.R)} (n=${c.lamp_head.n}).` } },
}

export const routeInfo = (route: string | null | undefined) => (route ? ROUTES[route] : undefined)

export function RouteBadge({ route }: { route: string | null | undefined }) {
  if (!route) return null
  return <span className="tag">{ROUTES[route]?.label ?? route}</span>
}

/** "T1 · local CLIP router — note (model_card)" for How do we know? */
export function RouteLine({ route }: { route: string | null | undefined }) {
  const { data: mc } = useModelCard()
  if (!route) return <span className="ink3">not measured (no usable view)</span>
  const r = ROUTES[route]
  return <span><span className="tag mr-1.5">{r?.label ?? route}</span>{r && mc ? <span className="ink2">{r.note(mc as MC)} <span className="ink3">(model_card)</span></span> : null}</span>
}

export function routeNote(route: string | null | undefined, mc: ModelCard | undefined) {
  const r = route ? ROUTES[route] : undefined
  return r && mc ? r.note(mc as MC) : null
}
