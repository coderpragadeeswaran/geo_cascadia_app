import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { AreaCard, AreaGeoJSON, Job, PublicConfig } from './types'

export const useConfig = () =>
  useQuery({ queryKey: ['config'], queryFn: () => api<PublicConfig>('/config/public'), staleTime: Infinity, retry: 1 })

export const useAreas = () =>
  useQuery({ queryKey: ['areas'], queryFn: () => api<{ areas: AreaCard[] }>('/areas').then((r) => r.areas), staleTime: 60_000 })

const ALL_LAYERS = 'buildings,assets,gaps,unmapped,missing,streets'
export const useAreaGeo = (slug: string | null) =>
  useQuery({
    queryKey: ['geo', slug],
    queryFn: () => api<AreaGeoJSON>(`/areas/${slug}/geojson?layers=${ALL_LAYERS}`),
    enabled: !!slug,
    staleTime: 30_000,
  })

export const useActiveJobs = () =>
  useQuery({
    queryKey: ['jobs', 'active'],
    queryFn: () => api<{ jobs: Job[]; worker_online: boolean }>('/jobs?active=1'),
    refetchInterval: 15_000,
    staleTime: 10_000,
  })
