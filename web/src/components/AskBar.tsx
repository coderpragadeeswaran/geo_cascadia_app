/** The ask bar: a plain-English question about this area (rule-based QueryEngine, docs/QUERY.md). On focus it shows
 *  example questions for this area, a way to build a question only by clicking, and how questions are understood. */
import { useMap } from '@vis.gl/react-google-maps'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Loader2, MousePointerClick, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { exampleQuestions, runQuery } from '@/lib/query'
import { propsFor, useAreaData } from '@/lib/useAreaData'
import { flyTo, OBJECT_TILT } from '@/map/camera'
import { useUi } from '@/store/ui'
import { QueryHelp } from './QueryHelp'

export function AskBar() {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const busy = useUi((s) => s.queryBusy)
  const qText = useUi((s) => s.query?.text ?? null)
  // the bar always shows the question being answered: chip edits rewrite it, closing the question clears it (fix 6)
  useEffect(() => { if (document.activeElement !== input.current) setText(qText ?? '') }, [qText])
  const setPalette = useUi((s) => s.setPaletteOpen)
  const setBuilder = useUi((s) => s.setBuilder)
  const { records, props } = useAreaData()
  const input = useRef<HTMLInputElement>(null)
  // this area's streets, busiest with findings first, so the examples use real names
  const streets = useMemo(() => {
    if (!records) return []
    const m = new Map<string, number>()
    for (const b of records.buildings) if (b.match_status !== 'matched') m.set(b.street, (m.get(b.street) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s)
  }, [records])
  const examples = exampleQuestions(streets)
  const map = useMap('main')
  // an exact building / pole / streetlight / business ID (e.g. w1252504688) opens that object: select, fly, drawer
  const openById = (q: string) => {
    if (!records) return false
    const id = q.trim().toLowerCase()
    const hit = ([['building', records.buildings], ['asset', records.assets], ['unmapped_business', records.unmapped]] as const)
      .flatMap(([k, xs]) => (xs as { id: string; lat: number; lon: number; type?: string }[]).filter((x) => x.id.toLowerCase() === id).map((x) => ({ k, x })))[0]
    if (!hit) return false
    const p = propsFor(props, hit.k === 'asset' ? hit.x.type ?? 'pole' : hit.k, hit.x.id)
    if (!p) return false
    const ui = useUi.getState()
    ui.setQuery(null)
    ui.select(p)
    if (map) flyTo(map, { center: { lat: hit.x.lat, lng: hit.x.lon }, zoom: Math.max(map.getZoom() ?? 18, 19), tilt: ui.flat ? 0 : OBJECT_TILT }, { instant: ui.flat })
    return true
  }
  const ask = (q: string) => {
    setOpen(false); input.current?.blur()
    if (openById(q)) { setText(''); return }
    setText(q)
    if (q.trim().length > 1) runQuery({ text: q.trim() })
  }

  return (
    <div className="relative min-w-0 flex-1">
      <form role="search" onSubmit={(e) => { e.preventDefault(); ask(text) }} className="field flex h-9 items-center gap-2.5">
        {busy ? <Loader2 className="size-4 shrink-0 animate-spin sodium" /> : <Search className="size-4 shrink-0 sodium" />}
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} aria-label="Ask a question about this area"
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 160)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); input.current?.blur() } }}
          placeholder="Ask about this area…" className="min-w-0 flex-1 bg-transparent text-[16.5px] outline-none placeholder:text-ink3 focus-visible:outline-none" />
        {text.trim().length > 1 && <button type="submit" className="btn btn-icon" aria-label="Ask"><ArrowRight /></button>}
        <QueryHelp />
        <button type="button" onClick={() => setPalette(true)} className="kbd hidden cursor-pointer lg:block" aria-label="Open command palette (Ctrl K)">Ctrl K</button>
      </form>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.14 }}
            className="sheet absolute left-0 right-0 top-[calc(100%+6px)] z-40 p-2" onMouseDown={(e) => e.preventDefault()}>
            <div className="t-micro px-2 pb-1 pt-1">Try asking</div>
            <ul aria-label="Example questions">
              {examples.map((q) => (
                <li key={q}><button onClick={() => ask(q)} className="w-full cursor-pointer rounded-[var(--ns-r-control)] px-2 py-1.5 text-left text-[16px] hover:bg-accent-soft">{q}</button></li>
              ))}
            </ul>
            <div className="rule-t mt-1.5 flex items-center justify-between px-2 pt-2">
              <button className="link t-small inline-flex items-center gap-1.5" onClick={() => { setOpen(false); input.current?.blur(); setBuilder(true) }}>
                <MousePointerClick className="size-4" /> Build a question by clicking
              </button>
              <QueryHelp compact />
            </div>
            <p className="t-small ink3 px-2 pt-1.5">Or type an ID (e.g. <span className="t-data">{records?.buildings[0]?.id ?? 'w…'}</span>) to open that building, pole or business.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
