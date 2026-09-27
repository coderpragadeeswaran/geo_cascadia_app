/** Review (USER screen, plain language; P5 / D29): queue | the evidence photo with its box | the decision.
 *  - Who is reviewing: asked once, remembered in this browser, saved with every decision and undo (no login).
 *  - Queue filters (street, reason, priority, status) combine; every option shows its live count.
 *  - Keys: J / K next / previous, A approve, R reject, E appeal, U undo, ? shortcuts. A note and a photo belong to an
 *    appeal only. Decisions persist via PATCH /review/{id}, update the map, and are logged in review_events.
 *  - After a decision: a short confirmation and a flash on the mini-map where it changed; the history panel lists every
 *    decision on the item (who, what, when, undone) with its appeal photo (signed URL, private bucket).
 *  - Live 360°: the panorama shows through the middle column (the map stays one instance, D3). */
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, CircleSlash, Flag, ImageIcon, Keyboard, Loader2, MapPin, Undo2, UserRound, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '@/api/client'
import { useReviewEvents } from '@/api/p5'
import { useReviewRows } from '@/api/queries'
import type { ReviewRow } from '@/api/types'
import { EvidenceViews } from '@/components/EvidenceViews'
import { GeoMini, type MiniPoint } from '@/components/GeoMini'
import { ObjectMini } from '@/components/ObjectMini'
import { ReviewerDialog } from '@/components/ReviewerName'
import { assetRegLabel, matchLabel, reviewLabel, reviewReasons, useLabel } from '@/lib/labels'
import { DONE_LABEL, patchReviewCaches, PHOTO_MAX_MB, PHOTO_TYPES, photoProblem, saveDecision, undoDecision, type Decision, type ReviewEvent } from '@/lib/review'
import { miniStreets } from '@/lib/mini'
import { propsFor, useAreaData } from '@/lib/useAreaData'
import { cn, fmt, fmt1, plural } from '@/lib/utils'
import { useUi } from '@/store/ui'

const STATUS_TONE: Record<string, MiniPoint['tone']> = { approved: 'discrepancy', rejected: 'no_record', appealed: 'review', pending: 'sodium' }
const STATUS_COLOR: Record<string, string> = { approved: 'var(--ns-discrepancy)', rejected: 'var(--ns-no-record)', appealed: 'var(--ns-review)', pending: 'var(--ns-sodium)', undo: 'var(--ns-ink3)' }
interface Filters { street: string; reason: string; priority: string; status: string }
const ALL: Filters = { street: '', reason: '', priority: '', status: 'pending' }

/** this browser tab's review session: decisions made (minus undone) and when the first one was made */
const SESSION_KEY = 'gc.reviewSession'
function readSession(): { n: number; t0: number | null } {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '') } catch { return { n: 0, t0: null } }
}
function writeSession(s: { n: number; t0: number | null }) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) } catch { /* private mode */ } }

const reasonsOf = (r: ReviewRow) => reviewReasons(r.reasons, { match_status: r.object?.match_status as string | null, discrepancies: r.discrepancies })
/** display name, e.g. "Residential · 2nd Street, Gandhi Nagar" (never the raw OSM id) */
function title(r: ReviewRow) {
  if (r.item_type === 'asset') return `${r.asset_cls === 'streetlight' ? 'Streetlight' : 'Pole'} · ${r.street ?? '—'}`
  const use = r.object?.use as string | null | undefined
  // a sign text is the title only when it reads as a real name (backend sends only those); else "<Use> on <street>"
  if (r.object?.name && typeof r.object.name === 'string') return `${r.object.name} · ${r.street ?? '—'}`
  return `${use ? useLabel(use) : 'Building'} on ${r.street ?? '—'}`
}

