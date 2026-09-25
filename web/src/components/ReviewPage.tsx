/** Review (lean P4 version; P5 builds the full split view): the queue for this area, or the set sent from Explore
 *  ("Send N to Review", §10 test 3). Keyboard: J/K next/prev, A approve, R reject, E appeal (note). Decisions persist
 *  via PATCH /review/{id} and update the map. */
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, CircleSlash, Flag, MapPin } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '@/api/client'
import { useReviewRows } from '@/api/queries'
import type { ReviewRow } from '@/api/types'
import { Button } from '@/components/ui/button'
import { propsFor, useAreaData } from '@/lib/useAreaData'
import { cn } from '@/lib/utils'
import { useUi } from '@/store/ui'
import { StreetViewImage, type EvidenceView } from './StreetViewImage'

export function ReviewPage() {
  const area = useUi((s) => s.area)
  const focus = useUi((s) => s.reviewFocus)
  const offline = useUi((s) => s.offline)
  const { data: rows, isPending } = useReviewRows(area)
  const { records, props } = useAreaData()
  const qc = useQueryClient()
  const [i, setI] = useState(0)
  const [note, setNote] = useState('')
  const [appeal, setAppeal] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const list = useMemo(() => {
    const all = rows ?? []
    return focus && focus.area === area ? all.filter((r) => r.id != null && focus.ids.includes(r.id)) : all
  }, [rows, focus, area])
  const cur: ReviewRow | undefined = list[Math.min(i, Math.max(0, list.length - 1))]

  const decide = useCallback(async (action: 'approve' | 'reject' | 'appeal') => {
    if (!cur?.id || offline) return
    if (action === 'appeal' && !note.trim()) { setAppeal(true); return }
    const fd = new FormData()
    fd.set('action', action)
    if (note.trim()) fd.set('note', note.trim())
    try {
      await api(`/review/${cur.id}`, { method: 'PATCH', body: fd })
      setMsg(`${action === 'approve' ? 'Approved' : action === 'reject' ? 'Rejected' : 'Appealed'} ${cur.ref_id}`)
      setNote(''); setAppeal(false)
      for (const k of ['review', 'buildings', 'assets', 'geo', 'detail']) qc.invalidateQueries({ queryKey: [k] })
      setI((x) => Math.min(x + 1, list.length - 1))
    } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Could not save') }
  }, [cur, note, offline, qc, list.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') return
      if (e.key === 'j') setI((x) => Math.min(x + 1, list.length - 1))
      else if (e.key === 'k') setI((x) => Math.max(x - 1, 0))
      else if (e.key === 'a') decide('approve')
      else if (e.key === 'r') decide('reject')
      else if (e.key === 'e') setAppeal(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [decide, list.length])

  const rec = cur ? (cur.item_type === 'building' ? records?.buildings.find((b) => b.id === cur.ref_id) : records?.assets.find((a) => a.id === cur.ref_id)) : undefined
  const view: EvidenceView | null = rec && 'attributes' in rec
    ? ((rec.evidence?.attribute_view ?? (rec.evidence?.views?.[0] ? { ...rec.evidence.views[0], fov: 90 } : null)) as EvidenceView | null)
    : rec ? ((rec.evidence?.views?.[0] as EvidenceView | undefined) ?? null) : null

  const showOnMap = () => {
    if (!cur) return
    const p = propsFor(props, cur.item_type === 'building' ? 'building' : cur.asset_cls ?? 'pole', cur.ref_id)
    const ui = useUi.getState()
    ui.setPage('explore')
    if (p) ui.select(p)
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-bg">
      <header className="flex items-center gap-3 border-b border-glass-border px-4 py-2.5">
        <Button size="sm" onClick={() => useUi.getState().setPage('explore')}><ArrowLeft /> Explore</Button>
        <h1 className="text-[15px] font-semibold">Review</h1>
        <span className="text-[12.5px] text-muted">{focus && focus.area === area ? <>“{focus.label}” · <b className="tnum text-fg">{list.length}</b> items sent from Explore <button className="ml-1 cursor-pointer text-accent" onClick={() => useUi.setState({ reviewFocus: null })}>show whole queue</button></> : <><b className="tnum text-fg">{list.length}</b> items in this area’s queue</>}</span>
        <div className="flex-1" />
        <span className="hidden text-[11px] text-faint md:block">J / K next · A approve · R reject · E appeal</span>
      </header>
      {offline && <p className="bg-[rgb(245_165_36/0.12)] px-4 py-1.5 text-[12px] text-discrepancy">Offline data mode: the queue is read-only.</p>}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,380px)_1fr]">
        <ol className="min-h-0 overflow-y-auto border-r border-glass-border p-2" aria-label="Review items">
          {isPending && <li className="p-3 text-[12px] text-muted">Loading…</li>}
          {list.map((r, k) => (
            <li key={`${r.item_type}:${r.ref_id}`}>
              <button onClick={() => setI(k)} className={cn('w-full cursor-pointer rounded-lg px-3 py-2 text-left hover:bg-hover', k === i && 'bg-accent-soft')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11.5px]">{r.ref_id}</span>
                  <span className={cn('text-[11px] font-semibold', r.status === 'pending' ? 'text-review' : 'text-muted')}>{r.status}</span>
                </div>
                <div className="truncate text-[12px] text-muted">P{r.priority} · {r.item_type} · {r.street}</div>
                <div className="truncate text-[11.5px] text-fg/80">{r.reasons.join(' · ')}</div>
              </button>
            </li>
          ))}
        </ol>
        <section className="min-h-0 overflow-y-auto p-5">
          {!cur ? <p className="text-[13px] text-muted">Nothing to review.</p> : (
            <div className="mx-auto grid max-w-[980px] gap-5 lg:grid-cols-[1fr_320px]">
              <div>{view ? <StreetViewImage view={view} label={cur.item_type === 'asset' ? 'aimed view' : 'evidence view'} crosshair={cur.item_type === 'asset'} /> : <div className="rounded-xl border border-dashed border-glass-border p-6 text-[12px] text-muted">No evidence view stored.</div>}</div>
              <div>
                <div className="eyebrow">{cur.item_type} · priority {cur.priority}</div>
                <h2 className="font-mono text-[15px] font-semibold">{cur.ref_id}</h2>
                <p className="text-[12.5px] text-muted">{cur.street}</p>
                <ul className="mt-3 list-disc space-y-1 pl-4 text-[12.5px]">{cur.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
                <dl className="mt-3 space-y-0.5 text-[12px]">{Object.entries(cur.object).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k.replace(/_/g, ' ')}</dt><dd>{v == null ? '—' : String(v).replace(/_/g, ' ')}</dd></div>)}</dl>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  <Button size="sm" variant="subtle" disabled={offline} onClick={() => decide('approve')}><Check /> Approve <kbd className="text-[10px] text-faint">A</kbd></Button>
                  <Button size="sm" variant="subtle" disabled={offline} onClick={() => decide('reject')}><CircleSlash /> Reject <kbd className="text-[10px] text-faint">R</kbd></Button>
                  <Button size="sm" variant="subtle" disabled={offline} onClick={() => setAppeal(!appeal)}><Flag /> Appeal <kbd className="text-[10px] text-faint">E</kbd></Button>
                  <Button size="sm" onClick={showOnMap}><MapPin /> Show on map</Button>
                </div>
                {appeal && (
                  <div className="mt-2">
                    <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Appeal note (required)"
                      className="w-full resize-none rounded-lg border border-glass-border bg-hover px-2.5 py-2 text-[12.5px] outline-none focus:border-accent" />
                    <Button size="sm" variant="accent" className="mt-1" disabled={!note.trim()} onClick={() => decide('appeal')}>Send appeal</Button>
                  </div>
                )}
                {msg && <p className="mt-2 text-[12px] text-muted">{msg}</p>}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
