/** Client-side derivations from the full records (D2: counts computed from records, never stored strings).
 *  KPI formulas mirror the pipeline's workspace.build_dashboard, so with no filter they equal the API dashboard. */
import type { Asset, Building, QueryResponse, ReviewRow, UnmappedBusiness } from '@/api/types'
import { EMPTY_FILTER, type Filter } from '@/store/ui'

export const NOT_CLASSIFIED = 'not classified'
export const useOf = (b: Building) => b.attributes?.use?.value ?? null
export const floorsOf = (b: Building) => b.attributes?.floors
export const nameOf = (b: Building) => b.attributes?.name

const onStreet = (s: string | null | undefined, street: string | null) => !street || s === street

export function matchBuilding(b: Building, f: Filter, inReview?: Set<string>) {
  if (!onStreet(b.street, f.street)) return false
  if (f.match && b.match_status !== f.match) return false
  if (f.use === '__none' ? useOf(b) !== null : f.use && useOf(b) !== f.use) return false
  const q = nameOf(b)?.quality
  if (f.nameQ === 'good' && q !== 'good') return false
  if (f.nameQ === 'unverified' && q !== 'fragment' && q !== 'tamil_unverified') return false
  if (f.google && !nameOf(b)?.google_confirmed) return false
  if (f.review && !(inReview ? inReview.has(b.id) : b.review?.status === 'pending')) return false
  return true
}

export function matchAsset(a: Asset, f: Filter) {
  if (!onStreet(a.street, f.street)) return false
  if (f.assetType && a.type !== f.assetType) return false
  if (f.triangulated && a.method !== 'triangulated') return false
  if (f.review && a.review?.status !== 'pending') return false
  return true
}

export const matchUnmapped = (u: UnmappedBusiness, f: Filter) => onStreet(u.street, f.street)

export interface Records { buildings: Building[]; assets: Asset[]; unmapped: UnmappedBusiness[]; review: ReviewRow[]; gaps: { street: string }[] }

/** dashboard.kpi (build_dashboard) + use_not_classified (D9) + assets_triangulated + gaps, optionally for one street */
export function kpis(r: Records, street: string | null) {
  const B = r.buildings.filter((b) => onStreet(b.street, street))
  const A = r.assets.filter((a) => onStreet(a.street, street))
  return {
    streets_covered: new Set(B.map((b) => b.street)).size,
    buildings_analysed: B.length,
    unmatched_properties: B.filter((b) => b.match_status === 'no_record').length,
    buildings_with_discrepancy: B.filter((b) => b.match_status === 'discrepancy').length,
    use_not_classified: B.filter((b) => useOf(b) === null).length,
    streetlights: A.filter((a) => a.type === 'streetlight').length,
    poles: A.filter((a) => a.type === 'pole').length,
    assets_triangulated: A.filter((a) => a.method === 'triangulated').length,
    assets: A.length,
    streetlight_gaps: r.gaps.filter((g) => onStreet(g.street, street)).length,
    named_businesses: B.filter((b) => nameOf(b)?.quality === 'good').length,
    sign_text_unverified: B.filter((b) => ['tamil_unverified', 'fragment'].includes(nameOf(b)?.quality ?? '')).length,
    names_confirmed_by_google: B.filter((b) => !!nameOf(b)?.google_confirmed).length,
    low_confidence_observations: r.review.filter((q) => onStreet(q.street, street)).length,
    /** P5 fix: "Waiting for review" counts only items still waiting (decided items drop out) */
    waiting_for_review: r.review.filter((q) => q.status === 'pending' && onStreet(q.street, street)).length,
    unmapped_businesses: r.unmapped.filter((u) => onStreet(u.street, street)).length,
  }
}
export type Kpis = ReturnType<typeof kpis>

/** KPI definitions in plain words (docs/DESIGN.md declutter rule 2: five numbers + More). Every dashboard.kpi value
 *  stays reachable; "use not known" (D9) is one of the five. */
