/** Jobs: the pre-computed runs and the analyses started from this app, with the worker's status and honest states.
 *  P5/P6 complete this page (durations, costs, live progress). */
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useAreas } from '@/api/queries'
import type { JobFull } from '@/api/types'
import { jobStatus, shortArea } from '@/lib/labels'
import { plural } from '@/lib/utils'
import { useUi } from '@/store/ui'


export default function Jobs() {
  const { data: areas } = useAreas()
  const go = useUi((s) => s.go)
  const setArea = useUi((s) => s.setArea)
  const { data: jobs } = useQuery({ queryKey: ['jobs', 'all'], queryFn: () => api<{ jobs: JobFull[]; worker_online: boolean; offline: boolean }>('/jobs'), refetchInterval: 15_000 })
  const open = (slug: string, page: 'explore' | 'hood') => { setArea(slug); go(page) }
  return (
    <div className="h-full overflow-y-auto px-10 py-8">
      <div className="mx-auto max-w-[960px]">
        <div className="t-micro">Jobs</div>
        <h1 className="t-display mt-2 mb-2">Analyses</h1>
        <p className="t-small ink2 mb-8">
          Analysis worker: <b className="text-ink">{jobs?.worker_online ? 'online' : 'offline'}</b>{!jobs?.worker_online && ' — new streets stay queued until the Colab worker is running'}.
          {jobs?.offline && ' Offline data mode: jobs need the database.'}
        </p>
        <div className="t-micro mb-2">Pre-computed runs</div>
        <ul className="mb-10">
          {areas?.map((a) => (
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
        </ul>
        <div className="t-micro mb-2">Started from this app</div>
        {jobs?.jobs.length ? (
          <ul>
            {jobs.jobs.map((j) => (
              <li key={j.id} className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-center gap-4 rule-t py-3">
                <div className="min-w-0">
                  <div className="truncate">{j.street ?? 'New street'}</div>
                  <div className="t-data ink3 mt-0.5">{j.created_at ? new Date(j.created_at).toLocaleString('en-IN') : '—'}{j.stage ? ` · ${j.stage}` : ''}{j.message && jobStatus(j).key !== 'cancelled' ? ` · ${j.message}` : ''}</div>
                </div>
                <span className="t-small" style={{ color: jobStatus(j).color }}>{jobStatus(j).label}</span>
                <span>{j.status === 'done' && j.area_slug ? <button className="btn btn-line" onClick={() => open(j.area_slug!, 'explore')}>Open</button> : null}</span>
              </li>
            ))}
          </ul>
        ) : <p className="t-small ink3 rule-t pt-3">No analyses started from this app yet. Use Analyse on the map to pick a street.</p>}
      </div>
    </div>
  )
}
