/** extras 2–4 on the VERIFIER pages (Under the Hood, Trust): the city-scale projection (an estimate, a range from our
 *  runs), our businesses vs OpenStreetMap, and OpenStreetMap's building:levels vs our floor counts. Every number comes
 *  from GET /projection and GET /areas/{slug}/osm; nothing is computed here. */
import { useOsmReference, useProjection } from '@/api/queries'
import { fmt, plural } from '@/lib/utils'

const sig2 = (v: number) => { if (v <= 0) return 0; const d = Math.floor(Math.log10(v)) - 1; return d > 0 ? Math.round(v / 10 ** d) * 10 ** d : Math.round(v) }
const range = (lo: number, hi: number, unit = '', millionFrom = 1e6) => hi >= millionFrom
  ? `${unit}${sig2(lo) / 1e6} – ${unit}${sig2(hi) / 1e6} million` : `${unit}${fmt.format(sig2(lo))} – ${unit}${fmt.format(sig2(hi))}`

export function ProjectionTable({ city }: { city?: string | null }) {
  const { data: p, isPending, isError } = useProjection()
  if (isPending) return <p className="t-small ink3">Loading the projection…</p>
  if (isError || !p?.available || !p.cities) return <p className="t-small ink3">Not available{p?.note ? `: ${p.note}` : ''}.</p>
  return (
    <>
      <table className="w-full text-[15px]" aria-label="City-scale projection">
        <thead><tr className="t-micro text-left">{['Whole city', 'Streets', 'Street View photos', 'Cost (list price)', 'GPU time', 'Colab days'].map((h) => <th key={h} className="py-1.5 pr-3 font-normal">{h}</th>)}</tr></thead>
        <tbody>
          {p.cities.map((c) => (
            <tr key={c.city} className="rule-t" style={city === c.name ? { boxShadow: 'inset 3px 0 0 var(--ns-sodium)' } : undefined}>
              <td className="py-1.5 pl-2 pr-3">{c.name}</td>
              <td className="t-data py-1.5 pr-3">about {fmt.format(Math.round(c.km))} km</td>
              <td className="t-data py-1.5 pr-3">{range(c.photos.low, c.photos.high, '', 1e5)}</td>
              <td className="t-data py-1.5 pr-3">{range(c.usd.low, c.usd.high, '$')}</td>
              <td className="t-data py-1.5 pr-3">{c.gpu_hours ? `${fmt.format(Math.round(c.gpu_hours.low))} – ${fmt.format(Math.round(c.gpu_hours.high))} h` : '—'}</td>
              <td className="t-data py-1.5 pr-3">{c.colab_days ? `${fmt.format(Math.round(c.colab_days.low))} – ${fmt.format(Math.round(c.colab_days.high))}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="t-small ink2 mt-3 space-y-1">{p.assumptions?.map((a) => <li key={a}>• {a}</li>)}</ul>
    </>
  )
}

export function OsmShopsSummary({ area }: { area: string | null }) {
  const { data, isPending } = useOsmReference(area)
  if (isPending) return <p className="t-small ink3">Loading…</p>
  const sh = data?.shops
  if (!sh?.available || !sh.counts) return <p className="t-small ink3">{sh?.note ?? 'Not available.'}</p>
  const n = sh.counts
  return (
    <>
      <p className="text-[17px]">Our camera found <b className="font-[600]">{plural(n.camera, 'business', 'businesses')}</b>; OpenStreetMap lists <b className="font-[600]">{fmt.format(n.osm)}</b> along these streets.</p>
      <dl className="t-small mt-2 grid max-w-[520px] grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        <dt>Same place (within {sh.match_m} m)</dt><dd className="t-data text-right">{fmt.format(n.matched)} <span className="ink3">({fmt.format(n.matched_same_name)} also the same name)</span></dd>
        <dt>Seen by our camera, not in OpenStreetMap</dt><dd className="t-data text-right">{fmt.format(n.camera_only)}</dd>
        <dt>In OpenStreetMap, not seen by our camera</dt><dd className="t-data text-right">{fmt.format(n.osm_only)}</dd>
        <dt className="ink3">Other OpenStreetMap points left out (worship, schools, ATMs …)</dt><dd className="t-data ink3 text-right">{fmt.format(n.osm_other_points)}</dd>
      </dl>
      <p className="t-small ink2 mt-2">{sh.rule}</p>
      <p className="t-small ink3 mt-1">{sh.note} OpenStreetMap names looked up {sh.fetched?.slice(0, 10)}; point positions from the app's copy (snapshot {sh.osm_snapshot}). Ask “Businesses not in OpenStreetMap” to see them on the map.</p>
    </>
  )
}

export function OsmLevelsSummary({ area }: { area: string | null }) {
  const { data } = useOsmReference(area)
  const lv = data?.levels
  if (!lv?.available) return <p className="t-small ink3">{lv?.note ?? 'Not available.'}</p>
  return (
    <>
      <p className="t-small">{fmt.format(lv.tagged ?? 0)} of {plural(lv.buildings ?? 0, 'analysed building')} carry OpenStreetMap's building:levels tag;
        {' '}{lv.compared ? <>of the {fmt.format(lv.compared)} we also counted, {fmt.format(lv.exact ?? 0)} agree exactly and {fmt.format(lv.within_1 ?? 0)} within one floor.</> : <>none of them has a floor count from us.</>}
        {' '}<span className="ink3">Too few to measure accuracy; our counts are never changed by it.</span></p>
      {!!lv.rows?.length && <ul className="t-small ink2 mt-1">{lv.rows.map((r) => <li key={r.id}><span className="t-data">{r.id}</span> · {r.street}: OpenStreetMap {r.osm_levels}, ours {r.ours ?? 'not counted'}</li>)}</ul>}
      <p className="t-small ink3 mt-1">{lv.note}</p>
      <p className="t-small ink2 mt-2"><b className="font-[600]">Floor-count confidence</b> (shown in the building card and the report): {data?.floor_rule}</p>
    </>
  )
}
