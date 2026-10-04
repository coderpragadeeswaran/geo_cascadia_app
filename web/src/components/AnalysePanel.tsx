/** "Analyse a street" sheet (CLAUDE.md §9.4.1, design pass B §3): a live "asking OpenStreetMap…" state with elapsed
 *  seconds and Cancel; a clear busy message; the confirm sheet with the street's display name, "Already analysed in …"
 *  (Open / Analyse anyway) and an estimate from the pipeline's own camera planner (P7.2) with the job's cost cap; then the job card with honest states (no worker online is
 *  "queued, waiting for a worker", never a spinner). While it runs: the stage in plain words, time so far and an honest
 *  time left (the device's estimate minus elapsed); a cost-cap pause offers Approve / Cancel; when done the map flies to
 *  the new area. The exact snapped street is drawn on the map while the sheet is open. */
import { useQueryClient } from '@tanstack/react-query'
import { useMap } from '@vis.gl/react-google-maps'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { JobEstimate, PlanStatus } from '@/api/p5'
import { post, useAreas } from '@/api/queries'
import { deviceWord, JOB_STAGES, jobStatus, minutesParts, planSlowText, planTooSlow, shortArea, STAGE_PLAIN, stageLine, timeLeft } from '@/lib/labels'
import { fmt, noun } from '@/lib/utils'
import { pickedLines, streetKey, useAnalyse } from '@/map/analyse'
import { flyToBounds } from '@/map/MapView'
import { mainLine, MIN_STRETCH_M, slice } from '@/map/trim'
import { useUi } from '@/store/ui'

const STAGES = JOB_STAGES
const card = 'sheet pointer-events-auto w-[min(470px,92vw)] px-5 py-4'


/** P7.2: the estimate for what will be analysed, from the pipeline's own camera planner. The preview starts planning the
 *  whole street; a trimmed stretch is planned again (debounced) while the end dots move. Planning runs on the backend
 *  (free Street View metadata calls + OpenStreetMap), so the sheet polls it and keeps the last finished estimate,
 *  dimmed, meanwhile. Start never waits for it. */
function usePlanEstimate() {
  const preview = useAnalyse((s) => s.preview)
  const trim = useAnalyse((s) => s.trim)
  const clickAt = useAnalyse((s) => s.clickAt)
  const include = useAnalyse((s) => s.include && !!s.preview?.elsewhere)
  const [st, setSt] = useState<PlanStatus | null>(null)
  const [last, setLast] = useState<JobEstimate | null>(null)
  const [nonce, setNonce] = useState(0)
  const main = useMemo(() => mainLine(preview?.lines), [preview])
  const stretch = trim && main ? slice(main, Math.round(trim.a), Math.round(trim.b)) : null
  const stretchKey = stretch ? JSON.stringify(stretch) : null
  useEffect(() => { setLast(null) }, [preview])
  // which planning to follow: the preview's (whole street) or a trimmed stretch's
  useEffect(() => {
    if (!preview) { setSt(null); return }
    if ((!stretchKey && !include) || !clickAt) { setSt(nonce ? null : preview.plan_estimate); if (!nonce) return }
    let off = false
    const t = setTimeout(() => {
      // D57: both pieces included → the backend plans the clicked piece + the rest of the name (no trim then)
      post<PlanStatus>('/jobs/plan-estimate', { lat: clickAt!.lat, lon: clickAt!.lng, ...(include ? { include_elsewhere: true } : {}),
        ...(stretchKey && !include ? { lines: { type: 'LineString', coordinates: JSON.parse(stretchKey) } } : {}) })
        .then((r) => { if (!off) setSt(r) }).catch(() => { if (!off) setSt({ key: '', status: 'failed', error: 'Could not plan this stretch.' }) })
    }, stretchKey ? 600 : 0)
    return () => { off = true; clearTimeout(t) }
  }, [preview, stretchKey, clickAt, nonce, include])
  // poll while planning
  useEffect(() => {
    if (st?.status === 'done' && st.estimate) setLast(st.estimate)
    if (st?.status !== 'running' || !st.key || planTooSlow(st)) return      // F3: stop waiting after PLAN_WAIT_S
    const t = setTimeout(() => {
      api<PlanStatus>(`/jobs/plan-estimate/${st.key}`).then((r) => setSt((cur) => (cur?.key === r.key ? r : cur))).catch(() => {})
    }, 1500)
    return () => clearTimeout(t)
  }, [st])
  return { st, est: st?.status === 'done' ? st.estimate ?? null : last, busy: st?.status === 'running' && !planTooSlow(st),
    slow: planTooSlow(st), retry: () => setNonce((n) => n + 1) }
}

