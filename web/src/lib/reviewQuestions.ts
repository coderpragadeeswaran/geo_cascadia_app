/** ui-polish-2 (D59): each review item asked as a plain question, answered Yes / No. Pure (no React), so
 *  scripts/test-ui.ts checks every reason in the data. Yes always means "the finding is right" (stored as approved),
 *  No means it is not (rejected), so the stored statuses and every count built on them keep their meaning.
 *  A question about a value (floors, use, a sign name) offers the reviewer's corrected value after a No; it is saved with
 *  the decision (review_items.corrected) and never written over the AI's value or the register. */
import { floorsText, useLabel } from './labels'
import { plural } from './utils'

export type ValueKind = 'floors' | 'use' | 'name'
export type Corrected = Partial<{ floors: number; use: string; name: string }>
/** building uses a reviewer can pick (the pipeline's values; backend review.USES) */
export const USE_OPTIONS = ['residential', 'commercial', 'mixed', 'institutional', 'industrial', 'under_construction', 'other'] as const

export interface QBuilding {
  attributes?: { use?: { value?: string | null } | null; floors?: { value?: number | null; status?: string | null } | null; name?: { value?: string | null } | null } | null
  register?: { record_use?: string | null; record_floors?: number | null; record_area_m2?: number | null; record_dist_m?: number | null } | null
  footprint?: { area_m2?: number | null } | null
  match_status?: string | null; discrepancies?: string[] | null
}
export interface QAsset { type?: string | null; register?: { record_type?: string | null } | null }
export interface QItem { item_type: 'building' | 'asset'; reasons: string[]; discrepancies?: string[] | null; asset_cls?: string | null }

export interface Question {
  /** which kind of question (also the reason it answers): stable keys for tests and the outcome line */
  kind: 'missing' | 'register' | 'floors' | 'use' | 'name' | 'box' | 'asset' | 'other'
  text: string
  /** extra lines under the question (one per register difference) */
  lines?: string[]
  /** the values a No can correct, with the value we have now (shown in the field's label) */
  values: { kind: ValueKind; current: string | number | null }[]
  /** the plain reasons this question covers (the pipeline's, as reviewReasons words them) */
  covers: string[]
}
export interface Asked { main: Question; also: Question[]; hint: string | null }

