/** P7.5 guided tour: seven short steps in plain words, on the real data (CLAUDE.md §9.5): the key numbers → a building
 *  → Review → Analyse a street → Jobs → Trust (Gate 1 "Not verified") → done. Started from the ? button on the rail;
 *  opens by itself once, on the first visit (localStorage gc.tourSeen). Skippable at every step; Esc closes; ← → and
 *  Enter step through. Each step only reads what exists: with no area, no building, no worker or no model card it says
 *  so instead of failing. */
import { useMap } from '@vis.gl/react-google-maps'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { useActiveJobs, useAreas, useModelCard } from '@/api/queries'
import type { AnyProps } from '@/api/types'
import { kpis } from '@/lib/derive'
import { shortArea, cameraOnlyText } from '@/lib/labels'
import { propsFor, useAreaData } from '@/lib/useAreaData'
import { cn, fmt, plural } from '@/lib/utils'
import { flyTo, OBJECT_TILT } from '@/map/camera'
import { flyToArea } from '@/map/MapView'
import { useUi } from '@/store/ui'

const SEEN = 'gc.tourSeen'
const seen = () => { try { return localStorage.getItem(SEEN) === '1' } catch { return true } }      // storage blocked: never auto-open
const markSeen = () => { try { localStorage.setItem(SEEN, '1') } catch { /* private mode */ } }

export const useTour = create<{ step: number | null; start: () => void; close: () => void; to: (i: number) => void }>((set) => ({
  step: null,
  start: () => { markSeen(); set({ step: 0 }) },
  close: () => set({ step: null }),
  to: (step) => set({ step }),
}))

type Ctx = ReturnType<typeof useCtx>
interface Step { id: string; title: string; target?: string; /** 'right': top right, clear of a bottom sheet */ place?: 'right'; enter: (c: Ctx) => void; body: (c: Ctx) => React.ReactNode }

const SHOWCASE = 'ward29'

function useCtx() {
  const map = useMap('main')
  const { data: areas } = useAreas()
  const { records, props, detail } = useAreaData()
  const { data: jobs, isError: jobsError } = useActiveJobs()
  const { data: mc } = useModelCard()
  const area = useUi((s) => s.area)
  const cur = areas?.find((a) => a.slug === area) ?? null
  // a building worth showing: not in the register, with a photo; the same one every time (sorted by id)
  const building = records?.buildings.filter((b) => b.match_status === 'no_record' && (b.evidence?.views?.length ?? 0) > 0)
    .sort((a, b) => a.id.localeCompare(b.id))[0] ?? records?.buildings[0] ?? null
  const bProps: AnyProps | null = building ? propsFor(props, 'building', building.id) : null
  const g1 = (mc as { gate1_position?: { status?: string } } | undefined)?.gate1_position
  return { map, areas, cur, records, detail, building, bProps, worker: jobsError ? null : jobs?.worker ?? null, jobsKnown: !!jobs, g1 }
}

