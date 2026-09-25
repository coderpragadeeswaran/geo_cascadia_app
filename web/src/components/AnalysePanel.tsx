/** "Analyse a street" (CLAUDE.md §9.4.1): pick → confirm sheet (street, length, estimate from model_card) → job card
 *  with honest states. With no worker online the job says so ("queued — no analysis worker connected"), not an error. */
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { Crosshair, Loader2, X } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { fmt } from '@/lib/utils'
import { useAnalyse } from '@/map/analyse'
import { useUi } from '@/store/ui'

const STAGES = ['panoramas', 'area', 'plan', 'detect', 'geometry', 'ocr', 'vlm', 'reference', 'match', 'export']

export function AnalysePanel() {
  const on = useUi((s) => s.analyse)
  const setAnalyse = useUi((s) => s.setAnalyse)
  const a = useAnalyse()
  const qc = useQueryClient()

  // poll the job while it is queued / running
  const status = a.job?.status
  useEffect(() => {
    if (!status || !['queued', 'running'].includes(status)) return
    const t = setInterval(() => useAnalyse.getState().poll(), 4000)
    return () => clearInterval(t)
  }, [status])
  useEffect(() => { if (status === 'done') qc.invalidateQueries({ queryKey: ['areas'] }) }, [status, qc])

  const cancelPick = () => { setAnalyse(false); a.reset() }
  const card = 'glass glass-strong pointer-events-auto w-[min(460px,92vw)] px-4 py-3'
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-10 z-30 flex justify-center">
      <AnimatePresence mode="wait">
        {on && !a.preview && (
          <motion.div key="pick" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className={card} role="status">
            <div className="flex items-center gap-2.5">
              {a.loading ? <Loader2 className="size-4 animate-spin text-accent" /> : <Crosshair className="size-4 text-accent" />}
              <p className="flex-1 text-[13px]">{a.loading ? 'Finding the street under your click…' : <>Click a street with <b className="text-[#4fa3ff]">blue Street View coverage</b>.</>}</p>
              <Button size="sm" onClick={cancelPick}>Cancel <kbd className="text-[10px] text-faint">Esc</kbd></Button>
            </div>
            {a.error && <p className="mt-2 text-[12px] text-no-record">{a.error}</p>}
          </motion.div>
        )}
        {on && a.preview && (
          <motion.div key="confirm" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className={card} role="dialog" aria-label="Confirm analysis">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="eyebrow">Analyse this street?</div>
                <div className="mt-0.5 text-[15px] font-semibold">{a.preview.street}</div>
                <div className="tnum text-[12px] text-muted">{fmt.format(a.preview.length_m)} m · {a.preview.osm_ways} OSM way{a.preview.osm_ways === 1 ? '' : 's'}</div>
              </div>
              <Button size="icon-sm" onClick={() => a.reset()} aria-label="Pick another street"><X /></Button>
            </div>
            {a.preview.already_analysed_in.length > 0 && (
              <p className="mt-2 rounded-md bg-accent-soft px-2 py-1.5 text-[12px] text-accent">This point is already inside: {a.preview.already_analysed_in.join(', ')}.</p>
            )}
            {a.preview.estimate ? (
              <div className="mt-2.5 grid grid-cols-3 gap-2 text-[12px]">
                <Stat label="Street View images" value={`≈ ${fmt.format(a.preview.estimate.street_view_images)}`} sub={a.preview.estimate.street_view_usd != null ? `≈ $${a.preview.estimate.street_view_usd}` : undefined} />
                <Stat label="GPU (Colab)" value={`≈ ${a.preview.estimate.gpu_minutes} min`} />
                <Stat label="CPU fallback" value={`${a.preview.estimate.cpu_minutes_full_ocr} min`} sub={`fast OCR ${a.preview.estimate.cpu_minutes_fast_ocr} min`} />
              </div>
            ) : <p className="mt-2 text-[12px] text-muted">No estimate available (reference run missing).</p>}
            {a.preview.estimate && <p className="mt-1.5 text-[10.5px] leading-snug text-faint">Estimate, {a.preview.estimate.basis}</p>}
            {a.error && <p className="mt-2 text-[12px] text-no-record">{a.error}</p>}
            <div className="mt-3 flex justify-end gap-1.5">
              <Button size="sm" onClick={cancelPick}>Cancel</Button>
              <Button size="sm" variant="accent" disabled={a.loading} onClick={() => a.start()}>{a.loading && <Loader2 className="animate-spin" />} Start analysis</Button>
            </div>
          </motion.div>
        )}
        {!on && a.job && <JobCard key="job" />}
      </AnimatePresence>
    </div>
  )
}

const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="rounded-lg bg-hover px-2 py-1.5"><div className="text-[10.5px] text-muted">{label}</div><div className="tnum font-semibold">{value}</div>{sub && <div className="tnum text-[10.5px] text-faint">{sub}</div>}</div>
)

function JobCard() {
  const { job, workerOnline, cancelJob, error } = useAnalyse()
  const setArea = useUi((s) => s.setArea)
  if (!job) return null
  const close = () => useAnalyse.setState({ job: null, preview: null, clickAt: null })
  const stageIdx = job.stage ? STAGES.indexOf(job.stage) : -1
  const tone = { queued: 'text-accent', running: 'text-accent', done: 'text-matched', failed: 'text-no-record', no_street_view: 'text-discrepancy', expired_token: 'text-discrepancy' }[job.status] ?? 'text-muted'
  const message = {
    queued: workerOnline ? 'Queued. The analysis worker will pick it up shortly.' : 'Queued — no analysis worker connected. It starts when the Colab worker (phase 6) comes online.',
    running: `Running: ${job.stage ?? 'starting'}${job.total ? ` (${job.done ?? 0} / ${job.total})` : ''}.`,
    done: 'Done. The new area is ready.',
    failed: job.message === 'cancelled by user' ? 'Cancelled.' : `Failed: ${job.message ?? 'unknown error'}`,
    no_street_view: `No usable Street View here: ${job.message ?? ''}`,
    expired_token: 'Paused: the worker’s AWS token expired. Refresh the keys in Colab and re-run the worker cell; it resumes.',
  }[job.status] ?? job.status
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="glass glass-strong pointer-events-auto w-[min(460px,92vw)] px-4 py-3" role="status" aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="eyebrow">Analysis job</div>
          <div className="truncate text-[14px] font-semibold">{job.street ?? 'New street'}</div>
        </div>
        <span className={`text-[12px] font-semibold ${tone}`}>{job.status.replace(/_/g, ' ')}</span>
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-fg/85">{message}</p>
      {(job.status === 'running' || job.status === 'queued') && (
        <div className="mt-2 flex gap-1" aria-label="Pipeline stages">
          {STAGES.map((s, i) => <span key={s} title={s} className={`h-1.5 flex-1 rounded-full ${i < stageIdx ? 'bg-accent' : i === stageIdx ? 'animate-pulse bg-accent' : 'bg-hover'}`} />)}
        </div>
      )}
      {error && <p className="mt-1.5 text-[12px] text-no-record">{error}</p>}
      <div className="mt-2.5 flex justify-end gap-1.5">
        {['queued', 'running', 'expired_token'].includes(job.status) && <Button size="sm" onClick={() => cancelJob()}>Cancel job</Button>}
        {job.status === 'done' && job.area_slug && <Button size="sm" variant="accent" onClick={() => { setArea(job.area_slug!); close() }}>Open new area</Button>}
        <Button size="sm" onClick={close}>{['queued', 'running'].includes(job.status) ? 'Hide' : 'Close'}</Button>
      </div>
    </motion.div>
  )
}
