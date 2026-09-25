/** One place that loads an area's records and indexes them; map, KPIs, table, charts and drawer all read from it. */
import { useMemo } from 'react'
import { useAreaDetail, useAreaGeo, useAssets, useBuildings, useReviewRows, useUnmapped } from '@/api/queries'
import type { AnyProps, GapProps, StreetProps } from '@/api/types'
import { useUi } from '@/store/ui'
import { focusOf, type Records } from './derive'

export function useAreaData() {
  const area = useUi((s) => s.area)
  const geo = useAreaGeo(area)
  const buildings = useBuildings(area)
  const assets = useAssets(area)
  const unmapped = useUnmapped(area)
  const review = useReviewRows(area)
  const detail = useAreaDetail(area)

  const props = useMemo(() => {
    const m = new Map<string, AnyProps>()
    for (const f of geo.data?.features ?? []) if (f.properties.kind !== 'street') m.set(`${f.properties.kind}:${f.properties.id}`, f.properties)
    return m
  }, [geo.data])
  const streets = useMemo(() => (geo.data?.features ?? []).filter((f) => f.properties.kind === 'street')
    .map((f) => ({ props: f.properties as StreetProps, geometry: f.geometry as GeoJSON.MultiLineString })), [geo.data])
  const gaps = useMemo(() => (geo.data?.features ?? []).filter((f) => f.properties.kind === 'streetlight_gap')
    .map((f) => ({ props: f.properties as GapProps, geometry: f.geometry as GeoJSON.LineString })), [geo.data])

  const records: Records | null = useMemo(() => (buildings.data && assets.data && unmapped.data && review.data
    ? { buildings: buildings.data, assets: assets.data, unmapped: unmapped.data, review: review.data, gaps: gaps.map((g) => g.props) }
    : null), [buildings.data, assets.data, unmapped.data, review.data, gaps])

  return { area, geo: geo.data, detail: detail.data, records, props, streets, gaps,
    loading: !records || geo.isPending, error: buildings.error ?? assets.error ?? geo.error }
}

/** props object for an id, as the map/hover cards use it */
export const propsFor = (m: Map<string, AnyProps>, kind: string, id: string) => m.get(`${kind}:${id}`) ?? null

export function useFocus() {
  const { records, gaps } = useAreaData()
  const filter = useUi((s) => s.filter)
  const query = useUi((s) => s.query)
  return useMemo(() => focusOf(records, filter, query, new Map(gaps.map((g) => [g.props.id, g.props.street]))), [records, filter, query, gaps])
}