const STEPS: Step[] = [
  {
    id: 'numbers', title: 'The numbers for this area', target: '[aria-label="Key figures (click to filter)"]',
    enter: (c) => {
      const ui = useUi.getState()
      ui.go('explore'); ui.setAnalyse(false); ui.select(null); ui.resetFilter(); ui.setPanelOpen(false)
      if (c.areas?.some((a) => a.slug === SHOWCASE) && ui.area !== SHOWCASE) ui.setArea(SHOWCASE)    // the area change flies there
      else if (c.map && c.cur) flyToArea(c.map, c.cur.bbox, ui.flat)
    },
    body: (c) => {
      if (!c.cur) return <>The map shows every analysed area. No area is loaded right now, so the numbers are empty; the rest of the tour still works.</>
      const k = c.records ? kpis(c.records, null) : null
      return k
        ? <>{shortArea(c.cur.name)}: <b>{fmt.format(k.buildings_analysed)}</b> buildings checked from Street View photos{c.cur.counts.camera_only_buildings ? <> ({cameraOnlyText(c.cur.counts.camera_only_buildings)}, with no map outline)</> : null}. <b>{fmt.format(k.unmatched_properties)}</b> are not in the property register and <b>{fmt.format(k.buildings_with_discrepancy)}</b> differ from it; <b>{plural(k.streetlight_gaps, 'possible dark stretch')}</b> have no streetlight seen in 60 m (the detector misses some lamps). Click any number to see those places on the map.</>
        : <>These numbers sum up {shortArea(c.cur.name)}: buildings checked, ones missing from the register or different from it, and possible dark stretches of road. Click one to see those places on the map.</>
    },
  },
  {
    id: 'building', title: 'Why a building is flagged', target: '[aria-label="Findings panel"]',
    enter: (c) => {
      const ui = useUi.getState()
      ui.go('explore')
      if (!c.bProps || !c.building) return
      ui.select(c.bProps)
      if (c.map) flyTo(c.map, { center: { lat: c.building.lat, lng: c.building.lon }, zoom: 19, tilt: ui.flat ? 0 : OBJECT_TILT }, { instant: ui.flat })
    },
    body: (c) => c.building
      ? <>Click any building to see the evidence: the Street View photo with the box the detector drew, what was read from its sign, and the register entry it was compared with (the register is made-up demo data). “How do we know?” shows the method behind each answer.</>
      : <>Clicking a building shows the Street View photo with its box, what was read and the register entry. This area has no building to show yet.</>,
  },
  {
    id: 'review', title: 'A person has the last word',
    enter: () => { const ui = useUi.getState(); ui.select(null); ui.go('review') },
    body: () => <>Anything uncertain waits here. Approve it (<span className="kbd">A</span>), reject it (<span className="kbd">R</span>) or appeal with a note or photo (<span className="kbd">E</span>); <span className="kbd">J</span> / <span className="kbd">K</span> move between items. Every decision is kept in a history and can be undone. It asks your name once, so the history says who decided.</>,
  },
  {
    id: 'analyse', title: 'Analyse a new street', target: '[data-tour="analyse"]', place: 'right',
    enter: () => { const ui = useUi.getState(); ui.go('explore'); ui.setAnalyse(true) },
    body: (c) => (
      <>
        Press <b>Analyse</b>, move the pointer over the map and click a blue Street View line. Before anything is bought you see the street, the photos it needs, the cost and the time; above the $2 cap it waits for your approval.{' '}
        {!c.jobsKnown ? 'The analysis computer’s status is not known right now.'
          : c.worker?.connected ? 'The analysis computer is connected, so a new street starts at once.'
            : 'The analysis computer is off right now, so a new street would wait in the queue. The areas already analysed work without it.'}
      </>
    ),
  },
  {
    id: 'jobs', title: 'Every analysis in one list',
    enter: () => { const ui = useUi.getState(); ui.setAnalyse(false); ui.go('jobs') },
    body: () => <>The original areas and every street analysed from the app, with status, time taken and cost. A running analysis shows its progress here and on the map.</>,
  },
  {
    id: 'trust', title: 'How far to trust it',
    enter: () => useUi.getState().go('trust', 'gate1'),
    body: (c) => (
      <>
        Every accuracy figure comes from the team’s model card, with how many examples were checked.{' '}
        {c.g1
          ? <>Building positions (FarmwiseAI Gate 1, within 3.5 m) are marked <b>{c.g1.status === 'not verified' ? 'Not verified' : c.g1.status}</b>: no surveyed reference exists to check them against.</>
          : <>The model card could not be loaded, so the figures are not shown right now.</>}
      </>
    ),
  },
  {
    id: 'done', title: 'That’s the tour',
    enter: () => useUi.getState().go('explore'),
    body: () => <>Under the Hood (left rail) explains every step the analysis took, with real examples. Press <span className="kbd">?</span> at the bottom of the rail to see this tour again; <span className="kbd">Ctrl</span> <span className="kbd">K</span> searches and asks questions.</>,
  },
]

export const TOUR_STEPS = STEPS.length

