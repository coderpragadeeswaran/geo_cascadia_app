/** "Analyse a street": click → /jobs/preview (street + estimate) → confirm → POST /jobs → poll the job.
 *  One lookup at a time: a new click cancels the pending one; the lookup gives up after 18 s with "OpenStreetMap is busy"
 *  (the backend tries two Overpass mirrors, ~8 s each). Honest states: worker offline, read-only data mode, no Street
 *  View, token expired. */
import { create } from 'zustand'
import { ApiError, api } from '@/api/client'
import { post } from '@/api/queries'
import type { JobFull, JobPreview } from '@/api/types'
import { useUi } from '@/store/ui'
import { mainLine, slice } from './trim'

const CLIENT_TIMEOUT_MS = 18_000
export type PickError = { kind: 'busy' | 'no_road' | 'offline' | 'other'; message: string }

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
  setTrim: (t: { a: number; b: number } | null) => void
  job: JobFull | null
  workerOnline: boolean
  pick: (lat: number, lng: number) => Promise<void>
  cancelPick: () => void
  start: () => Promise<void>
  cancelJob: () => Promise<void>
  reset: () => void
  poll: () => Promise<void>
}

let ctrl: AbortController | null = null

export const useAnalyse = create<AnalyseState>((set, get) => ({
  clickAt: null, preview: null, loading: false, startedAt: null, error: null, anyway: false, job: null, workerOnline: false, trim: null,
  setTrim: (trim) => set({ trim }),
  pick: async (lat, lng) => {
    ctrl?.abort('replaced')                                       // one request at a time: a new click wins
    const mine = new AbortController()
    ctrl = mine
    const timer = setTimeout(() => mine.abort('timeout'), CLIENT_TIMEOUT_MS)
    set({ clickAt: { lat, lng }, preview: null, loading: true, startedAt: performance.now(), error: null, anyway: false, trim: null })
    try {
      const preview = await post<JobPreview>('/jobs/preview', { lat, lon: lng }, mine.signal)
      if (ctrl === mine) set({ preview, loading: false, startedAt: null })
    } catch (e) {
      if (ctrl !== mine) return                                   // replaced by a newer click
      if (mine.signal.aborted) {
        const reason = mine.signal.reason
        set({ loading: false, startedAt: null, error: reason === 'cancelled' ? null
          : { kind: 'busy', message: 'OpenStreetMap is busy — try again in a moment.' } })
        return
      }
      const err = e instanceof ApiError ? e : null
      set({ loading: false, startedAt: null, error: !err ? { kind: 'other', message: 'Could not look up the street' }
        : err.status === 503 || err.status === 504 ? { kind: 'busy', message: 'OpenStreetMap is busy — try again in a moment.' }
          : err.status === 422 ? { kind: 'no_road', message: 'No road here. Point at a street with a blue Street View line and click.' }
            : err.status === 0 ? { kind: 'offline', message: 'The API is not reachable.' } : { kind: 'other', message: err.message } })
    } finally {
      clearTimeout(timer)
      if (ctrl === mine) ctrl = null
    }
  },
  cancelPick: () => { ctrl?.abort('cancelled'); ctrl = null; set({ loading: false, startedAt: null }) },
  start: async () => {
    const { clickAt: at, trim, preview } = get()
    if (!at) return
    set({ loading: true, error: null })
    // a trimmed stretch goes with the click; the backend checks it lies on the street and builds the polygon from it
    const m = trim && preview ? mainLine(preview.lines) : null
    const lines = m && trim ? { type: 'LineString', coordinates: slice(m, trim.a, trim.b) } : undefined
    try {
      const r = await post<{ job: JobFull; worker_online: boolean }>('/jobs', { lat: at.lat, lon: at.lng, ...(lines ? { lines } : {}) })
      set({ job: r.job, workerOnline: r.worker_online, loading: false, preview: null })
      useUi.getState().setAnalyse(false)
    } catch (e) {
      const offline = e instanceof ApiError && e.offline
      set({ loading: false, error: { kind: offline ? 'offline' : 'other', message: offline
        ? 'Offline data mode: the database is unreachable, so new analyses can’t be queued (read-only).'
        : e instanceof ApiError ? e.message : 'Could not queue the analysis' } })
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
  reset: () => { ctrl?.abort('cancelled'); ctrl = null; set({ clickAt: null, preview: null, loading: false, startedAt: null, error: null, anyway: false, trim: null }) },
  poll: async () => {
    const j = get().job
    if (!j) return
    try {
      const r = await api<{ job: JobFull; worker_online: boolean }>(`/jobs/${j.id}`)
      set({ job: r.job, workerOnline: r.worker_online })
    } catch { /* keep last state */ }
  },
}))
