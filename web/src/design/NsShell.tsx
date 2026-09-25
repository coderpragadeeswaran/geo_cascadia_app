/** App-shell mock (Night Survey): the map is home (Explore + Analyse are modes of the map; at most one panel), and a
 *  slim left rail reaches Review, Under the Hood, Trust and Jobs. All screens use real data. */
import { useQuery } from '@tanstack/react-query'
import { Activity, Inbox, ListChecks, Map as MapIcon, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/api/client'
import { useAreas, useConfig, useModelCard } from '@/api/queries'
import type { JobPreview } from '@/api/types'
import type { Records } from '@/lib/derive'
import type { Split } from '@/map/layers'
import { NsAnalyseSheet, NsFindingsTable, NsKpis, NsTopBar, Status } from './NsParts'
import { NsStory } from './NsStory'
import type { Mode } from './tokens'

type Screen = 'explore' | 'review' | 'hood' | 'trust' | 'jobs'
const RAIL: { k: Screen; label: string; Icon: typeof MapIcon }[] = [
  { k: 'explore', label: 'Explore', Icon: MapIcon }, { k: 'review', label: 'Review', Icon: Inbox },
  { k: 'hood', label: 'Under the hood', Icon: Activity }, { k: 'trust', label: 'Trust', Icon: ShieldCheck }, { k: 'jobs', label: 'Jobs', Icon: ListChecks },
]
type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
const pct = (v: unknown) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : String(v ?? '—'))

export function NsShell({ mode, records, split, renderMap, analysePreview }: {
  mode: Mode; records: Records | null; split: Split | null
  renderMap: (opts: { coverage: boolean }) => React.ReactNode; analysePreview: JobPreview | undefined }) {
  const [screen, setScreen] = useState<Screen>('explore')
  return (
    <div className="grid h-full grid-cols-[64px_1fr]">
      <nav className="surface rule-l flex flex-col items-center gap-1 py-3" style={{ borderLeft: 'none', borderRight: '1px solid var(--ns-line)' }} aria-label="Sections">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden className="mb-4"><path d="M16 2 29 9.5v13L16 30 3 22.5v-13z" fill="none" stroke="var(--ns-sodium)" strokeWidth="2.4" /><circle cx="16" cy="16" r="4" fill="var(--ns-sodium)" /></svg>
        {RAIL.map(({ k, label, Icon }) => (
          <button key={k} onClick={() => setScreen(k)} aria-current={screen === k ? 'page' : undefined} title={label}
            className="relative flex w-full cursor-pointer flex-col items-center gap-1 py-2.5" style={{ color: screen === k ? 'var(--ns-ink)' : 'var(--ns-ink3)' }}>
            {screen === k && <span className="absolute left-0 top-2 bottom-2 w-[2px]" style={{ background: 'var(--ns-sodium)' }} />}
            <Icon className="size-[18px]" strokeWidth={1.6} />
            <span className="text-[9.5px] leading-none" style={{ fontStretch: '85%', fontWeight: 560 }}>{label.split(' ').slice(-1)[0] === 'hood' ? 'Hood' : label}</span>
          </button>
        ))}
      </nav>
      <div className="relative min-h-0 overflow-hidden">
        {screen === 'explore' && <Explore mode={mode} records={records} split={split} renderMap={renderMap} preview={analysePreview} />}
        {screen === 'review' && <Review records={records} />}
        {screen === 'hood' && <div className="h-full overflow-y-auto px-10 py-8"><div className="t-micro mb-1">Under the hood · Ward 29</div><h3 className="t-display mb-8">How 733 panoramas became 260 decisions</h3><NsStory records={records} /></div>}
        {screen === 'trust' && <Trust />}
        {screen === 'jobs' && <Jobs />}
      </div>
    </div>
  )
}

