/** Evidence for a selected object (§10 test 5), USER view first: the Street View photo with the object's box, what we
 *  saw in plain words, what the (synthetic) register says, and review actions. The technical detail (model routes with
 *  model_card accuracy, confidences, positions, register ids, costs) is behind "How do we know?" (D16). */
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, CircleSlash, Flag, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError } from '@/api/client'
import { useObjectDetail } from '@/api/queries'
import type { AnyProps, Asset, Building, GapProps, MissingProps, ReviewItem, UnmappedBusiness } from '@/api/types'
import { assetRegLabel, ASSET_REG, diffLabel, floorsStatusPlain, floorsText, googleFlagPlain, matchLabel, nameQualityPlain, reviewLabel, reviewReasons, useLabel } from '@/lib/labels'
import { RouteLine } from '@/lib/routes'
import { useAreaData } from '@/lib/useAreaData'
import { cn, costText, fmt, fmt1, plural, withArticle } from '@/lib/utils'
import { DONE_LABEL, patchReviewCaches, PHOTO_TYPES, photoProblem, saveDecision, undoDecision, type Decision } from '@/lib/review'
import { useUi } from '@/store/ui'
import { EvidenceViews } from './EvidenceViews'
import { PositionMini } from './PositionMini'
import { StatusDot } from './FindingsTable'
import { GapHow } from './GapList'
import { Fact, HowWeKnow } from './HowWeKnow'
import { PanelHead } from './Panel'
import { ReviewerForm } from './ReviewerName'

