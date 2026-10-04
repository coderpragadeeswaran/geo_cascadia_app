/** "Analyse a street": click → /jobs/preview (street + estimate) → confirm → POST /jobs → poll the job.
 *  One lookup at a time: a new click cancels the pending one. Hotfix: while the map server is still answering, the
 *  backend says "pending" (202) and the browser asks again every ~0.8 s (each ask waits up to 4 s on the server), showing
 *  "Finding street…"; the street appears by itself when it lands. Only after FIND_LIMIT_MS with no answer: "Map server is
 *  busy — try again in a minute" + Retry. Honest states: worker offline, read-only data mode, no Street View, token expired. */
import { create } from 'zustand'
import { ApiError, api } from '@/api/client'
import { post } from '@/api/queries'
import type { JobEstimate } from '@/api/p5'
import type { JobFull, JobPreview } from '@/api/types'
import { useUi } from '@/store/ui'
import { mainLine, slice } from './trim'

const FIND_LIMIT_MS = 30_000          // give up looking for the street after this long
const DETAILS_LIMIT_MS = 90_000       // a street shown without its full name / length keeps updating this long
const ASK_TIMEOUT_MS = 10_000          // one ask (the server waits ≤ 4 s)
export type PickError = { kind: 'busy' | 'no_road' | 'offline' | 'other'; message: string }
export const BUSY = 'Map server is busy — try again in a minute.'
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((res) => {
  const t = setTimeout(res, ms)
  signal.addEventListener('abort', () => { clearTimeout(t); res() }, { once: true })
})

interface AnalyseState {
  clickAt: { lat: number; lng: number } | null
  preview: JobPreview | null
  loading: boolean
  /** performance.now() when the pending lookup started (the sheet shows elapsed seconds) */
  startedAt: number | null
  error: PickError | null
  /** the person chose "Analyse anyway" for a street that is already analysed */
  anyway: boolean
  /** review fix 10: the stretch kept after dragging the end dots, in metres along the main piece (null = whole street) */
  trim: { a: number; b: number } | null
  /** D57: also analyse the unconnected pieces of the same name (preview.elsewhere); off by default, no trimming then */
  include: boolean
  setInclude: (on: boolean) => void
  setTrim: (t: { a: number; b: number } | null) => void
  job: JobFull | null
  /** the job's planner estimate (stored when it was queued) for the honest time-left line */
  estimate: JobEstimate | null
  /** P7.2: the cost cap for the next job (US$); null = the backend default (JOB_COST_CAP_USD) */
  cap: number | null
  workerOnline: boolean
  pick: (lat: number, lng: number) => Promise<void>
  /** P7.1: look the same click up again (after "OSM lookup slow") */
  retry: () => Promise<void>
  cancelPick: () => void
  start: () => Promise<void>
  cancelJob: () => Promise<void>
  /** cost cap: a person accepts the estimate; the job goes back to the queue with the cap lifted for it */
  approveJob: () => Promise<void>
  /** a failed job goes back to the queue; the worker continues from its saved progress (no photo bought twice) */
  retryJob: () => Promise<void>
  reset: () => void
  poll: () => Promise<void>
}

let ctrl: AbortController | null = null

