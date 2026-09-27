/** "Analyse a street" sheet (CLAUDE.md §9.4.1, design pass B §3): a live "asking OpenStreetMap…" state with elapsed
 *  seconds and Cancel; a clear busy message; the confirm sheet with the street's display name, "Already analysed in …"
 *  (Open / Analyse anyway) and an estimate scaled by length; then the job card with honest states (no worker online is
 *  "queued, waiting for a worker", never a spinner). While it runs: the stage in plain words, time so far and an honest
 *  time left (the device's estimate minus elapsed); a cost-cap pause offers Approve / Cancel; when done the map flies to
 *  the new area. The exact snapped street is drawn on the map while the sheet is open. */
import { useQueryClient } from '@tanstack/react-query'
import { useMap } from '@vis.gl/react-google-maps'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { post, useAreas } from '@/api/queries'
import type { JobPreview } from '@/api/types'
import { deviceWord, JOB_STAGES, jobStatus, shortArea, STAGE_PLAIN, stageLine, timeLeft } from '@/lib/labels'
import { fmt, noun } from '@/lib/utils'
import { useAnalyse } from '@/map/analyse'
import { flyToBounds } from '@/map/MapView'
import { mainLine, MIN_STRETCH_M } from '@/map/trim'
import { useUi } from '@/store/ui'

const STAGES = JOB_STAGES
const card = 'sheet pointer-events-auto w-[min(470px,92vw)] px-5 py-4'

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(performance.now())
  useEffect(() => { const t = setInterval(() => setNow(performance.now()), 250); return () => clearInterval(t) }, [])
  return <span className="t-data">{Math.floor((now - since) / 1000)} s</span>
}

/** The estimate for what will be analysed: the preview's for the whole street, re-asked (debounced) while the end dots
 *  are dragged — the same backend rule, scaled by the stretch length (fix 10). */
