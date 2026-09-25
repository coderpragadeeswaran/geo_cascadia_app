import { useQuery } from '@tanstack/react-query'
import type { ModelCard } from '@/types/modelCard'
import { api } from './client'
import type { AreaCard, AreaDetail, AreaGeoJSON, Asset, Building, Job, PublicConfig, ReviewItem, ReviewRow, UnmappedBusiness } from './types'

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

export const useModelCard = () =>
  useQuery({ queryKey: ['model-card'], queryFn: () => api<ModelCard>('/model-card'), staleTime: Infinity })

export const useActiveJobs = () =>
  useQuery({
    queryKey: ['jobs', 'active'],
    queryFn: () => api<{ jobs: Job[]; worker_online: boolean }>('/jobs?active=1'),
    refetchInterval: 15_000,
    staleTime: 10_000,
  })

export const post = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
