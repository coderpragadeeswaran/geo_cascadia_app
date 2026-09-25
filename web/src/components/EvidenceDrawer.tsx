/** Evidence drawer (CLAUDE.md §9.4.1 / test 5): the exact Street View evidence view with its box, attributes with route
 *  badges (model_card notes), the SYNTHETIC register record, Google cross-check, reasons, cost and review actions.
 *  "Live 360°" dives the map into the panorama at the stored pano / heading / pitch. */
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Check, CircleSlash, Flag, Map as MapIcon, Rotate3d, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '@/api/client'
import { useObjectDetail } from '@/api/queries'
import type { AnyProps, Asset, Building, GapProps, MissingProps, ReviewItem, UnmappedBusiness } from '@/api/types'
import { Button } from '@/components/ui/button'
import { useAreaData } from '@/lib/useAreaData'
import { RouteBadge } from '@/lib/routes'
import { cn, fmt, fmt1 } from '@/lib/utils'
import { useUi } from '@/store/ui'
import { StatusChip } from './Inspect'
import { StreetViewImage, type EvidenceView } from './StreetViewImage'

const pretty = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ') : '—')

export function EvidenceDrawer({ sel }: { sel: AnyProps }) {
  const select = useUi((s) => s.select)
  const dive = useUi((s) => s.dive)
  const setDive = useUi((s) => s.setDive)
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
    <motion.aside key={'id' in sel ? `${sel.kind}:${sel.id}` : 'x'} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }} transition={{ type: 'spring', stiffness: 360, damping: 34 }}
      className="flex h-full min-h-0 flex-col" aria-label="Evidence">
      <div className="flex items-center gap-1 border-b border-glass-border px-2 py-1.5">
        <Button size="sm" onClick={() => select(null)} aria-label="Back to findings (Esc)"><ArrowLeft /> Findings</Button>
        <div className="flex-1" />
        {dive && <Button size="sm" variant="accent" onClick={() => setDive(null)}><MapIcon /> Back to map</Button>}
        <Button size="icon-sm" onClick={() => select(null)} aria-label="Close"><X /></Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-4 pt-3">{body}</div>
    </motion.aside>
  )
}

const Loading = () => <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-hover" />)}</div>

function Head({ eyebrow, title, right, sub }: { eyebrow: string; title: string; right?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <header className="mb-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow truncate">{eyebrow}</div>
          <h2 className="mt-0.5 text-[16px] font-semibold leading-tight">{title}</h2>
        </div>
        {right}
      </div>
      {sub && <div className="mt-1 text-[12px] text-muted">{sub}</div>}
    </header>
  )
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <div className="mb-1.5 flex items-center justify-between gap-2"><h3 className="eyebrow">{title}</h3>{right}</div>
      {children}
    </section>
  )
}

function Attr({ label, value, route, note }: { label: string; value: React.ReactNode; route?: string | null; note?: React.ReactNode }) {
  return (
    <div className="border-b border-glass-border py-2 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-muted">{label}</span>
        <RouteBadge route={route} />
      </div>
      <div className="mt-0.5 text-[13.5px] font-medium">{value}</div>
      {note && <div className="mt-0.5 text-[11px] leading-snug text-faint">{note}</div>}
    </div>
  )
}

const KV = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 py-[3px] text-[12px]"><span className="text-muted">{k}</span><span className="tnum text-right">{v ?? '—'}</span></div>
)
const Synthetic = () => <span className="rounded-md border border-dashed border-glass-border px-1.5 py-0.5 text-[10px] text-muted">synthetic register (demo)</span>