function Explore({ mode, records, split, renderMap, preview }: { mode: Mode; records: Records | null; split: Split | null; renderMap: (o: { coverage: boolean }) => React.ReactNode; preview: JobPreview | undefined }) {
  const [analyse, setAnalyse] = useState(false)
  const [panel, setPanel] = useState(true)
  const [fx, setFx] = useState<{ x: number; y: number } | null>(null)
  const [picked, setPicked] = useState(false)
  return (
    <div className="absolute inset-0" onMouseMove={analyse ? (e) => { const r = e.currentTarget.getBoundingClientRect(); setFx({ x: e.clientX - r.left, y: e.clientY - r.top }) } : undefined}
      onClick={analyse ? () => setPicked(true) : undefined}>
      {split && renderMap({ coverage: analyse })}
      {analyse && <div className="flashlight" style={{ '--fx': `${fx?.x ?? -999}px`, '--fy': `${fx?.y ?? -999}px` } as React.CSSProperties} />}
      <div className="scrim-top pointer-events-none absolute inset-x-0 top-0 pb-8 [&>*]:pointer-events-auto" style={{ right: panel && !analyse ? 380 : 0 }}>
        <NsTopBar area="Ward 29, Coimbatore" mode={mode} analyse={analyse} onAnalyse={() => { setAnalyse(!analyse); setPicked(false) }} />
        {records && !analyse && <div className="pt-1"><NsKpis records={records} /></div>}
      </div>
      {!analyse && panel && records && (
        <aside className="surface rule-l absolute bottom-0 right-0 top-0 flex w-[380px] flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-4 pb-2 pt-4"><span className="t-micro">No register record · 19</span><button className="btn" onClick={() => setPanel(false)}>Close</button></div>
          <div className="min-h-0 flex-1 overflow-y-auto"><NsFindingsTable rows={records.buildings.filter((b) => b.match_status === 'no_record')} /></div>
        </aside>
      )}
      {!analyse && !panel && <button className="btn btn-sodium absolute right-4 top-[120px]" onClick={(e) => { e.stopPropagation(); setPanel(true) }}>Findings</button>}
      {analyse && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
          {picked && preview ? <div className="pointer-events-auto" onClick={(e) => e.stopPropagation()}><NsAnalyseSheet p={preview} /></div>
            : <p className="t-small sheet px-4 py-2.5">Move over a street with Street View coverage and click it.</p>}
        </div>
      )}
    </div>
  )
}

function Review({ records }: { records: Records | null }) {
  const { data: cfg } = useConfig()
  const rows = (records?.review ?? []).slice().sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9)).slice(0, 14)
  const [i, setI] = useState(0)
  const cur = rows[i]
  const b = cur && cur.item_type === 'building' ? records?.buildings.find((x) => x.id === cur.ref_id) : undefined
  const v = b?.evidence?.attribute_view
  return (
    <div className="grid h-full grid-cols-[320px_1fr_300px]">
      <ol className="surface min-h-0 overflow-y-auto" style={{ borderRight: '1px solid var(--ns-line)' }}>
        <li className="t-micro px-4 py-3 rule-b">Queue · {records?.review.length ?? 0} items · highest priority first</li>
        {rows.map((r, k) => (
          <li key={`${r.item_type}${r.ref_id}`}><button onClick={() => setI(k)} className="w-full cursor-pointer px-4 py-2.5 text-left rule-b" style={{ background: k === i ? 'var(--ns-sodium-soft)' : undefined }}>
            <div className="flex justify-between"><span className="t-data">{r.ref_id}</span><span className="t-data ink3">P{r.priority}</span></div>
            <div className="t-small ink2 truncate">{r.reasons[0]}</div>
          </button></li>
        ))}
      </ol>
      <div className="flex min-h-0 items-center justify-center p-8" style={{ background: 'var(--ns-bg0)' }}>
        {cfg && v ? (
          <figure className="relative aspect-square h-full max-h-[560px]" style={{ borderRadius: 'var(--ns-r-control)', overflow: 'hidden' }}>
            <img alt="Evidence" className="absolute inset-0 size-full object-cover" src={`https://maps.googleapis.com/maps/api/streetview?size=640x640&pano=${encodeURIComponent(v.pano_id)}&heading=${v.heading}&pitch=${v.pitch ?? 0}&fov=${v.fov ?? 90}&key=${encodeURIComponent(cfg.maps_js_key)}`} />
            <svg viewBox="0 0 640 640" className="absolute inset-0 size-full">{v.x1 != null && <rect x={v.x1} y={v.y1!} width={v.x2! - v.x1} height={v.y2! - v.y1!} fill="none" stroke="var(--ns-sodium)" strokeWidth="3" />}</svg>
          </figure>
        ) : <p className="t-small ink3">{cur?.item_type === 'asset' ? 'Asset evidence: aimed view (no box stored).' : 'No evidence view.'}</p>}
      </div>
      <div className="surface flex flex-col gap-3 p-5" style={{ borderLeft: '1px solid var(--ns-line)' }}>
        {cur && <>
          <div className="t-micro">{cur.item_type} · priority {cur.priority}</div>
          <div className="t-title">{cur.street}</div>
          {b && <Status s={b.match_status} />}
          <ul className="t-small ink2 list-disc pl-4">{cur.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
          <div className="mt-auto grid gap-1.5">
            {[['A', 'Approve'], ['R', 'Reject'], ['E', 'Appeal with note / photo']].map(([k, l]) => (
              <button key={k} className="btn justify-between" style={{ border: '1px solid var(--ns-line-strong)' }}><span>{l}</span><span className="t-data ink3">{k}</span></button>
            ))}
            <p className="t-data ink3 mt-1">J / K next · previous</p>
          </div>
        </>}
      </div>
    </div>
  )
}