function useStretchEstimate() {
  const preview = useAnalyse((s) => s.preview)
  const trim = useAnalyse((s) => s.trim)
  const [trimmed, setTrimmed] = useState<{ len: number; est: JobPreview['estimate'] } | null>(null)
  const len = trim ? Math.round(trim.b - trim.a) : null
  useEffect(() => {
    if (len == null) return
    let off = false
    const t = setTimeout(() => {
      post<{ estimate: JobPreview['estimate'] }>('/jobs/estimate', { length_m: len })
        .then((r) => { if (!off) setTrimmed({ len, est: r.estimate }) }).catch(() => {})
    }, 120)
    return () => { off = true; clearTimeout(t) }
  }, [len])
  if (len == null) return { est: preview?.estimate ?? null, busy: false }
  return { est: trimmed?.est ?? preview?.estimate ?? null, busy: trimmed?.len !== len }
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
  const { est, busy: estBusy } = useStretchEstimate()
  const trimmable = (mainLine(a.preview?.lines)?.length ?? 0) >= MIN_STRETCH_M * 2
  const p = a.preview
  // frame the snapped street so its highlight is in view above the sheet
  useEffect(() => {
    if (!map || !p?.lines?.coordinates.length) return
    const pts = p.lines.coordinates.flat()
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1])
    // the sheet covers ~300 px at the bottom: frame the street above it so both end dots can be dragged (fix 10)
    flyToBounds(map, [Math.min(...xs) - 0.0003, Math.min(...ys) - 0.0003, Math.max(...xs) + 0.0003, Math.max(...ys) + 0.0003], { maxZoom: 17.2, bottomPx: 300 })
  }, [map, p])
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
                <p className="flex-1">Asking OpenStreetMap which street this is… <Elapsed since={a.startedAt} /></p>
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
                  {a.trim ? <><span className="t-data">{fmt.format(Math.round(a.trim.b - a.trim.a))} m</span> of {fmt.format(p.length_m)} m · <button className="link" onClick={() => a.setTrim(null)}>whole street</button></>
                    : <><span className="t-data">{fmt.format(p.length_m)} m</span> · highlighted on the map</>}
                  {p.name_source === 'osm' && ' · name from OpenStreetMap'}{p.name_source === 'unnamed' && ' · no name in OpenStreetMap'}</div>
                <div className="t-small ink3 mt-0.5">Drag the orange end dots on the map to analyse only part of it{trimmable ? '' : ' (this street is too short to trim)'}.</div>
              </div>
              <button className="btn btn-icon" onClick={() => a.reset()} aria-label="Pick another street"><X /></button>
            </div>
            {p.note && <p className="t-small mt-2" style={{ color: 'var(--ns-sodium)' }}>{p.note}</p>}
            {already.length > 0 && !a.anyway ? (
              <div className="mt-3 border-l-2 pl-3" style={{ borderColor: 'var(--ns-sodium)' }}>
                <p>Already analysed in <b>{shortArea(already[0].area)}</b>{already[0].street !== p.street ? <> as <b>{already[0].street}</b></> : null}.</p>
                <p className="t-small ink3 mt-0.5">{already[0].by === 'way_ids' ? 'Same OpenStreetMap road.' : `${Math.round(already[0].overlap * 100)}% of it runs along an analysed street.`}</p>
                <div className="mt-3 flex gap-2">
                  <button className="btn btn-solid" onClick={() => openExisting(already[0].slug, already[0].street)}>Open</button>
                  <button className="btn btn-line" onClick={() => useAnalyse.setState({ anyway: true })}>Analyse anyway</button>
                </div>
              </div>
            ) : (
              <>
                {est ? (
                  <dl className="mt-4 grid grid-cols-3" aria-live="polite" style={{ opacity: estBusy ? 0.6 : 1 }}>
                    {[['Street View', `≈ ${fmt.format(est.street_view_images)}`, `${noun(est.street_view_images, 'image')}${est.street_view_usd != null ? ` · ≈ $${est.street_view_usd}` : ''}`],
                      ['GPU (Colab)', `≈ ${est.gpu_minutes}`, noun(Number(est.gpu_minutes), 'minute')],
                      ['CPU only', `≈ ${est.cpu_minutes_full_ocr}`, `${noun(Number(est.cpu_minutes_full_ocr), 'minute')} · fast OCR ${est.cpu_minutes_fast_ocr}`]].map(([k, v, s], i) => (
                      <div key={k} className={i ? 'rule-l pl-4' : ''}><dt className="t-micro">{k}</dt><dd className="t-figure mt-1" style={{ fontSize: 21.5 }}>{v}</dd><dd className="t-small ink3">{s}</dd></div>
                    ))}
                  </dl>
                ) : <p className="t-small ink3 mt-3">No estimate available (reference run missing).</p>}
                {est && (
                  <details className="mt-2">
                    <summary className="t-small ink3 cursor-pointer">An estimate{a.trim ? ' for the trimmed stretch' : ''}, scaled by length from an earlier run. <span className="link">How is this estimated?</span></summary>
                    <p className="t-small ink3 mt-1">{est.basis}</p>
                  </details>
                )}
                {a.error && <p className="t-small mt-2" style={{ color: 'var(--ns-no-record)' }}>{a.error.message}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <button className="btn" onClick={leave}>Cancel</button>
                  <button className="btn btn-solid" disabled={a.loading || offline} onClick={() => a.start()}>{a.loading && <Loader2 className="animate-spin" />} {offline ? 'Offline — read-only' : 'Start analysis'}</button>
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
  const { job, workerOnline, cancelJob, approveJob, error, estimate } = useAnalyse()
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t) }, [])
  if (!job) return null
  const close = () => useAnalyse.setState({ job: null, preview: null, clickAt: null, estimate: null })
  const st = jobStatus(job)
  const stageIdx = job.stage ? STAGES.indexOf(job.stage) : -1
  const elapsed = job.started_at ? Math.max(0, (Date.now() - new Date(job.started_at).getTime()) / 1000) : null
  const pe = job.plan_estimate
  const message = {
    queued: workerOnline ? 'Queued. The analysis worker picks it up in a few seconds.' : 'Queued, waiting for a worker. Nothing is running yet; it starts when a worker connects.',
    running: stageLine(job.stage, job.done, job.total),
    interrupted: 'Interrupted: the worker stopped responding. It continues from where it stopped when a worker connects again.',
    needs_approval: `This street needs about ${pe?.photos != null ? fmt.format(pe.photos) : 'more'} Street View photos${pe?.usd != null ? ` (about $${pe.usd.toFixed(2)})` : ''}, above the limit of ${pe?.cap_photos ?? '—'} photos or $${pe?.cap_usd ?? '—'} per street. Nothing has been bought yet.`,
    done: 'Done. Opening the new area…',
    failed: `Failed: ${job.message ?? 'unknown error'}`,
    cancelled: 'Cancelled. Nothing was analysed.',
    no_street_view: `No usable Street View here${job.message ? `: ${job.message}` : ''}.`,
    expired_token: 'Paused: the cloud-AI keys expired. Enter new keys in the worker; it continues where it stopped.',
    cancelling: 'Cancelling… the worker stops within about 15 seconds and deletes what it saved.',
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