/** P7.2: the job's cost cap (default from the backend, $2). Above it the worker pauses the job for approval before any
 *  photo is bought; the estimate says which side of the cap it is on. */
function CostCap({ total, fallback }: { total: number | null; fallback: number }) {
  const cap = useAnalyse((s) => s.cap) ?? fallback
  const [text, setText] = useState(cap.toFixed(2))
  useEffect(() => { setText(cap.toFixed(2)) }, [cap])
  const commit = () => {
    const v = Number(text)
    if (Number.isFinite(v) && v > 0 && v <= 100) useAnalyse.setState({ cap: Math.round(v * 100) / 100 })
    else setText(cap.toFixed(2))
  }
  const over = total != null && total > cap
  return (
    <div className="t-small mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
      <label htmlFor="cost-cap" className="ink2">Cost cap $</label>
      <input id="cost-cap" inputMode="decimal" className="t-data w-[72px] rounded-[var(--ns-r-control)] bg-transparent px-2 py-0.5"
        style={{ boxShadow: 'inset 0 0 0 1px var(--ns-line-strong)' }} value={text} onChange={(e) => setText(e.target.value)}
        onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit() }} aria-describedby="cost-cap-note" />
      <span id="cost-cap-note" className={over ? '' : 'ink3'} style={over ? { color: 'var(--ns-sodium)' } : undefined}>
        {over ? 'Above the cap: it will wait for your approval before any photo is bought.' : 'Above it, the analysis waits for your approval.'}</span>
    </div>
  )
}

/** P7.1: "≈ 3 minutes", "< 1 minute" (never "0") */
function MinutesFigure({ m }: { m: number | null | undefined }) {
  const [v, u] = minutesParts(m)
  return <><dd className="t-figure mt-1" style={{ fontSize: 21.5 }}>{v === '—' ? v : v.startsWith('<') ? v : `≈ ${v}`}</dd><dd className="t-small ink3">{u}</dd></>
}

