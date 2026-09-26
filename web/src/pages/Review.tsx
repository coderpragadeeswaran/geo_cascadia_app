/** Review (USER screen, plain language): queue | the evidence photo with its box | the decision. Keyboard: J / K next /
 *  previous, A approve, R reject, E appeal (note + optional photo). Decisions persist via PATCH /review/{id} and update the
 *  map. "Send N to Review" from Explore opens this filtered to those items (§10 test 3). P5 completes this page. */
import { useQueryClient } from '@tanstack/react-query'
import { Check, CircleSlash, Flag, Loader2, MapPin } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '@/api/client'
import { useReviewRows } from '@/api/queries'
import type { ReviewRow } from '@/api/types'
import { EvidenceViews } from '@/components/EvidenceViews'
import { assetRegLabel, matchLabel, reviewLabel, reviewReasons, useLabel } from '@/lib/labels'
import { DONE_LABEL, patchReviewCaches, saveDecision, undoDecision, type Decision } from '@/lib/review'
import { propsFor, useAreaData } from '@/lib/useAreaData'
import { cn, fmt, plural } from '@/lib/utils'
import { useUi } from '@/store/ui'

export default function Review() {
  const area = useUi((s) => s.area)
  const focus = useUi((s) => s.reviewFocus)
  const offline = useUi((s) => s.offline)
  const { data: rows, isPending } = useReviewRows(area)
  const { records, props } = useAreaData()
  const qc = useQueryClient()
  const [i, setI] = useState(0)
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [appeal, setAppeal] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // review fix 12: one decision at a time. The lock is a ref so a second key press in the same tick is refused too.
  const lock = useRef(false)
  const [saving, setSaving] = useState<Decision | null>(null)
  const [undoing, setUndoing] = useState(false)
  // the toast names ONE item and ONE decision (event); Undo sends exactly those two ids (D24)
  const [done, setDone] = useState<{ id: number; name: string; action: Decision; eventId: number } | null>(null)
  // "Undone: …" belongs to the undone item only; it disappears when another item is shown
  const [undone, setUndone] = useState<{ id: number; name: string } | null>(null)
  const list = useMemo(() => {
    const all = [...(rows ?? [])].sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9))
    return focus && focus.area === area ? all.filter((r) => r.id != null && focus.ids.includes(r.id)) : all
  }, [rows, focus, area])
  const cur: ReviewRow | undefined = list[Math.min(i, Math.max(0, list.length - 1))]
  useEffect(() => { setUndone((u) => (u && u.id !== cur?.id ? null : u)); setMsg(null) }, [cur?.id])
  // The item a key press acts on is read from refs, not from the render's closure: a press that lands after a save
  // returned but before React re-rendered must act on the NEXT item, never re-decide the previous one (the skipped-items
  // bug). decided = ids decided in this session, so "next waiting" is right even while the cached list catches up.
  const curRef = useRef(cur)
  curRef.current = cur
  const listRef = useRef(list)
  listRef.current = list
  const decided = useRef(new Set<number>())

  // display name, e.g. "Residential · 2nd Street, Gandhi Nagar" (never the raw OSM id)
  const title = (r: ReviewRow) => {
    if (r.item_type === 'asset') return `${r.asset_cls === 'streetlight' ? 'Streetlight' : 'Pole'} · ${r.street ?? '—'}`
    const use = r.object?.use as string | null | undefined
    return `${r.object?.name && typeof r.object.name === 'string' ? r.object.name : use ? useLabel(use) : 'Building'} · ${r.street ?? '—'}`
  }
  const decide = useCallback(async (action: Decision) => {
    const item = curRef.current
    if (!item?.id || offline || lock.current) return
    if (action === 'appeal' && !note.trim()) { setAppeal(true); return }
    lock.current = true
    setSaving(action); setMsg(null); setDone(null); setUndone(null)
    try {
      const row = await saveDecision(item.id, action, { note, photo })
      patchReviewCaches(qc, row)
      decided.current.add(item.id)
      setNote(''); setPhoto(null); setAppeal(false)
      setDone({ id: item.id, name: title(item), action, eventId: row.event_id })
      // advance only after the save succeeded, to the next item still waiting (never skips one)
      const L = listRef.current
      const at = L.findIndex((r) => r.id === item.id)
      const next = L.findIndex((r, k) => k > at && r.status === 'pending' && r.id != null && !decided.current.has(r.id))
      const to = next >= 0 ? next : Math.max(0, at)
      curRef.current = L[to]                                      // before the lock opens: the next press acts on it
      setI(to)
    } catch (e) { setMsg(e instanceof ApiError ? (e.status === 503 ? 'Offline — read-only. Nothing was saved.' : e.message) : 'Could not save') }
    finally { lock.current = false; setSaving(null) }
  }, [note, photo, offline, qc]) // eslint-disable-line react-hooks/exhaustive-deps

  const undo = useCallback(async () => {
    if (!done || lock.current) return
    lock.current = true
    setUndoing(true); setMsg(null)
    try {
      const row = await undoDecision(done.id, done.eventId)
      patchReviewCaches(qc, row)
      decided.current.delete(done.id)
      const k = listRef.current.findIndex((r) => r.id === done.id)
      if (k >= 0) { curRef.current = listRef.current[k]; setI(k) }
      setDone(null)
      setUndone({ id: done.id, name: done.name })
    } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Could not undo') }
    finally { lock.current = false; setUndoing(false) }
  }, [done, qc])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('textarea, input')) return
      if (lock.current) return                                   // saving: keys wait for the answer
      if (e.key === 'j') setI((x) => Math.min(x + 1, list.length - 1))
      else if (e.key === 'k') setI((x) => Math.max(x - 1, 0))
      else if (e.key === 'a') decide('approve')
      else if (e.key === 'r') decide('reject')
      else if (e.key === 'e') setAppeal(true)
      else if ((e.key === 'z' && (e.ctrlKey || e.metaKey)) || e.key === 'u') undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [decide, undo, list.length])

  const b = cur?.item_type === 'building' ? records?.buildings.find((x) => x.id === cur.ref_id) : undefined
  const a = cur?.item_type === 'asset' ? records?.assets.find((x) => x.id === cur.ref_id) : undefined
  const showOnMap = () => {
    if (!cur) return
    const p = propsFor(props, cur.item_type === 'building' ? 'building' : cur.asset_cls ?? 'pole', cur.ref_id)
    const ui = useUi.getState()
    ui.go('explore')
    if (p) ui.select(p)
  }
  const pending = list.filter((r) => r.status === 'pending').length

  return (
    <div className="grid h-full grid-cols-[330px_minmax(0,1fr)_320px]">
      <aside className="flex min-h-0 flex-col" style={{ borderRight: '1px solid var(--ns-line)' }} aria-label="Review queue">
        <div className="px-5 pb-3 pt-5">
          <div className="t-micro">Review · most urgent first</div>
          <h1 className="t-title mt-1">{focus && focus.area === area ? `${fmt.format(list.length)} sent from Explore · ${fmt.format(pending)} waiting` : `${fmt.format(pending)} waiting`}</h1>
          {focus && focus.area === area && <p className="t-small ink2 mt-1">“{focus.label}” · <button className="link" onClick={() => useUi.setState({ reviewFocus: null })}>show the whole queue</button></p>}
          {offline && <p className="t-small mt-2 sodium">Offline — read-only. Decisions can’t be saved until the database is back.</p>}
        </div>
        <ol className="min-h-0 flex-1 overflow-y-auto">
          {isPending && <li className="t-small ink3 px-5 py-3">Loading…</li>}
          {list.map((r, k) => (
            <li key={`${r.item_type}:${r.ref_id}`}>
              <button onClick={() => { if (!lock.current) { setI(k); setAppeal(false) } }} className={cn('w-full cursor-pointer px-5 py-2.5 text-left rule-t hover:bg-line', k === i && 'bg-accent-soft')}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate">{title(r)}</span>
                  <span className={cn('t-small shrink-0', r.status === 'pending' ? 'sodium' : 'ink3')}>{r.status === 'pending' ? `P${r.priority}` : r.status}</span>
                </div>
                <div className="t-small ink3 truncate">{reviewReasons(r.reasons, { match_status: r.object?.match_status as string | null, discrepancies: r.discrepancies }).join(' · ')}</div>
              </button>
            </li>
          ))}
        </ol>
        <p className="t-data ink3 rule-t px-5 py-2">J / K next · A approve · R reject · E appeal · U undo</p>
      </aside>
      <section className="min-h-0 overflow-y-auto px-8 py-6" style={{ background: 'var(--ns-bg0)' }} aria-label="Evidence">
        {!cur ? <p className="t-small ink3">Nothing to review.</p> : (
          <div className="mx-auto max-w-[620px]">
            <div className="t-micro">{cur.item_type === 'asset' ? 'Pole or streetlight' : 'Building'}</div>
            <h2 className="t-display mt-1" style={{ fontSize: 27 }}>{title(cur)}</h2>
            <div className="mt-4">
              {b && <EvidenceViews kind="building" id={b.id} at={{ lat: b.lat, lng: b.lon }} target="building" />}
              {a && <EvidenceViews kind="asset" id={a.id} at={{ lat: a.lat, lng: a.lon }} target={a.type === 'streetlight' ? 'lamp' : 'pole'} />}
            </div>
          </div>
        )}
      </section>
      <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 py-5" style={{ borderLeft: '1px solid var(--ns-line)' }} aria-label="Decision">
        {cur && <>
          <div className="t-micro">Why a person should check</div>
          <ul className="space-y-1">{reviewReasons(cur.reasons, { match_status: cur.object?.match_status as string | null, discrepancies: cur.discrepancies }).map((x) => <li key={x} className="t-small flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full" style={{ background: 'var(--ns-sodium)' }} />{x}</li>)}</ul>
          <div className="t-micro mt-2">What we saw</div>
          {b && <p className="t-small">{b.attributes?.use?.value ? useLabel(b.attributes.use.value) : 'Use not known'} · {b.attributes?.floors?.value != null ? plural(b.attributes.floors.value, 'floor') : 'floors not known'} · {matchLabel(b.match_status, true)} <span className="ink3">(synthetic register)</span></p>}
          {a && <p className="t-small">{a.method === 'triangulated' ? 'Pinpointed' : 'Approximate position'} · {assetRegLabel(a.register?.status, true)} <span className="ink3">(synthetic register)</span></p>}
          <div className="t-small ink3">Status: {reviewLabel(cur.status)}{cur.note ? ` · note: ${cur.note}` : ''}</div>
          <div className="mt-auto grid gap-1.5" aria-busy={!!saving}>
            {offline && <p className="t-small sodium">Offline — read-only</p>}
            <button className="btn btn-line justify-between" disabled={offline || !!saving} onClick={() => decide('approve')}><span className="flex items-center gap-1.5">{saving === 'approve' ? <Loader2 className="animate-spin" /> : <Check />} {saving === 'approve' ? 'Saving…' : 'Approve: the finding is right'}</span><span className="kbd">A</span></button>
            <button className="btn btn-line justify-between" disabled={offline || !!saving} onClick={() => decide('reject')}><span className="flex items-center gap-1.5">{saving === 'reject' ? <Loader2 className="animate-spin" /> : <CircleSlash />} {saving === 'reject' ? 'Saving…' : 'Reject: the finding is wrong'}</span><span className="kbd">R</span></button>
            <button className="btn btn-line justify-between" disabled={offline || !!saving} aria-pressed={appeal} onClick={() => setAppeal(!appeal)}><span className="flex items-center gap-1.5"><Flag /> Appeal with a note or photo</span><span className="kbd">E</span></button>
            {appeal && (
              <div className="mt-1">
                <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Why? (required)"
                  className="t-small w-full resize-none rounded-[var(--ns-r-control)] border border-line-strong bg-bg0 px-2.5 py-2 outline-none focus:border-sodium" />
                <div className="mt-1 flex items-center gap-2">
                  <label className="link t-small cursor-pointer">
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
                    {photo ? photo.name : '+ Photo (optional)'}
                  </label>
                  <div className="flex-1" />
                  <button className="btn btn-solid" disabled={!note.trim() || !!saving} onClick={() => decide('appeal')}>{saving === 'appeal' ? 'Saving…' : 'Send appeal'}</button>
                </div>
              </div>
            )}
            <button className="btn mt-1" onClick={showOnMap}><MapPin /> Show on the map</button>
            <div role="status" aria-live="polite" className="min-h-[1.5em]">
              {(saving || undoing) && <p className="t-small ink2 flex items-center gap-1.5"><Loader2 className="size-4 animate-spin sodium" /> {undoing ? 'Undoing…' : 'Saving…'}</p>}
              {!saving && !undoing && done && (
                <p className="t-small flex items-center gap-2"><span style={{ color: 'var(--ns-matched)' }}>{DONE_LABEL[done.action]} ✓</span>
                  <span className="ink2">{done.name}</span> · <button className="link" onClick={undo}>Undo</button><span className="kbd">U</span></p>
              )}
              {!saving && !undoing && undone && undone.id === cur?.id && <p className="t-small ink2">Undone: {undone.name} is back to how it was.</p>}
              {!saving && msg && <p className="t-small ink2">{msg}</p>}
            </div>
          </div>
        </>}
      </aside>
    </div>
  )
}