export default function Review() {
  const area = useUi((s) => s.area)
  const focus = useUi((s) => s.reviewFocus)
  const offline = useUi((s) => s.offline)
  const reviewer = useUi((s) => s.reviewer)
  const dive = useUi((s) => s.dive)
  const { data: rows, isPending, isError, refetch } = useReviewRows(area)
  const { records, props, streets } = useAreaData()
  const qc = useQueryClient()
  const [f, setF] = useState<Filters>(ALL)
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [appeal, setAppeal] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [askName, setAskName] = useState(!reviewer)
  const [help, setHelp] = useState(false)
  const [session, setSession] = useState(readSession)
  const [flash, setFlash] = useState<{ lat: number; lon: number; status: string; key: number } | null>(null)
  const [decidedHere, setDecidedHere] = useState<Map<number, { lat: number; lon: number; status: string }>>(new Map())
  // one decision at a time: the lock is a ref so a second key press in the same tick is refused too (D23)
  const lock = useRef(false)
  const [saving, setSaving] = useState<Decision | null>(null)
  const [undoing, setUndoing] = useState(false)
  // the toast names ONE item and ONE decision (event); Undo sends exactly those two ids (D24)
  const [done, setDone] = useState<{ id: number; name: string; action: Decision; eventId: number; key: number; sel: string } | null>(null)
  const [undone, setUndone] = useState<{ id: number; name: string } | null>(null)

  const base = useMemo(() => {
    const all = [...(rows ?? [])].sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9))
    return focus && focus.area === area ? all.filter((r) => r.id != null && focus.ids.includes(r.id)) : all
  }, [rows, focus, area])
  // R2: every filter really filters (a decided item leaves "Waiting for review" at once)
  const matches = useCallback((r: ReviewRow, g: Filters, skip?: keyof Filters) =>
    (skip === 'street' || !g.street || r.street === g.street)
    && (skip === 'reason' || !g.reason || reasonsOf(r).includes(g.reason))
    && (skip === 'priority' || !g.priority || String(r.priority) === g.priority)
    && (skip === 'status' || !g.status || r.status === g.status), [])
  const list = useMemo(() => base.filter((r) => matches(r, f)), [base, f, matches])
  const facets = useMemo(() => {
    const count = (k: keyof Filters, val: (r: ReviewRow) => string[]) => {
      const m = new Map<string, number>()
      for (const r of base) if (matches(r, f, k)) for (const v of val(r)) m.set(v, (m.get(v) ?? 0) + 1)
      return m
    }
    return {
      street: count('street', (r) => [r.street ?? '—']), reason: count('reason', reasonsOf),
      priority: count('priority', (r) => [String(r.priority)]), status: count('status', (r) => [r.status]),
    }
  }, [base, f, matches])
  // the selection is an ITEM, not a list position: after a decision the item may leave the filtered list, and the
  // confirmation's "History" link can still open it (shown with a note that it is outside the filter)
  const [sel, setSel] = useState<string | null>(null)
  const keyOf = (r: ReviewRow) => `${r.item_type}:${r.ref_id}`
  const cur: ReviewRow | undefined = (sel ? base.find((r) => keyOf(r) === sel) : undefined) ?? list[0]
  const inList = !!cur && list.some((r) => keyOf(r) === keyOf(cur))
  const i = cur ? list.findIndex((r) => keyOf(r) === keyOf(cur)) : -1
  useEffect(() => { setUndone((u) => (u && u.id !== cur?.id ? null : u)); setMsg(null) }, [cur?.id])
  useEffect(() => { setSel(null) }, [f])
  // the item a key press acts on is read from refs, never from a stale render (D23 skipped-items fix)
  const curRef = useRef(cur)
  curRef.current = cur
  const listRef = useRef(list)
  listRef.current = list
  const move = (d: number) => {
    const L = listRef.current
    if (!L.length) return
    const at = curRef.current ? L.findIndex((r) => keyOf(r) === keyOf(curRef.current!)) : -1
    const to = at < 0 ? 0 : Math.max(0, Math.min(L.length - 1, at + d))
    curRef.current = L[to]
    setSel(keyOf(L[to]))
  }

  const bump = (d: number) => setSession((s) => {
    const n = { n: Math.max(0, s.n + d), t0: s.t0 ?? Date.now() }
    writeSession(n)
    return n
  })
  /** R4: the item's history shows the new event at once (then refetches the real rows) */
  const pushEvent = (id: number, ev: ReviewEvent, undoes?: number) => {
    qc.setQueryData<ReviewEvent[]>(['review-events', id], (old) => [ev, ...(old ?? []).map((e) => (undoes && e.id === undoes ? { ...e, undone_by: ev.id } : e))])
    qc.invalidateQueries({ queryKey: ['review-events', id] })
  }
  const decide = useCallback(async (action: Decision) => {
    const item = curRef.current
    if (!item?.id || offline || lock.current) return
    if (!reviewer) { setAskName(true); return }
    if (action === 'appeal' && !note.trim()) { setAppeal(true); return }
    const bad = action === 'appeal' ? photoProblem(photo) : null
    if (bad) { setMsg(bad); return }
    lock.current = true
    setSaving(action); setMsg(null); setDone(null); setUndone(null)
    try {
      const row = await saveDecision(item.id, action, { reviewer, note, photo })     // note / photo sent only for an appeal
      pushEvent(item.id, { id: row.event_id, action, status: row.status, previous_status: item.status, reviewer, previous_reviewer: item.reviewer,
        note: row.note, previous_note: item.note, undoes: null, undone_by: null, created_at: new Date().toISOString(), has_photo: action === 'appeal' && !!photo })
      // the next item still waiting after this one, in the list as it was before the save
      const L = listRef.current
      const at = L.findIndex((r) => r.id === item.id)
      const next = L.find((r, k) => k > at && r.status === 'pending' && r.id !== item.id) ?? L.find((r) => r.status === 'pending' && r.id !== item.id)
      patchReviewCaches(qc, row)
      setNote(''); setPhoto(null); setAppeal(false)
      const key = Date.now()
      setDone({ id: item.id, name: title(item), action, eventId: row.event_id, key, sel: keyOf(item) })
      setFlash({ lat: item.lat, lon: item.lon, status: row.status, key })
      setDecidedHere((m) => new Map(m).set(item.id!, { lat: item.lat, lon: item.lon, status: row.status }))
      bump(+1)
      if (next) { curRef.current = next; setSel(keyOf(next)) }
    } catch (e) { setMsg(e instanceof ApiError ? (e.status === 503 ? 'Offline — read-only. Nothing was saved.' : e.message) : 'Could not save') }
    finally { lock.current = false; setSaving(null) }
  }, [note, photo, offline, qc, reviewer]) // eslint-disable-line react-hooks/exhaustive-deps

  /** undo ONE decision (event) on ONE item: from the confirmation, from History, or with U (R1) */
  const undoEvent = useCallback(async (itemId: number, eventId: number, name: string, itemKey: string) => {
    if (lock.current) return
    lock.current = true
    setUndoing(true); setMsg(null)
    try {
      const row = await undoDecision(itemId, eventId, reviewer)
      pushEvent(itemId, { id: row.event_id, action: 'undo', status: row.status, previous_status: '', reviewer, previous_reviewer: null,
        note: row.note, previous_note: null, undoes: eventId, undone_by: null, created_at: new Date().toISOString(), has_photo: false }, eventId)
      patchReviewCaches(qc, row)
      setDecidedHere((m) => { const x = new Map(m); x.delete(itemId); return x })
      bump(-1)
      setSel(itemKey)
      setDone((d) => (d && d.eventId === eventId ? null : d)); setFlash(null)
      setUndone({ id: itemId, name })
    } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Could not undo') }
    finally { lock.current = false; setUndoing(false) }
  }, [qc, reviewer]) // eslint-disable-line react-hooks/exhaustive-deps
  const undo = useCallback(() => {
    if (done) return undoEvent(done.id, done.eventId, done.name, done.sel)
    const it = curRef.current                                   // U with no confirmation: the item's latest live decision
    if (!it?.id) return
    const ev = latestLive(qc.getQueryData<ReviewEvent[]>(['review-events', it.id]))
    if (ev) return undoEvent(it.id, ev.id, title(it), keyOf(it))
  }, [done, undoEvent, qc]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('textarea, input, select, [role="dialog"]')) return
      if (askName) return
      if (e.key === '?') { setHelp((h) => !h); return }
      if (e.key === 'Escape') { if (help) setHelp(false); else if (useUi.getState().dive) useUi.getState().setDive(null); return }
      if (lock.current || (e.ctrlKey && e.key !== 'z') || e.altKey) return
      if (e.key === 'j') move(1)
      else if (e.key === 'k') move(-1)
      else if (e.key === 'a') decide('approve')
      else if (e.key === 'r') decide('reject')
      else if (e.key === 'e') setAppeal(true)
      else if ((e.key === 'z' && (e.ctrlKey || e.metaKey)) || e.key === 'u') undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [decide, undo, askName, help]) // eslint-disable-line react-hooks/exhaustive-deps

  const b = cur?.item_type === 'building' ? records?.buildings.find((x) => x.id === cur.ref_id) : undefined
  const a = cur?.item_type === 'asset' ? records?.assets.find((x) => x.id === cur.ref_id) : undefined
  const showOnMap = () => {
    if (!cur) return
    const p = propsFor(props, cur.item_type === 'building' ? 'building' : cur.asset_cls ?? 'pole', cur.ref_id)
    const ui = useUi.getState()
    ui.go('explore')
    if (p) ui.select(p)
  }
  const waiting = base.filter((r) => r.status === 'pending').length
  const mins = session.t0 ? Math.max(1, (Date.now() - session.t0) / 60000) : null
  const mini = useMemo(() => miniStreets(streets), [streets])
  const miniPoints: MiniPoint[] = [
    ...[...decidedHere.entries()].filter(([id]) => id !== cur?.id).map(([, d]) => ({ lat: d.lat, lon: d.lon, tone: STATUS_TONE[d.status], shape: 'ring' as const,
      legend: 'decided in this session', tip: `Decided in this session: ${reviewLabel(d.status).toLowerCase()}` })),
    ...(cur ? [{ lat: cur.lat, lon: cur.lon, tone: 'sodium' as const, legend: 'this item', tip: 'The item you are reviewing' }] : []),
    ...(flash ? [{ lat: flash.lat, lon: flash.lon, tone: STATUS_TONE[flash.status], pulse: true, legend: 'decided in this session', tip: DONE_LABEL[(flash.status === 'approved' ? 'approve' : flash.status === 'rejected' ? 'reject' : 'appeal') as Decision] }] : []),
  ]
  const busy = !!saving || undoing
  return (
    <div className={cn('relative grid h-full grid-cols-[330px_minmax(0,1fr)_340px]', dive && 'pointer-events-none')}>
      <aside className="surface pointer-events-auto flex min-h-0 flex-col" style={{ borderRight: '1px solid var(--ns-line)' }} aria-label="Review queue">
        <div className="px-5 pb-2 pt-5">
          <div className="flex items-center justify-between gap-2">
            <div className="t-micro">Review · most urgent first</div>
            <button className="btn btn-icon" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts (?)"><Keyboard /></button>
          </div>
          <h1 className="t-title mt-1" aria-live="polite">{focus && focus.area === area ? `${fmt.format(base.length)} sent from Explore · ${fmt.format(waiting)} waiting` : `${fmt.format(waiting)} waiting`}</h1>
          {focus && focus.area === area && <p className="t-small ink2 mt-1">“{focus.label}” · <button className="link" onClick={() => useUi.setState({ reviewFocus: null })}>show the whole queue</button></p>}
          <p className="t-small ink2 mt-1 flex flex-wrap items-center gap-x-2">
            <span className="inline-flex items-center gap-1"><UserRound className="size-3.5" aria-hidden />{reviewer ? <>Reviewing as <b className="text-ink">{reviewer}</b></> : 'No name yet'}</span>
            <button className="link" onClick={() => setAskName(true)}>{reviewer ? 'change' : 'add'}</button>
          </p>
          <p className="t-small ink3 mt-0.5">This session: {plural(session.n, 'decision')}{mins && session.n ? ` · ${fmt1.format(session.n / mins)} per minute` : ''}</p>
          {offline && <p className="t-small mt-2 sodium">Offline — read-only. Decisions can’t be saved until the database is back.</p>}
          <FilterBar f={f} setF={setF} facets={facets} shown={list.length} />
        </div>
        <ol className="min-h-0 flex-1 overflow-y-auto" aria-label="Items">
          {isPending && <li className="t-small ink3 px-5 py-3">Loading…</li>}
          {isError && <li className="t-small ink2 px-5 py-3">Couldn’t load the queue. <button className="link" onClick={() => refetch()}>Try again</button></li>}
          {!isPending && !isError && !list.length && <li className="t-small ink3 px-5 py-3">{base.length ? 'No item matches these filters.' : 'Nothing to review.'}</li>}
          {list.map((r, k) => (
            <li key={`${r.item_type}:${r.ref_id}`}>
              <button onClick={() => { if (!lock.current) { setSel(keyOf(r)); setAppeal(false) } }} aria-current={k === i ? 'true' : undefined}
                className={cn('w-full cursor-pointer px-5 py-2.5 text-left rule-t hover:bg-line', k === i && 'bg-accent-soft')}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate">{title(r)}</span>
                  <span className="t-small shrink-0" style={{ color: r.status === 'pending' ? 'var(--ns-sodium)' : STATUS_COLOR[r.status] }}>{r.status === 'pending' ? `P${r.priority}` : reviewLabel(r.status)}</span>
                </div>
                <div className="t-small ink3 truncate">{reasonsOf(r).join(' · ')}</div>
              </button>
            </li>
          ))}
        </ol>
        <p className="t-small ink3 rule-t px-5 py-2"><span className="kbd">?</span> keyboard shortcuts · <span className="kbd">J</span> <span className="kbd">K</span> move · <span className="kbd">A</span> <span className="kbd">R</span> <span className="kbd">E</span> decide</p>
      </aside>

      <section className={cn('min-h-0 overflow-y-auto px-8 py-6', dive ? 'pointer-events-none' : 'pointer-events-auto')} style={{ background: dive ? 'transparent' : 'var(--ns-bg0)' }} aria-label="Evidence">
        {dive ? (
          <div className="pointer-events-auto inline-flex items-center gap-2">
            <button onClick={() => useUi.getState().setDive(null)} className="btn btn-solid h-9"><ArrowLeft /> Back to review</button>
            <span className="sheet t-small ink2 px-2.5 py-1.5">Live Street View · drag to look around · Esc</span>
          </div>
        ) : !cur ? <p className="t-small ink3">{isPending ? 'Loading…' : 'Nothing to show.'}</p> : (
          <div className="mx-auto max-w-[620px]">
            <div className="t-micro">{cur.item_type === 'asset' ? 'Pole or streetlight' : 'Building'}</div>
            <h2 className="t-display mt-1" style={{ fontSize: 27 }}>{title(cur)}</h2>
            <div className="mt-4">
              {b && <EvidenceViews kind="building" id={b.id} at={{ lat: b.lat, lng: b.lon }} target="building" />}
              {a && <EvidenceViews kind="asset" id={a.id} at={{ lat: a.lat, lng: a.lon }} target={a.type === 'streetlight' ? 'lamp' : 'pole'} />}
              {!b && !a && <div className="aspect-square w-full animate-pulse rounded-[var(--ns-r-control)] bg-line" />}
            </div>
          </div>
        )}
      </section>

      <aside className="surface pointer-events-auto flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overflow-x-hidden px-5 py-5 [&>*]:min-w-0" style={{ borderLeft: '1px solid var(--ns-line)' }} aria-label="Decision">
        {cur && <>
          {!inList && <p className="t-small rounded-[var(--ns-r-control)] px-2.5 py-1.5" style={{ boxShadow: 'inset 0 0 0 1px var(--ns-line-strong)' }}>This item is outside the current filter ({reviewLabel(cur.status).toLowerCase()}). <button className="link" onClick={() => move(0)}>Back to the list</button></p>}
          <div className="t-micro">Why a person should check</div>
          <ul className="space-y-1">{reasonsOf(cur).map((x) => <li key={x} className="t-small flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full" style={{ background: 'var(--ns-sodium)' }} />{x}</li>)}</ul>
          <div className="t-micro mt-1">What we saw</div>
          {b && <p className="t-small">{useLabel(b.attributes?.use?.value)} · {b.attributes?.floors?.value != null ? plural(b.attributes.floors.value, 'floor') : 'floors not known'} · {matchLabel(b.match_status, true, !!b.attributes?.use?.value)} <span className="ink3">(synthetic register)</span></p>}
          {a && <p className="t-small">{a.method === 'triangulated' ? 'Pinpointed' : 'Approximate position'} · {assetRegLabel(a.register?.status, true)} <span className="ink3">(synthetic register)</span></p>}
          <div className="t-small ink3">Status: <span style={{ color: STATUS_COLOR[cur.status] }}>{reviewLabel(cur.status)}</span>{cur.status !== 'pending' && cur.reviewer ? ` by ${cur.reviewer}` : ''}{cur.status === 'appealed' && cur.note ? ` · note: ${cur.note}` : ''}</div>
          {(b || a) ? <ObjectMini key={`${cur.item_type}:${cur.ref_id}:${flash?.key ?? 0}`} area={area} obj={b ? { kind: 'building', b } : { kind: 'asset', a: a! }}
            streets={mini} extra={miniPoints.filter((p) => p.legend !== 'this item')} height={220} label="Where this item is: its street, the buildings around it, and the cameras that saw it" />
            : <GeoMini area={area} streets={mini} points={miniPoints} fit="area" height={170} label="Where this item is; decisions made in this session flash here" key={flash?.key ?? 0} />}

          <div className="grid min-w-0 gap-1.5" aria-busy={busy}>
            {offline && <p className="t-small sodium">Offline — read-only</p>}
            <DecisionButton icon={<Check />} label="Approve: the finding is right" k="A" busy={saving === 'approve'} disabled={offline || busy} onClick={() => decide('approve')} />
            <DecisionButton icon={<CircleSlash />} label="Reject: the finding is wrong" k="R" busy={saving === 'reject'} disabled={offline || busy} onClick={() => decide('reject')} />
            <button className="btn btn-line justify-between" disabled={offline || busy} aria-pressed={appeal} onClick={() => setAppeal(!appeal)}><span className="flex items-center gap-1.5"><Flag /> Appeal with a note or photo</span><span className="kbd">E</span></button>
            {appeal && <AppealBox note={note} setNote={setNote} photo={photo} setPhoto={setPhoto} saving={saving === 'appeal'} disabled={busy} onSend={() => decide('appeal')} onCancel={() => { setAppeal(false); setNote(''); setPhoto(null) }} />}
            <button className="btn mt-1" onClick={showOnMap}><MapPin /> Show on the map</button>
            <div role="status" aria-live="polite" className="min-h-[1.5em]">
              {busy && <p className="t-small ink2 flex items-center gap-1.5"><Loader2 className="size-4 animate-spin sodium" /> {undoing ? 'Undoing…' : 'Saving…'}</p>}
              {!busy && done && (
                <div key={done.key} className="gc-pop min-w-0 rounded-[var(--ns-r-control)] px-3 py-2.5" style={{ boxShadow: `inset 0 0 0 1px ${STATUS_COLOR[done.action === 'approve' ? 'approved' : done.action === 'reject' ? 'rejected' : 'appealed']}` }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="t-body shrink-0" style={{ color: STATUS_COLOR[done.action === 'approve' ? 'approved' : done.action === 'reject' ? 'rejected' : 'appealed'] }}>{DONE_LABEL[done.action]} ✓</span>
                    <button className="btn btn-line h-8 shrink-0" onClick={undo}><Undo2 /> Undo <span className="kbd">U</span></button>
                  </div>
                  <div className="t-small ink2 mt-1 truncate" title={done.name}>{done.name}</div>
                  <button className="link t-small mt-0.5" onClick={() => setSel(done.sel)}>Show its history</button>
                </div>
              )}
              {!busy && undone && undone.id === cur?.id && <p className="t-small ink2">Undone: {undone.name} is back to how it was.</p>}
              {!busy && msg && <p className="t-small" style={{ color: 'var(--ns-no-record)' }}>{msg}</p>}
            </div>
          </div>
          {cur.id != null && <History id={cur.id} busy={busy} onUndo={(ev) => undoEvent(cur.id!, ev.id, title(cur), keyOf(cur))} />}
        </>}
      </aside>
      {askName && <ReviewerDialog onClose={() => setAskName(false)} />}
      {help && <Shortcuts onClose={() => setHelp(false)} />}
    </div>
  )
}

