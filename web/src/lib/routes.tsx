/** Model routes (Tier 1 local · Tier 2 OCR · Tier 3 VLM) with accuracy notes taken ONLY from model_card.json
 *  (D2: the per-building `validated` strings quote n=33 for floors; model_card says n=36, so they are not used).
 *  Shown only behind "How do we know?" and on the verifier pages (D16). */
import { useModelCard } from '@/api/queries'
import type { HowLink } from '@/components/HowWeKnow'
import type { ModelCard } from '@/types/modelCard'

const pct = (v: unknown) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : String(v ?? '—'))
// model_card sections are typed loosely in the zod schema; these notes read known paths only
type MC = any   // eslint-disable-line @typescript-eslint/no-explicit-any

interface RouteInfo { tier: 1 | 2 | 3; label: string; plain: string; note: (mc: MC) => string; link: HowLink }
/** label = the technical name (grey hint); plain = what a non-expert reads; note = the measured accuracy in plain words
 *  (numbers unchanged, from model_card) */
const ROUTES: Record<string, RouteInfo> = {
  // use: the production system is the built-in model with AI fallback (routed); lead with ITS number, then the path used
  tier1_local_clip: { tier: 1, label: 'T1 · local CLIP router', plain: 'Decided by a small built-in model (no cloud AI)', link: { page: 'trust', section: 'use', label: 'Building use accuracy' },
    note: (m) => { const h = m.building_use.local_router.ward29_heldout; return `The production system (built-in model with AI fallback) was right ${pct(h.routed)} of the time on ${h.n} hand-checked Ward 29 buildings. For comparison: built-in model alone ${pct(h.local_only)}, AI image check alone ${pct(h.vlm_only)}.` } },
  tier3_vlm: { tier: 3, label: 'T3 · VLM (Nova Lite)', plain: 'Decided by the AI image check', link: { page: 'trust', section: 'use', label: 'Building use accuracy' },
    note: (m) => { const h = m.building_use.local_router.ward29_heldout; return `The AI image check was right ${pct(m.building_use.vlm_accuracy.value)} of the time on ${m.building_use.vlm_accuracy.n} hand-checked buildings (${m.building_use.vlm_accuracy.metric}). The production system (built-in model with AI fallback) was right ${pct(h.routed)} on ${h.n} hand-checked Ward 29 buildings.` } },
  // D32: use filled from a readable business sign when no building photo was usable (rule, no model; not measured)
  sign_text: { tier: 2, label: 'T2 · sign text rule', plain: 'Read from the shop sign on the building', link: { page: 'hood', section: 'routed', label: 'How use is decided' },
    note: () => 'No clear photo of the building itself, but a readable business sign is linked to it, so it is counted as a shop or business. This rule has not been checked against hand labels.' },
  tier3_vlm_fewshot: { tier: 3, label: 'T3 · VLM few-shot', plain: 'AI image check, shown two example buildings first', link: { page: 'trust', section: 'floors', label: 'Floor count accuracy' },
    note: (m) => `On ${m.floors.ward29.n} Ward 29 buildings checked by hand: exact floor count ${pct(m.floors.ward29.exact)} of the time, within one floor ${pct(m.floors.ward29.within_1)}; without the examples ${pct(m.floors.ward29.baseline_exact)} exact.` },
  tier2_ocr: { tier: 2, label: 'T2 · OCR (PaddleOCR)', plain: 'Text reader', link: { page: 'trust', section: 'names', label: 'Shop name accuracy' },
    note: (m) => `On 31 sign photos checked by hand: the text reader alone got the name right ${pct(m.names.crop_level_n31.ocr_only)} of the time, text reader then AI ${pct(m.names.crop_level_n31.routed_ocr_then_vlm)}.` },
  'tier3_vlm+ocr_gate': { tier: 3, label: 'T3 · VLM + OCR gate', plain: 'AI read, confirmed by the text reader', link: { page: 'trust', section: 'names', label: 'Shop name accuracy' },
    note: (m) => `Kept because the text reader saw the same words. This way names were right ${pct(m.names.crop_level_n31.routed_ocr_then_vlm)} of the time vs ${pct(m.names.crop_level_n31.all_vlm)} for the AI alone (31 sign photos). ${m.names.vlm_only_names_confirmed}.` },
  tier3_vlm_unverified: { tier: 3, label: 'T3 · VLM, not supported by OCR', plain: 'AI read only, not confirmed', link: { page: 'trust', section: 'names', label: 'Shop name accuracy' },
    note: (m) => `The text reader did not see the same words, so treat this name as unconfirmed. ${m.names.vlm_only_names_confirmed}.` },
  'tier1_yolo + geometry': { tier: 1, label: 'T1 · YOLO detector + geometry', plain: 'Object detector, then camera geometry', link: { page: 'trust', section: 'detector', label: 'Detector accuracy' },
    note: (m) => { const c = m.detector.per_class; return `In test photos it found ${pct(c.pole.R)} of the poles and ${pct(c.pole.P)} of its pole finds were real (${c.pole.n} poles); lamps: found ${pct(c.lamp_head.R)}, ${pct(c.lamp_head.P)} real (${c.lamp_head.n} lamps).` } },
}

export const routeInfo = (route: string | null | undefined) => (route ? ROUTES[route] : undefined)

export function RouteBadge({ route }: { route: string | null | undefined }) {
  if (!route) return null
  return <span className="tag">{ROUTES[route]?.label ?? route}</span>
}

/** How do we know?: the plain name, what it scored (model_card), and the technical name as a small grey hint */
export function RouteLine({ route }: { route: string | null | undefined }) {
  const { data: mc } = useModelCard()
  if (!route) return <span className="ink3">Not measured: no clear photo</span>
  const r = ROUTES[route]
  return (
    <span>
      <b className="font-[560]">{r?.plain ?? route}</b>{r && mc ? <span className="ink2">. {r.note(mc as MC)}</span> : null}
      <span className="ink3 text-[13px]"> · {r?.label ?? route}{r && mc ? ' (model card)' : ''}</span>
    </span>
  )
}

export function routeNote(route: string | null | undefined, mc: ModelCard | undefined) {
  const r = route ? ROUTES[route] : undefined
  return r && mc ? r.note(mc as MC) : null
}
