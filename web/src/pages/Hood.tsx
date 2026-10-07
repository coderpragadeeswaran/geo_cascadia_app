/** Under the Hood (VERIFIER page, D16; P5 / D29): how the pipeline turned Street View into findings, as a scroll story.
 *  Every number comes from GET /areas/{slug}/hood, computed from the records and the run's own files (D2); nothing is
 *  copied from story[] text or meta.run counters. Plain / Technical changes the words, never the numbers. Each chapter
 *  opens 3 real examples. Timings and run cost counters come from resumed runs: greyed and badged (D1). Anchors
 *  (#/hood/<id>) are the targets of "How do we know?" links: streets, cameras, imagery, detection, signs, routed,
 *  buildings, positions (assets), matched, findings (streetlights), flow, dropped, streets-table, cost, story, compare. */
import { AlertTriangle, ArrowRight, GitCompareArrows, MapPin } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useHood, useHoods, type Hood as HoodData, type Routing as RoutingData, type RouteRow, type StreetRow } from '@/api/p5'
import { useAreas } from '@/api/queries'
import { Card, CountUp, jumpTo, REDUCED, SectionNav, T, useDetail, useInView, useScrollSpy } from '@/components/Detail'
import { ExampleSheet } from '@/components/ExampleSheet'
import { GeoMini } from '@/components/GeoMini'
import { OsmLevelsSummary, OsmShopsSummary } from '@/components/OsmPanels'
import { StreetNames } from '@/components/StreetNames'
import { AlignedBars, Donut, Funnel, SegBar, StageTimeline } from '@/components/viz'
import { KPI_DEFS, kpiFilter } from '@/lib/derive'
import { shortArea, CAMERA_ONLY_TIP, cameraOnlyText } from '@/lib/labels'
import { MATCH_LEGEND, REGISTER_NOTE, assetPoints, buildingPolys, darkLines, miniStreets } from '@/lib/mini'
import { useAreaData } from '@/lib/useAreaData'
import { cn, fmt, monthText, noun, plural, usd } from '@/lib/utils'
import { useUi } from '@/store/ui'

const Sankey = lazy(() => import('@/components/Sankey'))
type Pick = (key: string, label: string) => void
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—')
const NAV: [string, string][] = [
  ['overview', 'Coverage & summary'], ['streets', '01 · Streets planned'], ['cameras', '02 · Camera positions'], ['imagery', '03 · Photos fetched'],
  ['detection', '04 · Objects detected'], ['signs', '05 · Signs read'], ['routed', '06 · Local or cloud AI'], ['buildings', '07 · Floors and use'],
  ['positions', '08 · Positions'], ['matched', '09 · Matched'], ['findings', '10 · Findings'], ['flow', 'Whole pipeline'],
  ['dropped', 'What got dropped'], ['streets-table', 'Street by street'], ['street-names', 'Street names'], ['routing', 'Routing and cost'], ['cost', 'Time and cost'],
  ['osm', 'Businesses vs OpenStreetMap'],
]

export default function Hood() {
  const area = useUi((s) => s.area)
  const setArea = useUi((s) => s.setArea)
  const section = useUi((s) => s.section)
  const { data: areas } = useAreas()
  const [compare, setCompare] = useState(section === 'compare')
  const hood = useHood(area)
  const h = hood.data
  const [ex, setEx] = useState<{ key: string; label: string } | null>(null)
  const pick: Pick = (key, label) => setEx({ key, label })
  useEffect(() => { if (section === 'compare') setCompare(true) }, [section])
  useEffect(() => {
    if (!h || !section || section === 'compare') return
    const t = setTimeout(() => document.getElementById(section)?.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }), 120)
    return () => clearTimeout(t)
  }, [h, section, area])
  const sorted = [...(areas ?? [])].sort((a, b) => b.counts.buildings - a.counts.buildings)
  const scroller = useRef<HTMLDivElement>(null)
  const active = useScrollSpy(NAV.map(([id]) => id), scroller, [h, compare])
  const showNav = !compare && !!h
  return (
    <div className={cn('grid h-full', showNav ? 'grid-cols-[210px_minmax(0,1fr)]' : 'grid-cols-1')}>
      {showNav && <div className="min-h-0 overflow-y-auto" style={{ borderRight: '1px solid var(--ns-line)' }}><SectionNav items={NAV} active={active} onJump={jumpTo} /></div>}
    <div ref={scroller} className="h-full min-w-0 overflow-y-auto px-10 py-8" id="hood-scroll">
      <div className="mx-auto max-w-[960px]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="t-micro">Under the hood · how the results were produced</div>
        </div>
        <h1 className="t-display mt-2 mb-2">{compare ? 'Three runs, side by side' : h ? `How ${shortArea(h.name)} was analysed` : 'Loading the run…'}</h1>
        <p className="t-small ink2 mb-4 max-w-[700px]">
          <T plain="Follow the photos from Street View to the findings on the map. Every number is counted from the results themselves; open “see real examples” at any step to check it."
            tech={<>Numbers: <span className="t-data">GET /areas/{'{slug}'}/hood</span>, computed from export.json records and the run files (panos, plan, plan_anomalies, _views_done, detections, ocr, building_views, vlm_unmapped). Never from story[] text or meta.run counters (D2). Timings: resumed runs (D1).</>} />
        </p>
        <div className="mb-8 flex flex-wrap gap-1" role="tablist" aria-label="Area">
          {sorted.map((a) => (
            <button key={a.slug} role="tab" aria-selected={!compare && a.slug === area} className={cn('btn', !compare && a.slug === area ? 'btn-line' : '')}
              onClick={() => { setCompare(false); setArea(a.slug) }}>{shortArea(a.name)}</button>
          ))}
          <button role="tab" aria-selected={compare} className={cn('btn', compare && 'btn-line')} onClick={() => setCompare(true)}><GitCompareArrows /> Compare all {sorted.length || 3}</button>
        </div>
        {compare ? <Compare slugs={sorted.map((a) => a.slug)} onOpen={(s) => { setCompare(false); setArea(s) }} />
          : hood.isError ? <ErrorState retry={() => hood.refetch()} />
            : !h ? <Skeleton />
              : <Story h={h} pick={pick} />}
      </div>
      {ex && area && <ExampleSheet area={area} exKey={ex.key} label={ex.label} onClose={() => setEx(null)} />}
    </div>
    </div>
  )
}

function Skeleton() {
  return <div className="space-y-6" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-[var(--ns-r-sheet)] bg-line" />)}<p className="t-small ink3">Counting the run…</p></div>
}
function ErrorState({ retry }: { retry: () => void }) {
  return <p className="t-small ink2">Couldn’t load this run’s numbers. <button className="link" onClick={retry}>Try again</button></p>
}