const lower = (u: string | null | undefined) => (u ? useLabel(u).toLowerCase() : 'use not known')
const floorsWord = (n: number | null | undefined) => (n == null ? 'an unknown number of floors' : plural(n, 'floor'))
const m = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)} m`)
const REGISTER_DIFFS = ['missing_record', 'extra_floor', 'use_change', 'location_shift', 'area_understated', 'type_mismatch']

/** the question(s) for one review item. main = the one the Yes / No answers; also = value checks the reviewer can
 *  correct on the way (e.g. a floor estimate on a building that is not in the register); hint = "seen once" context. */
export function reviewQuestions(item: QItem, b?: QBuilding | null, a?: QAsset | null): Asked {
  const R = item.reasons ?? []
  const diffs = (item.discrepancies?.length ? item.discrepancies : b?.discrepancies) ?? []
  const has = (re: RegExp) => R.some((r) => re.test(r))
  const qs: Question[] = []
  const at = b?.attributes, reg = b?.register
  const floors = at?.floors?.value ?? null
  const use = at?.use?.value ?? null

  // 1. the register: "high-severity discrepancy" / "attribute discrepancy" name the finding they are about
  const registerReason = has(/^high-severity discrepancy/) || has(/^attribute discrepancy/)
  if (registerReason) {
    if (b?.match_status === 'no_record' || diffs.includes('missing_record')) {
      qs.push({ kind: 'missing', text: 'Is there a building here that’s missing from the register?', values: [], covers: ['Not in the register'] })
    } else {
      const lines: string[] = [], values: Question['values'] = [], covers: string[] = []
      const attrOnly = has(/^attribute discrepancy/) && !has(/^high-severity discrepancy/)
      for (const d of diffs.filter((x) => REGISTER_DIFFS.includes(x) && (!attrOnly || x === 'extra_floor' || x === 'use_change'))) {
        if (d === 'extra_floor') { lines.push(`The register says ${floorsWord(reg?.record_floors)}, the photo suggests ${floorsWord(floors)}.`); values.push({ kind: 'floors', current: floors }); covers.push('Extra floor vs register') }
        if (d === 'use_change') { lines.push(`The register says ${lower(reg?.record_use)}, the photo suggests ${lower(use)}.`); values.push({ kind: 'use', current: use }); covers.push('Use differs from register') }
        if (d === 'location_shift') { lines.push(`The register’s pin for this building is ${m(reg?.record_dist_m)} away from it.`); covers.push('Register pin in the wrong place') }
        if (d === 'area_understated') { lines.push(`The register says ${m(reg?.record_area_m2)}², the map outline is ${m(b?.footprint?.area_m2)}².`); covers.push('Bigger than recorded') }
      }
      if (lines.length === 1 && covers[0] === 'Register pin in the wrong place') {
        qs.push({ kind: 'register', text: `${lines[0]} Is the pin in the wrong place?`, values: [], covers })
      } else if (lines.length === 1 && covers[0] === 'Bigger than recorded') {
        qs.push({ kind: 'register', text: `${lines[0]} Is the building bigger than recorded?`, values: [], covers })
      } else if (lines.length === 1) {
        qs.push({ kind: 'register', text: `${lines[0]} Is the photo right?`, values, covers })
      } else if (lines.length > 1) {
        qs.push({ kind: 'register', text: 'The photo and the register differ. Is the photo right?', lines, values, covers })
      } else {
        qs.push({ kind: 'register', text: 'The photo and the register differ. Is the photo right?', values: [], covers: ['Differs from the register'] })
      }
    }
  }
  // assets: a register type mismatch (not in today's queue; asked the same way if it ever is)
  if (item.item_type === 'asset' && diffs.includes('type_mismatch')) {
    qs.push({ kind: 'register', text: `The register lists this as a ${a?.register?.record_type ?? 'different type'}; the photo shows a ${a?.type ?? item.asset_cls ?? 'pole'}. Is the photo right?`, values: [], covers: ['Recorded as a different type'] })
  }
  // 2. value checks
  if (has(/^floor count low confidence/)) {
    qs.push({ kind: 'floors', text: `Does this building have ${floorsWord(floors)}?`, values: [{ kind: 'floors', current: floors }], covers: ['Floor count is an estimate (roof not visible)'] })
  }
  if (R.some((r) => /\buse\b/i.test(r) && /(low confidence|not known|unknown|unclassified)/i.test(r))) {
    qs.push({ kind: 'use', text: use ? `Is this building ${lower(use)}?` : 'What is this building used for?', values: [{ kind: 'use', current: use }], covers: ['Use is an estimate'] })
  }
  if (has(/^name read by VLM only/)) {
    const name = at?.name?.value ?? null
    qs.push({ kind: 'name', text: name ? `Does the sign say “${name}”?` : 'Can you read the shop sign?', values: [{ kind: 'name', current: name }], covers: ['Shop name read by the AI model only'] })
  }
  // 3. seen once: the question itself when it is the only reason, else context for the main question
  const oneView = has(/^building seen from one view only/), onePhoto = has(/^single-detection asset/)
  const kind = item.asset_cls === 'streetlight' || a?.type === 'streetlight' ? 'streetlight' : 'pole'
  if (!qs.length && oneView) qs.push({ kind: 'box', text: 'Does the orange box show this building?', values: [], covers: ['Seen from one camera position only'] })
  if (!qs.length && onePhoto) qs.push({ kind: 'asset', text: `Is there a ${kind} in the orange box?`, values: [], covers: ['Seen in one photo only'] })
  // 4. anything else, word for word
  const known = /^(high-severity discrepancy|attribute discrepancy|floor count low confidence|name read by VLM only|building seen from one view only|single-detection asset)/
  for (const r of R.filter((x) => !known.test(x) && !(/\buse\b/i.test(x) && /(low confidence|not known|unknown|unclassified)/i.test(x)))) {
    qs.push({ kind: 'other', text: `${r.charAt(0).toUpperCase()}${r.slice(1).replace(/\s*[—–�-]\s*verify on imagery/, '')}. Is that right?`, values: [], covers: [r] })
  }
  if (!qs.length) qs.push({ kind: 'other', text: 'Is the finding right?', values: [], covers: [] })
  const [main, ...also] = qs
  const hint = qs.some((q) => q.kind === 'box' || q.kind === 'asset') ? null
    : oneView ? 'Seen from one camera position only, so look closely.' : onePhoto ? `Seen in one photo only, so look closely.` : null
  return { main, also, hint }
}

/** every value a No can correct for this item (main question first, no duplicates) */
export function correctable(q: Asked) {
  const out: Question['values'] = []
  for (const x of [q.main, ...q.also]) for (const v of x.values) if (!out.some((o) => o.kind === v.kind)) out.push(v)
  return out
}

/** "2 floors · Shop + home · sign reads “…”" (the reviewer's value; backend report.reviewer_says says the same) */
export function reviewerSays(c: Corrected | null | undefined) {
  if (!c) return null
  const p = [c.floors != null ? floorsText(c.floors) : null, c.use ? useLabel(c.use) : null, c.name ? `sign reads “${c.name}”` : null].filter(Boolean)
  return p.length ? p.join(' · ') : null
}

/** "Reviewer says: …" for the corrected values other than the one the main question already named */
const rest = (c: Corrected, skip: keyof Corrected) => { const { [skip]: _, ...o } = c; const says = reviewerSays(o); return says ? ` Reviewer says: ${says}.` : '' }

/** one line after a decision: what was saved, in plain words */
export function outcomeLine(q: Asked, answer: 'yes' | 'no' | 'appeal', corrected?: Corrected | null) {
  if (answer === 'appeal') return 'Saved: sent back with your note for another look.'
  const says = reviewerSays(corrected)
  const tail = says ? ` Reviewer says: ${says}.` : ''
  const v = q.main.values[0]
  const yes = answer === 'yes'
  switch (q.main.kind) {
    case 'missing': return (yes ? 'Saved: reviewer confirmed it’s missing from the register.' : 'Saved: reviewer says it’s not a building missing from the register.') + tail
    case 'register': return (yes ? 'Saved: reviewer says the photo is right; the register differs.' : 'Saved: reviewer says the register is right, not the photo.') + tail
    case 'floors': return yes ? `Saved: reviewer confirmed ${floorsWord(v?.current as number | null)}.`
      : corrected?.floors != null ? `Saved: reviewer says it has ${floorsWord(corrected.floors)}, not ${v?.current ?? 'the number we counted'}.${rest(corrected, 'floors')}`
        : `Saved: reviewer says it doesn’t have ${floorsWord(v?.current as number | null)}.${tail}`
    case 'use': return yes ? `Saved: reviewer confirmed it’s ${lower(v?.current as string | null)}.`
      : corrected?.use ? `Saved: reviewer says it’s ${lower(corrected.use)}, not ${lower(v?.current as string | null)}.${rest(corrected, 'use')}`
        : `Saved: reviewer says it isn’t ${lower(v?.current as string | null)}.${tail}`
    case 'name': return yes ? 'Saved: reviewer confirmed the sign.'
      : corrected?.name ? `Saved: reviewer says the sign reads “${corrected.name}”.${rest(corrected, 'name')}` : `Saved: reviewer says the sign reads differently.${tail}`
    case 'box': return yes ? 'Saved: reviewer confirmed the orange box is this building.' : 'Saved: reviewer says the orange box is not this building.' + tail
    case 'asset': return yes ? 'Saved: reviewer confirmed it’s there.' : 'Saved: reviewer says there’s nothing there.' + tail
    default: return (yes ? 'Saved: reviewer says yes.' : 'Saved: reviewer says no.') + tail
  }
}

/** the answer a stored status stands for (approved = Yes, rejected = No) */
export const answerOf = (status: string | null | undefined) => (status === 'approved' ? 'Yes' : status === 'rejected' ? 'No' : status === 'appealed' ? 'Sent back' : null)
