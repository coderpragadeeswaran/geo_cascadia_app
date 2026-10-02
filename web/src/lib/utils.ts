import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const fmt = new Intl.NumberFormat('en-IN')
export const fmt1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 })

/** Singular / plural in one place (review fix 14): noun(1, 'floor') → 'floor', noun(2, 'floor') → 'floors'. */
const PLURALS: Record<string, string> = { stretch: 'stretches', 'dark stretch': 'dark stretches', 'possible dark stretch': 'possible dark stretches', business: 'businesses', match: 'matches',
  'pole or streetlight': 'poles and streetlights', 'shop or business': 'shops & businesses', copy: 'copies', person: 'people' }
export const noun = (n: number, one: string, many?: string) => (n === 1 ? one : many ?? PLURALS[one] ?? `${one}s`)
/** "1 building", "2 buildings", "1,234 dark stretches" (Indian digit grouping, like fmt) */
export const plural = (n: number, one: string, many?: string) => `${fmt.format(n)} ${noun(n, one, many)}`

/** "a" or "an" by sound, in one place: an apartment, an office, a house, a university, a one-storey, an hour, an NGO */
export function article(word: string) {
  const w = word.trim().toLowerCase()
  if (!w) return 'a'
  if (/^(uni|use|usu|uti|eu|ewe|one|once)/.test(w)) return 'a'
  if (/^(hour|honest|honou?r|heir)/.test(w)) return 'an'
  if (/^[A-Z]{2,}(\s|$)/.test(word.trim()) &&/^[aefhilmnorsx]/i.test(w)) return 'an'   // spoken letters: an NGO, an MRI
  return /^[aeiou]/.test(w) ? 'an' : 'a'
}
/** "a house" / "An apartment" (capitalised when the sentence starts with it) */
export const withArticle = (phrase: string, capital = false) => {
  const a = article(phrase)
  return `${capital ? a.charAt(0).toUpperCase() + a.slice(1) : a} ${phrase}`
}

/** a per-object VLM cost: calls were made but the run stored no cost (the pipeline did not record the floors call's
 *  tokens, e.g. 163 Ward 29 buildings store 1 call at $0.0) -> "cost not recorded", never a made-up amount */
export function costText(calls: number, amount: number | null | undefined) {
  if (calls > 0 && !amount) return 'cost not recorded'
  return usd(amount ?? 0)
}

/** US dollars with `digits` decimals; a positive amount that would round to zero shows "< $0.0001" (never "$0.0000") */
export function usd(v: number | null | undefined, digits = 4) {
  if (v == null || !Number.isFinite(v)) return '—'
  const step = 10 ** -digits
  if (v > 0 && v < step / 2) return `< $${step.toFixed(digits)}`
  return `$${v.toFixed(digits)}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** P8: a Street View capture month "2023-03" → "Mar 2023" (null when unknown) */
export function monthText(d: string | null | undefined) {
  const m = /^(\d{4})-(\d{2})/.exec(d ?? '')
  return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : null
}
/** P8: whole months between a capture month and today (the imagery-age rule: older than 36 months = may be outdated) */
export function monthsAgo(d: string | null | undefined, now = new Date()) {
  const m = /^(\d{4})-(\d{2})/.exec(d ?? '')
  return m ? now.getFullYear() * 12 + now.getMonth() - (+m[1] * 12 + +m[2] - 1) : null
}
export const OLD_PHOTO_MONTHS = 36