// ---------------------------------------------------------------------------------------------------- the story
function Story({ h, pick }: { h: HoodData; pick: Pick }) {
  const n = h.n
  const detail = useDetail()
  const { streets, geo, area } = useAreaData()
  const mini = useMemo(() => miniStreets(streets), [streets])
  const exBtn = (key: string, label: string) => ({ key, label })
  const pipe = h.pipeline ?? {}
  // every count defaults to 0 (never NaN), e.g. when an older API has no "sign" count yet
  const use = { local: h.routes.use.local ?? 0, vlm: h.routes.use.vlm ?? 0, sign: h.routes.use.sign ?? 0, unknown: h.routes.use.unknown ?? 0 }
  const chapters: Chapter[] = [
    { id: 'streets', title: 'Streets planned', figure: n.streets, unit: noun(n.streets, 'street'),
      plain: `${fmt.format(n.streets_m)} m of road were chosen. Everything below happened along ${n.streets === 1 ? 'this street' : `these ${n.streets} streets`}.`,
      tech: `streets.json: ${n.streets} merged OSM streets, ${fmt.format(n.streets_m)} m (display names from street_names.json).`,
      visual: () => geo ? <GeoMini area={area} streets={mini} lit fit="area" stops="all" height={230}
        label={`The ${plural(n.streets, 'analysed street')} with the camera stops along them`}
        caption="Hover a street for its name and length; the small ticks are the camera stops." /> : null,
      examples: [exBtn('streets', 'Streets analysed')] },
    { id: 'cameras', title: 'Camera positions', figure: n.cameras, unit: 'camera positions',
      plain: `Instead of photographing every panorama in all 12 directions, the planner chose ${plural(n.cameras, 'camera position')} that face the buildings.${n.cameras_inside_footprint ? ` ${plural(n.cameras_inside_footprint, 'position')} ${n.cameras_inside_footprint === 1 ? 'was' : 'were'} dropped: the camera stood inside a building outline.` : ''} Of the other panoramas, ${fmt.format(n.panoramas_off_street)} lie more than 15 m from the analysed streets and ${fmt.format(n.panoramas_thinned)} were thinned out because a camera position a few metres away was already chosen.`,
      tech: `panos.json ${fmt.format(n.panoramas)} (${n.panoramas_user} user photospheres; ${n.cameras_user} used as stops) → plan.json ${n.cameras} stops; plan_anomalies.json camera_inside_footprint ${n.cameras_inside_footprint}; not selected ${fmt.format(n.panoramas_not_selected)} = off street (> 15 m, plan.py assignment) ${fmt.format(n.panoramas_off_street)} + thinned (thin_m 12 m / min_sep_m 6 m, or piece < min_seg_m 25 m) ${fmt.format(n.panoramas_thinned)}.`,
      visual: (run) => <SegBar run={run} onPick={pick} unit="panoramas" segs={[
        { key: 'kept', label: 'chosen as camera positions', value: n.cameras, kind: 'kept', examples: 'cameras.kept' },
        { key: 'off', label: 'not on an analysed street', value: n.panoramas_off_street, kind: 'idle', examples: n.panoramas_off_street ? 'panos.off_street' : null },
        { key: 'thin', label: 'on the street, thinned', value: n.panoramas_thinned, kind: 'idle', examples: n.panoramas_thinned ? 'panos.thinned' : null },
        { key: 'drop', label: 'dropped: inside a building outline', value: n.cameras_inside_footprint, kind: 'drop', examples: n.cameras_inside_footprint ? 'cameras.inside' : null }]} />,
      examples: [exBtn('cameras.kept', 'Camera positions'), ...(n.cameras_inside_footprint ? [exBtn('cameras.inside', 'Dropped camera positions')] : [])] },
    { id: 'imagery', title: 'Photos fetched', figure: n.views_fetched || n.views, unit: 'photos',
      plain: `${fmt.format(n.views)} Street View photos were taken from those positions. ${fmt.format(n.views_mapped)} face a building on the map; ${fmt.format(n.views_unmapped)} (${pct(n.views_unmapped, n.views)}) face frontage with no building outline, where only lights and signs can be read.`,
      tech: `plan.json views ${fmt.format(n.views)} (${fmt.format(n.views_tilted)} tilted up for rooflines); _views_done.json ${fmt.format(n.views_fetched)} fetched; footprint == null ${fmt.format(n.views_unmapped)}. Billed at the Static API price (model_card).`,
      visual: (run) => <SegBar run={run} onPick={pick} unit="photos" segs={[
        { key: 'm', label: 'face a mapped building', value: n.views_mapped, kind: 'kept', examples: 'views.mapped' },
        { key: 'u', label: 'map has no building outline', value: n.views_unmapped, kind: 'idle', examples: 'views.unmapped' }]} />,
      examples: [exBtn('views.mapped', 'Photos facing a mapped building'), exBtn('views.unmapped', 'Photos where the map has no building outline')] },
    { id: 'detection', title: 'Objects detected', figure: n.boxes, unit: 'boxes',
      plain: `A detector running without the cloud drew boxes around ${fmt.format(n.boxes_building)} buildings, ${fmt.format(n.boxes_signboard)} signs, ${fmt.format(n.boxes_pole)} poles and ${fmt.format(n.boxes_lamp_head)} lamp heads in the photos. These are photo boxes, not objects: one pole is usually boxed in several photos, and the boxes of the same pole or lamp are merged into ${plural(n.assets, 'pole or streetlight', 'poles and streetlights')} on the map. ${fmt.format(n.boxes_tilted + n.boxes_user)} boxes came from tilted or public photos and are not used to place anything on the map.`,
      tech: `${pipe.detector ?? 'YOLO'} → detections.json ${fmt.format(n.boxes)} boxes; geom_ok ${fmt.format(n.boxes_geom_ok)}; excluded: tilted view ${fmt.format(n.boxes_tilted)}, user photosphere ${fmt.format(n.boxes_user)}.`,
      visual: (run) => <SegBar run={run} onPick={pick} unit="boxes" segs={[
        { key: 'ok', label: 'usable for positions', value: n.boxes_geom_ok, kind: 'kept', examples: 'det.building' },
        { key: 't', label: 'tilted photo', value: n.boxes_tilted, kind: 'drop', examples: n.boxes_tilted ? 'det.tilted' : null },
        { key: 'u', label: 'public photosphere', value: n.boxes_user, kind: 'drop', examples: n.boxes_user ? 'det.user' : null }]} />,
      examples: [exBtn('det.building', 'Building boxes'), exBtn('det.signboard', 'Sign boxes'), exBtn('det.pole', 'Pole boxes'), exBtn('det.lamp_head', 'Lamp-head boxes')] },
    { id: 'signs', title: 'Signs read', figure: n.sign_crops, unit: 'sign crops',
      plain: `Every sign was cut out and read by OCR on the machine first. ${fmt.format(n.signs_ocr)} were read directly; ${fmt.format(n.signs_vlm)} were unclear and went to the cloud model; ${fmt.format(n.signs_no_text)} had no readable name. ${plural(n.named, 'building')} got a name from a sign; ${fmt.format(n.named_good)} of those were read clearly (the “shop names read clearly” number on the map; the rest are partly readable or unconfirmed Tamil) and ${fmt.format(n.named_google)} are also on Google Maps. ${n.unmapped_kept ? `${plural(n.unmapped_kept, 'business', 'businesses')} were found on no analysed building.` : ''} A sign stays with the building its photo was aimed at, unless its own line of sight clearly hits another building${n.signs_relinked ? ` (${fmt.format(n.signs_relinked)} signs moved that way)` : ''}.`,
      tech: `ocr.json tiers: 2 OCR ${n.signs_ocr}, 3 VLM ${n.signs_vlm}, 1 no text ${n.signs_no_text}, 0 watermark ${n.signs_watermark}${n.signs_skipped ? `, −1 skipped ${n.signs_skipped}` : ''}. Name gate ${pipe.name_gate ?? '—'}: a VLM name is kept only if OCR supports it. vlm_unmapped.json: ${n.unmapped_checked} checked, ${n.unmapped_not_business} not a business → ${n.unmapped_kept} kept. D44: sign_links.json (each sign box's own ray ±4°: moves only when all three hit the same other outline first and none touches the aimed one); ${n.signs_relinked ?? 0} differ from the photo's planned outline.`,
      visual: (run) => <Funnel run={run} onPick={pick} rows={h.sign_funnel} />,
      examples: [exBtn('signs.ocr', 'Read by OCR'), exBtn('signs.vlm', 'Sent to the cloud model'), exBtn('signs.no_text', 'No readable text'), ...(n.unmapped_kept ? [exBtn('unmapped.kept', 'Businesses not on the map')] : [])] },
    { id: 'routed', title: 'Local or cloud AI', figure: n.use_local, figure2: n.use_vlm, unit: 'local / cloud',
      plain: `A small local model decides each building’s use first; only when it is unsure does the cloud model look, and a readable shop sign counts when there is no clear photo. Building use: ${fmt.format(use.local)} local, ${fmt.format(use.vlm)} cloud, ${fmt.format(use.sign)} from a shop sign (no clear photo), ${fmt.format(use.unknown)} not known.`,
      tech: `use.route: tier1_local_clip ${n.use_local} (CLIP ViT-B/32 + logistic regression), tier3_vlm ${n.use_vlm} (${pipe.vlm ?? 'Nova Lite'}); use.value null ${n.use_unknown} (D9). name.route: tier2_ocr ${n.name_route_tier2_ocr}, tier3_vlm+ocr_gate ${n.name_route_tier3_vlm_ocr_gate}, tier3_vlm_unverified ${n.name_route_tier3_vlm_unverified}. Counted from exported buildings; stored counters that differ are on Trust › Stored vs computed.`,
      visual: () => (
        <div className="flex flex-wrap gap-8">
          <Donut title="Building use decided by" onPick={pick} center={<><span className="t-data text-[15px]">{fmt.format(use.local + use.vlm + use.sign)}</span><span className="t-small ink3 text-[12px]">decided</span></>}
            segs={[{ key: 'l', label: 'local model', value: use.local, kind: 'kept', examples: use.local ? 'use.local' : null },
              { key: 'v', label: 'cloud model (VLM)', value: use.vlm, kind: 'alt', examples: use.vlm ? 'use.vlm' : null },
              { key: 's', label: 'shop sign (no clear photo)', value: use.sign, kind: 'idle', examples: use.sign ? 'use.sign' : null },
              { key: 'u', label: 'not known', value: use.unknown, kind: 'unclassified', examples: use.unknown ? 'use.unknown' : null }]} />
          <Donut title="Names kept from signs, read by" onPick={pick} center={<><span className="t-data text-[15px]">{fmt.format(n.named)}</span><span className="t-small ink3 text-[12px]">names kept</span></>}
            segs={[{ key: 'o', label: 'OCR alone', value: h.routes.names.ocr, kind: 'kept', examples: 'names.ocr' },
              { key: 'g', label: 'cloud model, OCR agrees', value: h.routes.names.vlm_gate, kind: 'alt', examples: 'names.vlm_gate' },
              { key: 'x', label: 'cloud model only (to review)', value: h.routes.names.vlm_only, kind: 'drop', examples: 'names.vlm_only' }]} />
        </div>),
      examples: [] },
    { id: 'buildings', title: 'Floors and use', figure: n.buildings_usable, unit: `of ${plural(n.buildings, 'building')} had a clear photo`,
      plain: `Use and floors can only be read from a clear photo of the front. ${fmt.format(n.buildings_usable)} buildings had one; ${fmt.format(n.buildings_rejected)} had only a poor photo (roof cut off, a sliver at the edge…) and ${fmt.format(n.buildings_no_box)} were never seen as a building. Floors were measured for ${fmt.format(n.floors_measured)} and estimated for ${fmt.format(n.floors_low_confidence)}.`,
      tech: `building_views.json per registered building: reliable ${n.buildings_usable}; quality gate: sliver ${n.gate_thin_sliver_at_the_photo_edge}, roof cut ${n.gate_roof_cut_off_at_the_top}, base cut ${n.gate_base_cut_off_at_the_bottom}, full frame ${n.gate_box_fills_the_whole_photo}, tall ${n.gate_implausibly_tall_box}; no box ${n.buildings_no_box}. floors.status measured ${n.floors_measured} / low_confidence ${n.floors_low_confidence} / not_measured ${n.floors_not_measured}. (${n.footprints_unregistered_with_box} unregistered footprints also had boxes; not in the export.)`,
      visual: (run) => (
        <div className="space-y-4">
          <SegBar run={run} onPick={pick} unit="buildings" segs={[
            { key: 'u', label: 'clear photo', value: n.buildings_usable, kind: 'kept', examples: 'bld.usable' },
            { key: 'r', label: 'photo failed the quality check', value: n.buildings_rejected, kind: 'drop', examples: n.buildings_rejected ? 'bld.rejected' : null },
            { key: 'n', label: 'never seen as a building', value: n.buildings_no_box, kind: 'drop', examples: n.buildings_no_box ? 'bld.no_box' : null }]} />
          <SegBar run={run} onPick={pick} unit="buildings" segs={[
            { key: 'm', label: 'floors measured', value: n.floors_measured, kind: 'kept', examples: 'floors.measured' },
            { key: 'l', label: 'floors estimated', value: n.floors_low_confidence, kind: 'alt', examples: n.floors_low_confidence ? 'floors.low_confidence' : null },
            { key: 'x', label: 'floors not known', value: n.floors_not_measured, kind: 'unclassified', examples: n.floors_not_measured ? 'floors.not_measured' : null }]} />
          <p className="t-small ink2">Use: {Object.entries(n.use_values).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.replace(/_/g, ' ')} ${fmt.format(v)}`).join(' · ')}</p>
        </div>),
      examples: [] },
    { id: 'positions', alias: 'assets', title: 'Positions', figure: n.assets_triangulated, figure2: n.assets_approximate, unit: 'pinpointed / approximate',
      plain: `A pole or lamp seen from two or more camera positions is pinpointed where the sight lines cross (${fmt.format(n.assets_triangulated)}). Seen from one position only, its place is an estimate (${fmt.format(n.assets_approximate)}), with a circle that grows with its distance from the camera (${fmt.format(n.assets_single_near ?? 0)} stand within 8 m of their camera and get a smaller circle; Trust › Pole & light positions has the table). Buildings: ${fmt.format(n.pos_triangulated)} located from their front-wall corners, ${fmt.format(n.pos_wall_hit)} where a sight line meets the front wall on the map, ${fmt.format(n.pos_wall_centre)} use the centre of their front wall on the map (no camera line of sight)${n.pos_footprint_centre ? `, ${fmt.format(n.pos_footprint_centre)} the middle of the outline` : ''}. ${plural(n.pos_rejected, 'camera result')} ${n.pos_rejected === 1 ? 'was' : 'were'} rejected as implausible.`,
      tech: `assets[].method triangulated ${n.assets_triangulated} (streetlights ${n.streetlight_triangulated}, poles ${n.pole_triangulated}); other ${n.assets_approximate}; cameras_used ≥ 2: ${n.assets_2plus_cameras} (not all could be triangulated). predicted_position.method (rule B, D28): triangulated ${n.pos_triangulated}, wall_hit ${n.pos_wall_hit}, wall_centre ${n.pos_wall_centre}, footprint_centre ${n.pos_footprint_centre}; reason set (> 10 m from the road-facing wall) ${n.pos_rejected}.`,
      visual: (run) => (
        <div className="space-y-4">
          <SegBar run={run} onPick={pick} unit="poles and streetlights" segs={[
            { key: 't', label: 'pinpointed (2+ cameras)', value: n.assets_triangulated, kind: 'kept', examples: n.assets_triangulated ? 'assets.triangulated' : null },
            { key: 'a', label: 'approximate (1 camera)', value: n.assets_approximate, kind: 'drop', examples: 'assets.approximate' }]} />
          <SegBar run={run} onPick={pick} unit="buildings" segs={[
            { key: 't', label: 'front-wall corners', value: n.pos_triangulated, kind: 'kept', examples: n.pos_triangulated ? 'pos.triangulated' : null },
            { key: 'w', label: 'sight line meets the wall', value: n.pos_wall_hit, kind: 'alt', examples: n.pos_wall_hit ? 'pos.wall_hit' : null },
            { key: 'f', label: 'front-wall centre from the map', value: n.pos_wall_centre, kind: 'idle', examples: n.pos_wall_centre ? 'pos.wall_centre' : null },
            { key: 'c', label: 'middle of the outline', value: n.pos_footprint_centre, kind: 'idle', examples: n.pos_footprint_centre ? 'pos.footprint_centre' : null }]} />
        </div>),
      examples: n.pos_rejected ? [exBtn('pos.rejected', 'Camera results rejected')] : [] },
    { id: 'matched', title: 'Matched to map and register', figure: n.buildings, unit: `buildings compared${n.camera_only_buildings ? ` (${cameraOnlyText(n.camera_only_buildings)}, not compared: no map outline)` : ''}`,
      plain: `Each building was compared with the register (made-up for this demo: it copies what the photos show, except a few planted mistakes). Records are paired with buildings by position, never by a shared ID. ${fmt.format(n.match_matched)} have an entry and no difference was found, ${fmt.format(n.match_discrepancy)} differ and ${fmt.format(n.match_no_record)} have no entry. For ${fmt.format(n.matched_use_unknown)} of the ${fmt.format(n.match_matched)} the use could not be compared, because it is not known.`,
      tech: `match_status: matched ${n.match_matched}, discrepancy ${n.match_discrepancy}, no_record ${n.match_no_record}. D43 register.match_by_location: one-to-one by distance (≤ 50 m) + area/use penalty; pin > match_m = 15 m = location_shift. Pairing confidence high ${n.register_pair_high ?? 0} / medium ${n.register_pair_medium ?? 0} / low ${n.register_pair_low ?? 0}; records with no building nearby ${n.register_unmatched ?? 0}. Discrepancy types: ${Object.entries(n.discrepancy_types).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}. Registers are SYNTHETIC (D42: the observations + planted mistakes; Trust › Register tests).`,
      visual: (run) => <SegBar run={run} onPick={pick} unit="buildings" segs={[
        { key: 'm', label: 'entry, no difference found', value: n.match_matched, kind: 'matched', examples: 'match.matched' },
        { key: 'd', label: 'differ from the register', value: n.match_discrepancy, kind: 'discrepancy', examples: n.match_discrepancy ? 'match.discrepancy' : null },
        { key: 'n', label: 'not in the register', value: n.match_no_record, kind: 'no_record', examples: n.match_no_record ? 'match.no_record' : null }]} />,
      examples: [] },
    { id: 'findings', alias: 'streetlights', title: 'Findings', figure: null, unit: '',
      plain: `This is what the map shows a city official. Everything the models were unsure about (${plural(n.review_items, 'item')}) goes to a person first; ${fmt.format(n.review_waiting)} ${n.review_waiting === 1 ? 'is' : 'are'} still waiting.`,
      tech: `Records: match_status no_record ${n.match_no_record}, discrepancy ${n.match_discrepancy}; use.value null ${n.use_unknown}; streetlight_gaps[] (60 m) ${n.gaps}, Σ recorded length_m ${fmt.format(n.gaps_m)} m; review queue ${n.review_items} (${n.review_waiting} pending).`,
      visual: () => <Findings n={n} pick={pick} />, examples: [] },
  ]
  return (
    <div className="space-y-8">
      <Card id="overview" title="Coverage and the run in brief">
        <Coverage h={h} />
        <StoryHero h={h} />
      </Card>
      {chapters.map((c, i) => <Step key={`${h.area}-${c.id}`} c={c} i={i} pick={pick} detail={detail} />)}
      <Section id="flow" title="The whole pipeline in one picture"
        lead={<T plain="Each column counts something different: panoramas, then photos, then detector boxes, then results. Ribbons show which part feeds the next step. Hatched parts were dropped; click one to see real examples and why."
          tech="Unit-changing flow: bars compare within a column only; ribbons taper where the unit changes (e.g. photos → boxes, sized by boxes per view type). Values from hood.n; drop branches open /hood/examples." />}>
        <Suspense fallback={<div className="h-[400px] animate-pulse rounded-[var(--ns-r-control)] bg-line" />}><Sankey hood={h} onPick={pick} /></Suspense>
      </Section>
      <Dropped h={h} pick={pick} />
      <StreetsTable h={h} />
      <Section id="street-names" title="Street names" lead={<T plain="Where our sources give a street different names, choose the one to show. The default is the street picker’s rule: the map’s name, else Google’s name for the road itself, else the cross streets."
        tech="GET /areas/{slug}/street-names (street_name_candidates.json); PUT stores data/street_name_picks.json and reloads the area. Source files unchanged." />}>
        <StreetNames slug={h.area} />
      </Section>
      {h.routing && <RoutingCost r={h.routing} />}
      <CostTime h={h} />
      <Section id="osm" title="Businesses vs OpenStreetMap" lead={<T plain="A real, outside reference next to the synthetic register: the businesses our camera found against the shop points on OpenStreetMap, the open map volunteers edit. It is not an official register: a shop missing from it says nothing about the street."
        tech="GET /areas/{slug}/osm (osmref.shops): local osm_pois within 30 m of the analysed streets, names by one Overpass id look-up (osm_tags.json); one-to-one within 25 m, a same_business name first, then the nearest." />}>
        <OsmShopsSummary area={h.area} />
        <div className="mt-4"><OsmLevelsSummary area={h.area} brief /></div>
      </Section>
    </div>
  )
}

interface Chapter {
  id: string; alias?: string; title: string; figure: number | null; figure2?: number; unit: string; plain: string; tech: string
  visual?: (run: boolean) => React.ReactNode; examples: { key: string; label: string }[]
}

function Step({ c, i, pick, detail }: { c: Chapter; i: number; pick: Pick; detail: string }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.2)
  return (
    <Card id={c.id} eyebrow={`Step ${String(i + 1).padStart(2, '0')}`} title={c.title}>
      {c.alias && <span id={c.alias} aria-hidden />}
      <div ref={ref} className="min-w-0">
        {c.figure != null && (
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="t-figure" style={{ fontSize: 54, fontWeight: 250 }}>
              <CountUp to={c.figure} run={seen} />{c.figure2 != null && <><span className="ink3"> / </span><CountUp to={c.figure2} run={seen} /></>}
            </span>
            <span className="t-title ink2" style={{ fontSize: 21 }}>{c.unit}</span>
          </div>
        )}
        <p className="t-body mt-2 max-w-[700px]">{detail === 'technical' ? c.tech : c.plain}</p>
        {c.visual && <div className="mt-4">{c.visual(seen)}</div>}
        {!!c.examples.length && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {c.examples.map((e) => <button key={e.key} className="btn btn-line h-8" onClick={() => pick(e.key, e.label)}>See real examples: {e.label.toLowerCase()} <ArrowRight className="size-3.5" /></button>)}
          </div>
        )}
      </div>
    </Card>
  )
}

function Findings({ n, pick }: { n: HoodData['n']; pick: Pick }) {
  const open = (key: 'unmatched_properties' | 'buildings_with_discrepancy' | 'use_not_classified' | 'streetlight_gaps') => {
    const d = KPI_DEFS.find((k) => k.key === key)!
    const ui = useUi.getState()
    ui.go('explore')
    ui.setFilter(kpiFilter(d, null), { kpi: key, frame: true })
  }
  const items: { v: string; label: string; tone: string; ex: string; kpi: Parameters<typeof open>[0] }[] = [
    { v: fmt.format(n.match_no_record), label: 'not in the register', tone: 'var(--ns-no-record)', ex: 'match.no_record', kpi: 'unmatched_properties' },
    { v: fmt.format(n.match_discrepancy), label: 'differ from the register', tone: 'var(--ns-discrepancy)', ex: 'match.discrepancy', kpi: 'buildings_with_discrepancy' },
    { v: fmt.format(n.use_unknown), label: 'use not known', tone: 'var(--ns-ink2)', ex: 'use.unknown', kpi: 'use_not_classified' },
    { v: fmt.format(n.gaps), label: `${noun(n.gaps, 'possible dark stretch')} (60 m)`, tone: 'var(--ns-ink)', ex: 'gaps', kpi: 'streetlight_gaps' },
    { v: `${fmt.format(n.gaps_m)} m`, label: 'of road with no streetlight seen', tone: 'var(--ns-ink)', ex: 'gaps', kpi: 'streetlight_gaps' },
  ]
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
      {items.map((x) => (
        <div key={x.label}>
          <div className="t-figure" style={{ color: x.tone, fontSize: 34 }}>{x.v}</div>
          <div className="t-small ink2">{x.label}</div>
          <div className="mt-1 flex gap-3">
            <button className="link t-small" onClick={() => pick(x.ex, x.label)} disabled={x.v === '0'}>examples</button>
            <button className="link t-small" onClick={() => open(x.kpi)}>on the map</button>
          </div>
        </div>
      ))}
    </div>
  )
}

function Coverage({ h }: { h: HoodData }) {
  const c = h.coverage
  const share = c.share_views_unmapped ?? 0
  const partial = c.level === 'partial'
  return (
    <div role="note" className="flex gap-3 rounded-[var(--ns-r-sheet)] px-4 py-3"
      style={{ boxShadow: `inset 0 0 0 1px ${partial ? 'var(--ns-sodium)' : 'var(--ns-line-strong)'}`, background: partial ? 'var(--ns-sodium-soft)' : 'transparent' }}>
      {partial && <AlertTriangle className="mt-0.5 size-5 shrink-0 sodium" aria-hidden />}
      <div>
        <div className="t-body" style={{ fontWeight: 560 }}>
          {partial ? `${Math.round(share * 100)}% of camera photos face no mapped building` : `Map coverage: full — ${Math.round(share * 100)}% of photos face no mapped building`}
        </div>
        <p className="t-small ink2 mt-0.5">
          <T plain={partial ? `Streetlights, poles and signs are analysed everywhere, but buildings only where the map has an outline (${plural(c.buildings, 'building')} here${h.n.camera_only_buildings ? `; ${cameraOnlyText(h.n.camera_only_buildings)}` : ''}). ${c.unmapped_kept ? `${plural(c.unmapped_kept, 'business', 'businesses')} were found where the map has no building.` : ''}`
            : 'Almost every photo faces a building that is on the map, so buildings, lights and signs are all analysed.'}
            tech={<>Verdict (meta.run.coverage): “{c.verdict ?? '—'}”. plan.json views with footprint == null: {fmt.format(c.views_unmapped)} of {fmt.format(c.views)}.</>} />
        </p>
        <ImageryLine h={h} />
        <MapDataLine h={h} />
      </div>
    </div>
  )
}

/** the run's nine sentences, rebuilt from computed numbers; corrected ones say what changed and why */
function StoryHero({ h }: { h: HoodData }) {
  return (
    <div id="story" className="scroll-mt-4 mt-6 pt-5" style={{ borderTop: '1px solid var(--ns-line)' }}>
      <h3 className="t-title">The run in {h.story.length} sentences</h3>
      <ol className="mt-3 space-y-2">
        {h.story.map((s, i) => (
          <li key={s.chapter} className={cn('grid grid-cols-[18px_minmax(0,1fr)] gap-3', !REDUCED && 'gc-rise')} style={{ animationDelay: `${i * 70}ms` }}>
            <span className="mt-[9px] size-2 rounded-full" style={{ background: 'var(--ns-sodium)' }} aria-hidden />
            <p className="t-body">{s.text}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}

function Section({ id, title, lead, children }: { id: string; title: string; lead?: React.ReactNode; children: React.ReactNode }) {
  return <Card id={id} title={title} lead={lead}>{children}</Card>
}

function Dropped({ h, pick }: { h: HoodData; pick: Pick }) {
  const rows = h.sankey.columns.flatMap((c) => (c.groups ?? [c]).flatMap((g) => (g.segments ?? []).filter((s) => s.kind === 'drop' && s.value > 0).map((s) => ({ ...s, unit: 'unit' in g ? g.unit : c.unit }))))
  const n = h.n
  if (n.unmapped_not_business) rows.push({ id: 'nb', label: 'sign candidates the cloud model said were not a business', value: n.unmapped_not_business, kind: 'drop', examples: null, reason: 'adverts, notices and street names are not businesses', unit: 'signs' })
  return (
    <Section id="dropped" title="What got dropped, and why" lead={<T plain="Nothing is thrown away silently. These are the things the pipeline set aside, with the reason." tech="Drop branches of the flow (hood.sankey, kind == drop) plus vlm_unmapped.json verdicts." />}>
      <ul>
        {rows.sort((a, b) => b.value - a.value).map((r) => (
          <li key={r.id} className="grid grid-cols-[170px_minmax(0,1fr)_auto] items-baseline gap-4 rule-t py-2">
            <span className="t-data text-right">{fmt.format(r.value)} <span className="ink3 text-[12px]">{r.unit}</span></span>
            <span><span className="t-small">{r.label}</span>{r.reason && <span className="t-small ink3"> — {r.reason}</span>}</span>
            {r.examples ? <button className="link t-small" onClick={() => pick(r.examples!, r.label)}>examples</button> : <span />}
          </li>
        ))}
      </ul>
    </Section>
  )
}

type SortKey = keyof StreetRow
function StreetsTable({ h }: { h: HoodData }) {
  const [sort, setSort] = useState<{ k: SortKey; desc: boolean }>({ k: 'length_m', desc: true })
  const [sel, setSel] = useState<string | null>(null)
  const { streets, area, records, gaps } = useAreaData()
  const mini = useMemo(() => miniStreets(streets), [streets])
  const rows = [...h.streets].sort((a, b) => {
    const x = a[sort.k], y = b[sort.k]
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
    return sort.desc ? -c : c
  })
  const cols: [SortKey, string][] = [['street', 'Street'], ['length_m', 'm'], ['cameras', 'cameras'], ['buildings', 'buildings'], ['no_record', 'not in reg.'],
    ['discrepancy', 'differ'], ['use_unknown', 'use ?'], ['streetlights', 'lights'], ['gaps', 'dark'], ['gap_m', 'dark m']]
  const cur = rows.find((r) => r.street === sel)
  const openStreet = (s: string) => { const ui = useUi.getState(); ui.go('explore'); ui.selectStreet(s) }
  return (
    <Section id="streets-table" title="Street by street" lead={<T plain="Click a street to see it on the plan and open it on the map." tech="Per street: plan.json cameras/views by OSM label mapped to display names; findings counted from the records." />}>
      <div className="grid gap-5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead><tr className="rule-b">{cols.map(([k, l]) => (
              <th key={k} className={cn('t-micro whitespace-nowrap py-1.5 pr-3 font-[600]', k === 'street' ? 'text-left' : 'text-right')} aria-sort={sort.k === k ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
                <button className="cursor-pointer hover:text-ink" onClick={() => setSort({ k, desc: sort.k === k ? !sort.desc : k !== 'street' })}>{l}{sort.k === k ? (sort.desc ? ' ↓' : ' ↑') : ''}</button>
              </th>))}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.street} className={cn('rule-b cursor-pointer hover:bg-line', sel === r.street && 'bg-accent-soft')} onClick={() => setSel(r.street)}
                tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setSel(r.street) }} aria-selected={sel === r.street}>
                {cols.map(([k]) => <td key={k} className={cn('py-1.5 pr-3', k === 'street' ? 't-small max-w-[260px] truncate' : 't-data text-right')}>{k === 'street' ? r.street : fmt.format(r[k] as number)}</td>)}
              </tr>))}</tbody>
          </table>
        </div>
        <div>
          {cur ? (
            <div className="grid items-start gap-4 md:grid-cols-[420px_minmax(0,1fr)]">
              <StreetMini area={area} mini={mini} street={cur.street} records={records} gaps={gaps} />
              <div>
              <p className="t-small">{cur.street}: {fmt.format(cur.length_m)} m, {plural(cur.buildings, 'building')}, {fmt.format(cur.no_record)} not in the register, {plural(cur.gaps, 'possible dark stretch')}.</p>
              <button className="btn btn-line mt-2" onClick={() => openStreet(cur.street)}><MapPin /> Open in Explore</button>
              </div>
            </div>
          ) : <p className="t-small ink3">Select a street in the table to see it on a plan here.</p>}
        </div>
      </div>
    </Section>
  )
}

/** P7 R3 (A2): the photo dollars are list price; the cloud-AI (AWS) cost stays as measured */
const SV_LIST_PRICE = 'Photo cost is at Google’s list price — Google’s free monthly allowance may cover it.'

function CostTime({ h }: { h: HoodData }) {
  const c = h.cost
  const sv = c.lines.find((l) => l.key === 'street_view')
  const vlm = c.lines.find((l) => l.key === 'vlm')
  if (c.live) return <LiveCost h={h} />
  const time = c.model_card?.gpu_minutes != null ? `About ${c.model_card.gpu_minutes} min on a Colab GPU` : 'Time: not recorded for this run'
  const svText = sv?.value != null
    ? `about $${sv.value.toFixed(2)} in Street View photos (${sv.photos != null ? fmt.format(sv.photos) : '—'} photos)` : 'Street View cost not recorded'
  return (
    <Section id="cost" title="Time and cost">
      <p className="t-body" title={sv?.source ?? undefined}>{time}; {svText}.</p>
      {vlm?.value != null && <p className="t-body mt-1" title={vlm.source ?? undefined}>Cloud AI: about {usdText(vlm.value)} ({vlm.detail}).</p>}
      {sv?.value != null && <p className="t-small ink2 mt-1">{SV_LIST_PRICE}</p>}
      {sv?.source && <p className="t-small ink3 mt-1">Where the photo count comes from: {sv.source}.</p>}
    </Section>
  )
}

/** P6: a street analysed from the app is a fresh run, so its clock and counters are its own: shown plainly, with the
 *  stage timings. Only a run that resumed from saved files after a pause keeps a note (its numbers cover the last part). */
function LiveCost({ h }: { h: HoodData }) {
  const c = h.cost, t = c.timings
  const line = (k: string) => c.lines.find((l) => l.key === k)
  const sv = line('street_view'), vlm = line('vlm'), pl = line('places')
  const money = (v: number | null | undefined) => (v == null ? null : `$${v < 0.01 && v > 0 ? v.toFixed(4) : v.toFixed(2)}`)
  const dev = t.device === 'gpu' ? 'a GPU' : t.device === 'cpu' ? 'a CPU' : 'the worker'
  return (
    <Section id="cost" title="Time and cost">
      <p className="t-body">
        {t.total_minutes != null ? `Took ${t.total_minutes} min on ${dev}` : 'Time not recorded'}
        {sv ? `; ${sv.detail.split(' × ')[0]}${money(sv.value) ? `, about ${money(sv.value)}` : ''}` : ''}
        {vlm ? `; ${vlm.detail} to the cloud model${money(vlm.value) ? `, ${money(vlm.value)}` : ''}` : ''}
        {pl ? `; ${pl.detail.replace(' (price not in the model card)', '')} on Google (price not recorded)` : ''}.
      </p>
      {t.badge ? <p className="t-small mt-1" style={{ color: 'var(--ns-sodium)' }}>This analysis was {t.badge}.</p>
        : <p className="t-small ink3 mt-1">Measured during this analysis. Photo prices from the team’s model card.</p>}
      {sv && <p className="t-small ink2 mt-1">{SV_LIST_PRICE} The cloud-AI cost is as measured.</p>}
      <div className="mt-4"><StageTimeline stages={t.stage_seconds} badge={t.badge} total={t.total_minutes} live /></div>
    </Section>
  )
}

/** D53: where the roads and building outlines come from, with the snapshot dates and the attribution */
function MapDataLine({ h }: { h: HoodData }) {
  const m = h.map_data
  if (!m) return null
  const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'date not recorded')
  const c = m.city
  const run = m.run.kind === 'snapshot'
    ? <>This analysis read them from that copy (OpenStreetMap snapshot {day(m.run.osm_snapshot)}).</>
    : <>This analysis asked OpenStreetMap’s servers{m.run.date ? <> on {day(m.run.date)}</> : <> at the time it ran</>}, before the copy existed.</>
  return (
    <p className="t-small ink2 mt-2" aria-label="Map data source">
      {c
        ? <>Map data: <b className="text-ink">OpenStreetMap snapshot {day(c.osm_snapshot)}</b> · <b className="text-ink">Microsoft footprints {day(c.ms_release)}</b>, held in the app’s database for {c.name}. {run}</>
        : <>Map data: OpenStreetMap’s servers at the time of the analysis (this area is outside the cities held in the app’s database).</>}
      <span className="ink3"> {m.attribution.osm}. {m.attribution.microsoft}.</span>
    </p>
  )
}

/** P8: when the photos were taken (panos.json capture month of each camera stop; nothing fetched) */
function ImageryLine({ h }: { h: HoodData }) {
  const im = h.imagery
  if (!im?.oldest) return null
  const flagged = Object.values(im.outdated_findings ?? {}).reduce((a, b) => a + b, 0)
  const years = Object.entries(im.by_year).map(([y, k]) => `${y}: ${fmt.format(k)}`).join(' · ')
  return (
    <p className="t-small ink2 mt-2" title={`${im.source}. Camera positions by year: ${years}`}>
      Photos taken <b className="text-ink">{monthText(im.oldest)}</b> to <b className="text-ink">{monthText(im.newest)}</b>
      {im.older_than_cutoff ? <> · {plural(im.older_than_cutoff, 'camera position')} of {fmt.format(im.camera_stops)} with photos more than 3 years old</> : <> · none more than 3 years old</>}
      {flagged ? <> · <span className="sodium">{plural(flagged, 'missing or not-in-register finding')} marked “imagery may be outdated”</span></> : null}.
    </p>
  )
}

// ---------------------------------------------------------------------------------------------------- routing
const usdText = (v: number | null | undefined) => (v == null ? '—' : usd(v, v >= 1 ? 2 : v < 0.01 ? 4 : 3))

/** P8: which model handled what (small local models first; the cloud model, Nova Lite, only for what they can't do or
 *  aren't sure of) with count, latency and $ per route, from this run's own saved cloud calls (backend/app/routing.py). */
function RoutingCost({ r }: { r: RoutingData }) {
  const ev = r.every_view, ac = r.all_cloud, chk = r.model_card_check
  const det = r.tasks.find((t) => t.key === 'detect')?.routes[0]
  // P8 fix: the run's whole cost, photos vs cloud AI, in one plain line; and which AI task costs most
  const sv = r.street_view, ai = r.totals.usd
  const total = sv.usd != null && ai != null ? sv.usd + ai : null
  const cloudRoutes = r.tasks.flatMap((t) => t.routes.filter((x) => x.route === 'cloud' && x.usd != null).map((x) => ({ task: t.key, usd: x.usd! })))
  const top = cloudRoutes.sort((a, b) => b.usd - a.usd)[0]
  const totalRows = [
    { key: 'routed', label: 'As run (routed)', value: r.totals.usd, note: `${fmt.format(r.totals.calls)} cloud calls · ${r.totals.status}` },
    ...(ac ? [{ key: 'all', label: 'No local router', value: ac.usd, tone: 'var(--ns-ink3)', note: `${fmt.format(ac.calls)} cloud calls · ${ac.src}` }] : []),
    ...(ev ? [{ key: 'every', label: 'Every photo (est.)', value: ev.usd, tone: 'var(--ns-ink3)', note: `estimate · ${ev.src}` }] : []),
  ]
  return (
    <Section id="routing" title="Routing and cost" lead={<>Small models on the analysis computer handle everything first: the detector (YOLO) finds objects, OCR reads signs, a CLIP model decides building use. Only what they can’t do, or aren’t sure of, goes to the cloud model (Amazon Nova Lite), which is billed per call. Counts, times and dollars come from this run’s own saved calls.</>}>
      {total != null && (
        <p className="t-body mb-4" title={`Photos: ${fmt.format(sv.photos)} × $${sv.usd_per_photo} (Google list price, model card). Cloud AI: ${r.totals.status}, from this run's saved calls.`}>
          This run cost about <b>{usdText(total)}</b>: Street View photos <b>{usdText(sv.usd)}</b> ({fmt.format(sv.photos)} at Google’s list price, {Math.round((100 * sv.usd!) / total)}%) and cloud AI (Nova Lite) <b>{usdText(ai)}</b> ({((100 * ai!) / total).toFixed(1)}%).
          {top?.task === 'floors' && <> Floor counting is the largest AI cost; it isn’t routed yet.</>}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead><tr className="rule-b">{['task', 'route', 'how many', 'time each', 'cost', ''].map((x, i) => <th key={i} className={cn('t-micro py-1.5 pr-3 font-[600]', i >= 2 && i <= 4 ? 'text-right' : 'text-left')}>{x}</th>)}</tr></thead>
          <tbody>
            {r.tasks.filter((t) => t.input > 0).map((t) => t.routes.map((x: RouteRow, i) => (
              <tr key={`${t.key}-${i}`} className={cn('align-baseline', i === t.routes.length - 1 && 'rule-b')}>
                <td className="t-small py-1.5 pr-3">{i === 0 ? <><b>{t.title}</b><div className="ink3 text-[13px]">{fmt.format(t.input)} {t.input_unit}</div></> : null}</td>
                <td className="t-small py-1.5 pr-3"><span className="tag mr-1.5" style={x.route === 'cloud' ? { color: 'var(--ns-sodium)', boxShadow: 'inset 0 0 0 1px var(--ns-sodium)' } : undefined}>{x.route}</span>{x.model}<div className="ink3 text-[13px]">{x.label}</div></td>
                <td className="t-data py-1.5 pr-3 text-right">{fmt.format(x.n)}</td>
                <td className="t-data py-1.5 pr-3 text-right" title={x.lat_src}>{x.lat_s != null ? `${x.lat_s < 1 ? x.lat_s.toFixed(3) : x.lat_s.toFixed(2)} s` : <span className="ink3">—</span>}</td>
                <td className="t-data py-1.5 pr-3 text-right" title={x.usd_src}>{x.route === 'local' ? '$0' : usdText(x.usd)}</td>
                <td className="t-small ink3 py-1.5 text-[13px]" title={x.route === 'local' ? x.lat_src : x.usd_src}>{x.route === 'local' ? (x.lat_s == null ? 'time not measured' : '') : x.usd_status}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
      <p className="t-small ink3 mt-2">Hover a number for its source. “Time each” is the median seconds per cloud call, or the model card’s speed for the detector (T4 GPU). Local models use GPU time, not a per-call fee. Derived = the run’s own cost counter minus the calls measured one by one; estimate = calls × the measured cost of the same prompt.</p>

      <h3 className="t-title mt-6">Cloud-AI cost for this run, three ways</h3>
      <div className="mt-2 max-w-[640px]"><AlignedBars rows={totalRows} fmtV={(v) => usdText(v)} /></div>
      <ul className="t-small ink2 mt-2 max-w-[760px] space-y-1">
        <li><b className="text-ink">As run:</b> {fmt.format(r.totals.calls)} cloud calls, {usdText(r.totals.usd)} ({r.totals.status}).</li>
        {ac && <li><b className="text-ink">No local router:</b> {fmt.format(ac.calls)} calls, {usdText(ac.usd)}. The {fmt.format(ac.extra_calls)} buildings the local model decided would each need one more cloud call ({usdText(ac.extra_usd)} in all). The saving is modest because the use call is one of the cheapest; the floors call (three photos per building) costs most and runs for every building either way.</li>}
        {ev && <li><b className="text-ink">Cloud model on every photo (estimate):</b> {fmt.format(ev.photos)} photos × {usd(ev.usd_per_call, 6)} per one-photo call (measured average) = {usdText(ev.usd)}{ev.minutes != null ? `, about ${ev.minutes} min of calls (${ev.workers} at a time)` : ''}. That still would not count floors or place anything on the map; the detector does that locally{det?.lat_s != null ? ` in ${Math.round(det.lat_s * 1000)} ms per photo` : ''}.</li>}
        {r.measured_every_view && <li><b className="text-ink">Measured on whole photos (model card, n = {r.measured_every_view.n}):</b> reading shop names with the cloud model on every photo cost {usdText(r.measured_every_view.usd_all_vlm)} vs {usdText(r.measured_every_view.usd_routed)} routed ({r.measured_every_view.ratio}), at the same accuracy ({Math.round(r.measured_every_view.all_vlm * 100)}% vs {Math.round(r.measured_every_view.routed * 100)}%).</li>}
      </ul>

      {!!r.accuracy.length && <>
        <h3 className="t-title mt-6">Accuracy: routed vs cloud only</h3>
        <p className="t-small ink2 mt-1">Hand-labelled samples from the team’s model card. Small samples: one item either way moves a result by about 3 points.</p>
        <div className="mt-3 grid gap-6 md:grid-cols-2">
          {r.accuracy.map((a) => (
            <div key={a.task}>
              <div className="t-micro mb-1.5">{a.task} · n = {a.n}</div>
              <AlignedBars rows={a.rows.map((x) => ({ key: x.label, label: x.label, value: x.value, tone: x.production ? undefined : 'var(--ns-ink3)', note: `${a.src}${x.production ? ' (production)' : ''}` }))} fmtV={(v) => `${Math.round(v * 100)}%`} />
              <p className="t-small ink3 mt-1">{a.note}.</p>
            </div>
          ))}
        </div>
      </>}

      {chk && (
        <div role="note" className="mt-6 max-w-[760px] rounded-[var(--ns-r-control)] px-3 py-2" style={{ boxShadow: 'inset 0 0 0 1px var(--ns-line-strong)' }}>
          <div className="t-small"><b>Model card check.</b> The model card lists ${chk.stored_with} with the router ({fmt.format(chk.stored_calls_with)} calls) and ${chk.stored_without} without ({fmt.format(chk.stored_calls_without)} calls).
            Recounted from the run’s saved calls: {usdText(chk.computed_with)} ({fmt.format(chk.computed_calls_with)} calls) and {usdText(chk.computed_without)} ({chk.computed_calls_without != null ? fmt.format(chk.computed_calls_without) : '—'} calls).</div>
          <p className="t-small ink2 mt-1">{chk.why}</p>
        </div>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------------------------------- compare
function Compare({ slugs, onOpen }: { slugs: string[]; onOpen: (slug: string) => void }) {
  const qs = useHoods(slugs)
  const hs = qs.map((q) => q.data).filter(Boolean) as HoodData[]
  if (qs.some((q) => q.isError)) return <p className="t-small ink2">Couldn’t load one of the runs. <button className="link" onClick={() => qs.forEach((q) => q.refetch())}>Try again</button></p>
  if (hs.length < slugs.length) return <Skeleton />
  const nm = (h: HoodData) => shortArea(h.name)
  const metrics: { k: string; label: string; v: (h: HoodData) => number | null; f?: (v: number) => string; tone?: string }[] = [
    { k: 'views', label: 'Photos', v: (h) => h.n.views },
    { k: 'share', label: 'Photos facing no mapped building', v: (h) => h.coverage.share_views_unmapped != null ? h.coverage.share_views_unmapped * 100 : null, f: (v) => `${Math.round(v)}%`, tone: 'var(--ns-sodium-glow)' },
    { k: 'b', label: 'Buildings on the map', v: (h) => h.n.buildings },
    { k: 'usable', label: 'Buildings with a clear photo', v: (h) => h.n.buildings ? (100 * h.n.buildings_usable) / h.n.buildings : null, f: (v) => `${Math.round(v)}%` },
    { k: 'unm', label: 'Businesses not on the map', v: (h) => h.n.unmapped_kept },
    { k: 'a', label: 'Poles & streetlights', v: (h) => h.n.assets },
    { k: 'tri', label: 'Pinpointed (2+ cameras)', v: (h) => h.n.assets ? (100 * h.n.assets_triangulated) / h.n.assets : null, f: (v) => `${Math.round(v)}%` },
    { k: 'dark', label: 'Road with no streetlight seen', v: (h) => h.n.gaps_m, f: (v) => `${fmt.format(Math.round(v))} m`, tone: 'var(--ns-ink2)' },
    { k: 'rev', label: 'Items for a person', v: (h) => h.n.review_items },
  ]
  return (
    <div id="compare">
      <p className="t-small ink2 mb-5 max-w-[720px]"><T plain="The same pipeline on every analysed place. Where the open map has few building outlines (Tiruppur), buildings can’t be checked, but streetlights, poles and shop signs still are."
        tech="Same code, three runs (Trichy was produced by an older package version). Bars in each group share one scale. Percentages are computed from hood.n." /></p>
      <div className="grid gap-4 md:grid-cols-3">
        {hs.map((h) => (
          <article key={h.area} className="flex flex-col rounded-[var(--ns-r-sheet)] p-4" style={{ boxShadow: `inset 0 0 0 1px ${h.coverage.level === 'partial' ? 'var(--ns-sodium)' : 'var(--ns-line-strong)'}` }}>
            <h3 className="t-title">{nm(h)}</h3>
            <p className="t-small mt-1" style={{ color: h.coverage.level === 'partial' ? 'var(--ns-sodium)' : 'var(--ns-ink2)' }}>
              {h.coverage.level === 'partial' ? `Low map coverage: ${Math.round((h.coverage.share_views_unmapped ?? 0) * 100)}% of photos face no mapped building` : 'Full map coverage'}</p>
            <dl className="t-small mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <dt className="ink3">streets</dt><dd className="t-data text-right">{h.n.streets} · {fmt.format(h.n.streets_m)} m</dd>
              <dt className="ink3">buildings</dt><dd className="t-data text-right">{fmt.format(h.n.buildings)}{h.n.camera_only_buildings ? <span className="ink3" title={CAMERA_ONLY_TIP}> {cameraOnlyText(h.n.camera_only_buildings)}</span> : null}</dd>
              <dt className="ink3">not in register</dt><dd className="t-data text-right">{fmt.format(h.n.match_no_record)}</dd>
              <dt className="ink3">use not known</dt><dd className="t-data text-right">{fmt.format(h.n.use_unknown)}</dd>
              <dt className="ink3">possible dark stretches</dt><dd className="t-data text-right">{fmt.format(h.n.gaps)}</dd>
              <dt className="ink3">photos taken</dt><dd className="t-data text-right">{h.imagery?.oldest ? `${monthText(h.imagery.oldest)} – ${monthText(h.imagery.newest)}` : '—'}</dd>
              <dt className="ink3">story corrections</dt><dd className="t-data text-right">{h.corrections.length}</dd>
            </dl>
            <div className="flex-1" />
            <button className="btn btn-line mt-4 self-start" onClick={() => onOpen(h.area)}>Open this run <ArrowRight className="size-3.5" /></button>
          </article>
        ))}
      </div>
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {metrics.map((m) => (
          <div key={m.k}>
            <div className="t-micro mb-1.5">{m.label}</div>
            <AlignedBars fmtV={m.f} rows={hs.map((h) => ({ key: h.area, label: nm(h), value: m.v(h), tone: m.tone }))} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** D39: the selected street among the others, with what was found along it (counts in the legend) */
function StreetMini({ area, mini, street, records, gaps }: { area: string | null; mini: ReturnType<typeof miniStreets>; street: string
  records: ReturnType<typeof useAreaData>['records']; gaps: ReturnType<typeof useAreaData>['gaps'] }) {
  const bs = useMemo(() => (records?.buildings ?? []).filter((b) => b.street === street), [records, street])
  const as = useMemo(() => (records?.assets ?? []).filter((a) => a.street === street), [records, street])
  const gs = useMemo(() => gaps.filter((g) => g.props.street === street), [gaps, street])
  return (
    <GeoMini area={area} streets={mini} highlight={street} stops={{ street }} polygons={buildingPolys(bs)} points={assetPoints(as)}
      lines={darkLines(gs)} minSpanM={260} height={300} label={`${street} among the other streets, with its buildings, lights and dark stretches`}
      caption={bs.some((b) => b.match_status in MATCH_LEGEND) ? REGISTER_NOTE : undefined} />
  )
}