export const useAnalyse = create<AnalyseState>((set, get) => ({
  clickAt: null, preview: null, loading: false, startedAt: null, error: null, anyway: false, job: null, estimate: null, cap: null, workerOnline: false, trim: null,
  include: false,
  setTrim: (trim) => set({ trim }),
  setInclude: (include) => set({ include, trim: null }),
  pick: async (lat, lng) => {
    ctrl?.abort('replaced')                                       // one request at a time: a new click wins
    const mine = new AbortController()
    ctrl = mine
    const t0 = performance.now()
    // a click on the street already shown keeps its trim; another street starts untrimmed
    set({ clickAt: { lat, lng }, loading: true, startedAt: t0, error: null })
    try {
      for (;;) {
        const one = new AbortController()
        const kill = setTimeout(() => one.abort('timeout'), ASK_TIMEOUT_MS)
        const stop = () => one.abort('cancelled')
        mine.signal.addEventListener('abort', stop, { once: true })
        let r: JobPreview | { status: 'pending' } | null = null
        try {
          r = await post<JobPreview | { status: 'pending' }>('/jobs/preview', { lat, lon: lng }, one.signal)
        } catch (e) {
          if (mine.signal.aborted) throw e
          if (!(one.signal.aborted && one.signal.reason === 'timeout')) throw e          // a slow ask is just asked again
        } finally {
          clearTimeout(kill)
          mine.signal.removeEventListener('abort', stop)
        }
        if (ctrl !== mine) return
        if (r && r.status !== 'pending') {
          const preview = r as JobPreview
          const same = streetKey(get().preview) === streetKey(preview)
          set({ preview, loading: false, startedAt: null, ...(same ? {} : { trim: null, anyway: false, include: false }) })
          // the road is shown; its full name / length are still loading: keep asking quietly and swap them in
          if (preview.status !== 'partial' || performance.now() - t0 > DETAILS_LIMIT_MS) return
        } else if (performance.now() - t0 > FIND_LIMIT_MS) {
          set({ loading: false, startedAt: null, error: { kind: 'busy', message: BUSY } })
          return
        }
        await sleep(800, mine.signal)
        if (mine.signal.aborted) return
      }
    } catch (e) {
      if (ctrl !== mine) return                                   // replaced by a newer click
      if (mine.signal.aborted) { set({ loading: false, startedAt: null }); return }
      const err = e instanceof ApiError ? e : null
      set({ loading: false, startedAt: null, error: !err ? { kind: 'other', message: 'Could not look up the street.' }
        : err.status === 503 || err.status === 504 ? { kind: 'busy', message: err.offline ? 'Offline: looking up streets needs the server.' : BUSY }
          : err.status === 422 ? { kind: 'no_road', message: 'No road here. Point at a street with a blue line and click.' }
            : err.status === 0 ? { kind: 'offline', message: 'The server is not reachable.' }
              : err.status >= 500 ? { kind: 'other', message: 'Couldn’t prepare this street — server error.' }
                : { kind: 'other', message: err.message } })
    } finally {
      if (ctrl === mine) ctrl = null
    }
  },
  retry: async () => { const at = get().clickAt; if (at) await get().pick(at.lat, at.lng) },
  cancelPick: () => { ctrl?.abort('cancelled'); ctrl = null; set({ loading: false, startedAt: null }) },
  start: async () => {
    const { clickAt: at, trim, preview, cap, include } = get()
    if (!at) return
    set({ loading: true, error: null })
    // a trimmed stretch goes with the click; the backend checks it lies on the street and builds the polygon from it
    const m = trim && preview && !include ? mainLine(preview.lines) : null
    const lines = m && trim ? { type: 'LineString', coordinates: slice(m, trim.a, trim.b) } : undefined
    try {
      const r = await post<{ job: JobFull; worker_online: boolean }>('/jobs', { lat: at.lat, lon: at.lng, ...(lines ? { lines } : {}),
        ...(include && preview?.elsewhere ? { include_elsewhere: true } : {}), ...(cap != null ? { cost_cap_usd: cap } : {}) })
      set({ job: r.job, workerOnline: r.worker_online, loading: false, preview: null, estimate: null })
      get().poll()
      useUi.getState().setAnalyse(false)
    } catch (e) {
      const offline = e instanceof ApiError && e.offline
      set({ loading: false, error: { kind: offline ? 'offline' : 'other', message: offline
        ? 'Offline data mode: the database is unreachable, so new analyses can’t be queued (read-only).'
        : !(e instanceof ApiError) ? 'Could not queue the analysis'
          : e.status === 0 ? 'The API is not reachable.'
            : e.status >= 500 && e.status !== 503 ? 'Couldn’t queue this street — server error.' : e.message } })
    }
  },
  cancelJob: async () => {
    const j = get().job
    if (!j) return
    try {
      const r = await post<{ job: JobFull }>(`/jobs/${j.id}/cancel`, {})
      set({ job: r.job })
    } catch (e) { set({ error: { kind: 'other', message: e instanceof ApiError ? e.message : 'Could not cancel' } }) }
  },
  approveJob: async () => {
    const j = get().job
    if (!j) return
    try {
      const r = await post<{ job: JobFull; worker_online: boolean }>(`/jobs/${j.id}/approve`, {})
      set({ job: r.job, workerOnline: r.worker_online, error: null })
    } catch (e) { set({ error: { kind: 'other', message: e instanceof ApiError ? e.message : 'Could not approve' } }) }
  },
  retryJob: async () => {
    const j = get().job
    if (!j) return
    try {
      const r = await post<{ job: JobFull; worker_online: boolean }>(`/jobs/${j.id}/retry`, {})
      set({ job: r.job, workerOnline: r.worker_online, error: null })
    } catch (e) { set({ error: { kind: 'other', message: e instanceof ApiError ? e.message : 'Could not retry' } }) }
  },
  reset: () => { ctrl?.abort('cancelled'); ctrl = null; set({ clickAt: null, preview: null, loading: false, startedAt: null, error: null, anyway: false, trim: null, include: false }) },
  poll: async () => {
    const j = get().job
    if (!j) return
    try {
      const r = await api<{ job: JobFull; worker_online: boolean; estimate: JobEstimate | null }>(`/jobs/${j.id}`)
      set({ job: r.job, workerOnline: r.worker_online, estimate: r.estimate })
    } catch { /* keep last state */ }
  },
}))

/** one street = the same OSM ways (or, for a street of an analysed area, the same name and length): a second click on it
 *  keeps the camera and the trim (P7.1) */
export const streetKey = (p: JobPreview | null | undefined) =>
  !p ? null : (p.way_ids?.length ? [...p.way_ids].sort((a, b) => a - b).join(',') : `${p.street}|${p.length_m}`)
    // D57: the way ids cover every piece of the name; two pieces of it are two streets (own camera, own trim)
    + (p.elsewhere ? `|piece ${p.length_m}` : '')
/** D57: the lines to analyse: the clicked piece, plus the rest of the same name when the person included it */
export const pickedLines = (p: JobPreview | null | undefined, include: boolean) =>
  !p?.lines ? null : include && p.elsewhere ? { ...p.lines, coordinates: [...p.lines.coordinates, ...p.elsewhere.lines.coordinates] } : p.lines
