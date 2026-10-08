/** Evidence for a selected object (§10 test 5), USER view first: the Street View photo with the object's box, what we
 *  saw in plain words, what the (synthetic) register says, and review actions. The technical detail (model routes with
 *  model_card accuracy, confidences, positions, register ids, costs) is behind "How do we know?" (D16). */
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Flag, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '@/api/client'
import { useBuildingLinks, useImagery, useModelCard, useObjectDetail, type PositionCheck } from '@/api/queries'
import type { AnyProps, Asset, Building, CameraBuildingProps, FloorConfidence, GapProps, MissingProps, OsmLevels, ReviewItem, UnmappedBusiness } from '@/api/types'
import { assetRegLabel, ASSET_REG, diffLabel, onMapSeenIn, floorsStatusPlain, floorsText, googleFlagPlain, matchLabel, nameQualityPlain, reviewLabel, useLabel, useNoun } from '@/lib/labels'
import { RouteLine } from '@/lib/routes'
import { miniStreets } from '@/lib/mini'
import { useAreaData } from '@/lib/useAreaData'
import { cn, costText, fmt, fmt1, monthText, plural, withArticle } from '@/lib/utils'
import { patchReviewCaches, PHOTO_TYPES, photoProblem, saveDecision, undoDecision, type Decision } from '@/lib/review'
import { answerOf, correctable, outcomeLine, reviewQuestions, type Corrected, type QAsset, type QBuilding } from '@/lib/reviewQuestions'
import { AnswerButtons, NoBox, QuestionBlock, ReviewerSays } from './ReviewAsk'
import { useUi } from '@/store/ui'
import { EvidenceViews } from './EvidenceViews'
import { GeoMini } from './GeoMini'
import { ObjectMini, type MiniObject } from './ObjectMini'
import { PositionMini } from './PositionMini'
import { StatusDot } from './FindingsTable'
import { GapHow, PriorityTag } from './GapList'
import { LampRecall } from './LampRecall'
import { Fact, HowWeKnow } from './HowWeKnow'
import { PanelHead } from './Panel'
import { ReviewerForm } from './ReviewerName'

export function EvidenceDrawer({ sel }: { sel: AnyProps }) {
  const { records } = useAreaData()
  const body = (() => {
    switch (sel.kind) {
      case 'building': { const b = records?.buildings.find((x) => x.id === sel.id); return b ? <BuildingBody b={b} /> : records ? <Gone /> : <Loading /> }
      case 'pole': case 'streetlight': { const a = records?.assets.find((x) => x.id === sel.id); return a ? <AssetBody a={a} /> : records ? <Gone /> : <Loading /> }
      case 'unmapped_business': { const u = records?.unmapped.find((x) => x.id === sel.id); return u ? <UnmappedBody u={u} /> : records ? <Gone /> : <Loading /> }
      case 'missing_asset_record': return <MissingBody p={sel} />
      case 'streetlight_gap': return <GapBody p={sel} />
      case 'camera_building': return <CameraOnlyBody p={sel} />
      default: return null
    }
  })()
  return (
    <motion.div key={'id' in sel ? `${sel.kind}:${sel.id}` : 'x'} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
      className="flex min-h-0 flex-1 flex-col" aria-label="Evidence">
      {body}
    </motion.div>
  )
}

