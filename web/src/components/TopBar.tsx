/** Explore top bar on the map scrim (docs/DESIGN.md): wordmark · area · the ask bar · Analyse · status · worker · 3D · layers. */
import { useQueryClient } from '@tanstack/react-query'
import { useMap } from '@vis.gl/react-google-maps'
import { Check, ChevronDown, CloudOff, Crosshair } from 'lucide-react'
import { useActiveJobs, useAreas } from '@/api/queries'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tip } from '@/components/ui/tooltip'
import { deviceWord, shortArea, stageLine, stageShort } from '@/lib/labels'
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
        <WorkerIndicator />
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
  const qc = useQueryClient()
  return (
    <DropdownMenu onOpenChange={(o) => { if (o) qc.invalidateQueries({ queryKey: ['areas'] }) }}>
      <DropdownMenuTrigger asChild>
        <button className="btn -ml-1 max-w-[300px] px-1.5" aria-label="Switch area">
          <span className="t-title truncate text-ink" style={{ fontSize: 18 }}>{cur ? shortArea(cur.name) : 'Loading…'}</span>
          <ChevronDown className="ink3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] w-[340px] overflow-y-auto">
        <DropdownMenuLabel>Analysed areas</DropdownMenuLabel>
        {/* the originals first (largest first), then the streets analysed from this app */}
        {[...(areas ?? [])].sort((a, b) => Number(!!a.live) - Number(!!b.live) || b.counts.buildings - a.counts.buildings).map((a) => (
          <DropdownMenuItem key={a.slug} className="items-center"
            onSelect={() => { if (a.slug === area && map) flyToArea(map, a.bbox, flat); else setArea(a.slug) }}>
            <Check className={cn('size-4 shrink-0 sodium', a.slug !== area && 'invisible')} />
            <span className="min-w-0 flex-1 truncate font-[560]">{shortArea(a.name)}</span>
            {a.live && <span className="t-micro shrink-0 rounded-[var(--ns-r-hairline)] px-1.5 py-0.5" style={{ color: 'var(--ns-sodium)', boxShadow: 'inset 0 0 0 1px var(--ns-sodium)' }}>new</span>}
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

/** P6: the analysis worker light. Connected (with GPU / CPU and the street it is on) or disconnected; switching Colab
 *  accounts simply shows disconnected, then connected again. Queued jobs with no worker say so, never a spinner. */
function WorkerIndicator() {
  const { data } = useActiveJobs()
  const go = useUi((s) => s.go)
  if (!data) return null
  const w = data.worker
  const jobs = data.jobs ?? []
  const on = !!w?.connected
  const running = jobs.find((j) => j.status === 'running')
  const waiting = jobs.filter((j) => j.status === 'queued').length
  const approval = jobs.filter((j) => j.status === 'needs_approval').length
  const dev = deviceWord(w?.device)
  const doing = on && w?.job ? `${w.job.street ?? 'a street'}: ${stageLine(w.job.stage, w.job.done, w.job.total)}`
    : running ? `${running.street ?? 'a street'} (worker not responding)` : null
  const short = approval ? 'Needs approval' : on ? (w?.job ? stageShort(w.job.stage) ?? 'Starting' : dev ?? 'Ready')
    : waiting ? `${waiting} waiting` : null
  const tip = [on ? `Analysis worker connected${dev ? ` (${dev})` : ''}` : 'Analysis worker disconnected',
    doing, waiting && !on ? `${plural(waiting, 'street')} queued, waiting for a worker` : null,
    approval ? `${plural(approval, 'analysis', 'analyses')} waiting for your approval (cost above the cap)` : null].filter(Boolean).join(' · ')
  return (
    <Tip label={tip}>
      <button className="btn" onClick={() => go('jobs')} aria-label={tip}>
        <span className={cn('size-2 rounded-full', on && w?.job && 'animate-pulse')} aria-hidden
          style={{ background: on ? 'var(--ns-discrepancy)' : 'transparent', boxShadow: on ? undefined : 'inset 0 0 0 1.5px var(--ns-ink3)' }} />
        <span className="t-small hidden min-[1280px]:inline">{on ? 'Worker' : 'No worker'}</span>
        {short && <span className="t-data" style={approval ? { color: 'var(--ns-sodium)' } : undefined}>{short}</span>}
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