export interface KpiDef {
  /** `one`: the label when the count is exactly 1 ("Dark stretch"), see kpiLabel */
  key: keyof Kpis; label: string; one?: string; main?: boolean; tone?: 'no-record' | 'discrepancy' | 'unclassified' | 'review' | 'matched'
  apply?: Partial<Filter>; sub?: string; overview?: boolean
}
export const KPI_DEFS: KpiDef[] = [
  { key: 'buildings_analysed', label: 'Buildings checked', one: 'Building checked', main: true, apply: {} },
  { key: 'unmatched_properties', label: 'Not in register', main: true, tone: 'no-record', apply: { match: 'no_record' } },
  { key: 'buildings_with_discrepancy', label: 'Differ from register', one: 'Differs from register', main: true, tone: 'discrepancy', apply: { match: 'discrepancy' } },
  { key: 'streetlight_gaps', label: 'Dark stretches', one: 'Dark stretch', main: true, apply: { gaps: true }, sub: 'no streetlight seen in 60 m' },
  { key: 'use_not_classified', label: 'Use not known', main: true, tone: 'unclassified', apply: { use: '__none' } },
  { key: 'streetlights', label: 'Streetlights', one: 'Streetlight', apply: { subject: 'assets', assetType: 'streetlight' } },
  { key: 'poles', label: 'Poles, no lamp seen', one: 'Pole, no lamp seen', apply: { subject: 'assets', assetType: 'pole' } },
  { key: 'named_businesses', label: 'Shop names read clearly', one: 'Shop name read clearly', apply: { nameQ: 'good' } },
  { key: 'names_confirmed_by_google', label: 'Also on Google Maps', apply: { google: true } },
  { key: 'sign_text_unverified', label: 'Signs to double-check', one: 'Sign to double-check', apply: { nameQ: 'unverified' } },
  { key: 'waiting_for_review', label: 'Waiting for review', tone: 'review', apply: { review: true } },
  { key: 'unmapped_businesses', label: 'Businesses with no mapped building', one: 'Business with no mapped building', apply: { subject: 'unmapped' } },
  { key: 'streets_covered', label: 'Streets', one: 'Street', overview: true },
]
/** singular / plural KPI label for a count (walkthrough 2 fix 5) */
export const kpiLabel = (d: KpiDef, n: number | null | undefined) => (n === 1 && d.one ? d.one : d.label)
/** the filter a KPI click applies (keeps the selected street) */
export const kpiFilter = (d: KpiDef, street: string | null): Filter => ({ ...EMPTY_FILTER, ...(d.apply ?? {}), street })

const count = <T,>(xs: T[], key: (x: T) => string | null | undefined) => {
  const m = new Map<string, number>()
  for (const x of xs) { const k = key(x); if (k != null) m.set(k, (m.get(k) ?? 0) + 1) }
  return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
}

export function charts(r: Records, street: string | null, streetNames: string[]) {
  const B = r.buildings.filter((b) => onStreet(b.street, street))
  const A = r.assets.filter((a) => onStreet(a.street, street))
  const measured = B.filter((b) => floorsOf(b)?.status === 'measured' && floorsOf(b)?.value != null)
  const floors = count(measured, (b) => `${floorsOf(b)!.value}`).sort((a, b) => +a.name - +b.name)
  const streets = (street ? [street] : streetNames).map((s) => {
    const on = r.buildings.filter((b) => b.street === s)
    return { name: s, value: on.filter((b) => b.match_status === 'no_record').length, buildings: on.length }
  }).filter((x) => x.buildings > 0).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
  return {
    building_use: count(B, (b) => useOf(b) ?? NOT_CLASSIFIED),
    floor_distribution: floors, floors_n: measured.length,
    floors_status: count(B, (b) => floorsOf(b)?.status ?? 'not_measured'),
    asset_type: count(A, (a) => a.type),
    match_status: count(B, (b) => b.match_status),
    discrepancy_type: count(B.flatMap((b) => b.discrepancies ?? []), (d) => d),
    unmatched_by_street: streets,
  }
}