function DecisionButton({ icon, label, k, busy, disabled, onClick }: { icon: React.ReactNode; label: string; k: string; busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button className="btn btn-line justify-between" disabled={disabled} onClick={onClick}>
      <span className="flex items-center gap-1.5">{busy ? <Loader2 className="animate-spin" /> : icon} {busy ? 'Saving…' : label}</span><span className="kbd">{k}</span>
    </button>
  )
}

function FilterBar({ f, setF, facets, shown }: { f: Filters; setF: (f: Filters) => void; facets: Record<keyof Filters, Map<string, number>>; shown: number }) {
  const opts = (m: Map<string, number>, sort: 'count' | 'key' = 'count') => [...m.entries()].sort((a, b) => (sort === 'key' ? a[0].localeCompare(b[0]) : b[1] - a[1] || a[0].localeCompare(b[0])))
  const sel = (k: keyof Filters, label: string, all: string, items: [string, number][], fmtKey = (s: string) => s) => (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} aria-label={label}
        className="t-small w-full cursor-pointer rounded-[var(--ns-r-control)] border border-line-strong bg-bg1 px-2 py-1.5 outline-none focus:border-sodium"
        style={f[k] ? { borderColor: 'var(--ns-sodium)' } : undefined}>
        <option value="">{all}</option>
        {items.map(([v, c]) => <option key={v} value={v}>{fmtKey(v)} ({fmt.format(c)})</option>)}
        {f[k] && !items.some(([v]) => v === f[k]) && <option value={f[k]}>{fmtKey(f[k])} (0)</option>}
      </select>
    </label>
  )
  const active = (Object.keys(ALL) as (keyof Filters)[]).some((k) => f[k] !== ALL[k])
  return (
    <div className="mt-3 grid grid-cols-2 gap-1.5" role="group" aria-label="Filter the queue">
      {sel('status', 'Status', 'Any status', opts(facets.status), (s) => reviewLabel(s))}
      {sel('priority', 'Priority', 'Any priority', opts(facets.priority, 'key'), (p) => `P${p}`)}
      <div className="col-span-2">{sel('street', 'Street', 'All streets', opts(facets.street))}</div>
      <div className="col-span-2">{sel('reason', 'Reason', 'Any reason', opts(facets.reason))}</div>
      <p className="t-small ink3 col-span-2 flex items-center justify-between">{plural(shown, 'item')} shown
        {active && <button className="link" onClick={() => setF(ALL)}>reset filters</button>}</p>
    </div>
  )
}

