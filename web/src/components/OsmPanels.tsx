/** extras 3–4 on the VERIFIER pages (Under the Hood, Trust): our businesses vs OpenStreetMap, and OpenStreetMap's
 *  building:levels vs our floor counts. Every number comes from GET /areas/{slug}/osm; nothing is computed here. */
import { useOsmReference } from '@/api/queries'
import { fmt, plural } from '@/lib/utils'

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
        <dt>Near each other (within {sh.match_m} m, location only)</dt><dd className="t-data text-right">{fmt.format(n.matched)} <span className="ink3">({!n.matched ? 'none' : !n.matched_same_name ? 'names didn’t match' : `${fmt.format(n.matched_same_name)} with the same name`})</span></dd>
        <dt>Seen by our camera, not in OpenStreetMap</dt><dd className="t-data text-right">{fmt.format(n.camera_only)}</dd>
        <dt>In OpenStreetMap, not seen by our camera</dt><dd className="t-data text-right">{fmt.format(n.osm_only)}</dd>
        <dt className="ink3">Other OpenStreetMap points left out (worship, schools, ATMs …)</dt><dd className="t-data ink3 text-right">{fmt.format(n.osm_other_points)}</dd>
      </dl>
      <p className="t-small ink2 mt-2">{sh.rule}</p>
      <p className="t-small ink3 mt-1">{sh.note} OpenStreetMap names looked up {sh.fetched?.slice(0, 10)}; point positions from the app's copy (snapshot {sh.osm_snapshot}). Ask “Businesses not in OpenStreetMap” to see them on the map.</p>
    </>
  )
}

/** ui-polish-2: fewer compared buildings than this = "too few to compare" (one plain line on Under the Hood) */
const LEVELS_MIN_COMPARE = 20

export function OsmLevelsSummary({ area, brief = false }: { area: string | null; brief?: boolean }) {
  const { data } = useOsmReference(area)
  const lv = data?.levels
  if (!lv?.available) return <p className="t-small ink3">{lv?.note ?? 'Not available.'}</p>
  if (brief) return (
    <p className="t-small" aria-label="OpenStreetMap floor counts">OpenStreetMap has floor counts for {fmt.format(lv.tagged ?? 0)} of {plural(lv.buildings ?? 0, 'building')}
      {(lv.compared ?? 0) < LEVELS_MIN_COMPARE ? ' — too few to compare.' : <>; of the {fmt.format(lv.compared ?? 0)} we also counted, {fmt.format(lv.exact ?? 0)} agree exactly and {fmt.format(lv.within_1 ?? 0)} within one floor.</>}</p>
  )
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