/** Ids the map should emphasise (everything else is dimmed). null = no emphasis for that layer. */
export interface Focus {
  buildings: Set<string> | null; assets: Set<string> | null; unmapped: Set<string> | null; gaps: Set<string> | null
  streets: Set<string> | null; key: string
}
const NONE: Focus = { buildings: null, assets: null, unmapped: null, gaps: null, streets: null, key: '' }

export function focusOf(r: Records | null, f: Filter, q: QueryResponse | null, gapStreets: Map<string, string>): Focus {
  if (!r) return NONE
  const street = f.street ? new Set([f.street]) : null
  // a partly understood question is not applied to the map until the person accepts it (docs/QUERY.md)
  if (q && (q.accepted || !q.understanding || q.understanding.status === 'ok')) {
    const ids = (kind: string) => new Set((q.rows ?? []).filter((x) => x.kind === kind || (kind === 'asset' && (x.kind === 'pole' || x.kind === 'streetlight'))).map((x) => String(x.id)))
    const empty = new Set<string>()
    switch (q.intent) {
      case 'buildings':
        if (q.groups) return { ...NONE, streets: f.street ? new Set([f.street]) : new Set(q.groups.map((g) => g.key)), key: `q:${q.text}:${f.street}` }
        return { buildings: ids('building'), assets: empty, unmapped: empty, gaps: empty, streets: street, key: `q:${q.text}` }
      case 'assets':
        return { buildings: empty, assets: ids('asset'), unmapped: empty, gaps: empty, streets: street, key: `q:${q.text}` }
      case 'streetlight_gaps':
        return { buildings: empty, assets: empty, unmapped: empty, gaps: ids('streetlight_gap'),
          streets: q.parsed_filters.street ? new Set([q.parsed_filters.street]) : null, key: `q:${q.text}` }
      case 'review': {
        const rows = (q.rows ?? []) as unknown as { item_type: string; ref_id: string }[]
        return { buildings: new Set(rows.filter((x) => x.item_type === 'building').map((x) => x.ref_id)),
          assets: new Set(rows.filter((x) => x.item_type === 'asset').map((x) => x.ref_id)), unmapped: empty, gaps: empty,
          streets: street, key: `q:${q.text}` }
      }
    }
  }
  // choosing a record type in the table (buildings / assets / unmapped) is not a filter: only a street or an attribute
  // filter emphasises the map
  const attr = !!(f.match || f.use || f.nameQ || f.google || f.review || f.assetType || f.triangulated || f.gaps)
  if (!f.street && !attr) return NONE
  const onlyStreet = !attr
  const inStreet = <T extends { street?: string | null; id: string }>(xs: T[]) => new Set(xs.filter((x) => !f.street || x.street === f.street).map((x) => x.id))
  const gaps = new Set([...gapStreets].filter(([, s]) => !f.street || s === f.street).map(([id]) => id))
  const empty = new Set<string>()
  if (onlyStreet) return { buildings: inStreet(r.buildings), assets: inStreet(r.assets), unmapped: inStreet(r.unmapped), gaps, streets: street, key: `s:${f.street}` }
  const key = `f:${JSON.stringify(f)}`
  if (f.gaps) return { buildings: empty, assets: empty, unmapped: empty, gaps, streets: street, key }
  if (f.subject === 'assets') return { buildings: empty, assets: new Set(r.assets.filter((a) => matchAsset(a, f)).map((a) => a.id)), unmapped: empty, gaps: empty, streets: street, key }
  if (f.subject === 'unmapped') return { buildings: empty, assets: empty, unmapped: new Set(r.unmapped.filter((u) => matchUnmapped(u, f)).map((u) => u.id)), gaps: empty, streets: street, key }
  return { buildings: new Set(r.buildings.filter((b) => matchBuilding(b, f)).map((b) => b.id)),
    assets: f.review ? new Set(r.assets.filter((a) => matchAsset(a, f)).map((a) => a.id)) : empty, unmapped: empty, gaps: empty, streets: street, key }
}
