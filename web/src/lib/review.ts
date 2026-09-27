/** Review decisions (review fix 12): one PATCH per decision, then the cached queue, records and map features are patched
 *  in place (no reload of the whole area after each write). Undo (D24) names one item AND the one decision (event id)
 *  returned when it was made; the item goes back to exactly what it was before that decision. */
import type { QueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { AreaGeoJSON, ReviewRow } from '@/api/types'

export type Decision = 'approve' | 'reject' | 'appeal'
export const DONE_LABEL: Record<Decision, string> = { approve: 'Approved', reject: 'Rejected', appeal: 'Appealed' }
export type Saved = ReviewRow & { offline: boolean; event_id: number }

/** One decision, saved with the reviewer's name. A note and a photo belong to an APPEAL only (P5 fix: text typed in the
 *  appeal box is never sent with Approve / Reject; the API refuses it too). */
export async function saveDecision(id: number, action: Decision, extra: { reviewer: string; note?: string; photo?: File | null }) {
  const fd = new FormData()
  fd.set('action', action)
  fd.set('reviewer', extra.reviewer)
  if (action === 'appeal') {
    if (extra.note?.trim()) fd.set('note', extra.note.trim())
    if (extra.photo) fd.set('photo', extra.photo)
  }
  return api<Saved>(`/review/${id}`, { method: 'PATCH', body: fd })
}

/** Undo exactly one decision on exactly one item (both ids are required by the API); records who pressed Undo */
export function undoDecision(itemId: number, eventId: number, reviewer?: string | null) {
  return api<Saved>(`/review/${itemId}/undo`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_id: itemId, event_id: eventId, reviewer: reviewer ?? null }) })
}

/** appeal photo limits (same as the API: storage.py ALLOWED / MAX_BYTES) */
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const PHOTO_MAX_MB = 8
export function photoProblem(f: File | null): string | null {
  if (!f) return null
  if (!PHOTO_TYPES.includes(f.type)) return 'Use a JPEG, PNG or WebP photo.'
  if (f.size > PHOTO_MAX_MB * 1024 * 1024) return `The photo is larger than ${PHOTO_MAX_MB} MB.`
  return null
}

export interface ReviewEvent {
  id: number; action: Decision | 'undo'; status: string; previous_status: string; reviewer: string | null
  previous_reviewer: string | null; note: string | null; previous_note: string | null; undoes: number | null
  undone_by: number | null; created_at: string | null; has_photo: boolean
}

type Rec = { id: string; review?: Record<string, unknown> | null }

export function patchReviewCaches(qc: QueryClient, row: ReviewRow) {
  const { area, ref_id, status } = row
  for (const key of [['review', area], ['review', null]]) {
    qc.setQueryData<ReviewRow[]>(key, (xs) => xs?.map((x) => (x.id === row.id ? { ...x, ...row, object: x.object } : x)))
  }
  qc.setQueryData<Rec[]>([row.item_type === 'building' ? 'buildings' : 'assets', area],
    (xs) => xs?.map((x) => (x.id === ref_id ? { ...x, review: { ...(x.review ?? {}), status } } : x)))
  qc.setQueryData<AreaGeoJSON>(['geo', area], (g) => g && {
    ...g, features: g.features.map((f) => (f.properties?.id === ref_id && f.properties?.kind !== 'streetlight_gap'
      ? { ...f, properties: { ...f.properties, review_status: status } } : f)),
  })
  qc.invalidateQueries({ queryKey: ['detail', area, row.item_type, ref_id] })
}