export function AnalysePanel() {
  const on = useUi((s) => s.analyse)
  const offline = useUi((s) => s.offline)
  const a = useAnalyse()
  const qc = useQueryClient()
  const map = useMap('main')
  const { data: areas } = useAreas()
  const status = a.job?.status
  useEffect(() => {
    if (!status || !['queued', 'running', 'needs_approval', 'expired_token'].includes(status)) return
    const t = setInterval(() => useAnalyse.getState().poll(), 4000)
    return () => clearInterval(t)
  }, [status])
  // done: the new area joins the list, the map flies there and the job card closes (the area's own card takes over)
  const doneSlug = status === 'done' ? a.job?.area_slug ?? null : null
  useEffect(() => {
    if (!doneSlug) return
    let off = false
    qc.invalidateQueries({ queryKey: ['jobs'] })
    qc.refetchQueries({ queryKey: ['areas'] }).then(() => {
      if (off) return
      useUi.getState().setArea(doneSlug)
      useAnalyse.setState({ job: null, preview: null, clickAt: null, estimate: null })
    })
    return () => { off = true }
  }, [doneSlug, qc])

  const leave = () => { useUi.getState().setAnalyse(false); a.reset() }
  const plan = usePlanEstimate()
  const est = plan.est
  const trimmable = (mainLine(a.preview?.lines)?.length ?? 0) >= MIN_STRETCH_M * 2
  const p = a.preview
  const both = a.include && !!p?.elsewhere
  // P7.1: frame the snapped street ONCE when a street is selected, so its highlight is in view above the sheet. Clicking
  // the same street again, trimming it or the estimate arriving never moves the camera; only another street does.
  const fitted = useRef<string | null>(null)
  // D57: the clicked piece is framed as before (the rest of the name is a dashed guide); switching "include it?" on frames
  // both pieces, off frames the clicked piece again
  const key = streetKey(p) && `${streetKey(p)}|${both ? 'both' : 'one'}`
  useEffect(() => {
    if (!key) fitted.current = null
    if (!map || !p?.lines?.coordinates.length || !key || fitted.current === key) return
    fitted.current = key
    const pts = pickedLines(p, both)!.coordinates.flat()
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1])
    // the sheet covers ~300 px at the bottom: frame the street above it so both end dots can be dragged (fix 10)
    flyToBounds(map, [Math.min(...xs) - 0.0003, Math.min(...ys) - 0.0003, Math.max(...xs) + 0.0003, Math.max(...ys) + 0.0003], { maxZoom: 17.2, bottomPx: 300 })
  }, [map, p, key, both])
  const already = p?.already ?? []
  const openExisting = (slug: string, street: string) => {
    const ui = useUi.getState()
    a.reset(); ui.setAnalyse(false)
    if (ui.area !== slug) ui.setArea(slug)
    setTimeout(() => {
      useUi.getState().selectStreet(street)
      const ar = areas?.find((x) => x.slug === slug)
      if (map && ar && !p?.lines) flyToBounds(map, ar.bbox)
    }, ui.area !== slug ? 900 : 0)
  }
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-9 z-30 flex justify-center">
      <AnimatePresence mode="wait">
        {on && !p && (
          <motion.div key="pick" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className={card} role="status" aria-live="polite">
            {a.loading && a.startedAt != null ? (
              <div className="flex items-center gap-3">
                <Loader2 className="size-4 shrink-0 animate-spin sodium" />
                <p className="flex-1">Finding street…</p>
                <button className="btn btn-line" onClick={() => a.cancelPick()}>Cancel</button>
              </div>
            ) : a.error ? (
              <div className="flex items-start gap-3">
                <p className="flex-1" style={{ color: a.error.kind === 'busy' ? 'var(--ns-sodium)' : undefined }}>{a.error.message}</p>
                {a.error.kind === 'busy' && a.clickAt && <button className="btn btn-sodium" onClick={() => a.pick(a.clickAt!.lat, a.clickAt!.lng)}>Try again</button>}
                <button className="btn" onClick={leave}>Leave</button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <p className="flex-1">Point at a street with a <b style={{ color: '#4fa3ff' }}>blue</b> Street View line and click it.</p>
                <button className="btn" onClick={leave}>Cancel <span className="kbd">Esc</span></button>
              </div>
            )}
          </motion.div>
        )}
        {on && p && (
          <motion.div key="confirm" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className={card} role="dialog" aria-label="Confirm analysis">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="t-micro">Analyse this street?</div>
                <div className="t-title mt-1">{p.street}</div>
                <div className="t-small ink2 mt-0.5">
                  {both ? <><span className="t-data">{fmt.format(p.length_m + p.elsewhere!.length_m)} m</span> in {p.elsewhere!.pieces + 1} separate pieces · highlighted on the map</>
                    : a.trim ? <><span className="t-data">{fmt.format(Math.round(a.trim.b - a.trim.a))} m</span> of {fmt.format(p.length_m)} m · <button className="link" onClick={() => a.setTrim(null)}>whole street</button></>
                    : <><span className="t-data">{fmt.format(p.length_m)} m</span> · highlighted on the map</>}
                  </div>
                {p.elsewhere && (
                  <label className="t-small mt-1.5 flex cursor-pointer items-center gap-2">
                    <button type="button" role="switch" aria-checked={both} onClick={() => a.setInclude(!both)}
                      aria-label={`This street continues elsewhere (${fmt.format(p.elsewhere.length_m)} m) — include it?`}
                      className="relative h-[18px] w-[32px] shrink-0 rounded-full transition-colors"
                      style={{ background: both ? 'var(--ns-sodium)' : 'var(--ns-line-strong)' }}>
                      <span className="absolute top-[2px] size-[14px] rounded-full bg-[var(--ns-bg2)] transition-[left]" style={{ left: both ? 16 : 2 }} />
                    </button>
                    <span>This street continues elsewhere (<span className="t-data">{fmt.format(p.elsewhere.length_m)} m</span>) — include it?</span>
                  </label>
                )}
                <div className="t-small ink3 mt-0.5">{both ? 'Trimming is off while both pieces are included.'
                  : <>Drag the orange end dots on the map to analyse only part of it{trimmable ? '' : ' (this street is too short to trim)'}.</>}</div>
              </div>
              <button className="btn btn-icon" onClick={() => a.reset()} aria-label="Pick another street"><X /></button>
            </div>
            {p.note && (
              <div className="mt-2 flex items-start gap-3">
                <p className="t-small flex-1" style={{ color: 'var(--ns-sodium)' }}>{p.note}</p>

              </div>
            )}
            {p.osm_details === false && !p.note && (
              <div className="t-small ink2 mt-2 flex items-center gap-2" role="status"><Loader2 className="size-3.5 animate-spin sodium" /> Finding the full street…</div>
            )}
            {a.loading && a.startedAt != null && (
              <div className="t-small ink2 mt-2 flex items-center gap-2" role="status"><Loader2 className="size-3.5 animate-spin sodium" /> Finding street…</div>
            )}
            {!a.loading && a.error && a.error.kind === 'busy' && (
              <div className="mt-2 flex items-start gap-3">
                <p className="t-small flex-1" style={{ color: 'var(--ns-sodium)' }}>{a.error.message}</p>
                <button className="btn btn-line" onClick={() => a.retry()}>Retry</button>
              </div>
            )}
            {already.length > 0 && !a.anyway ? (
              <div className="mt-3 border-l-2 pl-3" style={{ borderColor: 'var(--ns-sodium)' }}>
                <p>Already analysed in <b>{shortArea(already[0].area)}</b>{already[0].street !== p.street ? <> as <b>{already[0].street}</b></> : null}.</p>
                <p className="t-small ink3 mt-0.5">{already[0].by === 'way_ids' ? 'The same road.' : `${Math.round(already[0].overlap * 100)}% of it runs along an analysed street.`}</p>
                <div className="mt-3 flex gap-2">
                  <button className="btn btn-solid" onClick={() => openExisting(already[0].slug, already[0].street)}>Open</button>
                  <button className="btn btn-line" onClick={() => useAnalyse.setState({ anyway: true })}>Analyse anyway</button>
                </div>
              </div>
            ) : (
              <>
                {est ? (
                  <dl className="mt-4 grid grid-cols-2" aria-live="polite" style={{ opacity: plan.busy ? 0.6 : 1 }}>
                    <div><dt className="t-micro">Street View</dt><dd className="t-figure mt-1" style={{ fontSize: 21.5 }}>≈ {fmt.format(est.street_view_images)}</dd>
                      <dd className="t-small ink3">{noun(est.street_view_images, 'image')}{est.street_view_usd != null ? ` · ≈ $${est.street_view_usd.toFixed(2)}` : ''}</dd></div>
                    <div className="rule-l pl-4"><dt className="t-micro">Time</dt><MinutesFigure m={est.gpu_minutes} /></div>
                  </dl>
                ) : plan.st?.status === 'failed' ? null
                  : plan.slow ? (
                    <div className="mt-3 flex items-start gap-3" role="status">
                      <p className="t-small flex-1" style={{ color: 'var(--ns-sodium)' }}>{planSlowText(useAnalyse.getState().cap ?? p.cost_cap_usd)}</p>
                      <button className="btn btn-line" onClick={plan.retry}>Check again</button>
                    </div>)
                  : <p className="t-small ink2 mt-3 flex items-center gap-2" role="status"><Loader2 className="size-3.5 animate-spin sodium" /> Estimating cost and time…</p>}
                {plan.st?.status === 'failed' && (
                  <div className="mt-3 flex items-start gap-3">
                    <p className="t-small ink2 flex-1">No estimate: {plan.st.error}</p>
                    <button className="btn btn-line" onClick={plan.retry}>Try again</button>
                  </div>
                )}
                {est && (
                  <p className="t-small ink2 mt-2">
                    {est.total_usd != null ? <>Total ≈ <span className="t-data">${est.total_usd.toFixed(2)}</span> (photos{est.cloud_ai_usd != null ? ` + cloud AI $${est.cloud_ai_usd.toFixed(est.cloud_ai_usd < 0.01 ? 4 : 2)}` : ''})</> : 'Total not known'}
                    {plan.busy && <> · updating…</>}
                  </p>
                )}
                {est?.note && <p className="t-small mt-1" style={{ color: 'var(--ns-sodium)' }}>{est.note}</p>}
                <CostCap total={est?.total_usd ?? null} fallback={p.cost_cap_usd} />
                {est && (
                  <details className="mt-2">
                    <summary className="t-small ink3 cursor-pointer">An estimate{a.trim ? ' for the shorter stretch' : ''}, not a measurement. <span className="link">How is this estimated?</span></summary>
                    <p className="t-small ink3 mt-1">{est.basis}</p>
                  </details>
                )}
                {a.error && a.error.kind !== 'busy' && <p className="t-small mt-2" style={{ color: 'var(--ns-no-record)' }}>{a.error.message}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <button className="btn" onClick={leave}>Cancel</button>
                  <button className="btn btn-solid" disabled={a.loading || offline || p.osm_details === false} onClick={() => a.start()}>{a.loading && <Loader2 className="animate-spin" />} {offline ? 'Offline — read-only' : 'Start analysis'}</button>
                </div>
              </>
            )}
          </motion.div>
        )}
        {!on && a.job && <JobCard key="job" />}
      </AnimatePresence>
    </div>
  )
}

