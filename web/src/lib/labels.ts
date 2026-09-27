/** Plain-language labels for the USER screens (Explore, Analyse, Review, Drive). Technical values (routes, tiers,
 *  confidences, n) stay behind "How do we know?" and on the verifier pages (docs/DECISIONS.md D16). */
import { plural } from './utils'

export const pretty = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ') : '—')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** building register match (synthetic register) */
export const MATCH: Record<string, { short: string; long: string }> = {
  matched: { short: 'Matches', long: 'Matches the register' },
  discrepancy: { short: 'Differs', long: 'Differs from the register' },
  no_record: { short: 'Not in register', long: 'Not in the register' },
}
/** P5 fix: a "matched" building whose use is not known was never compared on use, so it is not "Matches the register"
 *  but "Register entry exists — use not compared". Pass useKnown wherever the building's use is at hand. */
export const MATCHED_USE_UNKNOWN = { short: 'Entry exists', long: 'Register entry exists — use not compared' }
export const matchLabel = (s: string | null | undefined, long = false, useKnown = true) =>
  (s === 'matched' && !useKnown ? MATCHED_USE_UNKNOWN[long ? 'long' : 'short'] : s && MATCH[s] ? MATCH[s][long ? 'long' : 'short'] : pretty(s))

/** asset register status (synthetic register) */
export const ASSET_REG: Record<string, { short: string; long: string; status: 'matched' | 'discrepancy' | 'no_record' | null }> = {
  matched: { short: 'In register', long: 'In the register', status: 'matched' },
  discrepancy: { short: 'Differs', long: 'Differs from the register', status: 'discrepancy' },
  unrecorded_asset: { short: 'Not in register', long: 'Not in the register', status: 'no_record' },
  unconfirmed_detection: { short: 'Seen once', long: 'Seen in one photo only: needs a second look', status: null },
}
export const assetRegLabel = (s: string | null | undefined, long = false) => (s && ASSET_REG[s] ? ASSET_REG[s][long ? 'long' : 'short'] : pretty(s))

/** observed use */
export function useLabel(u: string | null | undefined) {
  if (!u) return 'Use not known'
  return ({ mixed: 'Shop + home', other: 'Other', under_construction: 'Under construction' } as Record<string, string>)[u] ?? cap(u)
}
/** "a shop" / "a house" for sentences */
export function useNoun(u: string | null | undefined) {
  return ({ commercial: 'shop or business', residential: 'home', institutional: 'institution', mixed: 'shop with homes above',
    under_construction: 'building under construction' } as Record<string, string>)[u ?? ''] ?? 'building'
}

/** discrepancy types → what differs, in plain words */
export const DIFF: Record<string, string> = {
  extra_floor: 'more floors than recorded',
  use_change: 'used differently than recorded',
  location_shift: 'record pinned in the wrong place',
  area_understated: 'bigger than recorded',
  missing_record: 'no register record',
  type_mismatch: 'recorded as a different type',
}
export const diffLabel = (d: string) => DIFF[d] ?? pretty(d)

export const GAP_TYPE: Record<string, string> = {
  'poles present, no lamp detected': 'poles, but no streetlight seen',
  'no pole or lamp detected': 'no pole or streetlight seen',
}
export const gapTypeLabel = (t: string | null | undefined) => (t ? GAP_TYPE[t] ?? t : '—')

export const REVIEW: Record<string, string> = { pending: 'Waiting for review', approved: 'Approved', rejected: 'Rejected', appealed: 'Appealed' }
export const reviewLabel = (s: string | null | undefined) => (s ? REVIEW[s] ?? pretty(s) : '—')

export const floorsText = (n: number | null | undefined, status?: string | null) =>
  n == null ? 'Floors not known' : `${plural(n, 'floor')}${status === 'low_confidence' ? ' (estimate)' : ''}`

/** area name for display: no "Unseen street:" prefix, no pipeline version suffix ("(v2)") */
export const shortArea = (name: string) => name.replace(/^Unseen street: /, '').replace(/\s*\(v\d+\)\s*$/, '')

/** a difference, as a review reason ("Extra floor vs register") */
export const REASON_DIFF: Record<string, string> = {
  missing_record: 'Not in the register',
  extra_floor: 'Extra floor vs register',
  use_change: 'Use differs from register',
  location_shift: 'Register pin in the wrong place',
  area_understated: 'Bigger than recorded',
  type_mismatch: 'Recorded as a different type',
}
const ATTRIBUTE_DIFFS = new Set(['extra_floor', 'use_change'])

/** The pipeline's review reasons in plain words, named after the finding they are about (so a no-record building is
 *  never "a big difference from the register", and a discrepancy names the actual difference). Deduplicated. */
