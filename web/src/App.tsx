import { APIProvider } from '@vis.gl/react-google-maps'
import { motion } from 'framer-motion'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useConfig, useFollowJobs } from '@/api/queries'
import { CommandPalette } from '@/components/CommandPalette'
import { Explore } from '@/components/Explore'
import { Rail } from '@/components/Rail'
import { Tour } from '@/components/Tour'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MapView } from '@/map/MapView'
import { useUi } from '@/store/ui'

// verifier pages and Review: loaded on first visit (keeps the first paint lean, D3)
const ReviewPage = lazy(() => import('@/pages/Review'))
const HoodPage = lazy(() => import('@/pages/Hood'))
const TrustPage = lazy(() => import('@/pages/Trust'))
const JobsPage = lazy(() => import('@/pages/Jobs'))

/** Maps JS channel. 'quarterly' (stable): deck.gl 9.4 interleaved rendering draws nothing on weekly 3.66 (checked 2026-09-25). */
const MAPS_VERSION = 'quarterly'

export default function App() {
  useFollowJobs()
  const cfg = useConfig()

  if (cfg.isPending) return <Splash />
  if (cfg.isError || !cfg.data) {
    return (
      <Splash>
        <div className="t-small ink2 mt-6 max-w-md text-center">
          The app’s server isn’t answering, so nothing can be shown yet. Try again in a minute; if it keeps happening, the server needs to be started.
        </div>
      </Splash>
    )
  }
  // P7 R3 (C5): with no Maps browser key or Map ID the app still opens without the map and the Street View photos;
  // Review, Under the Hood, Trust and Jobs work from the API, and Explore says what is missing
  const mapId = cfg.data.maps_js_key ? cfg.data.map_id : ''

  const shell = (
    <TooltipProvider>
      <main className="grid h-full grid-cols-[64px_minmax(0,1fr)]">
        <Rail />
        {/* the map is home: one map instance stays mounted under every page (D3) */}
        <div className="relative min-w-0 overflow-hidden" data-map-stage>
          {mapId ? <><MapView mapId={mapId} /><Explore /></> : <NoMap />}
          <Pages />
        </div>
        <CommandPalette />
        <Tour />
        <ApiLost />
        <PerfMeter />
      </main>
    </TooltipProvider>
  )
  return mapId ? <APIProvider apiKey={cfg.data.maps_js_key} version={MAPS_VERSION}>{shell}</APIProvider> : shell
}

/** Explore without a map (no browser key / Map ID): say so plainly and point to what still works. */
function NoMap() {
  const page = useUi((s) => s.page)
  const go = useUi((s) => s.go)
  if (page !== 'explore') return null
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="sheet max-w-lg p-6" role="status">
        <h1 className="t-title">The map can’t be shown</h1>
        <p className="t-small ink2 mt-2">The map key isn’t set up on this server, so the map and the Street View photos are off.</p>
        <p className="t-small ink2 mt-2">Everything else still works from the saved results:</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn btn-line" onClick={() => go('review')}>Review</button>
          <button className="btn btn-line" onClick={() => go('hood')}>Under the hood</button>
          <button className="btn btn-line" onClick={() => go('trust')}>Trust</button>
          <button className="btn btn-line" onClick={() => go('jobs')}>Jobs</button>
        </div>
      </div>
    </div>
  )
}

function Pages() {
  const page = useUi((s) => s.page)
  // P5 fix: Live 360° on Review shows through the page (the evidence column turns transparent); the map stays one instance
  const see = useUi((s) => s.page === 'review' && !!s.dive)
  if (page === 'explore') return null
  const P = page === 'review' ? ReviewPage : page === 'hood' ? HoodPage : page === 'trust' ? TrustPage : JobsPage
  return (
    <div className={see ? 'pointer-events-none absolute inset-0 z-40' : 'surface absolute inset-0 z-40'}>
      <Suspense fallback={<p className="t-small ink3 p-10">Loading…</p>}><P /></Suspense>
    </div>
  )
}

/** P7 R3 (C5): the API stopped answering after the app had loaded (it was restarted, or the laptop slept). Everything
 *  already loaded stays on screen; the next successful call clears this. */
function ApiLost() {
  const lost = useUi((s) => !s.apiReachable)
  if (!lost) return null
  return (
    <div role="alert" className="sheet t-small fixed left-1/2 top-3 z-[55] -translate-x-1/2 px-3 py-1.5" style={{ color: 'var(--ns-sodium)', background: 'var(--ns-bg2)' }}>
      The app’s server isn’t answering. What is on screen stays; new data loads once it is back.
    </div>
  )
}

function Splash({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center">
        <svg width="40" height="40" viewBox="0 0 32 32" className={children ? '' : 'animate-pulse'} aria-hidden>
          <path d="M16 2 29 9.5v13L16 30 3 22.5v-13z" fill="none" stroke="var(--ns-sodium)" strokeWidth="2.2" />
          <circle cx="16" cy="16" r="4" fill="var(--ns-sodium)" />
        </svg>
        <div className="mt-4" style={{ fontWeight: 700, fontStretch: '75%', letterSpacing: '0.16em', fontSize: 15.5 }}>GEO·CASCADIA</div>
        {!children && <div className="t-small ink3 mt-1">Loading the map…</div>}
        {children}
      </motion.div>
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
    <div className="sheet t-data pointer-events-none fixed bottom-9 left-1/2 z-50 -translate-x-1/2 px-2.5 py-1">
      JS heap {mb == null ? 'n/a (Chrome only)' : `${mb.toFixed(1)} MB`} · DPR {Math.min(devicePixelRatio, 1.5)} (cap 1.5)
    </div>
  )
}
