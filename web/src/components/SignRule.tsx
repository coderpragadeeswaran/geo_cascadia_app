/** P7.4: the sign-linking rule on Trust, in plain words, with its Google-pin check (model_card.sign_links) and a spot-check
 *  of random sign moves. The AI first pass (Claude Code looked at each photo) is labelled as such, never as a human check;
 *  the spot-check below lets a person redo it: one sample at a time (each photo is one billed Street View image), with the
 *  sign box, a plan of the old and new outline and the sign's line of sight, and right / wrong / can't tell buttons
 *  (kept in this browser only). */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/api/client'
import { cn, fmt } from '@/lib/utils'
import { EvidencePhoto } from './EvidencePhoto'
import { Boxes } from './EvidenceViews'

type Outline = { id: string; ring: [number, number][]; pin: [number, number] } | null
export interface SpotSample { n: number; crop: string; pano_id: string; heading: number; pitch: number; fov: number
  box: { x1: number; y1: number; x2: number; y2: number }; conf: number; camera: [number, number]; bearing: number
  dist_m: number | null; old: Outline; new: Outline; old_id: string | null; new_id: string | null }
type Verdict = 'right' | 'wrong' | 'cant_tell'
interface SignLinks {
  model_card: { rule: string; margin_deg: number; note: string; source: string
    ward29: { sign_crops: number; moved: number; read_moved: number
      google_check: { moved_read_signs_with_google_pin: number; closer: number; further: number; same_within_1m: number; to_or_from_no_outline: number; median_change_m: number } } } | null
  spotcheck: { seed: number; moves_total: number; samples: SpotSample[] } | null
  ai_check: { who: string; date: string; counts: Record<Verdict, number>; not_shop_signs: number; method: string
    rows: { n: number; verdict: Verdict; why: string; shop_sign: boolean }[] } | null
}
const WORD: Record<Verdict, string> = { right: 'Move looks right', wrong: 'Move looks wrong', cant_tell: 'Can’t tell' }
const STORE = 'signSpotcheck.v1'

const readHuman = (): Record<number, Verdict> => { try { return JSON.parse(localStorage.getItem(STORE) ?? '{}') } catch { return {} } }

const useSignLinks = () => useQuery({ queryKey: ['trust-sign-links'], queryFn: () => api<SignLinks>('/trust/sign-links'), staleTime: 60_000 })

/** P7 R3 (A4): what the sign spot-check found about the detector's sign boxes themselves (no retraining; said as found) */
export function SignBoxNote() {
  const { data } = useSignLinks()
  const ai = data?.ai_check, n = data?.spotcheck?.samples.length
  if (!ai || !n) return null
  return (
    <p className="t-small ink2 mt-3 max-w-[760px]">
      <b>Sign boxes are not always shop signs.</b> In a {n}-photo check, {ai.not_shop_signs} of the {n} boxes counted as signs weren’t shop signs (billboards, a gate, a house number, a STOP sign, a pole poster). {ai.who}; the detector was not retrained. <button className="link" onClick={() => document.getElementById('signs')?.scrollIntoView({ block: 'start' })}>See the check</button>
    </p>
  )
}

export function SignRule() {
  const { data, isPending, isError } = useSignLinks()
  const [open, setOpen] = useState(false)
  if (isPending) return <div className="h-24 animate-pulse rounded-[var(--ns-r-control)] bg-line" />
  if (isError || !data?.model_card) return <p className="t-small ink2">The sign-linking check is not in the model card.</p>
  const m = data.model_card, w = m.ward29, g = w.google_check, ai = data.ai_check
  return (
    <div className="space-y-4">
      <p className="t-body max-w-[760px]">A shop sign belongs to the building its own line of sight points at: the line from the camera through the sign in the photo. A sign is moved off the building the photo was aimed at only when that line, and the lines {m.margin_deg}° either side of it, all reach the same other building and none touches the aimed one.</p>
      <dl className="t-small grid max-w-[760px] grid-cols-[220px_1fr] gap-y-1">
        <dt className="ink3">Ward 29 sign boxes</dt><dd><span className="t-data">{fmt.format(w.sign_crops)}</span>, of which <span className="t-data">{fmt.format(w.moved)}</span> moved to another building (or to / from none)</dd>
        <dt className="ink3">Checked against Google</dt><dd>{fmt.format(g.moved_read_signs_with_google_pin)} moved signs whose name matches a Google Maps business: the new building is <b>closer</b> to Google’s pin for <span className="t-data">{g.closer}</span>, <b>further</b> for <span className="t-data">{g.further}</span>, the same for <span className="t-data">{g.same_within_1m}</span>; <span className="t-data">{g.to_or_from_no_outline}</span> moved to or from no building (not measured). Median change: {Math.abs(g.median_change_m)} m {g.median_change_m < 0 ? 'closer' : 'further'}.</dd>
        <dt className="ink3">How far to trust it</dt><dd className="ink2">{m.note}</dd>
      </dl>
      {ai && (
        <div className="max-w-[760px] rounded-[var(--ns-r-control)] p-3" style={{ boxShadow: 'inset 0 0 0 1px var(--ns-sodium)' }}>
          <div className="t-micro" style={{ color: 'var(--ns-sodium)' }}>{ai.who}</div>
          <p className="t-small mt-1">{data.spotcheck?.samples.length ?? 20} random sign moves (of {fmt.format(data.spotcheck?.moves_total ?? w.moved)}) looked at once each: <b>{ai.counts.right}</b> move looks right · <b>{ai.counts.wrong}</b> looks wrong · <b>{ai.counts.cant_tell}</b> can’t tell. {ai.not_shop_signs} of the boxes are not shop signs at all (billboards, a gate, a house number, a traffic sign, a pole poster).</p>
          <p className="t-small ink3 mt-1">{ai.method}. A person should redo it: <button className="link" onClick={() => setOpen(true)}>open the spot-check</button>.</p>
        </div>
      )}
      {open && data.spotcheck && <SpotCheck samples={data.spotcheck.samples} ai={ai?.rows ?? []} onClose={() => setOpen(false)} />}
      <p className="t-small ink3">Source: {m.source}.</p>
    </div>
  )
}

