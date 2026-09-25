/** Run a plain-English question (or edited filter chips) through the backend QueryEngine and route the result:
 *  gaps → Streetlights tab, grouped counts → Charts tab, rows → Findings table; the map frames the result. */
import { create } from 'zustand'
import { ApiError } from '@/api/client'
import { post } from '@/api/queries'
import type { QueryFilters, QueryResponse } from '@/api/types'
import { useUi } from '@/store/ui'

export const useQueryError = create<{ error: string | null; set: (e: string | null) => void }>((set) => ({ error: null, set: (error) => set({ error }) }))

export async function runQuery(input: { text: string } | { filters: QueryFilters }) {
  const ui = useUi.getState()
  if (!ui.area) return
  ui.setQueryBusy(true)
  useQueryError.getState().set(null)
  try {
    const r = await post<QueryResponse>('/query', { area: ui.area, ...input })
    ui.select(null)
    ui.setQuery(r)
    ui.setTab(r.intent === 'streetlight_gaps' ? 'streetlights' : r.groups ? 'charts' : 'findings')
  } catch (e) {
    useQueryError.getState().set(e instanceof ApiError ? e.message : 'The question could not be answered')
  } finally {
    useUi.getState().setQueryBusy(false)
  }
}

export const SPEC_QUERIES = [
  'Show commercial buildings with more than two visible floors that do not have a matching property record',
  'Show streets where no streetlight is detected within 60 m',
  'Display only low-confidence floor-count predictions and create a review queue',
  'Chart of unmatched buildings by street',
]
