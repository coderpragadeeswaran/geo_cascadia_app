/** D60: what to show for a stored Street View photo Google may no longer serve (pure; wording tested in test:ui).
 *  served → the stored photo with its boxes, as before. gone + a current panorama nearby → that photo, aimed at the same
 *  target, without boxes (they belong to the old photo). gone + nothing nearby → no photo request at all. */
import type { CurrentPhoto } from '@/api/types'
import { monthText } from './utils'

export type SwapState = 'checking' | 'served' | 'swapped' | 'none'
export interface Swap { state: SwapState; current: CurrentPhoto | null; original: string | null }

/** from a known answer (the evidence API's `served` / `current`, or GET /photos/{pano}) */
export function swapOf(served: boolean | null | undefined, current: CurrentPhoto | null | undefined, original?: string | null): Swap {
  if (served === false) return { state: current ? 'swapped' : 'none', current: current ?? null, original: original ?? null }
  return { state: 'served', current: null, original: original ?? null }
}

/** "newer" only when Google's capture month really is later than the analysis photo's */
export function swapWhen(s: Swap): 'newer' | 'same_month' | 'older' | null {
  const a = s.current?.date, b = s.original
  if (!a || !b) return null
  return a === b ? 'same_month' : a > b ? 'newer' : 'older'
}

/** the plain label under a replaced photo */
export function swapNote(s: Swap): string | null {
  if (s.state === 'none') return 'No Street View photo available here any more: Google no longer serves the photo used in the analysis and has no other photo within 25 m of where it was taken.'
  if (s.state !== 'swapped' || !s.current) return null
  const m = monthText(s.current.date)
  const w = swapWhen(s)
  const head = `${w === 'newer' ? 'Newer' : 'Current'} photo${m ? ` (${m})` : ''} — Google no longer serves the photo used in the analysis, so its boxes can’t be shown.`
  if (w === 'same_month') return `${head} Same capture month, taken ${s.current.moved_m < 1 ? 'from the same spot' : `${Math.round(s.current.moved_m)} m away`}: Google now serves it under a new ID.`
  if (w === 'older') return `${head} It is older than the analysis photo.`
  return head
}