export function EvidenceDrawer({ sel }: { sel: AnyProps }) {
  const { records } = useAreaData()
  const body = (() => {
    switch (sel.kind) {
      case 'building': { const b = records?.buildings.find((x) => x.id === sel.id); return b ? <BuildingBody b={b} /> : <Loading /> }
      case 'pole': case 'streetlight': { const a = records?.assets.find((x) => x.id === sel.id); return a ? <AssetBody a={a} /> : <Loading /> }
      case 'unmapped_business': { const u = records?.unmapped.find((x) => x.id === sel.id); return u ? <UnmappedBody u={u} /> : <Loading /> }
      case 'missing_asset_record': return <MissingBody p={sel} />
      case 'streetlight_gap': return <GapBody p={sel} />
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

const Loading = () => <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-[var(--ns-r-control)] bg-line" />)}</div>
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
      : ' Its position is the middle of its outline on the map, because no camera view could measure it.'
  return seen + u + pos
}
function registerSummary(b: Building) {
  const d = (b.discrepancies ?? []).filter((x) => x !== 'missing_record').map(diffLabel)
  const r = b.match_status === 'matched' ? 'it matches the record.' : b.match_status === 'no_record' ? 'there is no record for it.'
    : `the record differs${d.length ? `: ${d.join(', ')}` : ''}.`
  return `We compared this building with the property register (made-up demo data with planted mistakes): ${r}`
}
/** the single-camera default's basis in plain words; the percentage comes from the stored basis ("86% of monocular …") */
function singleCameraHint(basis: string | null | undefined) {
  const m = basis ? /(\d+)%/.exec(basis) : null
  return m ? `${m[1]}% of single-camera distances were within 3.5 m of a second camera's estimate (a consistency check, not surveyed positions)` : basis ?? undefined
}
function assetSummary(a: Asset) {
  const what = a.type === 'streetlight' ? 'streetlight' : 'pole'
  const times = a.n_detections != null ? plural(a.n_detections, 'time') : 'several times'
  return a.method === 'triangulated'
    ? `The detector found this ${what} ${times} in the street photos, and its position is measured from where ${plural(a.cameras_used ?? 0, 'camera view')} cross.`
    : `The detector found this ${what} ${times} in the street photos, but from one camera position only, so its position is approximate.`
}

function BuildingBody({ b }: { b: Building }) {
  const area = useUi((s) => s.area)
  const detail = useObjectDetail(area, 'building', b.id)
  const at = b.attributes, reg = b.register
  const name = at?.name
  const use = at?.use?.value
  const title = name?.quality === 'good' && name.value ? name.value : `${useLabel(use) === 'Use not known' ? 'Building' : useLabel(use)} on ${b.street}`
  return (
    <>
      <PanelHead eyebrow="Building" title={title} sub={<StatusDot s={b.match_status} label={matchLabel(b.match_status, true, !!b.attributes?.use?.value)} />} />
      <Body>
        <EvidenceViews kind="building" id={b.id} at={{ lat: b.lat, lng: b.lon }} target="building" />
        <Section title="What we saw">
          <Row k="Use">{use ? <>{useLabel(use)}</> : <span className="ink3">Not known: no clear photo of the front</span>}</Row>
          <Row k="Floors">{at?.floors?.value != null ? floorsText(at.floors.value, at.floors.status) : <span className="ink3">Not known</span>}</Row>
          <Row k="Sign">{name?.value ? <>{name.value}{name.quality !== 'good' && <span className="ink3"> (hard to read, to double-check)</span>}</> : <span className="ink3">No sign read</span>}</Row>
          {name?.google_confirmed && name.google_place_id && <Row k="Google Maps"><PlaceName id={name.google_place_id} /></Row>}
          <HowWeKnow summary={buildingSummary(b)} links={[{ page: 'trust', section: 'use', label: 'Use accuracy' }, { page: 'trust', section: 'floors', label: 'Floors accuracy' },
            { page: 'trust', section: 'names', label: 'Names accuracy' }, { page: 'hood', section: 'buildings', label: 'How buildings are read' }]}>
            <Fact k="Use"><RouteLine route={at?.use?.route} /></Fact>
            <Fact k="Floors"><RouteLine route={at?.floors?.route} />{at?.floors?.status && <span className="ink3"> Result: {floorsStatusPlain(at.floors.status)}.</span>}</Fact>
            <Fact k="Sign / name"><RouteLine route={name?.route} />{name?.quality && <span className="ink3"> The sign was {nameQualityPlain(name.quality)}.</span>}</Fact>
            {b.evidence?.sign_view?.ocr_text && <Fact k="Sign text read" hint={b.evidence.sign_view.ocr_conf != null ? `OCR confidence ${fmt1.format(b.evidence.sign_view.ocr_conf)}` : 'OCR'}>“{b.evidence.sign_view.ocr_text}”{b.evidence.sign_view.ocr_conf != null && <span className="ink2">, the text reader was {Math.round(b.evidence.sign_view.ocr_conf * 100)}% sure</span>}</Fact>}
            {!!at?.property_identifiers?.length && <Fact k="Door numbers">{at.property_identifiers.join(', ')} <span className="ink3">(not confirmed)</span></Fact>}
            <Fact k="Condition" hint="withheld"><span className="ink3">Not shown: our condition check was not accurate enough (see Trust)</span></Fact>
            {!!b.google_flags?.length && <Fact k="Google check">{b.google_flags.map(googleFlagPlain).join('. ')}.</Fact>}
            <Fact k="AI checks" hint="VLM calls">{plural(b.cost?.vlm_calls ?? 0, 'AI image check')}, {costText(b.cost?.vlm_calls ?? 0, b.cost?.vlm_usd) === 'cost not recorded' ? 'cost not recorded' : `cost ${costText(b.cost?.vlm_calls ?? 0, b.cost?.vlm_usd)}`}</Fact>
            <Fact k="Map position" hint="footprint centre"><span className="t-data">{b.lat.toFixed(5)}, {b.lon.toFixed(5)}</span>: the middle of the building outline on the map</Fact>
            <Fact k="ID"><span className="t-data">{b.id}</span></Fact>
            <Fact k="Where it stands"><PositionMini b={b} /></Fact>
          </HowWeKnow>
        </Section>
        <Section title="What the register says" right={<Synthetic />}>
          {reg?.property_id ? (
            <p className="t-body">{`${withArticle(reg.record_use ? reg.record_use.replace(/_/g, ' ') : 'property', true)}${reg.record_floors != null ? ` with ${plural(reg.record_floors, 'floor')}` : ''}.`}</p>
          ) : <p className="t-body">No record for this building.</p>}
          {!!b.reasons?.length && (
            <ul className="mt-2 space-y-1">{b.reasons.map((r) => <li key={r} className="t-small flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full" style={{ background: 'var(--ns-sodium)' }} />{plainReason(r)}</li>)}</ul>
          )}
          <HowWeKnow summary={registerSummary(b)} links={[{ page: 'trust', section: 'matching', label: 'How matching was tested' }]}>
            <Fact k="Record number"><span className="t-data">{reg?.property_id ?? '—'}</span></Fact>
            <Fact k="Record says">{reg?.record_use?.replace(/_/g, ' ') ?? '—'} · {reg?.record_floors != null ? plural(reg.record_floors, 'floor') : '— floors'} · {reg?.record_area_m2 != null ? `${fmt.format(Math.round(reg.record_area_m2))} m²` : '—'}</Fact>
            <Fact k="Record's map pin">{reg?.record_dist_m != null ? `${fmt1.format(reg.record_dist_m)} m from the building outline` : '—'}</Fact>
            <Fact k="Result" hint={b.match_status}>{matchLabel(b.match_status, true, !!b.attributes?.use?.value)}{b.discrepancies?.length ? `: ${b.discrepancies.map(diffLabel).join(', ')}` : ''}</Fact>
            <Fact k="Register" hint="SYNTHETIC">Made-up demo data with planted mistakes: no open property records were available</Fact>
          </HowWeKnow>
        </Section>
        <ReviewActions item={detail.data?.review_item ?? null} loading={detail.isPending} finding={b.match_status} />
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
        <EvidenceViews kind="asset" id={a.id} at={{ lat: a.lat, lng: a.lon }} target={a.type === 'streetlight' ? 'lamp' : 'pole'} />
        <Section title="What we saw">
          <Row k="What">{a.type === 'streetlight' ? 'A streetlight (pole with a lamp)' : 'A pole with no lamp seen'}</Row>
          <Row k="Position">{pinned ? `Pinpointed: seen from ${a.cameras_used} camera positions` : 'Approximate: seen from one camera position'}</Row>
          <HowWeKnow summary={assetSummary(a)} links={[{ page: 'trust', section: 'detector', label: 'Detector accuracy' }, { page: 'trust', section: 'positions', label: 'Position checks' },
            { page: 'hood', section: 'assets', label: 'How assets are located' }]}>
            <Fact k="Found by"><RouteLine route={a.route} /></Fact>
            <Fact k="Position" hint={a.method === 'triangulated' ? 'triangulated' : `${a.method?.replace(/_/g, ' ')}, single camera`}>{a.method === 'triangulated' ? `Measured where ${plural(a.cameras_used ?? 0, 'camera view')} cross` : 'Estimated from one camera, from where its base appears in the photo'}</Fact>
            <Fact k="How far off" hint={a.method === 'triangulated' ? a.uncertainty_basis ?? undefined : singleCameraHint(a.uncertainty_basis)}>{a.method === 'triangulated'
              ? `±${fmt1.format(a.uncertainty_m ?? 0)} m: the camera views agree within about ${fmt.format(Math.ceil(a.uncertainty_m ?? 0))} m`
              : `About ±${fmt1.format(a.uncertainty_m ?? 0)} m: a fixed default for single-camera estimates, not measured for this object.`}</Fact>
            <Fact k="Times seen" hint={`${a.confidence ?? '—'} confidence`}>{a.n_detections != null ? `Found ${plural(a.n_detections, 'time')} in the photos` : '—'}, {a.confidence === 'high' ? 'so we are fairly sure' : a.confidence === 'medium' ? 'so we are somewhat sure' : a.confidence === 'low' ? 'so it needs a second look' : ''}</Fact>
            <Fact k="Map position"><span className="t-data">{a.lat.toFixed(6)}, {a.lon.toFixed(6)}</span></Fact>
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
        <ReviewActions item={detail.data?.review_item ?? null} loading={detail.isPending} />
      </Body>
    </>
  )
}

function UnmappedBody({ u }: { u: UnmappedBusiness }) {
  return (
    <>
      <PanelHead eyebrow="Business with no mapped building" title={u.name ?? '—'} sub={u.street ?? undefined} />
      <Body>
        <EvidenceViews kind="unmapped" id={u.id} at={{ lat: u.lat, lng: u.lon }} target="sign" />
        <Section title="What we saw">
          <p className="t-body">A shop sign was read here, but OpenStreetMap has no building outline at this spot, so it can’t be matched to the register.</p>
          <Row k="Seen in">{u.sightings != null ? plural(u.sightings, 'photo') : '— photos'}</Row>
          <Row k="Position">Approximate</Row>
          <HowWeKnow summary={<>The text reader read this sign in {u.sightings != null ? plural(u.sightings, 'photo') : 'the photos'}. OpenStreetMap has no building outline here, so its spot is only approximate.</>}
            links={[{ page: 'hood', section: 'signs', label: 'How signs are read' }]}>
            <Fact k="Sign text read" hint="OCR">“{u.ocr_text}”</Fact>
            <Fact k="Position" hint={u.position ?? 'approximate'}>{(() => { const m = /~([\d.]+) m/.exec(u.position ?? ''); return m ? `About ${m[1]} m from the camera, along its line of sight` : 'Approximate' })()}: worked out from the camera, as there is no building outline to place it on</Fact>
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
      <PanelHead eyebrow="Dark stretch" title={`${fmt.format(Math.round(p.length_m))} m of ${p.street} has no visible streetlight`} />
      <Body>
        <p className="t-body">{p.poles_inside ? `${plural(p.poles_inside, 'pole')} ${p.poles_inside === 1 ? 'stands' : 'stand'} here, but no lamp was seen on ${p.poles_inside === 1 ? 'it' : 'them'}.` : 'No pole or lamp was seen here.'}</p>
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

function ReviewActions({ item, loading, finding }: { item: ReviewItem | null; loading: boolean; finding?: string | null }) {
  const offline = useUi((s) => s.offline)
  const reviewer = useUi((s) => s.reviewer)
  const qc = useQueryClient()
  const [mode, setMode] = useState<'idle' | 'appeal'>('idle')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState<Decision | 'undo' | null>(null)
  const [last, setLast] = useState<{ id: number; eventId: number } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  if (loading) return null
  if (!item) return <Section title="Review"><p className="t-small ink3">Not waiting for review.</p></Section>
  const send = async (action: Decision) => {
    if (!item.id || busy || !reviewer) return
    const bad = action === 'appeal' ? photoProblem(photo) : null
    if (bad) { setMsg(bad); return }
    setBusy(action); setMsg(null); setLast(null)
    try {
      // a note / photo belongs to an appeal only (P5 fix); saveDecision drops them for approve / reject
      const row = await saveDecision(item.id, action, { reviewer, note, photo })
      patchReviewCaches(qc, row)
      setMode('idle'); setNote(''); setPhoto(null)
      setLast({ id: item.id, eventId: row.event_id })               // Undo = exactly this item + this decision (D24)
      setMsg(`${DONE_LABEL[action]} ✓`)
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
    <Section title="Review" right={<span className={cn('t-small', item.status === 'pending' ? 'sodium' : 'ink3')}>{reviewLabel(item.status)}</span>}>
      <p className="t-small ink2">A person should check this because: {reviewReasons(item.reasons, { match_status: finding, discrepancies: item.discrepancies }).map((r) => r.charAt(0).toLowerCase() + r.slice(1)).join('; ')}.</p>
      {item.note && <p className="t-small ink3 mt-1">Note: {item.note}</p>}
      {offline || item.id == null ? (
        <p className="t-small mt-2" style={{ color: 'var(--ns-sodium)' }}>Offline — read-only. Decisions can’t be saved until the database is back.</p>
      ) : !reviewer ? (
        <div className="mt-2"><p className="t-small ink2 mb-1.5">Your name is saved with each decision (asked once, no login).</p><ReviewerForm compact /></div>
      ) : (
        <>
          <div className="mt-2 flex gap-1.5">
            <button className="btn btn-line" disabled={!!busy} onClick={() => send('approve')}>{busy === 'approve' ? <Loader2 className="animate-spin" /> : <Check />} {busy === 'approve' ? 'Saving…' : 'Approve'}</button>
            <button className="btn btn-line" disabled={!!busy} onClick={() => send('reject')}>{busy === 'reject' ? <Loader2 className="animate-spin" /> : <CircleSlash />} {busy === 'reject' ? 'Saving…' : 'Reject'}</button>
            <button className="btn btn-line" disabled={!!busy} aria-pressed={mode === 'appeal'} onClick={() => setMode(mode === 'appeal' ? 'idle' : 'appeal')}><Flag /> Appeal</button>
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

