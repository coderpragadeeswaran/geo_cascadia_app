/** Explore: everything floats over the one map (docs/DESIGN.md). Top bar + five numbers on a scrim; at most one panel
 *  (a question, a selection, a key number's list, a street, or "What stands out"); the key bottom-left; zoom, compass and
 *  the altimeter bottom-right. Analyse and Drive are modes of the same map. */
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { useMap } from '@vis.gl/react-google-maps'
import { useEffect, useRef, useState } from 'react'
import { useAnalyse } from '@/map/analyse'
import { clearCoverageMask, maskCoverage } from '@/map/coverageMask'
import { PANEL_W } from '@/map/MapView'
import { usePanel, useUi } from '@/store/ui'
import { AnalysePanel } from './AnalysePanel'
import { DriveStrip } from './DrivePanel'
import { CoverageNotice, HoverCard } from './Inspect'
import { Key } from './Key'
import { KpiRibbon } from './KpiRibbon'
import { MapControls } from './MapControls'
import { Minimap } from './Minimap'
import { PanoPins } from './PanoPins'
import { Panel } from './Panel'
import { TopBar } from './TopBar'

export function Explore() {
  const page = useUi((s) => s.page)
  const dive = useUi((s) => s.dive)
  const analyse = useUi((s) => s.analyse)
  const drive = useUi((s) => !!s.drive)
  const minimap = useUi((s) => s.minimap)
  const picked = useAnalyse((s) => !!s.preview)
  const panel = usePanel()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState()
      if (e.key !== 'Escape' || ui.paletteOpen || ui.analyse || ui.page !== 'explore') return
      if ((e.target as HTMLElement)?.closest?.('input, textarea, [role="dialog"], [role="menu"]')) return
      if (ui.dive) ui.setDive(null)
      else if (ui.drive) ui.setDrive(null)
      else ui.closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (page !== 'explore') return null
  const right = panel ? PANEL_W : 0
  return (
    <>
      {/* the flashlight guides the pick; once a street is picked, the whole snapped street must be visible */}
      {analyse && !picked && <Flashlight right={right} />}
      {analyse && <CoverageMask picked={picked} />}
      {!dive && (
        <div className="scrim-top pointer-events-none absolute left-0 top-0 z-20 pb-10" style={{ right }}>
          <TopBar />
          {!analyse && !drive && <div className="pt-0.5"><KpiRibbon /></div>}
          {drive && <p className="sheet t-small ink2 mx-5 mt-1 inline-block px-3 py-1.5" style={{ background: 'color-mix(in srgb, var(--ns-bg1) 90%, transparent)' }}>Driving through the real camera stops. <span className="kbd">←</span> <span className="kbd">→</span> step · <span className="kbd">Esc</span> stops.</p>}
          {analyse && <p className="sheet t-small ink2 mx-5 mt-1 max-w-[760px] px-3 py-1.5" style={{ background: 'color-mix(in srgb, var(--ns-bg1) 90%, transparent)' }}>Analyse a new street: move the pointer over the map. Blue lines near the pointer are Google Street View coverage; click one to pick that street. <span className="kbd">Esc</span> leaves.</p>}
          <CoverageNotice />
        </div>
      )}
      {dive && (
        <div className="pointer-events-none absolute left-4 top-4 z-30 flex items-center gap-2">
          <button onClick={() => useUi.getState().setDive(null)} className="btn btn-solid pointer-events-auto h-9"><ArrowLeft /> Back to map</button>
          <span className="sheet t-small ink2 px-2.5 py-1.5">Live Street View · drag to look around · Esc to return</span>
        </div>
      )}
      {dive && <PanoPins />}
      <Panel />
      {!panel && !analyse && !dive && <OverviewButton />}
      {!dive && !drive && <Key />}
      {!drive && (
        <div className="pointer-events-none absolute bottom-8 z-10 flex flex-col items-end gap-2" style={{ right: right + 16 }}>
          {/* in Street View only the minimap stays: it shows where the panorama camera is */}
          {minimap && <Minimap />}
          {!dive && <MapControls />}
        </div>
      )}
      {drive && !dive && <DriveStrip right={right} />}
      <HoverCard />
      <AnalysePanel />
      <Footer right={right} />
    </>
  )
}

/** Analyse mode: the map dims like a flashlight outside a 150 px circle around the pointer, so Google's blue coverage
 *  lines only show near it (docs/DESIGN.md declutter rule 6). */
function Flashlight({ right }: { right: number }) {
  const [p, setP] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const host = document.querySelector<HTMLElement>('[data-map-stage]')
    if (!host) return
    const move = (e: PointerEvent) => { const r = host.getBoundingClientRect(); setP({ x: e.clientX - r.left, y: e.clientY - r.top }) }
    const leave = () => setP(null)
    host.addEventListener('pointermove', move)
    host.addEventListener('pointerleave', leave)
    return () => { host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', leave) }
  }, [])
  return <div className="flashlight z-[5]" style={{ right, '--fx': `${p?.x ?? -999}px`, '--fy': `${p?.y ?? -999}px` } as React.CSSProperties} aria-hidden />
}

/** Review fix 9: the blue coverage lines exist only inside the flashlight circle (every zoom); none once a street is
 *  picked. Re-applied each frame while Analyse is on, since Google re-creates the tile pane on zoom and pans move it. */
const FLASH_R = 150
function CoverageMask({ picked }: { picked: boolean }) {
  const map = useMap('main')
  const at = useRef<{ x: number; y: number } | null>(null)
  const pickedRef = useRef(picked)
  pickedRef.current = picked
  useEffect(() => {
    const root = map?.getDiv() as HTMLElement | undefined
    if (!root) return
    const move = (e: PointerEvent) => { const r = root.getBoundingClientRect(); at.current = { x: e.clientX - r.left, y: e.clientY - r.top } }
    const leave = () => { at.current = null }
    root.addEventListener('pointermove', move)
    root.addEventListener('pointerleave', leave)
    let raf = 0
    const tick = () => { maskCoverage(root, pickedRef.current ? null : at.current, FLASH_R); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      root.removeEventListener('pointermove', move)
      root.removeEventListener('pointerleave', leave)
      clearCoverageMask(root)
    }
  }, [map])
  return null
}

function OverviewButton() {
  const setPanelOpen = useUi((s) => s.setPanelOpen)
  return (
    <AnimatePresence>
      <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="btn btn-sodium absolute right-5 top-[132px] z-20"
        style={{ background: 'color-mix(in srgb, var(--ns-bg1) 85%, transparent)' }} onClick={() => setPanelOpen(true)}>
        <Sparkles /> What stands out
      </motion.button>
    </AnimatePresence>
  )
}

/** CLAUDE.md §9.6 footer note; sits between Google's logo (left) and attribution (right), never over them. Two lines
 *  since D53 (OpenStreetMap / Microsoft attribution), so it stays clear of the logo at 1366 px with the panel open. */
function Footer({ right }: { right: number }) {
  return (
    <div className="pointer-events-none absolute bottom-1.5 z-10 flex justify-center" style={{ left: 0, right }}>
      <span className="t-small ink3 rounded-[var(--ns-r-control)] px-2 py-0.5 text-center text-[13px] leading-[1.3]" style={{ background: 'color-mix(in srgb, var(--ns-bg0) 70%, transparent)' }}>
        <span className="block whitespace-nowrap">Registers are synthetic demo data. Prototype — imagery © Google.</span>
        <span className="block whitespace-nowrap">Map data © OpenStreetMap contributors · building footprints © Microsoft.</span>
      </span>
    </div>
  )
}