const Loading = () => <div className="space-y-2 p-5" role="status"><p className="t-small ink3">Loading the details…</p>{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-[var(--ns-r-control)] bg-line" />)}</div>
/** the area's records are loaded but this item is not among them (another area is open, or it was re-analysed) */
const Gone = () => <p className="t-small ink2 p-5">This item is not in the loaded results for this area. It may belong to another area, or the area was analysed again. Close this panel and pick it on the map.</p>
const Body = ({ children }: { children: React.ReactNode }) => <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">{children}</div>
const Synthetic = () => <span className="tag">synthetic register (demo)</span>
const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[96px_1fr] items-baseline gap-3 rule-t py-2"><span className="t-small ink3">{k}</span><span>{children}</span></div>
)
const Section = ({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) => (
  <section className="mt-5"><div className="mb-1 flex items-center justify-between gap-2"><h3 className="t-micro">{title}</h3>{right}</div>{children}</section>
)

/** pipeline reason strings → plain sentences (the data, reworded; nothing added) */
export function plainReason(r: string): string {
  let m
  if (r === 'building has no record') return 'No register record for this building.'
  if ((m = /^record (\d+) floor\(s\), imagery shows (\d+)$/.exec(r))) return `The register says ${plural(+m[1], 'floor')}; the photo shows ${m[2]}.`
  if ((m = /^record says (\w+), imagery shows (\w+)$/.exec(r))) return `The register says ${m[1].replace(/_/g, ' ')}; the photo shows ${m[2] === 'commercial' ? 'a shop or business' : m[2] === 'residential' ? 'a home' : m[2]}.`
  if ((m = /^record pin (\d+) m from the building$/.exec(r))) return `The register’s pin is ${m[1]} m away from the building.`
  if ((m = /^record (\d+) m2 vs footprint (\d+) m2$/.exec(r))) return `The register says ${m[1]} m²; the building outline is ${m[2]} m².`
  return r.charAt(0).toUpperCase() + r.slice(1)
}

/** the plain opening sentence of a building's "How do we know?" (what we checked and how sure we are) */
function buildingSummary(b: Building) {
  const n = b.evidence?.views?.length ?? 0
  const use = b.attributes?.use
  const p = b.predicted_position
  const seen = n ? `We looked at this building in ${plural(n, 'street photo')}.` : 'No street photo faced this building.'
  const u = !use?.value ? ' Its use could not be told: no clear photo of the front.'
    : use.route === 'tier1_local_clip' ? ' Its use was decided by a small built-in model (no cloud AI).'
      : use.route === 'sign_text' ? ' There is no clear photo of the building, but its readable shop sign shows it is a business.'
        : ' Its use comes from an AI image check of the clearest photo.'
  const pos = !p ? '' : p.method === 'triangulated' ? ` Its position is measured from where ${plural(p.n_cameras, 'camera view')} cross.`
    : p.method === 'wall_hit' ? ' Its position is where one camera’s line of sight meets its front wall on the map.'
      : p.method === 'wall_centre' ? ' Its position is the centre of its front wall on the map, because no camera line of sight reached it.'
        : ' Its position is the middle of its outline on the map, because no front wall could be found.'
  return seen + u + pos
}
function registerSummary(b: Building) {
  const d = (b.discrepancies ?? []).filter((x) => x !== 'missing_record').map(diffLabel)
  const r = b.match_status === 'matched' ? 'it matches the record.' : b.match_status === 'no_record' ? 'there is no record for it.'
    : `the record differs${d.length ? `: ${d.join(', ')}` : ''}.`
  return `We compared this building with the property register (made-up demo data: it copies what the photos show, except a few planted mistakes; paired by location): ${r}`
}
/** "Listed as a shop or business with 2 floors." Fields the register leaves empty are said to be not recorded (D42). */
function registerLine(reg: NonNullable<Building['register']>) {
  const u = reg.record_use
  const what = !u ? 'Listed (use not recorded)' : ['commercial', 'residential', 'mixed', 'institutional', 'under_construction'].includes(u)
    ? `Listed as ${withArticle(useNoun(u))}` : `Listed as ${withArticle(u.replace(/_/g, ' '))}`
  return `${what}${reg.record_floors != null ? ` with ${plural(reg.record_floors, 'floor')}` : ', floors not recorded'}.`
}
/** D45: a single-camera asset's distance from its camera, in plain words ("one camera, 12 m away") */
const singleCameraWhere = (a: Asset) => (a.camera_distance_m != null ? `one camera, ${Math.round(a.camera_distance_m)} m away` : 'one camera, distance unknown')
function assetSummary(a: Asset) {
  const what = a.type === 'streetlight' ? 'streetlight' : 'pole'
  const times = a.n_detections != null ? plural(a.n_detections, 'time') : 'several times'   // one object, several photo boxes
  return a.method === 'triangulated'
    ? `The detector found this ${what} ${times} in the street photos, and its position is measured from where ${plural(a.cameras_used ?? 0, 'camera view')} cross.`
    : `The detector found this ${what} ${times} in the street photos, but from one camera position only, so its position is approximate.`
}

/** P7.3: "1 building · N sign boxes in M photos": the sign boxes linked to this outline by their own line of sight.
 *  D61: N counts BOXES, not different signs (one sign is boxed in several photos; some boxes aren't shop signs). Grouping
 *  boxes of one sign was tested and is not reliable (by spot: 26% of box pairs in one photo, i.e. different signs,
 *  land within 1 m of each other in Ward 29; same read text: too few), so no "different signs" count is given. */
function LinkedLine({ area, id }: { area: string | null; id: string }) {
  const { data: l } = useBuildingLinks(area, id)
  if (!l) return null
  return (
    <p className="t-small ink2 mt-2" title={l.source}>
      <span className="t-data">1</span> building · {l.sign_boxes
        ? <><span className="t-data">{fmt.format(l.sign_boxes)}</span> sign {l.sign_boxes === 1 ? 'box' : 'boxes'} in {plural(l.photos, 'photo')} linked to it <span className="ink3">(light-orange S tags on the photos; the same sign is often boxed in several photos, and some boxes aren’t shop signs)</span></>
        : <>no sign box in the photos is linked to it</>}
    </p>
  )
}

/** extras 4: how sure the floor count is, in plain words, and OpenStreetMap's own count next to it when it has one */
function FloorConfidenceLine({ fc, osm }: { fc?: FloorConfidence; osm?: OsmLevels }) {
  if (!fc) return null
  const tone = fc.level === 'high' ? 'var(--ns-ink)' : fc.level === 'medium' ? 'var(--ns-ink2)' : 'var(--ns-sodium)'
  return (
    <span className="t-small mt-0.5 block" aria-label="Floor-count confidence">
      {fc.level ? <><b className="font-[600]" style={{ color: tone }}>{fc.word} confidence</b><span className="ink2">: {fc.reason}</span></>
        : <span className="ink3">{fc.reason}</span>}
      {osm?.osm_levels != null && <span className="ink2 block">OpenStreetMap says {osm.osm_levels} {osm.osm_levels === '1' ? 'floor' : 'floors'} <span className="ink3">(volunteer map, a cross-check)</span></span>}
    </span>
  )
}

function BuildingBody({ b }: { b: Building }) {
  const area = useUi((s) => s.area)
  const detail = useObjectDetail(area, 'building', b.id)
  const at = b.attributes, reg = b.register
  const name = at?.name
  const use = at?.use?.value
  // D51: frontage = the road-facing wall (export footprint.frontage_m); the outline's longest side is shown only as a note
  const fw = detail.data?.front_wall
  const frontage = b.footprint?.frontage_m ?? fw?.length_m ?? null
  const longest = b.footprint?.longest_side_m ?? fw?.longest_side_m ?? null
  const title = name?.quality === 'good' && name.value ? name.value : `${useLabel(use) === 'Use not known' ? 'Building' : useLabel(use)} on ${b.street}`
  // D59: the reviewer's own value, saved with the decision (never over ours); the live item first, then the record
  const fix = (detail.data?.review_item?.corrected ?? (b.review as { corrected?: Corrected | null } | null | undefined)?.corrected) ?? null
  return (
    <>
      <PanelHead eyebrow="Building" title={title} sub={<StatusDot s={b.match_status} label={matchLabel(b.match_status, true, !!b.attributes?.use?.value)} />} />
      <Body>
        <OldImagery k={`building:${b.id}`} />
        <EvidenceViews kind="building" id={b.id} at={{ lat: b.lat, lng: b.lon }} target="building" />
        <LinkedLine area={area} id={b.id} />
        <Section title="What we saw">
          <Row k="Use">{use ? <>{useLabel(use)}</> : <span className="ink3">Not known: no clear photo of the front</span>}
            {fix?.use && <ReviewerSays corrected={{ use: fix.use }} />}</Row>
          <Row k="Floors">{at?.floors?.value != null ? floorsText(at.floors.value, at.floors.status) : <span className="ink3">Not known</span>}
            {fix?.floors != null && <ReviewerSays corrected={{ floors: fix.floors }} />}
            <FloorConfidenceLine fc={detail.data?.floor_confidence} osm={detail.data?.osm_levels} /></Row>
          <Row k="Frontage">{frontage != null ? <>{fmt1.format(frontage)} m <span className="ink3">along the street, from the map outline</span></> : <span className="ink3">{detail.isPending ? '…' : 'Not known'}</span>}</Row>
          <Row k="Position"><PositionLine pc={detail.data?.position_check} pending={detail.isPending} /></Row>
          <Row k="Sign">{name?.value ? <>{name.value}{name.quality !== 'good' && <span className="ink3"> (hard to read, to double-check)</span>}</> : <span className="ink3">No sign read</span>}
            {fix?.name && <ReviewerSays corrected={{ name: fix.name }} />}</Row>
          {name?.google_confirmed && name.google_place_id && <Row k="Google Maps"><PlaceName id={name.google_place_id} /></Row>}
          <HowWeKnow summary={buildingSummary(b)} links={[{ page: 'trust', section: 'use', label: 'Use accuracy' }, { page: 'trust', section: 'floors', label: 'Floors accuracy' },
            { page: 'trust', section: 'names', label: 'Names accuracy' }, { page: 'trust', section: 'gate1', label: 'Position accuracy (Gate 1)' },
            { page: 'hood', section: 'buildings', label: 'How buildings are read' }]}>
            <Fact k="Use"><RouteLine route={at?.use?.route} /></Fact>
            <Fact k="Floors"><RouteLine route={at?.floors?.route} />{at?.floors?.status && <span className="ink3"> Result: {floorsStatusPlain(at.floors.status)}.</span>}</Fact>
            {detail.data?.floor_confidence && <Fact k="Floor confidence" hint="a fixed rule">{detail.data.floor_confidence.rule}{detail.data.floor_confidence.check && <span className="ink3"> The AI floor count was {detail.data.floor_confidence.check}.</span>}</Fact>}
            {/* ui-polish-2: only on buildings that carry the tag (Ward 29: 2 of 373); nothing elsewhere */}
            {detail.data?.osm_levels?.osm_levels != null && <Fact k="OpenStreetMap floors" hint="building:levels">OpenStreetMap gives this building {detail.data.osm_levels.osm_levels} {detail.data.osm_levels.osm_levels === '1' ? 'level' : 'levels'} (looked up {detail.data.osm_levels.fetched?.slice(0, 10)}). Volunteers add this tag for few buildings; it is a cross-check only and never changes our count.</Fact>}
            <Fact k="Sign / name"><RouteLine route={name?.route} />{name?.quality && <span className="ink3"> The sign was {nameQualityPlain(name.quality)}.</span>}</Fact>
            {b.evidence?.sign_view?.ocr_text && <Fact k="Sign text read" hint={b.evidence.sign_view.ocr_conf != null ? `OCR confidence ${fmt1.format(b.evidence.sign_view.ocr_conf)}` : 'OCR'}>“{b.evidence.sign_view.ocr_text}”{b.evidence.sign_view.ocr_conf != null && <span className="ink2">, the text reader was {Math.round(b.evidence.sign_view.ocr_conf * 100)}% sure</span>}</Fact>}
            {!!at?.property_identifiers?.length && <Fact k="Door numbers">{at.property_identifiers.join(', ')} <span className="ink3">(not confirmed)</span></Fact>}
            <Fact k="Condition" hint="withheld"><span className="ink3">Not shown: our condition check was not accurate enough (see Trust)</span></Fact>
            {!!b.google_flags?.length && <Fact k="Google check">{b.google_flags.map(googleFlagPlain).join('. ')}.</Fact>}
            {frontage != null && <Fact k="Frontage" hint="OpenStreetMap outline">{fmt1.format(frontage)} m. Source: {fw?.source ?? 'the road-facing wall of the OpenStreetMap outline'}.{longest != null && <span className="ink3"> Longest side of the outline: {fmt1.format(longest)} m ({fw?.longest_note ?? 'the longer side of its rotated rectangle, whichever way it faces; not the front'}).</span>}</Fact>}
            <Fact k="AI checks" hint="VLM calls">{plural(b.cost?.vlm_calls ?? 0, 'AI image check')}, {costText(b.cost?.vlm_calls ?? 0, b.cost?.vlm_usd) === 'cost not recorded' ? 'cost not recorded' : `cost ${costText(b.cost?.vlm_calls ?? 0, b.cost?.vlm_usd)}`}</Fact>
            <PositionFacts pc={detail.data?.position_check} />
            <Fact k="Map position" hint="footprint centre"><span className="t-data">{b.lat.toFixed(5)}, {b.lon.toFixed(5)}</span>: the middle of the building outline on the map</Fact>
            <Fact k="ID"><span className="t-data">{b.id}</span></Fact>
            <Fact k="Where it stands"><PositionMini b={b} /></Fact>
          </HowWeKnow>
        </Section>
        <Section title="What the register says" right={<Synthetic />}>
          {reg?.property_id ? (
            <p className="t-body">{registerLine(reg)}</p>
          ) : <p className="t-body">No record for this building.</p>}
          {!!b.reasons?.length && (
            <ul className="mt-2 space-y-1">{b.reasons.map((r) => <li key={r} className="t-small flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full" style={{ background: 'var(--ns-sodium)' }} />{plainReason(r)}</li>)}</ul>
          )}
          <HowWeKnow summary={registerSummary(b)} links={[{ page: 'trust', section: 'matching', label: 'How matching was tested' }]}>
            <Fact k="Record number"><span className="t-data">{reg?.property_id ?? '—'}</span></Fact>
            {reg?.property_id && <Fact k="Paired by" hint={reg.match_confidence ? `match confidence ${reg.match_confidence}` : undefined}>Location: the record's pin is {fmt1.format(reg.record_dist_m ?? 0)} m from this building{reg.match_confidence ? `, so the pairing is ${reg.match_confidence === 'high' ? 'clear' : reg.match_confidence === 'medium' ? 'likely' : 'uncertain'}` : ''}{reg.match_margin_m != null ? ` (the next building would fit ${fmt1.format(reg.match_margin_m)} m worse)` : ''}. Records are paired with buildings by position, never by a shared ID.</Fact>}
            <Fact k="Record says">{reg?.record_use?.replace(/_/g, ' ') ?? 'use not recorded (not compared)'} · {reg?.record_floors != null ? plural(reg.record_floors, 'floor') : 'floors not recorded (not compared)'} · {reg?.record_area_m2 != null ? `${fmt.format(Math.round(reg.record_area_m2))} m²` : '—'}</Fact>
            <Fact k="Record's map pin">{reg?.record_dist_m != null ? `${fmt1.format(reg.record_dist_m)} m from the building outline` : '—'}</Fact>
            <Fact k="Result" hint={b.match_status}>{matchLabel(b.match_status, true, !!b.attributes?.use?.value)}{b.discrepancies?.length ? `: ${b.discrepancies.map(diffLabel).join(', ')}` : ''}</Fact>
            <Fact k="Register" hint={reg?.source ?? 'SYNTHETIC'}>{reg?.source === 'IMPORTED' ? 'An imported property register' : 'Made-up demo data: it copies what the photos show, except a few planted mistakes (no open property records were available)'}</Fact>
          </HowWeKnow>
        </Section>
        <ReviewActions item={detail.data?.review_item ?? null} loading={detail.isPending} b={b as QBuilding} />
      </Body>
    </>
  )
}

function AssetBody({ a }: { a: Asset }) {
  const area = useUi((s) => s.area)
  const detail = useObjectDetail(area, 'asset', a.id)
  const reg = a.register
  const pinned = a.method === 'triangulated'
  return (
    <>
      <PanelHead eyebrow={a.type === 'streetlight' ? 'Streetlight' : 'Pole, no lamp seen'} title={a.street ?? '—'}
        sub={<StatusDot s={ASSET_REG[reg?.status ?? '']?.status ?? null} label={assetRegLabel(reg?.status, true)} />} />
      <Body>
        <OldImagery k={`asset:${a.id}`} />
        <EvidenceViews kind="asset" id={a.id} at={{ lat: a.lat, lng: a.lon }} target={a.type === 'streetlight' ? 'lamp' : 'pole'} />
        <Section title="What we saw">
          <Row k="What">{a.type === 'streetlight' ? 'A streetlight (pole with a lamp)' : 'A pole with no lamp seen'}</Row>
          <Row k="On the map">{onMapSeenIn(a.type === 'streetlight' ? 'streetlight' : 'pole', a.n_detections)}{(a.n_detections ?? 0) > 1 && <span className="ink3"> (the same {a.type === 'streetlight' ? 'streetlight' : 'pole'} in several photos, merged into one)</span>}</Row>
          <Row k="Position">{pinned ? `Pinpointed: seen from ${a.cameras_used} camera positions` : `Approximate: about ±${fmt1.format(a.uncertainty_m ?? 0)} m (${singleCameraWhere(a)})`}</Row>
          <HowWeKnow summary={assetSummary(a)} links={[{ page: 'trust', section: 'detector', label: 'Detector accuracy' }, { page: 'trust', section: 'positions', label: 'Position checks' },
            { page: 'hood', section: 'assets', label: 'How assets are located' }]}>
            <Fact k="Found by"><RouteLine route={a.route} /></Fact>
            <Fact k="Position" hint={a.method === 'triangulated' ? 'triangulated' : `${a.method?.replace(/_/g, ' ')}, single camera`}>{a.method === 'triangulated' ? `Measured where ${plural(a.cameras_used ?? 0, 'camera view')} cross` : 'Estimated from one camera, from where its base appears in the photo'}</Fact>
            <Fact k="How far off" hint={a.uncertainty_basis ?? undefined}>{a.method === 'triangulated'
              ? `±${fmt1.format(a.uncertainty_m ?? 0)} m: the camera views agree within about ${fmt.format(Math.ceil(a.uncertainty_m ?? 0))} m`
              : a.camera_distance_m != null && a.camera_distance_m <= 8
                ? `About ±${fmt1.format(a.uncertainty_m ?? 0)} m: ${singleCameraWhere(a)}. At that distance, 8 in 10 single-camera estimates of poles that two cameras pinpointed were within ${fmt1.format(a.uncertainty_m ?? 0)} m (a consistency check).`
                : `About ±${fmt1.format(a.uncertainty_m ?? 0)} m: ${singleCameraWhere(a)}. An earlier surveyed check found a typical error of 4.55 m for poles 8–15 m from the camera, so about half of such poles fall inside this circle.`}</Fact>
            <Fact k="Times seen" hint={`${a.confidence ?? '—'} confidence`}>{a.n_detections != null ? `One ${a.type === 'streetlight' ? 'streetlight' : 'pole'}, found ${plural(a.n_detections, 'time')} in the photos` : '—'}, {a.confidence === 'high' ? 'so we are fairly sure' : a.confidence === 'medium' ? 'so we are somewhat sure' : a.confidence === 'low' ? 'so it needs a second look' : ''}</Fact>
            <Fact k="Map position"><span className="t-data">{a.lat.toFixed(6)}, {a.lon.toFixed(6)}</span></Fact>
            <Fact k="Where it stands"><DrawerMini obj={{ kind: 'asset', a }} /></Fact>
            <Fact k="ID"><span className="t-data">{a.id}</span></Fact>
          </HowWeKnow>
        </Section>
        <Section title="What the register says" right={<Synthetic />}>
          <p className="t-body">{reg?.status === 'matched' ? `Listed as ${reg.asset_no}.` : reg?.status === 'discrepancy' ? `Listed as ${reg.asset_no}, but it differs: ${(reg.flags ?? []).map(diffLabel).join(', ') || 'see details'}.`
            : reg?.status === 'unrecorded_asset' ? 'Not listed in the register.' : 'Not listed; seen in one photo only, so it needs a second look before it counts as missing from the register.'}</p>
          <HowWeKnow summary={<>We compared this {a.type === 'streetlight' ? 'streetlight' : 'pole'} with the asset register (made-up demo data with planted mistakes). Result: {assetRegLabel(reg?.status, true).charAt(0).toLowerCase() + assetRegLabel(reg?.status, true).slice(1)}.</>}
            links={[{ page: 'trust', section: 'matching', label: 'How matching was tested' }]}>
            <Fact k="Result" hint={reg?.status ?? undefined}>{assetRegLabel(reg?.status, true)}{reg?.flags?.length ? `: ${reg.flags.map(diffLabel).join(', ')}` : ''}</Fact>
            <Fact k="Register entry">{reg?.asset_no ? <>{reg.asset_no}, listed as {reg.record_type ?? '—'}</> : 'No entry in the register'}</Fact>
          </HowWeKnow>
        </Section>
        <ReviewActions item={detail.data?.review_item ?? null} loading={detail.isPending} a={a as QAsset} />
      </Body>
    </>
  )
}

function UnmappedBody({ u }: { u: UnmappedBusiness }) {
  return (
    <>
      <PanelHead eyebrow="Business with no analysed building" title={u.name ?? '—'} sub={u.street ?? undefined} />
      <Body>
        <EvidenceViews kind="unmapped" id={u.id} at={{ lat: u.lat, lng: u.lon }} target="sign" />
        <div className="mt-3"><DrawerMini obj={{ kind: 'unmapped', u }} /></div>
        <Section title="What we saw">
          <p className="t-body">{u.on_outline
            ? 'A shop sign was read here, on a building outline that is not one of the analysed buildings (no planned photo faced it), so it can’t be matched to the register.'
            : 'A shop sign was read here, but the map has no building outline at this spot, so it can’t be matched to the register.'}</p>
          <Row k="Seen in">{u.sightings != null ? plural(u.sightings, 'photo') : '— photos'}</Row>
          <Row k="Position">{u.on_outline ? 'Where the sign’s line of sight meets that outline' : 'Approximate'}</Row>
          <HowWeKnow summary={<>The text reader read this sign in {u.sightings != null ? plural(u.sightings, 'photo') : 'the photos'}. OpenStreetMap has no building outline here, so its spot is only approximate.</>}
            links={[{ page: 'hood', section: 'signs', label: 'How signs are read' }]}>
            <Fact k="Sign text read" hint="OCR">“{u.ocr_text}”</Fact>
            <Fact k="Position" hint={u.position ?? 'approximate'}>{u.on_outline ? <>On the outline <span className="t-data">{u.on_outline}</span>, where the sign’s own line of sight meets it</> : <>{(() => { const m = /~([\d.]+) m/.exec(u.position ?? ''); return m ? `About ${m[1]} m from the camera, along its line of sight` : 'Approximate' })()}: worked out from the camera, as there is no building outline to place it on</>}</Fact>
            <Fact k="ID"><span className="t-data">{u.id}</span></Fact>
          </HowWeKnow>
        </Section>
      </Body>
    </>
  )
}

function MissingBody({ p }: { p: MissingProps }) {
  return (
    <>
      <PanelHead eyebrow="In the register, not seen" title={p.street ?? p.id} />
      <Body>
        <OldImagery k={`missing:${p.id}`} />
        <p className="t-body">The register lists a pole or light here (<span className="t-data">{p.id}</span>), but none was seen in the photos within 25 m.</p>
        <p className="mt-2"><Synthetic /></p>
        <HowWeKnow summary="The register lists a pole or light here, but the detector did not find one in the photos within 25 m." links={[{ page: 'trust', section: 'matching', label: 'How matching was tested' }]}>
          <Fact k="Why flagged">{p.why}</Fact>
          <Fact k="Register" hint="SYNTHETIC">Made-up demo data: missing items were planted to test the matching</Fact>
        </HowWeKnow>
      </Body>
    </>
  )
}

function GapBody({ p }: { p: GapProps }) {
  return (
    <>
      <PanelHead eyebrow="Possible dark stretch" title={`${fmt.format(Math.round(p.length_m))} m of ${p.street} has no visible streetlight`} />
      <Body>
        <OldImagery k={`gap:${p.id}`} />
        {p.priority && (
          <div className="mb-3 rounded-[var(--ns-r-control)] px-3 py-2" style={{ boxShadow: 'inset 0 0 0 1px var(--ns-line-strong)' }} aria-label="Lighting priority">
            <PriorityTag p={p.priority} long />
            <p className="t-body mt-1">{p.priority_reason}.</p>
            <p className="t-small ink3 mt-0.5">A fixed rule ranks the possible dark stretches by length, road type and shops nearby, so you can see which to check first. It does not confirm a stretch is dark.</p>
          </div>
        )}
        <LampRecall />
        <p className="t-body mt-2">{p.poles_inside ? `${plural(p.poles_inside, 'pole')} ${p.poles_inside === 1 ? 'stands' : 'stand'} here, but no lamp was seen on ${p.poles_inside === 1 ? 'it' : 'them'}.` : 'No pole or lamp was seen here.'}</p>
        {p.display_mode === 'check' && <p className="t-small mt-2 border-l-2 pl-2 ink2" style={{ borderColor: 'var(--ns-sodium)' }}>Needs checking on the ground: the road bends here and some lights were seen part way along.</p>}
        <GapHow g={{ ...p }} />
      </Body>
    </>
  )
}

/** Live Places lookup by place_id (§9.6: Places data displayed by place_id lookup, not stored copies). */
function PlaceName({ id }: { id: string }) {
  const [name, setName] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let off = false
    ;(async () => {
      try {
        const { Place } = (await google.maps.importLibrary('places')) as google.maps.PlacesLibrary
        const pl = new Place({ id })
        await pl.fetchFields({ fields: ['displayName'] })
        if (!off) setName(pl.displayName ?? null)
      } catch { if (!off) setErr(true) }
    })()
    return () => { off = true }
  }, [id])
  if (err) return <span className="ink3">lookup unavailable</span>
  return name ? <span>{name} <span className="t-small ink3">· Google Maps</span></span> : <span className="ink3">looking up…</span>
}