/** Street View evidence with view switcher + "Live 360°" dive */
function Evidence({ views, at, crosshair }: { views: { key: string; label: string; view: EvidenceView; note?: React.ReactNode }[]; at: { lat: number; lng: number } | null; crosshair?: boolean }) {
  const [i, setI] = useState(0)
  const setDive = useUi((s) => s.setDive)
  const dive = useUi((s) => s.dive)
  useEffect(() => setI(0), [views])
  if (!views.length) return <div className="rounded-xl border border-dashed border-glass-border p-4 text-center text-[12px] text-muted">No Street View evidence stored for this item.</div>
  const v = views[Math.min(i, views.length - 1)]
  return (
    <div>
      <StreetViewImage view={v.view} label={v.label} crosshair={crosshair} />
      {v.note && <p className="mt-1.5 text-[11px] leading-snug text-faint">{v.note}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {views.length > 1 && views.map((x, k) => (
          <button key={x.key} onClick={() => setI(k)} className={cn('h-7 cursor-pointer rounded-lg px-2 text-[11.5px]', k === i ? 'bg-accent-soft text-accent' : 'bg-hover text-muted hover:text-fg')}>{x.label}</button>
        ))}
        <div className="flex-1" />
        <Button size="sm" variant={dive ? 'subtle' : 'accent'} onClick={() => setDive(dive ? null : { pano: v.view.pano_id, heading: v.view.heading, pitch: v.view.pitch ?? 0, fov: v.view.fov ?? 90, at })}>
          <Rotate3d /> {dive ? 'Back to map' : 'Live 360°'}
        </Button>
      </div>
    </div>
  )
}

function BuildingBody({ b }: { b: Building }) {
  const area = useUi((s) => s.area)
  const detail = useObjectDetail(area, 'building', b.id)
  const at = b.attributes, reg = b.register, ev = b.evidence
  const views = useMemo(() => {
    const out: { key: string; label: string; view: EvidenceView; note?: React.ReactNode }[] = []
    if (ev?.attribute_view) out.push({ key: 'attr', label: 'Attributes view', view: ev.attribute_view as EvidenceView })
    if (ev?.sign_view) out.push({ key: 'sign', label: 'Sign view', view: { ...(ev.sign_view as EvidenceView) },
      note: ev.sign_view.ocr_text ? <>OCR: “<span className="font-medium text-fg/85">{ev.sign_view.ocr_text}</span>”{ev.sign_view.ocr_conf != null && <> · conf {fmt1.format(ev.sign_view.ocr_conf)}</>}</> : undefined })
    if (!out.length && ev?.views?.[0]) out.push({ key: 'v0', label: 'Camera view', view: { ...(ev.views[0] as EvidenceView), fov: 90 }, note: 'No detection box stored for this building; nearest camera view shown.' })
    return out
  }, [ev])
  const name = at?.name
  return (
    <>
      <Head eyebrow={`Building · ${b.id}`} title={name?.value && name.quality === 'good' ? name.value : b.street ?? '—'}
        right={<StatusChip s={b.match_status} />} sub={<>{b.street} · <span className="tnum">{b.lat.toFixed(5)}, {b.lon.toFixed(5)}</span></>} />
      <Evidence views={views} at={{ lat: b.lat, lng: b.lon }} />
      <Section title="Observed attributes">
        <Attr label="Use" route={at?.use?.route} value={at?.use?.value ? pretty(at.use.value) : <span className="text-unclassified">not classified</span>}
          note={!at?.use?.value ? 'No usable view for use classification (shown, never hidden).' : undefined} />
        <Attr label="Floors" route={at?.floors?.route}
          value={at?.floors?.value != null ? <>{at.floors.value} <span className="text-[12px] font-normal text-muted">({pretty(at.floors.status)})</span></> : <span className="text-unclassified">not measured</span>} />
        <Attr label="Name / sign text" route={name?.route}
          value={name?.value ? <>{name.value} <span className="text-[12px] font-normal text-muted">({pretty(name.quality)})</span></> : '—'}
          note={ev?.sign_view?.ocr_text ? <>OCR read: “{ev.sign_view.ocr_text}”</> : undefined} />
        {!!at?.property_identifiers?.length && <Attr label="Property identifiers (unverified)" value={at.property_identifiers.join(', ')} />}
        {at?.shop_units != null && <Attr label="Shop units" value={String(at.shop_units)} />}
        <p className="mt-1.5 text-[11px] text-faint">Condition: withheld (not validated, see Trust).</p>
      </Section>
      <Section title="Register record" right={<Synthetic />}>
        <KV k="Property ID" v={reg?.property_id} />
        <KV k="Recorded use · floors" v={`${pretty(reg?.record_use)} · ${reg?.record_floors ?? '—'}`} />
        <KV k="Recorded area" v={reg?.record_area_m2 != null ? `${fmt.format(Math.round(reg.record_area_m2))} m²` : '—'} />
        <KV k="Distance to record" v={reg?.record_dist_m != null ? `${fmt1.format(reg.record_dist_m)} m` : '—'} />
        <KV k="Match" v={<StatusChip s={b.match_status} />} />
        {!!b.discrepancies?.length && <KV k="Discrepancies" v={b.discrepancies.map(pretty).join(', ')} />}
        {!!b.reasons?.length && <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[12px] text-fg/85">{b.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      </Section>
      <Section title="Google cross-check">
        <KV k="Sign name confirmed by Google" v={name?.google_confirmed ? <span className="text-matched">yes</span> : 'no'} />
        {name?.google_place_id && <KV k="Google place" v={<PlaceName id={name.google_place_id} />} />}
        {!!b.google_flags?.length && <KV k="Flags" v={b.google_flags.map(pretty).join(', ')} />}
      </Section>
      <Section title="Cost (this building)">
        <KV k="VLM calls · cost" v={`${b.cost?.vlm_calls ?? 0} · $${(b.cost?.vlm_usd ?? 0).toFixed(4)}`} />
      </Section>
      <ReviewActions item={detail.data?.review_item ?? null} loading={detail.isPending} />
    </>
  )
}

function AssetBody({ a }: { a: Asset }) {
  const area = useUi((s) => s.area)
  const detail = useObjectDetail(area, 'asset', a.id)
  const views = useMemo(() => (a.evidence?.views ?? []).map((v, k) => ({
    key: `v${k}`, label: `Camera ${k + 1}${v.source === 'user' ? ' (user photo)' : ''}`, view: v as EvidenceView,
    note: 'View aimed at the estimated position; the pipeline stores no detection box for assets.' })), [a])
  const reg = a.register
  return (
    <>
      <Head eyebrow={`${a.type === 'pole' ? 'Utility pole' : 'Streetlight'} · ${a.id}`} title={a.street ?? '—'}
        right={<StatusChip s={reg?.status} />} sub={<span className="tnum">{a.lat.toFixed(6)}, {a.lon.toFixed(6)}</span>} />
      <Evidence views={views} at={{ lat: a.lat, lng: a.lon }} crosshair />
      <Section title="Detection & position">
        <Attr label="Detected as" route={a.route} value={a.type} />
        <Attr label="Position" value={a.method === 'triangulated' ? `triangulated from ${a.cameras_used} cameras` : 'approximate (single camera)'}
          note={`± ${fmt1.format(a.uncertainty_m ?? 0)} m · ${a.uncertainty_basis ?? ''}`} />
        <KV k="Confidence · detections" v={`${a.confidence ?? '—'} · ${a.n_detections ?? '—'}`} />
      </Section>
      <Section title="Register record" right={<Synthetic />}>
        <KV k="Asset no." v={reg?.asset_no} />
        <KV k="Recorded type" v={reg?.record_type} />
        <KV k="Status" v={<StatusChip s={reg?.status} />} />
        {!!reg?.flags?.length && <KV k="Flags" v={reg.flags.map(pretty).join(', ')} />}
      </Section>
      <ReviewActions item={detail.data?.review_item ?? null} loading={detail.isPending} />
    </>
  )
}

function UnmappedBody({ u }: { u: UnmappedBusiness }) {
  const views = useMemo(() => (u.evidence ? [{ key: 'e', label: 'Sign view', view: u.evidence as EvidenceView,
    note: u.ocr_text ? <>OCR: “<span className="font-medium text-fg/85">{u.ocr_text}</span>”</> : undefined }] : []), [u])
  return (
    <>
      <Head eyebrow={`Unmapped business · ${u.id}`} title={u.name ?? '—'} sub={u.street ?? undefined} />
      <Evidence views={views} at={{ lat: u.lat, lng: u.lon }} />
      <Section title="Why it is here">
        <p className="text-[12px] leading-snug text-fg/85">A business sign read on frontage with no building outline in OpenStreetMap, so it has no register match.</p>
        <KV k="Position" v={u.position ?? 'approximate'} />
        <KV k="Sightings" v={u.sightings} />
      </Section>
    </>
  )
}

function MissingBody({ p }: { p: MissingProps }) {
  return (
    <>
      <Head eyebrow="Register record, nothing seen" title={p.id} sub={p.street ?? undefined} right={<Synthetic />} />
      <p className="text-[12.5px] leading-snug text-fg/85">{p.why}</p>
      <p className="mt-2 text-[11px] text-faint">The synthetic asset register lists an asset here, but no pole or streetlight was detected within 25 m, so there is no Street View evidence to show.</p>
    </>
  )
}

function GapBody({ p }: { p: GapProps }) {
  return (
    <>
      <Head eyebrow="Streetlight gap · 60 m rule" title={p.street} />
      <KV k="Length (recorded)" v={`${fmt.format(p.length_m)} m`} />
      {p.display_mode === 'along_road' && p.along_road_m != null && p.length_differs && <KV k="Along the road" v={`≈ ${fmt.format(p.along_road_m)} m`} />}
      <KV k="Finding" v={p.gap_type} />
      <KV k="Poles inside" v={p.poles_inside} />
      {p.display_mode === 'check'
        ? <p className="mt-2 rounded-md bg-[rgb(245_165_36/0.12)] px-2.5 py-2 text-[12px] leading-snug text-discrepancy">Check: {p.note}</p>
        : p.note && <p className="mt-2 text-[11px] leading-snug text-faint">{p.note}</p>}
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
  if (err) return <span className="text-faint">lookup unavailable</span>
  return name ? <span>{name} <span className="text-[10px] text-faint">· Google Maps</span></span> : <span className="text-faint">looking up…</span>
}

function ReviewActions({ item, loading }: { item: ReviewItem | null; loading: boolean }) {
  const offline = useUi((s) => s.offline)
  const qc = useQueryClient()
  const [mode, setMode] = useState<'idle' | 'appeal'>('idle')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  if (loading) return null
  if (!item) return <Section title="Review"><p className="text-[12px] text-muted">Not in the review queue.</p></Section>
  const send = async (action: 'approve' | 'reject' | 'appeal') => {
    if (!item.id) return
    const fd = new FormData()
    fd.set('action', action)
    if (note.trim()) fd.set('note', note.trim())
    if (photo) fd.set('photo', photo)
    setBusy(true); setMsg(null)
    try {
      await api(`/review/${item.id}`, { method: 'PATCH', body: fd })
      setMode('idle'); setNote(''); setPhoto(null)
      for (const k of ['detail', 'buildings', 'assets', 'review', 'geo']) qc.invalidateQueries({ queryKey: [k] })
    } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Could not save') } finally { setBusy(false) }
  }
  return (
    <Section title="Review" right={<span className={cn('text-[11.5px] font-semibold', item.status === 'pending' ? 'text-review' : 'text-muted')}>{item.status}</span>}>
      <ul className="mb-2 list-disc space-y-0.5 pl-4 text-[12px] text-fg/85">{item.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      {item.note && <p className="mb-2 text-[11.5px] text-muted">Note: {item.note}</p>}
      {offline || item.id == null ? (
        <p className="text-[11.5px] text-discrepancy">Offline data mode: decisions are read-only.</p>
      ) : (
        <>
          <div className="flex gap-1.5">
            <Button size="sm" variant="subtle" disabled={busy} onClick={() => send('approve')}><Check /> Approve</Button>
            <Button size="sm" variant="subtle" disabled={busy} onClick={() => send('reject')}><CircleSlash /> Reject</Button>
            <Button size="sm" variant="subtle" disabled={busy} onClick={() => setMode(mode === 'appeal' ? 'idle' : 'appeal')}><Flag /> Appeal</Button>
          </div>
          <AnimatePresence>
            {mode === 'appeal' && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Appeal note (required)" rows={3}
                  className="mt-2 w-full resize-none rounded-lg border border-glass-border bg-hover px-2.5 py-2 text-[12.5px] outline-none focus:border-accent" />
                <div className="mt-1.5 flex items-center gap-2">
                  <label className="cursor-pointer text-[11.5px] text-muted hover:text-fg">
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
                    {photo ? photo.name : '+ Photo (optional)'}
                  </label>
                  <div className="flex-1" />
                  <Button size="sm" variant="accent" disabled={busy || !note.trim()} onClick={() => send('appeal')}>Send appeal</Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
      {msg && <p className="mt-1.5 text-[11.5px] text-no-record">{msg}</p>}
    </Section>
  )
}
