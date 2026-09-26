import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const fmt = new Intl.NumberFormat('en-IN')
export const fmt1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 })

/** Singular / plural in one place (review fix 14): noun(1, 'floor') → 'floor', noun(2, 'floor') → 'floors'. */
const PLURALS: Record<string, string> = { stretch: 'stretches', 'dark stretch': 'dark stretches', business: 'businesses', match: 'matches',
  'pole or streetlight': 'poles and streetlights', 'shop or business': 'shops & businesses', copy: 'copies', person: 'people' }
export const noun = (n: number, one: string, many?: string) => (n === 1 ? one : many ?? PLURALS[one] ?? `${one}s`)
/** "1 building", "2 buildings", "1,234 dark stretches" (Indian digit grouping, like fmt) */
export const plural = (n: number, one: string, many?: string) => `${fmt.format(n)} ${noun(n, one, many)}`
