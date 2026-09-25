/** "Analyse a street" flow: click → /jobs/preview (street + estimate) → confirm → POST /jobs → poll the job.
 *  Honest states: worker offline ("queued, no worker connected"), read-only data mode, no Street View, token expired. */
import { create } from 'zustand'
import { ApiError, api } from '@/api/client'
import { post } from '@/api/queries'
import type { JobFull, JobPreview } from '@/api/types'
import { useUi } from '@/store/ui'

interface AnalyseState {
  clickAt: { lat: number; lng: number } | null
  preview: JobPreview | null
  loading: boolean
  error: string | null
  job: JobFull | null
  workerOnline: boolean
  pick: (lat: number, lng: number) => Promise<void>
  start: () => Promise<void>
  cancelJob: () => Promise<void>
  reset: () => void
  poll: () => Promise<void>
}

export const useAnalyse = create<AnalyseState>((set, get) => ({
  clickAt: null, preview: null, loading: false, error: null, job: null, workerOnline: false,
  pick: async (lat, lng) => {
    set({ clickAt: { lat, lng }, preview: null, loading: true, error: null })
    try {
      const preview = await post<JobPreview>('/jobs/preview', { lat, lon: lng })
      if (get().clickAt?.lat === lat) set({ preview, loading: false })
    } catch (e) {
      set({ loading: false, error: e instanceof ApiError ? e.message : 'Could not look up the street' })
    }
  },
  start: async () => {
    const at = get().clickAt
    if (!at) return
    set({ loading: true, error: null })
    try {
      const r = await post<{ job: JobFull; worker_online: boolean }>('/jobs', { lat: at.lat, lon: at.lng })
      set({ job: r.job, workerOnline: r.worker_online, loading: false })
      useUi.getState().setAnalyse(false)
    } catch (e) {
      const offline = e instanceof ApiError && e.offline
      set({ loading: false, error: offline ? 'Offline data mode: the database is unreachable, so new analyses can’t be queued (read-only).'
        : e instanceof ApiError ? e.message : 'Could not queue the analysis' })
    }
  },
  cancelJob: async () => {
    const j = get().job
    if (!j) return
    try {
      const r = await post<{ job: JobFull }>(`/jobs/${j.id}/cancel`, {})
      set({ job: r.job })
    } catch (e) { set({ error: e instanceof ApiError ? e.message : 'Could not cancel' }) }
  },
  reset: () => set({ clickAt: null, preview: null, loading: false, error: null }),
  poll: async () => {
    const j = get().job
    if (!j) return
    try {
      const r = await api<{ job: JobFull; worker_online: boolean }>(`/jobs/${j.id}`)
      set({ job: r.job, workerOnline: r.worker_online })
    } catch { /* keep last state */ }
  },
}))
