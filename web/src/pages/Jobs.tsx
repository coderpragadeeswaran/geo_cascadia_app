/** Jobs (P5 / D29, P6 / D34): the pre-computed runs and every analysis requested from this app. Statuses: queued,
 *  running, done, failed (red), cancelled (neutral grey), interrupted (the worker stopped sending heartbeats; it resumes),
 *  no Street View, paused (keys expired), needs approval (cost above the cap: Approve / Cancel).
 *  A job's detail shows its street on a small plan (our own geometry, no second map), length, the estimate (labelled as
 *  such), the worker's real stages with time so far and an honest time left, and for a finished street "Delete this
 *  analysed area" (never offered for the original areas). With no worker connected a queued job says so plainly. */
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Loader2, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError } from '@/api/client'
import { useJob, useJobs, type JobP5 } from '@/api/p5'
import { post, useAreas } from '@/api/queries'
import type { AreaCard, WorkerStatus } from '@/api/types'
import { Card } from '@/components/Detail'
import { GeoMini } from '@/components/GeoMini'
import { deviceWord, JOB_STAGES, jobStatus, shortArea, STAGE_PLAIN, stageLine, timeLeft } from '@/lib/labels'
import { cn, fmt, plural } from '@/lib/utils'
import { useUi } from '@/store/ui'