/** D59: the review as a question (lib/reviewQuestions) with Yes / No; a No on a value question asks for the right value */
function ReviewActions({ item, loading, b, a }: { item: ReviewItem | null; loading: boolean; b?: QBuilding; a?: QAsset }) {
  const offline = useUi((s) => s.offline)
  const reviewer = useUi((s) => s.reviewer)
  const qc = useQueryClient()
  const [mode, setMode] = useState<'idle' | 'appeal' | 'no'>('idle')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState<Decision | 'undo' | null>(null)
  const [last, setLast] = useState<{ id: number; eventId: number } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  if (loading) return null
  if (!item) return <Section title="Review"><p className="t-small ink3">Not waiting for review.</p></Section>
  const asked = reviewQuestions(item, b, a)
  const send = async (action: Decision, opts: { corrected?: Corrected | null; noNote?: string } = {}) => {
    if (!item.id || busy || !reviewer) return
    const bad = action === 'appeal' ? photoProblem(photo) : null
    if (bad) { setMsg(bad); return }
    setBusy(action); setMsg(null); setLast(null)
    try {
      // the appeal box's note / photo go only with "send back" (P5 fix); a No sends its own note + the right value (D59)
      const row = await saveDecision(item.id, action, { reviewer, note, photo, ...opts })
      patchReviewCaches(qc, row)
      setMode('idle'); setNote(''); setPhoto(null)
      setLast({ id: item.id, eventId: row.event_id })               // Undo = exactly this item + this decision (D24)
      setMsg(`${outcomeLine(asked, action === 'approve' ? 'yes' : action === 'reject' ? 'no' : 'appeal', row.corrected)} ✓`)
    } catch (e) { setMsg(e instanceof ApiError ? (e.status === 503 ? 'Offline — read-only. Nothing was saved.' : e.message) : 'Could not save') } finally { setBusy(null) }
  }
  const undo = async () => {
    if (!last || busy) return
    setBusy('undo'); setMsg(null)
    try {
      patchReviewCaches(qc, await undoDecision(last.id, last.eventId, reviewer))
      setLast(null); setMsg('Undone: back to how it was.')
    } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Could not undo') } finally { setBusy(null) }
  }
  return (
    <Section title="Review" right={<span className={cn('t-small', item.status === 'pending' ? 'sodium' : 'ink3')}>{item.status === 'pending' ? reviewLabel(item.status) : `Answered ${answerOf(item.status)}`}</span>}>
      <QuestionBlock q={asked} compact />
      {item.status !== 'pending' && <p className="t-small ink2 mt-1">Answered {answerOf(item.status)}{item.reviewer ? ` by ${item.reviewer}` : ''}.</p>}
      <ReviewerSays corrected={item.corrected} className="mt-0.5" />
      {item.note && <p className="t-small ink3 mt-1">Note: {item.note}</p>}
      {offline || item.id == null ? (
        <p className="t-small mt-2" style={{ color: 'var(--ns-sodium)' }}>Offline — read-only. Decisions can’t be saved until the database is back.</p>
      ) : !reviewer ? (
        <div className="mt-2"><p className="t-small ink2 mb-1.5">Your name is saved with each decision (asked once, no login).</p><ReviewerForm compact /></div>
      ) : (
        <>
          <div className="mt-2 grid gap-1.5">
            <AnswerButtons busy={busy === 'approve' ? 'yes' : busy === 'reject' ? 'no' : null} disabled={!!busy} onYes={() => send('approve')}
              onNo={() => (correctable(asked).length ? setMode('no') : send('reject'))} />
            {mode === 'no' && <NoBox q={asked} saving={busy === 'reject'} disabled={!!busy} onCancel={() => setMode('idle')} onSave={(corrected, noNote) => send('reject', { corrected, noNote })} />}
            <button className="btn btn-line justify-start" disabled={!!busy} aria-pressed={mode === 'appeal'} onClick={() => setMode(mode === 'appeal' ? 'idle' : 'appeal')}><Flag /> Not sure? Send back with a note</button>
          </div>
          <AnimatePresence>
            {mode === 'appeal' && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why? (required)" rows={3}
                  className="t-small mt-2 w-full resize-none rounded-[var(--ns-r-control)] border border-line-strong bg-bg0 px-2.5 py-2 outline-none focus:border-sodium" />
                <div className="mt-1.5 flex items-center gap-2">
                  <label className="link t-small cursor-pointer">
                    <input type="file" accept={PHOTO_TYPES.join(',')} className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
                    {photo ? photo.name : '+ Photo (optional)'}
                  </label>
                  <div className="flex-1" />
                  <button className="btn btn-solid" disabled={!!busy || !note.trim()} onClick={() => send('appeal')}>{busy === 'appeal' ? 'Saving…' : 'Send appeal'}</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
      {msg && <p className="t-small mt-1.5" role="status" style={{ color: msg.endsWith('✓') ? 'var(--ns-matched)' : 'var(--ns-no-record)' }}>
        {msg}{msg.endsWith('✓') && last?.id === item.id && <> · <button className="link" onClick={undo}>Undo</button></>}</p>}
    </Section>
  )
}

/** D39: the object on a small plan: its cameras and lines of sight, its street, the buildings around (same map as Review) */
function DrawerMini({ obj }: { obj: MiniObject }) {
  const { area, streets } = useAreaData()
  const mini = useMemo(() => miniStreets(streets), [streets])
  return <ObjectMini area={area} obj={obj} streets={mini} height={200} label="Where it stands: its street, the buildings around it, and the cameras that saw it" />
}


/** Gate 1 for this building, in plain words (backend/app/gate1pos.py). Camera-derived: its distance to the middle of the
 *  front wall on the map, the same number Trust's Gate 1 table uses. Taken from the outline: not measured (that point IS
 *  the reference, so "0 m" would mean nothing and is never shown). */
const posMetres = (d: number, target: number) => {
  const one = fmt1.format(d)
  return Number(one) === target && d > target ? d.toFixed(2) : one        // 3.54 must not read as "3.5 m ✗"
}
function PositionLine({ pc, pending }: { pc: PositionCheck | null | undefined; pending: boolean }) {
  if (!pc) return <span className="ink3">{pending ? '…' : 'Not known'}</span>
  return (
    <>
      {pc.case === 'camera' && pc.distance_m != null ? (
        <span>
          <span className="t-data">{posMetres(pc.distance_m, pc.target_m)} m</span> from the middle of the front wall on the map <span className="ink3">(target ≤ {fmt1.format(pc.target_m)} m)</span>{' '}
          <span className="inline-flex items-center gap-0.5 whitespace-nowrap align-[-2px]" style={{ color: pc.within ? 'var(--ns-ink)' : 'var(--ns-discrepancy)' }}>
            {pc.within ? <Check size={16} strokeWidth={2.6} aria-hidden /> : <X size={16} strokeWidth={2.6} aria-hidden />}<span className="t-small">{pc.within ? 'within' : 'outside'}</span>
          </span>
        </span>
      ) : pc.case === 'map' ? <span>Position taken from the map outline — error not measured.</span>
        : <span className="ink3">No position worked out for this building.</span>}
      {(pc.corner || pc.back_street) && pc.front_street && (
        <div className="t-small ink2 mt-1">Front wall chosen: the one facing {pc.front_street}
          <span className="ink3"> ({pc.corner ? 'a corner building: another wall faces a street too' : 'a street runs behind it too'})</span></div>
      )}
    </>
  )
}
const wallWord = (w: PositionCheck['other_walls'][number]) => `${w.side === 'back' ? 'the back wall' : 'a side wall'} faces ${w.street ?? 'an unnamed road'} (${fmt1.format(w.dist_m)} m away)`
function PositionFacts({ pc }: { pc: PositionCheck | null | undefined }) {
  const status = useModelCard().data?.gate1_position?.status
  if (!pc || pc.case === 'none') return null
  const st = pc.area_stats
  return (
    <>
      <Fact k="Position check" hint="Gate 1, vs OSM front-wall centre">
        {pc.case === 'camera' && pc.distance_m != null ? (
          <>The predicted point ({pc.method === 'triangulated' ? 'where camera views cross' : 'where a camera’s line of sight meets the front wall'}) is <span className="t-data">{pc.distance_m.toFixed(2)} m</span> from {pc.reference}; the target is ≤ {fmt1.format(pc.target_m)} m.{' '}
            {pc.from_trust && st
              ? <>This is the number Trust uses: this area’s camera-derived row is n = <span className="t-data">{fmt.format(st.n)}</span>, median <span className="t-data">{st.median_m} m</span>, <span className="t-data">{st.within_3_5_m_pct}%</span> within {fmt1.format(pc.target_m)} m.</>
              : <>This area was analysed from the app and is not in Trust’s table; the distance is worked out the same way.</>}</>
        ) : (
          <>No camera line of sight reached this building’s front wall, so its position is {pc.method === 'footprint_centre' ? 'the middle of its outline (no front wall could be found)' : 'the middle of its front wall on the map'}. That is the point the error is measured against, so the error is not measured; Trust leaves these buildings out of the fair row.</>
        )}
        {status && <span className="ink3"> Gate 1 status on Trust: {status} (OpenStreetMap is the reference; there is no surveyed check).</span>}
      </Fact>
      {pc.front_street && (
        <Fact k="Front wall" hint={pc.roads_checked}>
          The front wall is the outline wall whose middle is nearest the line of {pc.front_street}.{' '}
          {pc.other_walls.length ? <>Other walls facing a street (a road within 10 m straight out from the wall’s middle): {pc.other_walls.map(wallWord).join('; ')}.</> : <>No other wall faces a street within 10 m.</>}
        </Fact>
      )}
    </>
  )
}

/** Gate 1 case 3: a building only the cameras saw (rays from several cameras cross where OpenStreetMap has no outline;
 *  building_positions.json "no_footprint"). Not an analysed building: no register check, no photo record. */
function CameraOnlyBody({ p }: { p: CameraBuildingProps }) {
  const { area, streets } = useAreaData()
  const mini = useMemo(() => miniStreets(streets), [streets])
  const what = p.from === 'signboard' ? 'shop sign' : 'building'
  return (
    <>
      <PanelHead eyebrow="Building seen by camera only" title="No map outline here" sub="Not an analysed building (no register check)" />
      <Body>
        <div className="mt-3">
          <GeoMini area={area} outlines="auto" streets={mini} height={200} minSpanM={60} frame={[{ lat: p.lat, lon: p.lon }]}
            points={[{ lat: p.lat, lon: p.lon, tone: 'sodium', shape: 'diamond', r_m: p.uncertainty_m, dashed: true, legend: 'seen by camera only',
              tip: `Where ${p.n_cameras != null ? plural(p.n_cameras, 'camera view') : 'the camera views'} cross` }]}
            label="Where the camera-only building is: the outlines around it, none at this spot" />
        </div>
        <Section title="What we saw">
          <p className="t-body">Lines of sight to a {what} from {p.n_cameras != null ? plural(p.n_cameras, 'camera position') : 'several camera positions'} cross here, but the map has no building outline at this spot.</p>
          <Row k="Position">No map outline for this building — error can’t be measured.</Row>
          <Row k="Uncertainty">{p.uncertainty_m != null
            ? <>About ±<span className="t-data">{fmt1.format(p.uncertainty_m)} m</span>: every camera line of sight passes within that of this point <span className="ink3">(how well the cameras agree; there is no outline to check it against)</span></>
            : <span className="ink3">Not estimated</span>}</Row>
          <HowWeKnow summary={<>Lines of sight from the cameras’ {what} boxes that hit no OpenStreetMap outline were crossed in pairs; crossings within 3 m were grouped, and a group seen from 3 or more camera positions was solved and kept when every line passes within 3 m.</>}
            links={[{ page: 'trust', section: 'gate1', label: 'Position accuracy (Gate 1)' }]}>
            <Fact k="Method" hint="triangulated_no_footprint">Camera views cross, with no map outline</Fact>
            <Fact k="Cameras">{p.n_cameras ?? '—'}</Fact>
            <Fact k="Uncertainty" hint="largest ray residual">{p.uncertainty_m != null ? `${fmt1.format(p.uncertainty_m)} m: the farthest camera line of sight from the point (at least 0.5 m)` : 'not estimated'}</Fact>
            <Fact k="Why no error">Gate 1 measures a position against the middle of the building’s front wall on its OpenStreetMap outline. This building has no outline, so there is nothing to measure against.</Fact>
            <Fact k="Map position"><span className="t-data">{p.lat.toFixed(6)}, {p.lon.toFixed(6)}</span></Fact>
          </HowWeKnow>
        </Section>
      </Body>
    </>
  )
}

/** P8: a "missing" or "not in the register" finding that rests only on photos more than three years old */
export function OldImagery({ k }: { k: string }) {
  const area = useUi((s) => s.area)
  const o = useImagery(area).data?.objects[k]
  if (!o?.outdated) return null
  return (
    <p role="note" className="t-small mb-3 rounded-[var(--ns-r-control)] px-3 py-2" style={{ boxShadow: 'inset 0 0 0 1px var(--ns-sodium)', background: 'var(--ns-sodium-soft)' }}>
      <b className="sodium">Imagery may be outdated.</b> The newest Street View photo of this spot is from {monthText(o.newest)}, more than 3 years ago. The street may have changed since, so check before acting on this.
    </p>
  )
}
