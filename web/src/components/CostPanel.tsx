/** Cost panel (§10 test 6): routed vs all-VLM cost AND accuracy, every number from model_card.json (D1/D2).
 *  Run counters of this area come from a resumed run → shown greyed with the "resumed run, not representative" badge. */
import { useAreaDetail, useModelCard } from '@/api/queries'
import { useUi } from '@/store/ui'

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
const pct = (v: unknown) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : '—')
const usd = (v: unknown) => (typeof v === 'number' ? `$${v < 0.01 ? v.toFixed(4) : v.toFixed(3)}` : '—')

function Pair({ label, routed, all, fmtV, better }: { label: string; routed: number; all: number; fmtV: (v: number) => string; better: 'lower' | 'higher' }) {
  const max = Math.max(routed, all) || 1
  const Row = ({ name, v, strong }: { name: string; v: number; strong?: boolean }) => (
    <div className="grid grid-cols-[62px_1fr_auto] items-center gap-2 text-[11.5px]">
      <span className="text-muted">{name}</span>
      <span className="h-2 overflow-hidden rounded-full bg-hover"><span className={`block h-full rounded-r-[4px] ${strong ? 'bg-accent' : 'bg-unclassified/70'}`} style={{ width: `${(v / max) * 100}%` }} /></span>
      <span className="tnum font-semibold">{fmtV(v)}</span>
    </div>
  )
  const win = better === 'lower' ? routed <= all : routed >= all
  return (
    <div className="space-y-1">
      <div className="text-[11.5px] font-medium">{label}</div>
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
    <section className="rounded-xl border border-glass-border px-3 pb-3 pt-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12.5px] font-semibold">Cost & accuracy: routed vs all-VLM</h3>
        <span className="rounded-md bg-hover px-1.5 py-0.5 text-[10px] font-semibold text-muted">from model_card</span>
      </div>
      <p className="mb-2 text-[11px] leading-snug text-faint">Measured on Ward 29 by the team. Routing sends only uncertain cases to the VLM.</p>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Pair label="Building use · VLM spend (Ward 29)" routed={ct.ward29_vlm_usd_with_router} all={ct.ward29_vlm_usd_without_router} fmtV={usd} better="lower" />
          <p className="text-[11px] leading-snug text-fg/80">
            Accuracy unchanged: {pct(bu.local_router.full_ward29_run.use_accuracy_before)} → {pct(bu.local_router.full_ward29_run.use_accuracy_after)} (n={bu.local_router.full_ward29_run.n});
            held-out routed {pct(bu.local_router.ward29_heldout.routed)} vs VLM-only {pct(bu.local_router.ward29_heldout.vlm_only)} (n={bu.local_router.ward29_heldout.n}).
            VLM calls {bu.local_router.full_ward29_run.vlm_calls_before} → {bu.local_router.full_ward29_run.vlm_calls_after}.
          </p>
        </div>
        <div className="space-y-1.5">
          <Pair label="Business names · VLM spend" routed={ct.names_routed_vs_all_vlm_usd.routed} all={ct.names_routed_vs_all_vlm_usd.all_vlm_every_view} fmtV={usd} better="lower" />
          <Pair label="Business names · accuracy (crop level, n=31)" routed={nm.crop_level_n31.routed_ocr_then_vlm} all={nm.crop_level_n31.all_vlm} fmtV={pct} better="higher" />
          <p className="text-[11px] leading-snug text-fg/80">Full street views (n=16): routed {pct(nm.full_view_n16.routed)} vs all-VLM {pct(nm.full_view_n16.all_vlm_per_view)}, at {nm.full_view_n16.cost_ratio} the cost for all-VLM.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11.5px]">
          <div className="rounded-lg bg-hover px-2 py-1.5"><div className="text-muted">Ward 29 full run</div><div className="tnum font-semibold">{ct.ward29_full_run_gpu_minutes} GPU min</div></div>
          <div className="rounded-lg bg-hover px-2 py-1.5"><div className="text-muted">Street View image</div><div className="tnum font-semibold">${ct.street_view_price_usd_per_image} each</div></div>
        </div>
        {!measured && (
          <p className="text-[11px] leading-snug text-muted">
            Cost is measured for Ward 29 only.{gen?.vlm_usd != null && <> For this area model_card records VLM cost <b className="tnum text-fg/85">${gen.vlm_usd}</b>.</>}
          </p>
        )}
        <div className="rounded-lg border border-dashed border-glass-border px-2.5 py-2 opacity-60" aria-label="Resumed run counters, not representative">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium">This run’s own counters</span>
            <span className="rounded bg-[rgb(245_165_36/0.15)] px-1.5 py-0.5 text-[10px] font-semibold text-discrepancy">{detail.cost.run_stats_badge}</span>
          </div>
          <div className="tnum text-[11px] text-muted">VLM {usd(run.vlm_cost_usd)} · {run.vlm_calls ?? '—'} calls · {run.total_minutes ?? '—'} min · {run.street_view_requests ?? '—'} SV requests</div>
        </div>
      </div>
    </section>
  )
}