const ORIGINAL_AREAS = ['ward29', 'trichy_bharathidasan_salai', 'tiruppur_uthukuli_road']
const secs = (a: string | null | undefined) => (a ? Math.max(0, (Date.now() - new Date(a).getTime()) / 1000) : null)
const dur = (sec: number) => { const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} h ${m} min` : m ? `${m} min ${s % 60} s` : `${s} s` }
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
const mins = (a: string | null, b: string | null) => (a && b ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)) : null)

export default function Jobs() {
  const { data: areas } = useAreas()
  const go = useUi((s) => s.go)
  const setArea = useUi((s) => s.setArea)
  const offline = useUi((s) => s.offline)
  const jobs = useJobs()
  const [sel, setSel] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const list = jobs.data?.jobs ?? []
  useEffect(() => { if (list.length && !list.some((j) => j.id === sel)) setSel(list[0].id) }, [list, sel])
  const open = (slug: string, page: 'explore' | 'hood') => { setArea(slug); go(page) }
  const online = !!jobs.data?.worker_online
  const [deleting, setDeleting] = useState<{ slug: string; name: string; job?: string } | null>(null)
  return (
    <div className="h-full overflow-y-auto px-10 py-8">
      <div className="mx-auto max-w-[1080px]">
        <div className="t-micro">Jobs</div>
        <h1 className="t-display mt-2 mb-2">Analyses</h1>
        <WorkerLine w={jobs.data?.worker} online={online} offline={!!(jobs.data?.offline || offline)} />

        <Card id="runs" title="Pre-computed runs" className="mb-8">
        <ul>
          {areas?.filter((a) => !a.live).map((a) => (
            <li key={a.slug} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rule-t py-3">
              <div className="min-w-0">
                <div className="truncate text-[17.5px]">{shortArea(a.name)}</div>
                <div className="t-small ink3 mt-0.5">{plural(a.counts.buildings, 'building')} · {plural(a.counts.assets, 'pole or light', 'poles & lights')} · {plural(a.counts.streetlight_gaps_60m, 'dark stretch')}{a.coverage.level === 'partial' ? ' · few buildings on the map here' : ''}</div>
              </div>
              <div className="flex gap-1.5">
                <button className="btn btn-line" onClick={() => open(a.slug, 'explore')}>Open on the map</button>
                <button className="btn" onClick={() => open(a.slug, 'hood')}>Under the hood</button>
              </div>
            </li>
          ))}
          {!areas && <li className="t-small ink3 rule-t py-3">Loading…</li>}
        </ul>
        </Card>

        <Card id="requests" title={<span className="flex items-center justify-between gap-3">Started from this app
          <button className="btn h-8" onClick={() => setClearing(true)} disabled={offline || !list.length}><Trash2 /> Clear test jobs…</button></span>}>
        {jobs.isPending ? <p className="t-small ink3 rule-t pt-3">Loading…</p>
          : jobs.isError ? <p className="t-small ink2 rule-t pt-3">Couldn’t load the jobs. <button className="link" onClick={() => jobs.refetch()}>Try again</button></p>
            : !list.length ? <p className="t-small ink3 rule-t pt-3">No analyses started from this app yet. Use Analyse on the map to pick a street.</p>
              : (
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
                  <ul aria-label="Analysis requests">
                    {list.map((j) => {
                      const st = jobStatus(j)
                      return (
                        <li key={j.id}>
                          <button onClick={() => setSel(j.id)} aria-current={sel === j.id ? 'true' : undefined}
                            className={cn('grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_130px] items-center gap-4 rule-t px-2 py-3 text-left hover:bg-line', sel === j.id && 'bg-accent-soft')}>
                            <div className="min-w-0">
                              <div className="truncate">{j.street ?? 'New street'}{j.is_test && <span className="t-small ink3"> · test</span>}</div>
                              <div className="t-data ink3 mt-0.5">{when(j.created_at)}{j.input?.length_m ? ` · ${fmt.format(Math.round(j.input.length_m))} m` : ''}{j.status === 'running' && j.stage ? ` · ${stageLine(j.stage)}` : ''}</div>
                            </div>
                            <span className="t-small flex items-center gap-1.5" style={{ color: st.color }}><span className="size-2 rounded-full" style={{ background: st.color }} />{st.label}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  <div>{sel && <JobDetail id={sel} online={online} onOpen={open} onDelete={setDeleting} />}</div>
                </div>
              )}
        </Card>
      </div>
      {clearing && <ClearTest onClose={() => setClearing(false)} />}
      {deleting && <DeleteArea area={deleting} onClose={() => setDeleting(null)} />}
    </div>
  )
}

function JobDetail({ id, online, onOpen, onDelete }: { id: string; online: boolean; onOpen: (slug: string, page: 'explore' | 'hood') => void
  onDelete: (a: { slug: string; name: string; job?: string }) => void }) {
  const { data, isPending, isError } = useJob(id)
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setConfirm(false); setErr(null) }, [id])
  if (isPending) return <div className="h-64 animate-pulse rounded-[var(--ns-r-sheet)] bg-line" />
  if (isError || !data) return <p className="t-small ink2">This job could not be loaded (it may have been removed).</p>
  const j: JobP5 = data.job
  const st = jobStatus(j)
  const est = data.estimate
  const lines = j.input?.lines ?? null
  const stageIdx = j.stage ? JOB_STAGES.indexOf(j.stage) : -1
  const cancellable = ['queued', 'running', 'expired_token', 'needs_approval'].includes(j.status)
  const pe = j.plan_estimate
  const elapsed = st.key === 'running' ? secs(j.started_at) : null
  const approve = async () => {
    setBusy(true); setErr(null)
    try { await post(`/jobs/${j.id}/approve`, {}); await qc.invalidateQueries({ queryKey: ['jobs'] }); await qc.invalidateQueries({ queryKey: ['job', j.id] }) }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not approve') } finally { setBusy(false) }
  }
  const removable = ['cancelled', 'failed', 'no_street_view', 'done'].includes(st.key) && !j.area_slug
  const remove = async () => {
    setBusy(true); setErr(null)
    try { await api(`/jobs/${j.id}`, { method: 'DELETE' }); forgetLocally(qc, [], [j.id]) }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not remove it from the list') } finally { setBusy(false) }
  }
  const cancel = async () => {
    setBusy(true); setErr(null)
    try { await post(`/jobs/${j.id}/cancel`, {}); await qc.invalidateQueries({ queryKey: ['jobs'] }); await qc.invalidateQueries({ queryKey: ['job', j.id] }); setConfirm(false) }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not cancel') } finally { setBusy(false) }
  }
  const message: Record<string, string> = {
    queued: online ? 'Queued. The analysis worker picks it up in a few seconds.' : 'Queued, waiting for a worker. Nothing is running yet; it starts when a worker connects.',
    running: `${stageLine(j.stage, j.done, j.total)}.`,
    interrupted: 'Interrupted: the worker stopped responding (the notebook closed or the account was switched). It will resume when a worker connects again.',
    needs_approval: `Needs your approval: about ${pe?.photos != null ? fmt.format(pe.photos) : 'more'} Street View photos${pe?.usd != null ? ` (about $${pe.usd.toFixed(2)})` : ''}${pe?.buildings != null ? ` for ${plural(pe.buildings, 'building')}` : ''}, above the limit of ${pe?.cap_photos ?? '—'} photos or $${pe?.cap_usd ?? '—'} per street. Nothing has been bought yet.`,
    done: j.area_slug ? 'Done. The new area is ready.' : j.message === 'area deleted' ? 'Done. Its area was deleted afterwards.' : 'Done.',
    failed: `Failed: ${j.message ?? 'unknown error'}`,
    cancelled: 'Cancelled. Nothing was analysed.',
    no_street_view: `No usable Street View here${j.message ? `: ${j.message}` : ''}.`,
    expired_token: 'Paused: the cloud-AI keys expired. Enter new keys in the worker; it continues where it stopped, nothing is lost.',
    cancelling: 'Cancelling… the worker stops within about 15 seconds and deletes what it saved for this street.',
  }
  return (
    <article className="rounded-[var(--ns-r-sheet)] p-4" style={{ boxShadow: 'inset 0 0 0 1px var(--ns-line-strong)' }} aria-label="Job detail">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><div className="t-micro">Analysis request</div><h2 className="t-title mt-0.5 truncate">{j.street ?? 'New street'}</h2></div>
        <span className="t-small shrink-0" style={{ color: st.color }}>{st.label}</span>
      </div>
      <p className="t-small ink2 mt-1">{message[st.key] ?? st.label}</p>
      {j.note && ['running', 'interrupted'].includes(st.key) && <p className="t-small mt-0.5" style={{ color: 'var(--ns-sodium)' }}>{j.note}</p>}
      {elapsed != null && (
        <p className="t-small ink3 mt-0.5"><span className="t-data">{dur(elapsed)}</span> so far{j.device ? ` · on a ${deviceWord(j.device)}` : ''}
          {timeLeft(elapsed, j.device, est) ? ` · ${timeLeft(elapsed, j.device, est)}` : ''}</p>
      )}
      <div className="mt-3">
        {lines ? <GeoMini streets={[{ name: j.street ?? 'street', geometry: lines as GeoJSON.MultiLineString }]} highlight={j.street ?? 'street'} fit="area" height={170} label={`${j.street ?? 'The street'} on a small plan`} />
          : <p className="t-small ink3">No street geometry stored for this job.</p>}
      </div>
      <dl className="t-small mt-3 grid grid-cols-[120px_1fr] gap-y-1">
        <dt className="ink3">Length</dt><dd>{j.input?.length_m ? `${fmt.format(Math.round(j.input.length_m))} m${j.input.trimmed ? ' (trimmed stretch)' : ''}` : '—'}</dd>
        <dt className="ink3">Requested</dt><dd>{when(j.created_at)}</dd>
        {j.started_at && <><dt className="ink3">Started</dt><dd>{when(j.started_at)}</dd></>}
        {j.finished_at && <><dt className="ink3">{st.key === 'cancelled' ? 'Cancelled at' : st.key === 'done' ? 'Finished' : st.key === 'no_street_view' ? 'Stopped at' : 'Failed at'}</dt>
          <dd>{when(j.finished_at)}{st.key === 'done' && mins(j.started_at, j.finished_at) != null ? ` · took ${mins(j.started_at, j.finished_at)} min` : ''}{st.key === 'done' && j.device ? ` on a ${deviceWord(j.device)}` : ''}</dd></>}
      </dl>
      {est && (
        <div className="mt-4">
          <div className="t-micro mb-1">Estimate</div>
          <dl className="t-small grid grid-cols-[120px_1fr] gap-y-1">
            <dt className="ink3">Photos</dt><dd>about {fmt.format(est.street_view_images)} Street View images{est.street_view_usd != null ? ` · about $${est.street_view_usd.toFixed(2)}` : ''}</dd>
            <dt className="ink3">Time</dt><dd>{est.gpu_minutes != null ? `about ${est.gpu_minutes} min on a GPU` : '—'}{est.cpu_minutes_fast_ocr ? ` · ${est.cpu_minutes_fast_ocr} min on a CPU (quick sign reading)` : est.cpu_minutes_full_ocr != null ? ` · ${est.cpu_minutes_full_ocr} min on a CPU` : ''}</dd>
          </dl>
          <p className="t-small ink3 mt-1">Scaled from the Ward 29 run by street length; an estimate, not a measurement.</p>
          <details className="mt-1"><summary className="link t-small cursor-pointer">How is this estimated?</summary><p className="t-small ink3 mt-1">{est.basis}</p></details>
        </div>
      )}
      <div className="mt-4">
        <div className="t-micro mb-1.5">Stages</div>
        {stageIdx < 0 && j.status !== 'done' ? <p className="t-small ink3 mb-1.5">Progress appears here once a worker runs the analysis.</p> : null}
        <ol className="grid grid-cols-2 gap-x-4 gap-y-1" aria-label="Pipeline stages">
          {JOB_STAGES.map((s, i) => {
            const state = j.status === 'done' ? 'done' : i < stageIdx ? 'done' : i === stageIdx ? 'now' : 'wait'
            return (
              <li key={s} className="t-small flex min-w-0 items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: state === 'done' ? 'var(--ns-sodium)' : state === 'now' ? 'var(--ns-sodium-glow)' : 'transparent', boxShadow: state === 'wait' ? 'inset 0 0 0 1.5px var(--ns-line-strong)' : undefined }} />
                <span className={cn('truncate', state === 'wait' && 'ink3')}>{i + 1}. {STAGE_PLAIN[s] ?? s}</span>
              </li>
            )
          })}
        </ol>
      </div>
      {err && <p className="t-small mt-2" style={{ color: 'var(--ns-no-record)' }}>{err}</p>}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {st.key === 'needs_approval' && !confirm && <button className="btn btn-solid" disabled={busy} onClick={approve}>{busy && <Loader2 className="animate-spin" />} Approve and run</button>}
        {cancellable && st.key !== 'cancelling' && !confirm && <button className="btn btn-line" onClick={() => setConfirm(true)}>{st.key === 'needs_approval' ? 'Cancel' : 'Cancel job'}</button>}
        {removable && <button className="btn" disabled={busy} onClick={remove}>{busy ? <><Loader2 className="animate-spin" /> Removing…</> : <><Trash2 /> Remove from list</>}</button>}
        {confirm && <>
          <span className="t-small self-center">Cancel this job? It won’t be analysed.</span>
          <button className="btn btn-solid" disabled={busy} onClick={cancel}>{busy ? <><Loader2 className="animate-spin" /> Cancelling…</> : 'Yes, cancel'}</button>
          <button className="btn" onClick={() => setConfirm(false)}>Keep it</button>
        </>}
        {j.status === 'done' && j.area_slug && <>
          <button className="btn btn-solid" onClick={() => onOpen(j.area_slug!, 'explore')}>Open the area <ArrowRight className="size-3.5" /></button>
          <button className="btn" onClick={() => onOpen(j.area_slug!, 'hood')}>Under the hood</button>
          {!ORIGINAL_AREAS.includes(j.area_slug) && <button className="btn" onClick={() => onDelete({ slug: j.area_slug!, name: j.street ?? 'this street', job: j.id })}><Trash2 /> Delete this analysed area…</button>}
        </>}
      </div>
    </article>
  )
}

/** "Clear test jobs": first lists exactly what would be removed (dry run) — test jobs with their test areas, and jobs
 *  cancelled before they started — then removes only those after confirmation. Never a real analysis or its area, never
 *  the three original areas (the API refuses them too). */
function ClearTest({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [state, setState] = useState<{ jobs: JobP5[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ jobs: number; areas: number } | null>(null)
  useEffect(() => {
    post<{ jobs: JobP5[] }>('/jobs/clear-test', { dry_run: true }).then((r) => setState({ jobs: r.jobs })).catch((e) => setErr(e instanceof ApiError ? e.message : 'Could not list the test jobs'))
  }, [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose, busy])
  const areas = state?.jobs.filter((j) => j.area_slug) ?? []
  const run = async () => {
    if (!state) return
    setBusy(true); setErr(null)
    try {
      const r = await post<{ removed: string[]; areas: { slug: string }[] }>('/jobs/clear-test', { dry_run: false, ids: state.jobs.map((j) => j.id) })
      forgetLocally(qc, r.areas.map((a) => a.slug), r.removed)
      setDone({ jobs: r.removed.length, areas: r.areas.length })
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not remove them') } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--ns-bg0) 70%, transparent)' }} onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Clear test jobs" className="sheet w-[520px] max-w-[94%] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="t-title">Clear test jobs</h2><button autoFocus className="btn btn-icon" disabled={busy} onClick={onClose} aria-label="Close"><X /></button></div>
        <p className="t-small ink2 mt-1">Removes test runs (with the test areas they made) and requests cancelled before any worker started them. Real analyses, their areas and the three original areas are never touched.</p>
        {err && <p className="t-small mt-3" style={{ color: 'var(--ns-no-record)' }}>{err}</p>}
        {!state && !err && <p className="t-small ink3 mt-3">Checking…</p>}
        {done != null ? <p className="t-small mt-3">Removed {plural(done.jobs, 'job')}{done.areas ? ` and ${plural(done.areas, 'test area')}` : ''}.</p> : state && (
          state.jobs.length ? (
            <>
              <ul className="mt-3 max-h-60 overflow-y-auto">{state.jobs.map((j) => (
                <li key={j.id} className="t-small grid grid-cols-[minmax(0,1fr)_auto] gap-3 rule-t py-1.5">
                  <span className="truncate">{j.street ?? 'New street'} <span className="ink3">· {when(j.created_at)}</span></span>
                  <span className="ink3">{j.area_slug ? 'test run and its area' : j.is_test ? 'test job' : 'cancelled before it started'}</span>
                </li>))}</ul>
              <div className="mt-4 flex justify-end gap-1.5">
                <button className="btn" disabled={busy} onClick={onClose}>Keep them</button>
                <button className="btn btn-solid" disabled={busy} onClick={run}>{busy ? <><Loader2 className="animate-spin" /> Deleting…</>
                  : <>Remove {plural(state.jobs.length, 'job')}{areas.length ? ` and ${plural(areas.length, 'area')}` : ''}</>}</button>
              </div>
            </>
          ) : <p className="t-small ink3 mt-3">There are no test jobs to remove.</p>
        )}
      </div>
    </div>
  )
}

/** D35 (F7): remove deleted areas and jobs from every cached list at once (area dropdown, Explore, Jobs, Hood tabs), move
 *  off a deleted area, then refresh from the API (review counts included). */
function forgetLocally(qc: ReturnType<typeof useQueryClient>, slugs: string[], jobIds: string[]) {
  const gone = new Set(slugs), jgone = new Set(jobIds)
  qc.setQueryData<AreaCard[]>(['areas'], (old) => old?.filter((a) => !gone.has(a.slug)))
  qc.setQueriesData<{ jobs: JobP5[] }>({ queryKey: ['jobs'] }, (old) => old && { ...old, jobs: old.jobs.filter((j) => !jgone.has(j.id) && !(j.area_slug && gone.has(j.area_slug))) })
  for (const s of slugs) for (const k of ['area', 'geo', 'hood', 'buildings', 'assets', 'unmapped', 'review']) qc.removeQueries({ queryKey: [k, s] })
  for (const id of jobIds) qc.removeQueries({ queryKey: ['job', id] })
  const ui = useUi.getState()
  if (ui.area && gone.has(ui.area)) ui.setArea('ward29')
  for (const k of ['areas', 'jobs', 'review']) qc.invalidateQueries({ queryKey: [k] })
}

/** the worker's state in one line: connected (device, the street it is on) or not */
function WorkerLine({ w, online, offline }: { w: WorkerStatus | undefined; online: boolean; offline: boolean }) {
  const on = w ? w.connected : online
  const dev = deviceWord(w?.device)
  return (
    <p className="t-small mb-8 flex items-center gap-2">
      <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: on ? 'var(--ns-discrepancy)' : 'transparent', boxShadow: on ? undefined : 'inset 0 0 0 1.5px var(--ns-ink3)' }} aria-hidden />
      <span className="ink2">Analysis worker: <b className="text-ink">{on ? 'connected' : 'not connected'}</b>
        {on && dev && ` on a ${dev}`}
        {on && (w?.job ? ` · analysing ${w.job.street ?? 'a street'} (${stageLine(w.job.stage, w.job.done, w.job.total)})` : ' · waiting for a street')}
        {!on && ' — new streets wait in the queue until a worker connects.'}
        {offline && ' Offline data mode: jobs need the database.'}</span>
    </p>
  )
}

/** "Delete this analysed area": removes a street analysed from the app (its results and review items). The three
 *  original areas are never offered (and the API refuses them). */
function DeleteArea({ area, onClose }: { area: { slug: string; name: string; job?: string }; onClose: () => void }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose, busy])
  const run = async () => {
    setBusy(true); setErr(null)
    try {
      await api(`/areas/${encodeURIComponent(area.slug)}?confirm=${encodeURIComponent(area.slug)}`, { method: 'DELETE' })
      forgetLocally(qc, [area.slug], area.job ? [area.job] : [])
      onClose()
    } catch (e) { setErr(`Could not delete it: ${e instanceof ApiError ? e.message : 'unknown error'}. Nothing was removed; try again.`); setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--ns-bg0) 70%, transparent)' }} onClick={() => !busy && onClose()}>
      <div role="alertdialog" aria-modal="true" aria-label="Delete this analysed area" className="sheet w-[480px] max-w-[94%] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="t-title">Delete {area.name}?</h2><button className="btn btn-icon" onClick={onClose} aria-label="Close"><X /></button></div>
        <p className="t-small ink2 mt-1">This removes the street’s results from the map and its items from the review queue. It can’t be undone; analysing the street again costs new Street View photos. Its request leaves the list too.</p>
        {err && <p className="t-small mt-3" style={{ color: 'var(--ns-no-record)' }}>{err}</p>}
        <div className="mt-4 flex justify-end gap-1.5">
          <button autoFocus className="btn" disabled={busy} onClick={onClose}>Keep it</button>
          <button className="btn btn-solid" disabled={busy} onClick={run} aria-live="polite">{busy ? <><Loader2 className="animate-spin" /> Deleting…</> : 'Delete the area'}</button>
        </div>
      </div>
    </div>
  )
}
