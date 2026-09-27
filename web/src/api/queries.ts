import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import type { ModelCard } from '@/types/modelCard'
import { api } from './client'
import type { AreaCard, AreaDetail, AreaGeoJSON, Asset, Building, EvidenceViewData, Job, PublicConfig, ReviewItem, ReviewRow, UnmappedBusiness, WorkerStatus } from './types'

export const useConfig = () =>
  useQuery({ queryKey: ['config'], queryFn: () => api<PublicConfig>('/config/public'), staleTime: Infinity, retry: 1 })

export const useAreas = () =>
  useQuery({ queryKey: ['areas'], queryFn: () => api<{ areas: AreaCard[] }>('/areas').then((r) => r.areas), staleTime: 60_000 })

export const useAreaDetail = (slug: string | null) =>
  useQuery({ queryKey: ['area', slug], queryFn: () => api<AreaDetail>(`/areas/${slug}`), enabled: !!slug, staleTime: 30_000 })

const ALL_LAYERS = 'buildings,assets,gaps,unmapped,missing,streets'
export const useAreaGeo = (slug: string | null) =>
  useQuery({
    queryKey: ['geo', slug],
    queryFn: () => api<AreaGeoJSON>(`/areas/${slug}/geojson?layers=${ALL_LAYERS}`),
    enabled: !!slug,
    staleTime: 30_000,
  })

/** Full records (one request each, cached): the table, KPIs, charts and evidence drawer compute from these (D2). */
export const useBuildings = (slug: string | null) =>
  useQuery({ queryKey: ['buildings', slug], queryFn: () => api<{ rows: Building[] }>(`/areas/${slug}/buildings?page_size=500`).then((r) => r.rows), enabled: !!slug, staleTime: 30_000 })
export const useAssets = (slug: string | null) =>
  useQuery({ queryKey: ['assets', slug], queryFn: () => api<{ rows: Asset[] }>(`/areas/${slug}/assets?page_size=500`).then((r) => r.rows), enabled: !!slug, staleTime: 30_000 })
export const useUnmapped = (slug: string | null) =>
  useQuery({ queryKey: ['unmapped', slug], queryFn: () => api<{ rows: UnmappedBusiness[] }>(`/areas/${slug}/unmapped`).then((r) => r.rows), enabled: !!slug, staleTime: 30_000 })
export const useReviewRows = (slug: string | null) =>
  useQuery({ queryKey: ['review', slug], queryFn: () => api<{ rows: ReviewRow[] }>(`/review${slug ? `?area=${slug}&` : '?'}page_size=500`).then((r) => r.rows), staleTime: 10_000 })

export const useObjectDetail = (area: string | null, kind: 'building' | 'asset' | null, id: string | null) =>
  useQuery({
    queryKey: ['detail', area, kind, id],
    queryFn: () => api<{ review_item: ReviewItem | null; building?: Building; asset?: Asset }>(`/${kind === 'building' ? 'buildings' : 'assets'}/${area}/${encodeURIComponent(id!)}`),
    enabled: !!(area && kind && id),
  })

/** detection boxes on each evidence photo of an object (design pass B §2) */
export const useEvidence = (area: string | null, kind: 'building' | 'asset' | 'unmapped', id: string) =>
  useQuery({
    queryKey: ['evidence', area, kind, id],
    queryFn: () => api<{ views: EvidenceViewData[] }>(`/areas/${area}/evidence/${kind}/${encodeURIComponent(id)}`).then((r) => r.views),
    enabled: !!area, staleTime: Infinity,
  })

export const useModelCard = () =>
  useQuery({ queryKey: ['model-card'], queryFn: () => api<ModelCard>('/model-card'), staleTime: Infinity })

export const useActiveJobs = () =>
  useQuery({
    queryKey: ['jobs', 'active'],
    queryFn: () => api<{ jobs: Job[]; worker_online: boolean; worker: WorkerStatus }>('/jobs?active=1'),
    // P6: live progress and the worker light: every 5 s while a street is being analysed, else 10 s
    refetchInterval: (q) => (q.state.data?.jobs.some((j) => j.status === 'running') ? 5_000 : 10_000),
    staleTime: 4_000,
  })

export const post = <T,>(path: string, body: unknown, signal?: AbortSignal) =>
  api<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })

/** D35 (F5): when an analysis leaves the active list (done, failed, cancelled — started here, from another tab or by a
 *  worker), the area list, jobs and review counts refresh, so a new area appears in the dropdown without a reload. */
export function useFollowJobs() {
  const { data } = useActiveJobs()
  const qc = useQueryClient()
  const prev = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!data) return
    const ids = new Set(data.jobs.map((j) => j.id))
    const gone = prev.current && [...prev.current].some((id) => !ids.has(id))
    prev.current = ids
    if (gone) {
      qc.invalidateQueries({ queryKey: ['areas'] })
      qc.invalidateQueries({ queryKey: ['jobs'] })
      qc.invalidateQueries({ queryKey: ['review'] })
    }
  }, [data, qc])
}
