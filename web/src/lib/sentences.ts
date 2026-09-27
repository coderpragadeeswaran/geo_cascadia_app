/** Findings as plain sentences, computed from the records (D2: never copied from stored strings).
 *  e.g. "Korathottam Road: 9 buildings not in the register", "376 m of Sathy Main Road has no visible streetlight".
 *  Streetlight wording is "no visible streetlight" / "no streetlight seen": the detector sees lamps in photos; it cannot
 *  tell whether a lamp works (docs/DECISIONS.md D16). Lengths are the pipeline's recorded lengths (D13). */
import type { GapProps } from '@/api/types'
import type { Kpis, Records } from './derive'
import { DIFF } from './labels'
import { fmt, plural } from '@/lib/utils'


export interface Sentence {
  key: string
  text: string
  sub?: string
  tone?: 'no_record' | 'discrepancy' | 'dark' | 'unknown' | 'review' | 'unmapped' | 'neutral'
  /** what a click does */
  action?: { kpi?: string; street?: string; page?: 'review' }
}

const byStreet = <T extends { street?: string | null }>(xs: T[]) => {
  const m = new Map<string, number>()
  for (const x of xs) if (x.street) m.set(x.street, (m.get(x.street) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/** "What stands out" for an area */
export function areaSentences(r: Records, k: Kpis, gaps: GapProps[]): Sentence[] {
  const out: Sentence[] = []
  const noRec = r.buildings.filter((b) => b.match_status === 'no_record')
  if (noRec.length) {
    const [top] = byStreet(noRec)
    out.push({ key: 'no_record', tone: 'no_record', action: { kpi: 'unmatched_properties' },
      text: `${plural(noRec.length, 'building')} ${noRec.length === 1 ? 'is' : 'are'} not in the register`,
      sub: top && noRec.length > 1 ? `${fmt.format(top[1])} of them on ${top[0]}` : undefined })
  }
  const diff = r.buildings.filter((b) => b.match_status === 'discrepancy')
  if (diff.length) {
    const kinds = new Map<string, number>()
    for (const b of diff) for (const d of b.discrepancies ?? []) if (d !== 'missing_record') kinds.set(d, (kinds.get(d) ?? 0) + 1)
    const top = [...kinds.entries()].sort((a, b) => b[1] - a[1])[0]
    out.push({ key: 'discrepancy', tone: 'discrepancy', action: { kpi: 'buildings_with_discrepancy' },
      text: `${plural(diff.length, 'building')} ${diff.length === 1 ? 'differs' : 'differ'} from the register`,
      sub: top ? `most often: ${DIFF[top[0]] ?? top[0].replace(/_/g, ' ')} (${fmt.format(top[1])})` : undefined })
  }
  if (gaps.length) {
    const total = gaps.reduce((n, g) => n + g.length_m, 0)
    const longest = [...gaps].sort((a, b) => b.length_m - a.length_m)[0]
    out.push({ key: 'dark', tone: 'dark', action: { kpi: 'streetlight_gaps' },
      text: `${fmt.format(Math.round(total))} m of road has no visible streetlight`,
      sub: `${plural(gaps.length, 'stretch', 'stretches')}; longest ${fmt.format(Math.round(longest.length_m))} m on ${longest.street}` })
  }
  if (k.unmapped_businesses) {
    out.push({ key: 'unmapped', tone: 'unmapped', action: { kpi: 'unmapped_businesses' },
      text: `${plural(k.unmapped_businesses, 'business', 'businesses')} ${k.unmapped_businesses === 1 ? 'has' : 'have'} no building on the map`,
      sub: 'shop signs read on frontage with no building outline' })
  }
  if (k.use_not_classified) {
    out.push({ key: 'unknown', tone: 'unknown', action: { kpi: 'use_not_classified' },
      text: `Use not known for ${plural(k.use_not_classified, 'building')}`, sub: `of ${fmt.format(k.buildings_analysed)}: no clear photo of the front` })
  }
  if (k.waiting_for_review) {
    out.push({ key: 'review', tone: 'review', action: { page: 'review' },
      text: `${plural(k.waiting_for_review, 'item')} ${k.waiting_for_review === 1 ? 'is' : 'are'} waiting for a person to check` })
  }
  return out
}

/** One street, in sentences (street panel + street hover) */
export function streetSentences(r: Records, street: string, gaps: GapProps[]): Sentence[] {
  const B = r.buildings.filter((b) => b.street === street)
  const A = r.assets.filter((a) => a.street === street)
  const G = gaps.filter((g) => g.street === street)
  const out: Sentence[] = []
  const n = (s: string) => B.filter((b) => b.match_status === s).length
  if (n('no_record')) out.push({ key: 'nr', tone: 'no_record', text: `${street}: ${plural(n('no_record'), 'building')} not in the register`, action: { kpi: 'unmatched_properties', street } })
  if (n('discrepancy')) out.push({ key: 'di', tone: 'discrepancy', text: `${street}: ${plural(n('discrepancy'), 'building')} ${n('discrepancy') === 1 ? 'differs' : 'differ'} from the register`, action: { kpi: 'buildings_with_discrepancy', street } })
  for (const g of [...G].sort((a, b) => b.length_m - a.length_m)) {
    out.push({ key: `g${g.id}`, tone: 'dark', text: `${fmt.format(Math.round(g.length_m))} m of ${street} has no visible streetlight`, action: { kpi: 'streetlight_gaps', street } })
  }
  const lamps = A.filter((a) => a.type === 'streetlight').length, poles = A.filter((a) => a.type === 'pole').length
  out.push({ key: 'seen', tone: 'neutral', text: `${plural(B.length, 'building')} checked · ${plural(lamps, 'streetlight')} and ${plural(poles, 'pole')} seen` })
  return out
}

/** One line per street for the overview's "By street" list */
export function streetLine(r: Records, street: string, gaps: GapProps[]) {
  const B = r.buildings.filter((b) => b.street === street)
  const parts: string[] = []
  const nr = B.filter((b) => b.match_status === 'no_record').length
  const di = B.filter((b) => b.match_status === 'discrepancy').length
  const dark = gaps.filter((g) => g.street === street).reduce((n, g) => n + g.length_m, 0)
  if (nr) parts.push(`${fmt.format(nr)} not in register`)
  if (di) parts.push(`${fmt.format(di)} differ`)
  if (dark) parts.push(`${fmt.format(Math.round(dark))} m dark`)
  return { street, buildings: B.length, text: parts.join(' · ') || 'nothing stands out', weight: nr * 2 + di + dark / 100 }
}

/** Header sentence for a KPI panel */
export function kpiSentence(key: string, k: Kpis): string {
  const n = (k as unknown as Record<string, number>)[key] ?? 0
  switch (key) {
    case 'buildings_analysed': return `${plural(n, 'building')} checked`
    case 'unmatched_properties': return `${plural(n, 'building')} ${n === 1 ? 'is' : 'are'} not in the register`
    case 'buildings_with_discrepancy': return `${plural(n, 'building')} ${n === 1 ? 'differs' : 'differ'} from the register`
    case 'use_not_classified': return `Use not known for ${plural(n, 'building')}`
    case 'streetlight_gaps': return `${plural(n, 'stretch', 'stretches')} of road with no visible streetlight`
    case 'streetlights': return `${plural(n, 'streetlight')} seen`
    case 'poles': return `${plural(n, 'pole')} seen (no lamp on them)`
    case 'named_businesses': return `${plural(n, 'shop name')} read clearly from signs`
    case 'names_confirmed_by_google': return `${plural(n, 'shop name')} also found on Google Maps`
    case 'sign_text_unverified': return `${plural(n, 'sign')} to double-check`
    case 'low_confidence_observations': return `${plural(n, 'item')} sent to a person to check`
    case 'waiting_for_review': return `${plural(n, 'item')} waiting for a person to check`
    case 'unmapped_businesses': return `${plural(n, 'business', 'businesses')} with no building on the map`
    case 'streets_covered': return `${plural(n, 'street')} analysed`
    default: return ''
  }
}