function Trust() {
  const { data } = useModelCard()
  const m = data as Any
  if (!m) return null
  const cls = m.detector.per_class as Record<string, { P: number; R: number; n: number }>
  return (
    <div className="h-full overflow-y-auto px-10 py-8">
      <div className="t-micro">Trust · every number from model_card.json</div>
      <h3 className="t-display mt-2 mb-8">What we measured, and what we dropped</h3>
      <div className="grid gap-10 lg:grid-cols-2">
        <section>
          <div className="t-title mb-3">Detector · {m.detector.production.split(' (')[0]}</div>
          {Object.entries(cls).map(([k, v]) => (
            <div key={k} className="grid grid-cols-[110px_1fr_170px] items-center gap-3 py-1.5 rule-b">
              <span className="t-small">{k.replace('_', ' ')}</span>
              <span className="relative h-2"><span className="absolute inset-y-0 left-0" style={{ width: `${v.R * 100}%`, background: 'var(--ns-sodium)', borderRadius: '0 3px 3px 0' }} /></span>
              <span className="t-data ink2 text-right">P {pct(v.P)} · R {pct(v.R)} · n {v.n}</span>
            </div>
          ))}
          <div className="mt-6 grid grid-cols-3 gap-4">
            {[['Use', pct(m.building_use.vlm_accuracy.value), `n ${m.building_use.vlm_accuracy.n}`], ['Floors exact', pct(m.floors.ward29.exact), `±1: ${pct(m.floors.ward29.within_1)} · n ${m.floors.ward29.n}`],
              ['Names routed', pct(m.names.crop_level_n31.routed_ocr_then_vlm), `all-VLM ${pct(m.names.crop_level_n31.all_vlm)} · n 31`]].map(([k, v, s]) => (
              <div key={k}><div className="t-micro">{k}</div><div className="t-figure mt-1">{v}</div><div className="t-data ink3 mt-1">{s}</div></div>
            ))}
          </div>
        </section>
        <section>
          <div className="t-title mb-3">Tried and dropped</div>
          <ul>
            {[['VLM lamp check', m.streetlights.vlm_lamp_check], ['Floors: other prompts', m.floors.rejected_variants.join(' · ')], ['Facade condition', m.withheld.facade_condition],
              ['Door numbers', m.withheld.door_numbers], ['Google Places as a use signal', `${pct(m.building_use.google_places_as_use_signal.value)} (n ${m.building_use.google_places_as_use_signal.n}) → ${m.building_use.google_places_as_use_signal.decision}`],
              ['YOLO26s', m.detector.benchmark.find((x: Any) => x.model === 'YOLO26s')?.downstream]].map(([k, v]) => (
              <li key={k} className="grid grid-cols-[170px_1fr] gap-3 py-2 rule-b"><span className="t-small">{k}</span><span className="t-small ink2">{v}</span></li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

function Jobs() {
  const { data: areas } = useAreas()
  const { data: jobs } = useQuery({ queryKey: ['ns-jobs'], queryFn: () => api<{ jobs: unknown[]; worker_online: boolean }>('/jobs') })
  return (
    <div className="h-full overflow-y-auto px-10 py-8">
      <div className="t-micro">Jobs</div>
      <h3 className="t-display mt-2 mb-6">Analyses</h3>
      <p className="t-small ink2 mb-6">Worker {jobs?.worker_online ? 'online' : 'offline'} · {jobs?.jobs.length ? `${jobs.jobs.length} analyses from this app` : 'no analyses started from this app yet'}.</p>
      <div className="t-micro mb-2">Pre-computed runs</div>
      {areas?.map((a) => (
        <div key={a.slug} className="grid grid-cols-[1fr_120px_120px_1.4fr] items-baseline gap-4 py-3 rule-b">
          <span>{a.name.replace(/^Unseen street: /, '')}</span>
          <span className="t-data">{a.counts.buildings} buildings</span>
          <span className="t-data">{a.counts.assets} assets</span>
          <span className="t-small ink3 truncate" title={a.coverage_verdict ?? ''}>{a.coverage_verdict}</span>
        </div>
      ))}
    </div>
  )
}
