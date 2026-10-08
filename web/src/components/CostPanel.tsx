/** Routed vs all-VLM: cost, accuracy AND time (§10 test 6; D65: measured on this run), every number from model_card.json (D1/D2). Lives on the Trust page
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
  const mr = bu.local_router.measured_ward29_n30, lat = mc.latency_per_item
  if (!mr) return null
  const measured = !!detail.cost.model_card
  const gen = mc.generalisation?.[area ?? '']
  const run = detail.cost.run_stats as Any
  return (
    <section aria-label="Cost and accuracy: routed vs all-VLM">
      <p className="t-small ink2 mb-4 max-w-[640px]">Routing sends only uncertain cases to the vision-language model (Nova Lite). Building use and floors: measured on {mr.n} of this Ward 29 run’s buildings ({mr.decided_locally} decided by the local model), labelled by viewing the photos (an AI check). Shop names: measured on earlier labelled photos. All numbers come from the team’s model card.</p>
      <div className="grid gap-8 md:grid-cols-2">
        <div className="space-y-3">
          <Pair label={`Building use · cloud $ per building (n=${mr.n})`} routed={mr.routed.usd_per_building} all={mr.all_cloud.usd_per_building} fmtV={(v) => usd4(v, 6)} better="lower" />
          <Pair label={`Building use · right (n=${mr.n})`} routed={mr.routed.use_accuracy} all={mr.all_cloud.use_accuracy} fmtV={pct} better="higher" />
          <Pair label={`Use + floors · seconds per building (n=${mr.n})`} routed={mr.routed.s_per_building} all={mr.all_cloud.s_per_building} fmtV={(v) => `${v.toFixed(2)} s`} better="lower" />
          <p className="t-small ink2">Floors (the same call either way): {pct(mr.routed.floors_exact)} exact, {pct(mr.routed.floors_within_1)} within one. Cloud calls for the {mr.n}: {mr.routed.cloud_calls} routed vs {mr.all_cloud.cloud_calls}.
            Earlier labelled photos: routed {pct(bu.local_router.ward29_heldout.routed)} vs VLM-only {pct(bu.local_router.ward29_heldout.vlm_only)} (n={bu.local_router.ward29_heldout.n}).</p>
        </div>
        <div className="space-y-3">
          <Pair label="Shop names · VLM spend" routed={ct.names_routed_vs_all_vlm_usd.routed} all={ct.names_routed_vs_all_vlm_usd.all_vlm_every_view} fmtV={usd} better="lower" />
          <Pair label="Shop names · accuracy (earlier labelled photos, n=31)" routed={nm.crop_level_n31.routed_ocr_then_vlm} all={nm.crop_level_n31.all_vlm} fmtV={pct} better="higher" />
          <p className="t-small ink2">Full street views (earlier labelled photos, n=16): routed {pct(nm.full_view_n16.routed)} vs all-VLM {pct(nm.full_view_n16.all_vlm_per_view)}, at {nm.full_view_n16.cost_ratio} the cost for all-VLM.</p>
        </div>
      </div>
      {lat && <div className="mt-5">
        <div className="t-micro mb-1">Time per item · {lat.machine} · measured {lat.measured}</div>
        <table className="w-full max-w-[640px]" aria-label="Time per item by route"><tbody>
          {lat.rows.map((x: Any) => (
            <tr key={x.step} className="rule-b"><td className="t-small py-1 pr-3">{x.step} <span className="ink3">· {x.model}</span></td>
              <td className="t-small py-1 pr-3"><span className="tag">{x.route}</span></td>
              <td className="t-data py-1 text-right">{x.s == null ? '—' : x.s < 1 ? `${Math.round(x.s * 1000)} ms` : `${x.s.toFixed(2)} s`}<span className="ink3"> / {x.unit}</span></td></tr>))}
        </tbody></table>
        <p className="t-small ink3 mt-1">Median over the sample's photos; the local models run on the server’s GPU, the cloud calls go to AWS Bedrock.</p>
      </div>}
      <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2">
        <div><div className="t-micro">Ward 29 full run (server GPU)</div><div className="t-figure mt-1" style={{ fontSize: 21.5 }}>{ct.ward29_full_run_gpu_minutes} <span className="t-small ink3">min{ct.ward29_full_run_images ? ` · ${ct.ward29_full_run_images.toLocaleString()} photos` : ''}</span></div></div>
        {ct.ward29_vlm_usd_run != null && <div><div className="t-micro">Ward 29 full run · cloud AI</div><div className="t-figure mt-1" style={{ fontSize: 21.5 }}>{usd(ct.ward29_vlm_usd_run)} <span className="t-small ink3">{ct.ward29_vlm_calls_run} calls</span></div></div>}
        <div><div className="t-micro">Street View image</div><div className="t-figure mt-1" style={{ fontSize: 21.5 }}>${ct.street_view_price_usd_per_image} <span className="t-small ink3">each</span></div></div>
        {!measured && gen?.vlm_usd != null && <div><div className="t-micro">This area · VLM cost</div><div className="t-figure mt-1" style={{ fontSize: 21.5 }}>${gen.vlm_usd}</div></div>}
      </div>
      <div className="mt-4 max-w-[640px] rounded-[var(--ns-r-control)] px-3 py-2 opacity-70" style={{ boxShadow: 'inset 0 0 0 1px var(--ns-line-strong)' }} aria-label="This area's own run counters">
        <div className="flex items-center justify-between gap-2"><span className="t-small">This area’s own run counters</span>{detail.cost.run_stats_badge && <span className="tag">{detail.cost.run_stats_badge}</span>}</div>
        <div className="t-data ink2 mt-1">VLM {usd(run.vlm_cost_usd)} · {run.vlm_calls != null ? plural(run.vlm_calls, 'call') : '— calls'} · {run.total_minutes ?? '—'} min · {run.street_view_requests ?? '—'} Street View requests</div>
      </div>
    </section>
  )
}