function JobCard() {
  const { job, workerOnline, cancelJob, approveJob, retryJob, error, estimate } = useAnalyse()
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t) }, [])
  if (!job) return null
  const close = () => useAnalyse.setState({ job: null, preview: null, clickAt: null, estimate: null })
  const st = jobStatus(job)
  const stageIdx = job.stage ? STAGES.indexOf(job.stage) : -1
  const elapsed = job.started_at ? Math.max(0, (Date.now() - new Date(job.started_at).getTime()) / 1000) : null
  const pe = job.plan_estimate
  const message = {
    queued: workerOnline ? 'Queued. The analysis starts in a few seconds.' : 'Queued. The analysis computer is not connected yet; it starts as soon as it is.',
    running: stageLine(job.stage, job.done, job.total),
    interrupted: 'Interrupted: the analysis computer stopped responding. It continues from where it stopped when it reconnects.',
    needs_approval: `This street needs about ${pe?.photos != null ? fmt.format(pe.photos) : 'more'} Street View photos${pe?.usd != null ? ` (about $${pe.usd.toFixed(2)})` : ''}, above the limit of ${pe?.cap_photos ?? '—'} photos or $${pe?.cap_usd ?? '—'} per street. Nothing has been bought yet.`,
    done: 'Done. Opening the new area…',
    failed: `Failed: ${job.message ?? 'unknown error'}${job.retryable ? '. Retry continues from the saved progress; photos already fetched are not bought again.' : ''}`,
    cancelled: 'Cancelled. Nothing was analysed.',
    no_street_view: `No usable Street View here${job.message ? `: ${job.message}` : ''}.`,
    expired_token: 'Paused: the analysis needs new access keys. It continues where it stopped once they are entered.',
    cancelling: 'Cancelling… the analysis stops within about 15 seconds and deletes what it saved.',
  }[st.key] ?? st.label
  const active = ['queued', 'running', 'needs_approval', 'expired_token'].includes(job.status)
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className={card} role="status" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><div className="t-micro">Analysis</div><div className="t-title mt-1 truncate">{job.street ?? 'New street'}</div></div>
        <span className="t-small shrink-0" style={{ color: st.color }}>{st.label}</span>
      </div>
      <p className="t-small ink2 mt-1">{message}</p>
      {job.note && ['running', 'interrupted'].includes(st.key) && <p className="t-small mt-0.5" style={{ color: 'var(--ns-sodium)' }}>{job.note}</p>}
      {st.key === 'running' && (
        <p className="t-small ink3 mt-0.5">
          {elapsed != null && <><span className="t-data">{fmtDuration(elapsed)}</span> so far</>}
          {job.device && <> · on a {deviceWord(job.device)}</>}
          {elapsed != null && timeLeft(elapsed, job.device, estimate) && <> · {timeLeft(elapsed, job.device, estimate)}</>}
        </p>
      )}
      {(st.key === 'running' || st.key === 'interrupted') && (
        <div className="mt-3 flex gap-1" aria-label={`Stage ${stageIdx + 1} of ${STAGES.length}`}>
          {STAGES.map((s, i) => <span key={s} title={STAGE_PLAIN[s]} className="h-1 flex-1 rounded-full" style={{ background: i < stageIdx ? 'var(--ns-sodium)' : i === stageIdx ? 'var(--ns-sodium-glow)' : 'var(--ns-line-strong)' }} />)}
        </div>
      )}
      {error && <p className="t-small mt-1.5" style={{ color: 'var(--ns-no-record)' }}>{error.message}</p>}
      <div className="mt-3 flex justify-end gap-2">
        {st.key === 'needs_approval' && <button className="btn btn-solid" onClick={() => approveJob()}>Approve and run</button>}
        {st.key === 'failed' && job.retryable && <button className="btn btn-solid" onClick={() => retryJob()}>Retry</button>}
        {active && st.key !== 'cancelling' && <button className="btn btn-line" onClick={() => cancelJob()}>{st.key === 'needs_approval' ? 'Cancel' : 'Cancel job'}</button>}
        <button className="btn" onClick={close}>{active ? 'Hide' : 'Close'}</button>
      </div>
    </motion.div>
  )
}

/** 75 s → "1 min 15 s"; 3,700 s → "1 h 2 min" */
function fmtDuration(sec: number) {
  const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h ? `${h} h ${m} min` : m ? `${m} min ${s % 60} s` : `${s} s`
}
