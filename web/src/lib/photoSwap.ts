/** D60: what to show for a stored Street View photo Google may no longer serve (pure; wording tested in test:ui).
 *  served → the stored photo with its boxes, as before. gone + a current panorama nearby → that photo, aimed at the same
 *  target, without boxes (they belong to the old photo). gone + nothing nearby → no photo request at all.
 *  D61: gone + a VERIFIED re-issue (same capture month, ≤ 5 m, the detector finds the saved boxes again) → 'same': the
 *  same photo under its new id, at the stored heading / pitch / fov, with the saved boxes, as before. */
import type { CurrentPhoto } from '@/api/types'
import { monthText } from './utils'

export type SwapState = 'checking' | 'served' | 'same' | 'swapped' | 'none'
export interface Swap { state: SwapState; current: CurrentPhoto | null; original: string | null }

/** from a known answer (the evidence API's `served` / `current`, or GET /photos/{pano}) */
export function swapOf(served: boolean | null | undefined, current: CurrentPhoto | null | undefined, original?: string | null): Swap {
  if (served === false) return { state: current ? (current.same_image ? 'same' : 'swapped') : 'none', current: current ?? null, original: original ?? null }
  return { state: 'served', current: null, original: original ?? null }
}

/** "newer" only when Google's capture month really is later than the analysis photo's */
export function swapWhen(s: Swap): 'newer' | 'same_month' | 'older' | null {
  const a = s.current?.date, b = s.original
  if (!a || !b) return null
  return a === b ? 'same_month' : a > b ? 'newer' : 'older'
}

/** D61: the boxes are drawn (the stored photo, or the same photo under a new id) */
export const showsBoxes = (s: Swap) => s.state === 'served' || s.state === 'same'

/** D61: the photo actually requested: a verified re-issue is the stored view with the new panorama id */
export function shownView<V extends { pano_id: string }>(s: Swap, view: V): V | CurrentPhoto {
  if (s.state === 'same' && s.current) return { ...view, pano_id: s.current.pano_id }
  if (s.state === 'swapped' && s.current) return s.current
  return view
}

export const SAME_NOTE = 'Same photo under a new Google ID'

/** the plain label under a replaced photo */
export function swapNote(s: Swap): string | null {
  if (s.state === 'same') return SAME_NOTE
  if (s.state === 'none') return 'No Street View photo available here any more: Google no longer serves the photo used in the analysis and has no other photo within 25 m of where it was taken.'
  if (s.state !== 'swapped' || !s.current) return null
  const m = monthText(s.current.date)
  const w = swapWhen(s)
  const head = `${w === 'newer' ? 'Newer' : 'Current'} photo${m ? ` (${m})` : ''} — Google no longer serves the photo used in the analysis, so its boxes can’t be shown.`
  // D61: a same-month photo a few metres away is a neighbouring photo of the same drive, not the analysis photo under a new
  // ID (the detector re-run on 40 of them found the saved boxes shifted, median overlap 0.49)
  if (w === 'same_month') return `${head} Taken on the same drive, ${s.current.moved_m < 1 ? 'less than 1 m' : `${Math.round(s.current.moved_m)} m`} from the analysis camera: a neighbouring photo, not the one the analysis used.`
  if (w === 'older') return `${head} It is older than the analysis photo.`
  return head
}
