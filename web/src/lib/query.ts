/** Run a plain-English question (or chips built by clicking) through the backend QueryEngine (rule-based, no LLM;
 *  docs/QUERY.md). The result opens the one panel; the map frames it. A question with ignored words comes back as
 *  "partly understood" and is NOT applied to the map until the person accepts what was understood (never a silent
 *  wrong answer). */
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
    // a typed question that names no street is answered on the selected street (one scope, review fix 3)
    const scope = 'text' in input && ui.filter.street ? { scope_street: ui.filter.street } : {}
    const r = await post<QueryResponse>('/query', { area: ui.area, ...input, ...scope })
    // chips built or edited by clicking are exactly what the person asked for
    ui.setQuery('filters' in input ? { ...r, accepted: true } : r)
  } catch (e) {
    useQueryError.getState().set(e instanceof ApiError ? e.message : 'The question could not be answered')
  } finally {
    useUi.getState().setQueryBusy(false)
  }
}

/** true when the map and lists may show this question's rows */
export const queryApplies = (q: QueryResponse | null) => !!q && (q.accepted || !q.understanding || q.understanding.status === 'ok')

export const SPEC_QUERIES = [
  'Show commercial buildings with more than two visible floors that do not have a matching property record',
  'Show streets where no streetlight is detected within 60 m',
  'Display only low-confidence floor-count predictions and create a review queue',
  'Chart of unmatched buildings by street',
]

/** 5–6 short example questions for the ask bar, using this area's own street names */
export function exampleQuestions(streets: string[]) {
  const [a, b] = streets
  return [
    'Commercial buildings with more than 2 floors and no record',
    'Streets where no streetlight is detected within 60 m',
    'Chart of unmatched buildings by street',
    'Low-confidence floor counts for review',
    'Not-in-register buildings within 50 m of a possible dark stretch',
    ...(a ? [`Buildings that differ from the register on ${a}`] : []),
    ...(b ?? a ? [`Poles on ${b ?? a}`] : []),
  ].slice(0, 6)
}
