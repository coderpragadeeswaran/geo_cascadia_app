/** Explore top bar on the map scrim (docs/DESIGN.md): wordmark · area · the ask bar · Analyse · status · 3D · layers. */
import { useMap } from '@vis.gl/react-google-maps'
import { Check, ChevronDown, CloudOff, Crosshair } from 'lucide-react'
import { useActiveJobs, useAreas } from '@/api/queries'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tip } from '@/components/ui/tooltip'
import { shortArea } from '@/lib/labels'
import { cn, plural } from '@/lib/utils'
import { flyToArea } from '@/map/MapView'
import { useUi } from '@/store/ui'
import { AskBar } from './AskBar'
import { LayerPanel } from './LayerPanel'

export function TopBar() {
  const analyse = useUi((s) => s.analyse)
  const drive = useUi((s) => !!s.drive)
  return (
    <header className="pointer-events-auto flex h-[58px] items-center gap-5 px-5">
      <div className="flex min-w-0 shrink-0 items-baseline gap-3">
        <span className="hidden min-[1500px]:inline" style={{ fontWeight: 700, fontStretch: '75%', letterSpacing: '0.16em', fontSize: 15.5 }}>GEO·CASCADIA</span>
        <AreaSwitcher />
      </div>
      {!analyse && !drive ? <AskBar /> : <div className="flex-1" />}
      <nav className="flex shrink-0 items-center gap-1" aria-label="Map actions">
        <AnalyseButton />
        <OfflineBadge />
        <JobsIndicator />
        <ThreeD />
        <LayerPanel />
      </nav>
    </header>
  )
}

function AreaSwitcher() {
  const { data: areas } = useAreas()
  const area = useUi((s) => s.area)
  const setArea = useUi((s) => s.setArea)
  const flat = useUi((s) => s.flat)
  const map = useMap('main')
  const cur = areas?.find((a) => a.slug === area)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="btn -ml-1 max-w-[300px] px-1.5" aria-label="Switch area">
          <span className="t-title truncate text-ink" style={{ fontSize: 18 }}>{cur ? shortArea(cur.name) : 'Loading…'}</span>
          <ChevronDown className="ink3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[380px]">
        <DropdownMenuLabel>Analysed areas</DropdownMenuLabel>
        {[...(areas ?? [])].sort((a, b) => b.counts.buildings - a.counts.buildings).map((a) => (
          <DropdownMenuItem key={a.slug} className="items-start"
            onSelect={() => { if (a.slug === area && map) flyToArea(map, a.bbox, flat); else setArea(a.slug) }}>
            <Check className={cn('mt-0.5 size-4 shrink-0 sodium', a.slug !== area && 'invisible')} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-[560]">{shortArea(a.name)}</div>
              <div className="t-data ink2 mt-0.5 flex flex-wrap gap-x-2">
                <span>{plural(a.counts.buildings, 'building')}</span>
                <span>{plural(a.counts.streetlight_gaps_60m, 'dark stretch')}</span>
                <span>{plural(a.counts.unmapped_businesses, 'business')} off the map</span>
              </div>
              {a.coverage.level === 'partial' && <div className="t-small ink3 mt-1">Few buildings are on the map here, so mostly lights and signs were analysed.</div>}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AnalyseButton() {
  const on = useUi((s) => s.analyse)
  const offline = useUi((s) => s.offline)
  return (
    <Tip label={offline ? 'Offline — read-only: new analyses need the database' : on ? 'Leave Analyse (Esc)' : 'Analyse a new street: point at it on the map'}>
      <button className={cn('btn', on ? 'btn-solid' : 'btn-sodium')} onClick={() => useUi.getState().setAnalyse(!on)} aria-pressed={on}>
        <Crosshair /> {on ? 'Analysing…' : 'Analyse'}
      </button>
    </Tip>
  )
}

function OfflineBadge() {
  const offline = useUi((s) => s.offline)
  if (!offline) return null
  return (
    <Tip label="The database can't be reached, so this shows the saved results read-only. Reviews and new analyses are paused.">
      <span className="btn cursor-default" role="status" style={{ color: 'var(--ns-sodium)' }}><CloudOff /> Offline</span>
    </Tip>
  )
}

function JobsIndicator() {
  const { data } = useActiveJobs()
  const go = useUi((s) => s.go)
  const n = data?.jobs.length ?? 0
  if (!n) return null
  return (
    <Tip label={`${plural(n, 'analysis job')} · worker ${data?.worker_online ? 'online' : 'offline'}`}>
      <button className="btn" onClick={() => go('jobs')} aria-label="Analysis jobs">
        <span className="size-2 animate-pulse rounded-full" style={{ background: 'var(--ns-sodium)' }} />
        <span className="t-data">{n} {data?.worker_online ? 'running' : 'queued'}</span>
      </button>
    </Tip>
  )
}

/** Labelled 3D switch (D3): on = tilt at street level, extruded buildings, camera motion; off = 2D, reduced motion. */
function ThreeD() {
  const flat = useUi((s) => s.flat)
  const setFlat = useUi((s) => s.setFlat)
  return (
    <Tip label={flat ? '2D: flat map, no camera animation. Click for 3D.' : '3D: tilt at street level, buildings raised by floors, camera motion. Click for 2D (reduced motion).'}>
      <button className="btn t-data" style={{ fontSize: 13.5 }} role="switch" aria-checked={!flat} aria-label="3D view" aria-pressed={!flat} onClick={() => setFlat(!flat)}>
        3D
      </button>
    </Tip>
  )
}
