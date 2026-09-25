import { APIProvider } from '@vis.gl/react-google-maps'
import { motion } from 'framer-motion'
import { lazy, Suspense, useEffect, useState } from 'react'
import { API_URL } from '@/api/client'
import { useConfig } from '@/api/queries'
import { AnalysePanel } from '@/components/AnalysePanel'
import { CommandPalette } from '@/components/CommandPalette'
import { CoverageNotice, HoverCard } from '@/components/Inspect'
import { KpiRibbon } from '@/components/KpiRibbon'
import { Legend } from '@/components/Legend'
import { QueryCard } from '@/components/QueryCard'
import { RightPanel } from '@/components/RightPanel'
import { MapControls } from '@/components/MapControls'
import { Minimap } from '@/components/Minimap'
import { TopBar } from '@/components/TopBar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MapView, PANEL_W } from '@/map/MapView'
import { useUi } from '@/store/ui'

const ReviewPage = lazy(() => import('@/components/ReviewPage').then((m) => ({ default: m.ReviewPage })))

/** Maps JS channel. 'quarterly' (stable): deck.gl 9.4 interleaved rendering draws nothing on weekly 3.66 (checked 2026-09-25). */
const MAPS_VERSION = 'quarterly'

export default function App() {
  const theme = useUi((s) => s.theme)
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  const cfg = useConfig()

  if (cfg.isPending) return <Splash />
  if (cfg.isError || !cfg.data?.maps_js_key || !cfg.data?.map_id) {
    return (
      <Splash>
        <div className="mt-6 max-w-md text-center text-[13px] text-muted">
          {cfg.isError ? (
            <>Can’t reach the API at <code className="text-fg">{API_URL}</code>. Start it with
              <pre className="glass mt-3 px-3 py-2 text-left text-[12px] text-fg">backend\.venv\Scripts\python -m uvicorn app.main:app --app-dir backend --port 8000</pre></>
          ) : (
            <>The API has no Maps browser key or Map ID. Set GOOGLE_MAPS_BROWSER_KEY and GOOGLE_MAP_ID in backend/.env.</>
          )}
        </div>
      </Splash>
    )
  }

  return (
    <APIProvider apiKey={cfg.data.maps_js_key} version={MAPS_VERSION}>
      <TooltipProvider>
        <main className="relative h-full w-full overflow-hidden">
          <MapView mapId={cfg.data.map_id} />
          <Explore />
          <PageSwitch />
          <CommandPalette />
          <PerfMeter />
        </main>
      </TooltipProvider>
    </APIProvider>
  )
}

/** Explore page chrome: everything floats over the one map. The Street View dive hides the map chrome. */
function Explore() {
  const dive = useUi((s) => s.dive)
  const panelOpen = useUi((s) => s.panelOpen)
  const page = useUi((s) => s.page)
  const select = useUi((s) => s.select)
  const setDive = useUi((s) => s.setDive)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || useUi.getState().paletteOpen || useUi.getState().analyse) return
      if (useUi.getState().dive) setDive(null)
      else select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [select, setDive])
  if (page !== 'explore') return null
  const right = panelOpen ? PANEL_W + 4 : 12
  return (
    <>
      <TopBar />
      {!dive && (
        <>
          <div className="pointer-events-none absolute left-3 top-[64px] z-10" style={{ right }}><KpiRibbon /></div>
          <div className="pointer-events-none absolute left-3 top-[122px] z-10 flex max-h-[calc(100%-122px-300px)] w-[300px] flex-col gap-2 overflow-y-auto">
            <QueryCard />
            <CoverageNotice />
          </div>
          <Legend />
        </>
      )}
      {dive && (
        <div className="pointer-events-none absolute left-3 top-[68px] z-20 flex items-center gap-2">
          <button onClick={() => setDive(null)} className="glass pointer-events-auto flex h-10 cursor-pointer items-center gap-2 px-3.5 text-[13px] font-semibold hover:bg-hover">
            ← Back to map
          </button>
          <span className="glass px-2.5 py-1.5 text-[11.5px] text-muted">Live Street View · drag to look around · Esc to return</span>
        </div>
      )}
      <RightPanel />
      <div className="pointer-events-none absolute bottom-9 z-10 flex flex-col items-end gap-2" style={{ right }}>
        <MapControls />
        <Minimap />
      </div>
      <HoverCard />
      <AnalysePanel />
      <Footer />
    </>
  )
}

function PageSwitch() {
  const page = useUi((s) => s.page)
  return page === 'review' ? <Suspense fallback={null}><ReviewPage /></Suspense> : null
}

function Splash({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-[radial-gradient(ellipse_at_center,rgb(79_157_255/0.12),transparent_60%)]">
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center">
        <svg width="44" height="44" viewBox="0 0 32 32" className={children ? '' : 'animate-pulse'} aria-hidden>
          <path d="M16 2 29 9.5v13L16 30 3 22.5v-13z" fill="none" stroke="var(--accent)" strokeWidth="2" />
          <path d="M16 9.5 23 13.5v8L16 25.5l-7-4v-8z" fill="var(--accent)" opacity=".8" />
        </svg>
        <div className="mt-4 text-[13px] font-semibold tracking-[0.2em]">GEO-CASCADIA</div>
        {!children && <div className="mt-1 text-[12px] text-muted">Loading map…</div>}
        {children}
      </motion.div>
    </div>
  )
}

/** CLAUDE.md §9.6 footer note; sits between Google's logo (left) and attribution (right), never over them. */
function Footer() {
  return (
    <div className="pointer-events-none absolute bottom-1.5 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--glass)] px-2 py-0.5 text-[10.5px] text-muted backdrop-blur">
      Registers are synthetic demo data. Prototype — imagery © Google.
    </div>
  )
}

/** JS heap readout for the D3 target (≤ 60 MB idle). Chrome/Edge only; open with ?perf=1. */
function PerfMeter() {
  const [mb, setMb] = useState<number | null>(null)
  const on = new URLSearchParams(location.search).has('perf')
  useEffect(() => {
    if (!on) return
    const read = () => { const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory; setMb(m ? m.usedJSHeapSize / 1048576 : null) }
    read()
    const t = setInterval(read, 2000)
    return () => clearInterval(t)
  }, [on])
  if (!on) return null
  return (
    <div className="glass tnum pointer-events-none absolute bottom-9 left-1/2 z-30 -translate-x-1/2 px-2.5 py-1 text-[11px]">
      JS heap {mb == null ? 'n/a (Chrome only)' : `${mb.toFixed(1)} MB`} · DPR {Math.min(devicePixelRatio, 1.5)} (cap 1.5)
    </div>
  )
}
