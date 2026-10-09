/** P7.3: street-name consistency picker. For each street of the area: every name our sources give it (OpenStreetMap,
 *  Google's geocoding vote, the street picker's rule, the synthetic register, Google Places), mismatches flagged, and a
 *  choice of the name to DISPLAY. The default choice is the street picker's rule (F2: OSM name → Google's name for the road
 *  itself → "Unnamed road between / near …"). A pick is stored on the server (data/street_name_picks.json) and the area is
 *  reloaded; source files are never changed. Needs the database (offline = read only). */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, api } from '@/api/client'
import { fmt } from '@/lib/utils'
import { useUi } from '@/store/ui'

export interface NameSource { source: string; label: string; name: string | null; note: string | null }
export interface StreetNameRow { raw: string; length_m: number | null; current: string; default: string; mismatch: boolean
  f2: { name: string | null; rule: string } | null; sources: NameSource[] }
interface NamesResponse { available: boolean; generated: string | null; streets: StreetNameRow[]; picks: Record<string, string> }

/** D66: plain labels by source (the stored list says "Street picker rule (F2)", an internal step name) */
const SOURCE_LABEL: Record<string, string> = { osm: 'OpenStreetMap', google: 'Google (the analysis’s vote)', f2: 'Street picker rule', register: 'Register (synthetic)', places: 'Google Places' }

/** the names a person can choose from: every source's name, plus the current display name */
export const nameChoices = (r: StreetNameRow) =>
  [...new Set([r.default, r.current, ...r.sources.map((s) => s.name)].filter((x): x is string => !!x && !x.startsWith('(unnamed')))]

/** the area's name list; Under the Hood hides the whole section when the area has none (D66) */
export const useStreetNames = (slug: string | null | undefined) =>
  useQuery({ queryKey: ['street-names', slug], queryFn: () => api<NamesResponse>(`/areas/${slug}/street-names`), enabled: !!slug, staleTime: 30_000 })

export function StreetNames({ slug }: { slug: string }) {
  const qc = useQueryClient()
  const offline = useUi((s) => s.offline)
  const { data, isPending, isError } = useStreetNames(slug)
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [choice, setChoice] = useState<Record<string, string>>({})
  if (isPending) return <div className="h-24 animate-pulse rounded-[var(--ns-r-control)] bg-line" />
  if (isError || !data) return <p className="t-small ink2">The street names could not be loaded.</p>
  if (!data.available) return null
  const rows = data.streets.filter((r) => all || r.mismatch)
  const n = data.streets.filter((r) => r.mismatch).length
  const save = async (r: StreetNameRow, name: string) => {
    setBusy(r.raw); setErr(null)
    try {
      await api(`/areas/${slug}/street-names`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: r.raw, name }) })
      await Promise.all([qc.invalidateQueries({ queryKey: ['street-names', slug] }), qc.invalidateQueries()])
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not save the name') } finally { setBusy(null) }
  }
  return (
    <div>
      <p className="t-small ink2">{n ? `${n} of ${data.streets.length} streets have more than one name in our sources.` : `All ${data.streets.length} streets have one name in our sources.`}{' '}
        <button className="link" onClick={() => setAll(!all)}>{all ? 'Show only mismatches' : 'Show all streets'}</button></p>
      {err && <p className="t-small mt-1" style={{ color: 'var(--ns-no-record)' }}>{err}</p>}
      <ul className="mt-3 space-y-4">
        {rows.map((r) => {
          const shown = data.picks[r.raw] ?? r.current
          const pick = choice[r.raw] ?? data.picks[r.raw] ?? r.default
          return (
            <li key={r.raw} className="rule-b pb-3">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <b>{shown}</b>
                {r.length_m != null && <span className="t-data ink3">{fmt.format(r.length_m)} m</span>}
                {r.mismatch && <span className="t-small" style={{ color: 'var(--ns-sodium)' }}>names differ</span>}
                {data.picks[r.raw] && <span className="t-small ink3">picked by a person</span>}
              </div>
              <dl className="t-small mt-1 grid grid-cols-[170px_1fr] gap-y-0.5">
                {r.sources.map((s) => (
                  <div key={s.source} className="contents"><dt className="ink3">{SOURCE_LABEL[s.source] ?? s.label}</dt>
                    <dd>{s.name ?? <span className="ink3">—</span>}{s.note && <span className="ink3"> · {s.note}</span>}</dd></div>
                ))}
              </dl>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="t-small ink2" htmlFor={`pick-${r.raw}`}>Show it as</label>
                <select id={`pick-${r.raw}`} className="t-small rounded-[var(--ns-r-control)] bg-transparent px-2 py-1" style={{ boxShadow: 'inset 0 0 0 1px var(--ns-line-strong)' }}
                  value={pick} onChange={(e) => setChoice((c) => ({ ...c, [r.raw]: e.target.value }))}>
                  {nameChoices(r).map((x) => <option key={x} value={x}>{x}{x === r.default ? ' (default: street picker rule)' : ''}</option>)}
                </select>
                <button className="btn btn-line" disabled={offline || busy === r.raw || pick === shown} onClick={() => save(r, pick)}>
                  {busy === r.raw ? 'Saving…' : offline ? 'Offline — read only' : 'Use this name'}</button>
              </div>
            </li>
          )
        })}
      </ul>
      <p className="t-small ink3 mt-2">A choice changes only how the street is displayed (map, records, charts). The sources above are never changed.{data.generated ? ` Names gathered ${data.generated.replace('T', ' ')}.` : ''}</p>
    </div>
  )
}