function AppealBox({ note, setNote, photo, setPhoto, saving, disabled, onSend, onCancel }: {
  note: string; setNote: (s: string) => void; photo: File | null; setPhoto: (f: File | null) => void; saving: boolean; disabled: boolean; onSend: () => void; onCancel: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const problem = photoProblem(photo)
  useEffect(() => {
    if (!photo || problem) { setUrl(null); return }
    const u = URL.createObjectURL(photo)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [photo, problem])
  return (
    <div className="mt-1 rounded-[var(--ns-r-control)] p-2.5" style={{ boxShadow: 'inset 0 0 0 1px var(--ns-line-strong)' }}>
      <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} placeholder="Why? (required)" aria-label="Appeal note (required)"
        className="t-small w-full resize-none rounded-[var(--ns-r-control)] border border-line-strong bg-bg0 px-2.5 py-2 outline-none focus:border-sodium" />
      <div className="mt-1.5 flex items-start gap-2">
        {url ? (
          <figure className="relative">
            <img src={url} alt="Appeal photo preview" className="h-16 w-20 rounded-[4px] object-cover" />
            <button className="btn btn-icon absolute -right-2 -top-2 size-6 p-0" style={{ background: 'var(--ns-bg2)' }} onClick={() => setPhoto(null)} aria-label="Remove photo"><X className="size-3.5" /></button>
          </figure>
        ) : (
          <label className="btn btn-line h-8 cursor-pointer">
            <input type="file" accept={PHOTO_TYPES.join(',')} className="sr-only" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
            <ImageIcon /> Add a photo
          </label>
        )}
        <div className="t-small ink3 min-w-0 flex-1">{photo ? <>{photo.name} · {fmt1.format(photo.size / 1048576)} MB</> : `optional · JPEG, PNG or WebP, up to ${PHOTO_MAX_MB} MB`}
          {problem && <div style={{ color: 'var(--ns-no-record)' }}>{problem}</div>}</div>
      </div>
      <div className="mt-2 flex justify-end gap-1.5">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn-solid" disabled={!note.trim() || disabled || !!problem} onClick={onSend}>{saving ? 'Saving…' : 'Send appeal'}</button>
      </div>
    </div>
  )
}

const ACTION: Record<string, string> = { approve: 'Approved', reject: 'Rejected', appeal: 'Appealed', undo: 'Undo' }
const ago = (iso: string | null) => {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/** who decided what, when, and whether it was undone; appeal photos open through a short-lived signed URL */
/** the item's newest decision that is still in effect (not an undo, not undone): what Undo reverts */
function latestLive(evs: ReviewEvent[] | undefined) {
  const e = (evs ?? []).find((x) => x.action !== 'undo' && !x.undone_by)
  return e ?? null
}

function History({ id, busy, onUndo }: { id: number; busy: boolean; onUndo: (ev: ReviewEvent) => void }) {
  const { data, isPending, isError } = useReviewEvents(id)
  const live = latestLive(data)
  const [photo, setPhoto] = useState<{ ev: number; url: string | null; err?: string } | null>(null)
  const open = async (ev: ReviewEvent) => {
    setPhoto({ ev: ev.id, url: null })
    try { setPhoto({ ev: ev.id, url: (await api<{ url: string }>(`/review/${id}/events/${ev.id}/photo`)).url }) }
    catch (e) { setPhoto({ ev: ev.id, url: null, err: e instanceof ApiError ? e.message : 'Could not open the photo' }) }
  }
  return (
    <section aria-label="History of this item" className="min-w-0 rule-t pt-3">
      <div className="t-micro mb-2">History</div>
      {isPending && <p className="t-small ink3">Loading…</p>}
      {isError && <p className="t-small ink3">History needs the database (offline or not reachable).</p>}
      {data && !data.length && <p className="t-small ink3">No decisions yet.</p>}
      {data && !!data.length && (
        <ol className="relative ml-1.5 space-y-2.5 border-l pl-4" style={{ borderColor: 'var(--ns-line-strong)' }}>
          {data.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full" style={{ background: e.action === 'undo' ? 'var(--ns-bg1)' : STATUS_COLOR[e.status], boxShadow: `0 0 0 2px ${e.action === 'undo' ? 'var(--ns-ink3)' : 'var(--ns-bg1)'}` }} aria-hidden />
              <div className="t-small flex flex-wrap items-baseline gap-x-1.5">
                <b className={cn(e.undone_by && 'line-through ink3')} style={{ fontWeight: 600 }}>{ACTION[e.action]}</b>
                {e.action === 'undo' && <span className="ink2">back to {reviewLabel(e.status).toLowerCase()}</span>}
                <span className="ink2">by {e.reviewer ?? 'unknown'}</span>
                <span className="ink3" title={e.created_at ? new Date(e.created_at).toLocaleString('en-IN') : undefined}>· {ago(e.created_at)}</span>
                {e.undone_by && <span className="ink3">(undone)</span>}
              </div>
              {e.note && e.action !== 'undo' && <p className="t-small ink2 mt-0.5 break-words">“{e.note}”</p>}
              {live?.id === e.id && <button className="btn btn-line mt-1 h-7" disabled={busy} onClick={() => onUndo(e)}><Undo2 /> Undo this decision</button>}
              {e.has_photo && (photo?.ev === e.id && photo.url ? (
                <a href={photo.url} target="_blank" rel="noreferrer" className="mt-1 block"><img src={photo.url} alt="Appeal photo" className="max-h-40 rounded-[4px]" /></a>
              ) : <button className="link t-small mt-0.5 inline-flex items-center gap-1" onClick={() => open(e)}><ImageIcon className="size-3.5" />{photo?.ev === e.id && !photo.err ? 'Opening…' : 'View appeal photo'}</button>)}
              {photo?.ev === e.id && photo.err && <p className="t-small" style={{ color: 'var(--ns-no-record)' }}>{photo.err}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function Shortcuts({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [['J / K', 'next / previous item'], ['A', 'approve: the finding is right'], ['R', 'reject: the finding is wrong'],
    ['E', 'appeal with a note (and a photo)'], ['U  or  Ctrl+Z', 'undo the last decision'], ['?', 'show or hide this list'], ['Esc', 'close this list, or leave Live 360°']]
  return (
    <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--ns-bg0) 70%, transparent)' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="sheet w-[420px] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="t-title">Keyboard shortcuts</h2><button autoFocus className="btn btn-icon" onClick={onClose} aria-label="Close"><X /></button></div>
        <table className="mt-3 w-full"><tbody>{rows.map(([k, v]) => <tr key={k} className="rule-b"><td className="py-1.5 pr-4"><span className="kbd">{k}</span></td><td className="t-small py-1.5">{v}</td></tr>)}</tbody></table>
        <p className="t-small ink3 mt-3">Keys pause while you type in a box.</p>
      </div>
    </div>
  )
}