export function reviewReasons(reasons: string[], finding: { match_status?: string | null; discrepancies?: string[] | null } = {}) {
  const diffs = (finding.discrepancies ?? []).filter((d) => d !== 'missing_record')
  const out: string[] = []
  const add = (s: string) => { if (s && !out.includes(s)) out.push(s) }
  for (const r of reasons) {
    if (r === 'high-severity discrepancy') {
      if (finding.match_status === 'no_record') add(REASON_DIFF.missing_record)
      else if (diffs.length) diffs.forEach((d) => add(REASON_DIFF[d] ?? pretty(d)))
      else add('Differs from the register')
    } else if (/^attribute discrepancy/.test(r)) {
      const a = diffs.filter((d) => ATTRIBUTE_DIFFS.has(d))
      if (a.length) a.forEach((d) => add(REASON_DIFF[d]))
      else if (finding.match_status === 'no_record') add(REASON_DIFF.missing_record)
      else add('Differs from the register')
    } else if (r === 'single-detection asset') add('Seen in one photo only')
    else if (r === 'building seen from one view only') add('Seen from one camera position only')
    else if (/^floor count low confidence/.test(r)) add('Floor count is an estimate (roof not visible)')
    else if (/^name read by VLM only/.test(r)) add('Shop name read by the AI model only')
    else add(r.charAt(0).toUpperCase() + r.slice(1).replace(/\s*[—–�-]\s*verify on imagery/, ''))
  }
  return out
}

/** Predicted building position method (D27), as a badge: plain words; the technical name is positionMethodTerm */
export function positionMethodLabel(p: { method: string; n_cameras: number }) {
  if (p.method === 'triangulated') return `Where ${plural(p.n_cameras, 'camera view')} cross`
  if (p.method === 'wall_hit') return 'Where the camera’s line of sight meets the front wall on the map'
  return 'Middle of the building outline on the map (fallback)'
}
/** the technical name of the method, for the small grey hint */
export const positionMethodTerm = (method: string) =>
  method === 'triangulated' ? 'triangulated' : method === 'wall_hit' ? 'wall hit, uses the map footprint' : 'footprint centre'
/** the badge's tooltip: how the point was found (and why the camera views were not used, when they were rejected) */
export function positionMethodWhy(p: { method: string; reason?: string | null }) {
  const base = p.method === 'triangulated' ? 'The two ends of the front wall were located from 2 or more camera positions; the point is halfway between them.'
    : p.method === 'wall_hit' ? 'Where the best camera’s line of sight meets the building’s street-facing wall on the map (so it depends on the map outline).'
      : 'No camera’s line of sight reached the street-facing wall, so the middle of the building outline is used.'
  const m = p.reason ? /\(([\d.]+) m from ([^)]+)\)/.exec(p.reason) : null
  const why = p.reason ? (m ? ` The camera views were not used: they put the building ${m[1]} m from the ${m[2]}, which is not plausible (the limit is 10 m).` : ` ${p.reason}.`) : ''
  return base + why
}

/** floor count status, name quality and Google flags in plain words */
export const floorsStatusPlain = (s: string | null | undefined) =>
  s === 'measured' ? 'measured from the photo' : s === 'low_confidence' ? 'an estimate: the roof was not clearly visible' : s === 'not_measured' ? 'not measured' : pretty(s)
export const nameQualityPlain = (q: string | null | undefined) =>
  q === 'good' ? 'read clearly' : q === 'fragment' ? 'only partly readable' : q === 'tamil_unverified' ? 'Tamil text, not confirmed' : pretty(q)
export const googleFlagPlain = (f: string) =>
  f === 'sign_not_in_google_within_40m' ? 'The sign name is not on Google Maps within 40 m'
    : f === 'google_business_but_observed_residential' ? 'Google lists a business here, but the photo shows a home' : pretty(f)

/** A job's status for people (review fix 13): a cancelled job is stored as failed + "cancelled by user" but shown as
 *  "Cancelled" in a neutral colour; "failed" (red) is kept for real failures. */
export const CANCELLED_MESSAGE = 'cancelled by user'
const JOB_STATUS: Record<string, [string, string]> = {
  queued: ['Queued', 'var(--ns-sodium)'], running: ['Running', 'var(--ns-sodium)'], done: ['Done', 'var(--ns-matched)'],
  failed: ['Failed', 'var(--ns-no-record)'], cancelled: ['Cancelled', 'var(--ns-ink3)'],
  no_street_view: ['No Street View', 'var(--ns-discrepancy)'], expired_token: ['Paused: key expired', 'var(--ns-sodium)'],
  interrupted: ['Interrupted', 'var(--ns-sodium-glow)'],
}
/** the pipeline's stages in order (what the P6 worker reports as job.stage) */
export const JOB_STAGES = ['panoramas', 'area', 'plan', 'detect', 'geometry', 'ocr', 'vlm', 'reference', 'match', 'export']
/** P5: the API's display_status adds "interrupted" (running, no heartbeat for 10 min) and "cancelled" */
export function jobStatus(j: { status: string; message?: string | null; display_status?: string }) {
  const k = j.display_status ?? (j.status === 'failed' && j.message === CANCELLED_MESSAGE ? 'cancelled' : j.status)
  const [label, color] = JOB_STATUS[k] ?? [pretty(k), 'var(--ns-ink2)']
  return { key: k, label, color }
}