/** the outline drawn around a step's target element (follows it while panels animate) */
function useTargetRect(sel: string | undefined) {
  const [r, setR] = useState<DOMRect | null>(null)
  useEffect(() => {
    if (!sel) { setR(null); return }
    const read = () => {
      const el = document.querySelector(sel)
      const b = el?.getBoundingClientRect()
      setR(b && b.width > 0 ? b : null)
    }
    read()
    const t = setInterval(read, 250)
    return () => clearInterval(t)
  }, [sel])
  return r
}

export function Tour() {
  const step = useTour((s) => s.step)
  const to = useTour((s) => s.to)
  const close = useTour((s) => s.close)
  const start = useTour((s) => s.start)
  const ctx = useCtx()
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  const next = useRef<HTMLButtonElement>(null)
  const s = step == null ? null : STEPS[step]
  const rect = useTargetRect(s?.target)

  // first visit: open once, after the opening flight, on Explore only
  const ready = !!ctx.areas
  useEffect(() => {
    if (!ready || seen()) return
    const t = setTimeout(() => { if (useUi.getState().page === 'explore' && useTour.getState().step == null && !seen()) start() }, 3500)
    return () => clearTimeout(t)
  }, [ready, start])

  useEffect(() => {
    if (step == null) return
    STEPS[step].enter(ctxRef.current)
    const t = setTimeout(() => next.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [step])

  const finish = () => { if (useUi.getState().analyse) useUi.getState().setAnalyse(false); close() }
  const go = (d: number) => {
    const cur = useTour.getState().step
    if (cur == null) return
    const n = cur + d
    if (n < 0) return
    if (n >= STEPS.length) finish(); else to(n)
  }
  const goRef = useRef(go)
  goRef.current = go
  const finishRef = useRef(finish)
  finishRef.current = finish

  // keys go to the tour first (capture), so Esc closes the tour, not the panel underneath, and ← → don't scrub a drive
  useEffect(() => {
    if (step == null) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea')) return
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finishRef.current() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); goRef.current(1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); goRef.current(-1) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [step])

  return (
    <AnimatePresence>
      {s && step != null && (
        <>
          {rect && (
            <motion.div key={`ring-${s.id}`} className="pointer-events-none fixed z-[60] rounded-[var(--ns-r-sheet)]" aria-hidden
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12,
                boxShadow: '0 0 0 2px var(--ns-sodium), 0 0 24px 2px color-mix(in srgb, var(--ns-sodium) 45%, transparent)' }} />
          )}
          <motion.section key="tour" role="dialog" aria-modal="false" aria-labelledby="tour-title" aria-describedby="tour-body"
            className={cn('sheet fixed z-[61] w-[440px] max-w-[calc(100vw-104px)] p-4', s.place === 'right' ? 'right-6 top-[76px]' : 'bottom-12 left-[88px]')}
            style={{ background: 'var(--ns-bg2)', boxShadow: '0 0 0 1px var(--ns-sodium), 0 18px 48px rgba(0,0,0,.45)' }}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: 0.2 }}>
            <div className="flex items-center gap-2">
              <span className="t-micro" style={{ color: 'var(--ns-sodium)' }}>Guided tour · {step + 1} of {STEPS.length}</span>
              <span className="flex-1" />
              <button className="btn btn-icon h-7 w-7" onClick={finish} aria-label="Close the tour (Esc)"><X /></button>
            </div>
            <h2 id="tour-title" className="t-title mt-1">{s.title}</h2>
            <p id="tour-body" className="t-small ink2 mt-1.5">{s.body(ctx)}</p>
            <div className="mt-3 flex items-center gap-1.5" aria-hidden>
              {STEPS.map((x, i) => <span key={x.id} className="h-1 flex-1 rounded-full" style={{ background: i <= step ? 'var(--ns-sodium)' : 'var(--ns-line-strong)' }} />)}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button className="btn" onClick={finish}>Skip tour</button>
              <span className="t-small ink3 hidden flex-1 text-right min-[1280px]:inline">← → or Enter · Esc closes</span>
              <span className="flex-1 min-[1280px]:hidden" />
              <button className="btn btn-line" onClick={() => go(-1)} disabled={step === 0}>Back</button>
              <button ref={next} className="btn btn-solid" onClick={() => go(1)}>{step === STEPS.length - 1 ? 'Finish' : 'Next'}</button>
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  )
}