/** plan of one sample: old outline (grey), new outline (orange), camera, the photo's aim and the sign's line of sight */
export function SpotPlan({ s }: { s: SpotSample }) {
  const [lon0, lat0] = s.camera
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540, k = 4                     // 4 px per metre
  const P = ([lo, la]: [number, number]) => `${(150 + (lo - lon0) * kx * k).toFixed(1)},${(150 - (la - lat0) * ky * k).toFixed(1)}`
  const ray = (b: number, len: number) => `${(150 + Math.sin((b * Math.PI) / 180) * len * k).toFixed(1)},${(150 - Math.cos((b * Math.PI) / 180) * len * k).toFixed(1)}`
  return (
    <svg viewBox="0 0 300 300" className="aspect-square w-full rounded-[var(--ns-r-control)]" style={{ background: 'var(--ns-bg2)' }} role="img"
      aria-label={`Plan: the building the photo was aimed at (grey) and the one the sign's line of sight reaches (orange)`}>
      {s.old && <polygon points={s.old.ring.map(P).join(' ')} fill="none" stroke="var(--ns-ink3)" strokeWidth="2" />}
      {s.new && <polygon points={s.new.ring.map(P).join(' ')} fill="none" stroke="var(--ns-sodium)" strokeWidth="2.5" />}
      <polyline points={`150,150 ${ray(s.heading, 40)}`} stroke="var(--ns-ink3)" strokeDasharray="4 4" strokeWidth="1.5" />
      <polyline points={`150,150 ${ray(s.bearing, 40)}`} stroke="var(--ns-sodium)" strokeWidth="1.5" />
      <circle cx="150" cy="150" r="4.5" fill="#4fa3ff" />
      <text x="6" y="292" fontSize="11" fill="var(--ns-ink3)">grey: aimed at · orange: the sign’s line of sight · 4 px = 1 m</text>
    </svg>
  )
}

function SpotCheck({ samples, ai, onClose }: { samples: SpotSample[]; ai: { n: number; verdict: Verdict; why: string }[]; onClose: () => void }) {
  const [i, setI] = useState(0)
  const [human, setHuman] = useState<Record<number, Verdict>>(readHuman)
  const [showAi, setShowAi] = useState(false)
  const s = samples[i]
  const mark = (v: Verdict) => {
    const next = { ...human, [s.n]: v }
    setHuman(next)
    try { localStorage.setItem(STORE, JSON.stringify(next)) } catch { /* private window: kept for this visit only */ }
    if (i < samples.length - 1) setI(i + 1)
  }
  const tally = (['right', 'wrong', 'cant_tell'] as Verdict[]).map((v) => [v, Object.values(human).filter((x) => x === v).length] as const)
  const a = ai.find((r) => r.n === s.n)
  return (
    <section id="sign-spotcheck" className="rounded-[var(--ns-r-sheet)] p-4" style={{ boxShadow: 'inset 0 0 0 1px var(--ns-line-strong)' }} aria-label="Sign move spot-check">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="t-title">Spot-check: sign {s.n} of {samples.length}</h4>
        <span className="t-small ink2">Your check: {tally.map(([v, n]) => `${n} ${WORD[v].toLowerCase()}`).join(' · ')} ({Object.keys(human).length} of {samples.length} done, kept in this browser)</span>
        <div className="flex-1" />
        <button className="btn" onClick={onClose}>Close</button>
      </div>
      <p className="t-small ink2 mt-1">Is the orange-boxed sign on the building the orange line reaches, rather than the one the photo was aimed at (grey)? Each photo loads one Street View image.</p>
      <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
        <EvidencePhoto view={s} label={`Sign ${s.n} · ${Math.round(s.heading)}°`}>
          <Boxes boxes={[{ cls: 'signboard', conf: s.conf, ...s.box, geom_ok: true, target: true }]} all={false} hidden={new Set()} targetName="This sign" />
        </EvidencePhoto>
        <div className="space-y-2">
          <SpotPlan s={s} />
          <p className="t-small ink3">Aimed at: {s.old_id ?? 'no building outline'} · line of sight reaches: {s.new_id ?? 'no building outline'}{s.dist_m != null ? ` (${s.dist_m} m)` : ''}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(['right', 'wrong', 'cant_tell'] as Verdict[]).map((v) => (
          <button key={v} className={cn('btn', human[s.n] === v ? 'btn-solid' : 'btn-line')} onClick={() => mark(v)} aria-pressed={human[s.n] === v}>{WORD[v]}</button>
        ))}
        <div className="flex-1" />
        <button className="btn" disabled={i === 0} onClick={() => setI(i - 1)}>Previous</button>
        <button className="btn" disabled={i === samples.length - 1} onClick={() => setI(i + 1)}>Next</button>
      </div>
      <p className="t-small ink3 mt-2">
        <button className="link" onClick={() => setShowAi(!showAi)}>{showAi ? 'Hide' : 'Show'} the AI visual check for this sign</button>
        {showAi && a && <> · AI visual check (Claude Code), not a human check: <b>{WORD[a.verdict]}</b>: {a.why}</>}
      </p>
    </section>
  )
}
