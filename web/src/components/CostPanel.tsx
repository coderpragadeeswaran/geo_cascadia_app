/** Routed vs all-VLM: cost AND accuracy (§10 test 6), every number from model_card.json (D1/D2). Lives on the Trust page
 *  (verifier content, D16). This area's own run counters come from a resumed run → shown greyed with the badge (D1). */
import { useAreaDetail, useModelCard } from '@/api/queries'
import { useUi } from '@/store/ui'
import { plural, usd as usd4 } from '@/lib/utils'

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
const pct = (v: unknown) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : '—')
const usd = (v: unknown) => (typeof v === 'number' ? usd4(v, v < 0.01 ? 4 : 3) : '—')

function Pair({ label, routed, all, fmtV, better }: { label: string; routed: number; all: number; fmtV: (v: number) => string; better: 'lower' | 'higher' }) {
  const max = Math.max(routed, all) || 1
  const win = better === 'lower' ? routed <= all : routed >= all
  const Row = ({ name, v, strong }: { name: string; v: number; strong?: boolean }) => (
    <div className="grid grid-cols-[64px_1fr_64px] items-center gap-3">
      <span className="t-small ink2">{name}</span>
      <span className="relative h-2.5"><span className="absolute inset-y-0 left-0" style={{ width: `${(v / max) * 100}%`, borderRadius: '0 4px 4px 0', background: strong ? 'var(--ns-sodium)' : 'var(--ns-ink3)' }} /></span>
      <span className="t-data text-right">{fmtV(v)}</span>
    </div>
  )
  return (
    <div className="space-y-1">
      <div className="t-small">{label}</div>
      <Row name="Routed" v={routed} strong={win} />
      <Row name="All-VLM" v={all} strong={!win} />
    </div>
  )
}

export function CostPanel() {
  const area = useUi((s) => s.area)
  const { data: mcRaw } = useModelCard()
  const { data: detail } = useAreaDetail(area)
  const mc = mcRaw as Any
  if (!mc || !detail) return null
  const ct = mc.cost_time, bu = mc.building_use, nm = mc.names
  const measured = !!detail.cost.model_card
  const gen = mc.generalisation?.[area ?? '']
  const run = detail.cost.run_stats as Any
  return (
    <section aria-label="Cost and accuracy: routed vs all-VLM">
      <p className="t-small ink2 mb-4 max-w-[640px]">Routing sends only uncertain cases to the vision-language model. Measured on Ward 29 by the team; all numbers from <span className="t-data">model_card.json</span>.</p>
      <div className="grid gap-8 md:grid-cols-2">
        <div className="space-y-3">
          <Pair label="Building use · VLM spend (Ward 29 run)" routed={ct.ward29_vlm_usd_with_router} all={ct.ward29_vlm_usd_without_router} fmtV={usd} better="lower" />
          <p className="t-small ink2">Accuracy unchanged: {pct(bu.local_router.full_ward29_run.use_accuracy_before)} → {pct(bu.local_router.full_ward29_run.use_accuracy_after)} (n={bu.local_router.full_ward29_run.n});
            held-out: routed {pct(bu.local_router.ward29_heldout.routed)} vs VLM-only {pct(bu.local_router.ward29_heldout.vlm_only)} (n={bu.local_router.ward29_heldout.n}).
            VLM calls {bu.local_router.full_ward29_run.vlm_calls_before} → {bu.local_router.full_ward29_run.vlm_calls_after}.</p>
        </div>
        <div className="space-y-3">
          <Pair label="Shop names · VLM spend" routed={ct.names_routed_vs_all_vlm_usd.routed} all={ct.names_routed_vs_all_vlm_usd.all_vlm_every_view} fmtV={usd} better="lower" />
          <Pair label="Shop names · accuracy (crop level, n=31)" routed={nm.crop_level_n31.routed_ocr_then_vlm} all={nm.crop_level_n31.all_vlm} fmtV={pct} better="higher" />
          <p className="t-small ink2">Full street views (n=16): routed {pct(nm.full_view_n16.routed)} vs all-VLM {pct(nm.full_view_n16.all_vlm_per_view)}, at {nm.full_view_n16.cost_ratio} the cost for all-VLM.</p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2">
        <div><div className="t-micro">Ward 29 full run</div><div className="t-figure mt-1" style={{ fontSize: 21.5 }}>{ct.ward29_full_run_gpu_minutes} <span className="t-small ink3">GPU min</span></div></div>
        <div><div className="t-micro">Street View image</div><div className="t-figure mt-1" style={{ fontSize: 21.5 }}>${ct.street_view_price_usd_per_image} <span className="t-small ink3">each</span></div></div>
        {!measured && gen?.vlm_usd != null && <div><div className="t-micro">This area · VLM cost</div><div className="t-figure mt-1" style={{ fontSize: 21.5 }}>${gen.vlm_usd}</div></div>}
      </div>
      <div className="mt-4 max-w-[640px] rounded-[var(--ns-r-control)] px-3 py-2 opacity-70" style={{ boxShadow: 'inset 0 0 0 1px var(--ns-line-strong)' }} aria-label="Resumed run counters, not representative">
        <div className="flex items-center justify-between gap-2"><span className="t-small">This area’s own run counters</span><span className="tag">{detail.cost.run_stats_badge}</span></div>
        <div className="t-data ink2 mt-1">VLM {usd(run.vlm_cost_usd)} · {run.vlm_calls != null ? plural(run.vlm_calls, 'call') : '— calls'} · {run.total_minutes ?? '—'} min · {run.street_view_requests ?? '—'} Street View requests</div>
      </div>
    </section>
  )
}
