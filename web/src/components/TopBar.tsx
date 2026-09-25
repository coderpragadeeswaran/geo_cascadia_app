import { motion } from 'framer-motion'
import { Box, Check, ChevronDown, CloudOff, Moon, Square, Sun } from 'lucide-react'
import { useMap } from '@vis.gl/react-google-maps'
import { useActiveJobs, useAreas } from '@/api/queries'
import type { Band } from '@/api/types'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tip } from '@/components/ui/tooltip'
import { bboxCenter, flyTo } from '@/map/camera'
import { flyToArea } from '@/map/MapView'
import { useUi } from '@/store/ui'
import { cn, fmt } from '@/lib/utils'
import { LayerPanel } from './LayerPanel'

const BANDS: { key: Band; label: string }[] = [
  { key: 'city', label: 'City' }, { key: 'area', label: 'Area' }, { key: 'street', label: 'Street' }, { key: 'object', label: 'Object' },
]

export function TopBar() {
  return (
    <header className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-start justify-between gap-3">
      <div className="pointer-events-auto flex items-center gap-2">
        <Brand />
        <AreaSwitcher />
      </div>
      <BandIndicator />
      <div className="pointer-events-auto glass flex h-11 items-center gap-0.5 px-1.5">
        <OfflineBadge />
        <JobsIndicator />
        <span className="mx-1 h-5 w-px bg-[var(--glass-border)]" />
        <FlatToggle />
        <ThemeToggle />
        <LayerPanel />
      </div>
    </header>
  )
}

function Brand() {
  return (
    <div className="glass flex h-11 items-center gap-2.5 pl-3 pr-4">
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
        <defs>
          <linearGradient id="gc-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--matched)" />
          </linearGradient>
        </defs>
        <path d="M16 2 29 9.5v13L16 30 3 22.5v-13z" fill="none" stroke="url(#gc-g)" strokeWidth="2.4" />
        <path d="M16 9.5 23 13.5v8L16 25.5l-7-4v-8z" fill="url(#gc-g)" opacity=".9" />
      </svg>
      <div className="leading-none">
        <div className="text-[13px] font-semibold tracking-[0.14em]">GEO-CASCADIA</div>
        <div className="mt-1 text-[10.5px] text-muted">Street-level asset &amp; property intelligence</div>
      </div>
    </div>
  )
}

function AreaSwitcher() {
  const { data: areas } = useAreas()
  const area = useUi((s) => s.area)
  const setArea = useUi((s) => s.setArea)
  const flat = useUi((s) => s.flat)
  const map = useMap('main')
  const cur = areas?.find((a) => a.slug === area)
  const short = (n: string) => n.replace(/^Unseen street: /, '')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="glass flex h-11 min-w-0 max-w-[340px] cursor-pointer items-center gap-3 px-3.5 text-left transition-colors hover:bg-hover" aria-label="Switch area">
          <div className="min-w-0">
            <div className="eyebrow leading-none">Area</div>
            <div className="mt-1 truncate text-[13px] font-medium leading-none">{cur ? short(cur.name) : 'Loading…'}</div>
          </div>
          {cur && (
            <div className="tnum hidden shrink-0 items-center gap-2 text-[11.5px] text-muted xl:flex">
              <span>{fmt.format(cur.counts.buildings)} bldg</span>
              <span className="text-faint">·</span>
              <span>{fmt.format(cur.counts.assets)} assets</span>
            </div>
          )}
          <ChevronDown className="size-4 shrink-0 text-muted" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[380px]">
        <DropdownMenuLabel>Analysed areas</DropdownMenuLabel>
        {areas?.map((a) => (
          <DropdownMenuItem
            key={a.slug}
            onSelect={() => { if (a.slug === area && map) flyToArea(map, a.bbox, flat); else setArea(a.slug) }}
            className="items-start"
          >
            <Check className={cn('mt-0.5 size-4 shrink-0 text-accent', a.slug !== area && 'invisible')} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{short(a.name)}</div>
              <div className="tnum mt-0.5 flex flex-wrap gap-x-2 text-[11.5px] text-muted">
                <span>{fmt.format(a.counts.buildings)} buildings</span>
                <span>{fmt.format(a.counts.assets)} assets</span>
                <span>{fmt.format(a.counts.streetlight_gaps_60m)} gaps</span>
                <span>{fmt.format(a.counts.unmapped_businesses)} unmapped</span>
              </div>
              {a.coverage_verdict && <div className="mt-1 line-clamp-2 text-[11px] text-faint">{a.coverage_verdict}</div>}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Band pills: show the current zoom band and fly the camera to any band on click (keyboard accessible). */
function BandIndicator() {
  const band = useUi((s) => s.band)
  const zoom = useUi((s) => s.camera?.zoom)
  const map = useMap('main')
  const { data: areas } = useAreas()
  const go = (target: Band) => {
    const ui = useUi.getState()
    const a = areas?.find((x) => x.slug === ui.area)
    if (!map || !a) return
    const c = map.getCenter()?.toJSON() ?? bboxCenter(a.bbox)
    const [x0, y0, x1, y1] = a.bbox
    const inArea = c.lng >= x0 && c.lng <= x1 && c.lat >= y0 && c.lat <= y1
    const tilt = ui.flat ? 0 : 45
    const sel = ui.selected && 'lat' in ui.selected && typeof ui.selected.lat === 'number'
      ? { lat: ui.selected.lat, lng: (ui.selected as { lon: number }).lon } : null
    if (target === 'area') return flyToArea(map, a.bbox, ui.flat)
    if (target === 'city') return flyTo(map, { center: bboxCenter(a.bbox), zoom: 11.8, tilt: 0, heading: 0 }, { instant: ui.flat })
    const center = target === 'object' && sel ? sel : inArea ? c : bboxCenter(a.bbox)
    return flyTo(map, { center, zoom: target === 'street' ? 17.6 : 19.2, tilt }, { instant: ui.flat })
  }
  return (
    <nav className="glass pointer-events-auto hidden h-9 items-center gap-0.5 self-center px-1 md:flex" aria-label="Zoom level">
      {BANDS.map((b) => (
        <button key={b.key} onClick={() => go(b.key)} aria-current={band === b.key ? 'true' : undefined}
          className="group relative cursor-pointer rounded-md px-2.5 py-1 text-[11.5px] font-medium">
          {band === b.key && (
            <motion.span layoutId="band-pill" className="absolute inset-0 rounded-md bg-accent-soft" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />
          )}
          <span className={cn('relative', band === b.key ? 'text-accent' : 'text-muted group-hover:text-fg')}>{b.label}</span>
        </button>
      ))}
      <span className="tnum w-12 pr-2 text-right text-[11px] text-faint" aria-live="polite">z{zoom != null ? zoom.toFixed(1) : '–'}</span>
    </nav>
  )
}

function OfflineBadge() {
  const offline = useUi((s) => s.offline)
  if (!offline) return null
  return (
    <Tip label="Database unreachable — showing read-only data from the pre-computed JSON exports. Reviews and new analyses are paused.">
      <div className="mr-1 flex h-7 items-center gap-1.5 rounded-lg bg-[rgb(245_165_36/0.14)] px-2.5 text-[11.5px] font-semibold text-discrepancy" role="status">
        <CloudOff className="size-3.5" /> Offline data mode
      </div>
    </Tip>
  )
}

function JobsIndicator() {
  const { data } = useActiveJobs()
  const n = data?.jobs.length ?? 0
  const online = data?.worker_online
  return (
    <Tip label={`${n} active analysis job${n === 1 ? '' : 's'} · worker ${online ? 'online' : 'offline'}`}>
      <div className="flex h-8 items-center gap-2 rounded-[10px] px-2.5 text-[12px] text-muted" aria-label="Analysis jobs">
        <span className="relative flex size-2">
          {n > 0 && <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />}
          <span className={cn('relative inline-flex size-2 rounded-full', online ? 'bg-matched' : 'bg-faint')} />
        </span>
        <span className="tnum">{n > 0 ? `${n} running` : 'Jobs'}</span>
      </div>
    </Tip>
  )
}

/** Labelled 3D switch (D3): on = tilt at street level, extruded buildings, camera motion; off = 2D, reduced motion. */
function FlatToggle() {
  const flat = useUi((s) => s.flat)
  const setFlat = useUi((s) => s.setFlat)
  const on = !flat
  return (
    <Tip label={on ? '3D on: tilt at street level, buildings extruded by floors, camera motion. Click for 2D (reduced motion).' : '3D off: flat 2D map, no camera animation. Click to turn 3D on.'}>
      <button role="switch" aria-checked={on} aria-label="3D view" onClick={() => setFlat(on)}
        className={cn('flex h-8 cursor-pointer items-center gap-2 rounded-[10px] pl-2 pr-1.5 text-[12px] font-semibold transition-colors',
          on ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-fg')}>
        {on ? <Box className="size-4" /> : <Square className="size-4" />}
        <span>3D</span>
        <span className={cn('relative inline-flex h-4 w-7 items-center rounded-full transition-colors', on ? 'bg-accent' : 'bg-[var(--glass-border)]')}>
          <span className={cn('absolute size-3 rounded-full bg-white shadow transition-transform', on ? 'translate-x-[13px]' : 'translate-x-0.5')} />
        </span>
        <span className="sr-only">{on ? 'on' : 'off'}</span>
      </button>
    </Tip>
  )
}

function ThemeToggle() {
  const theme = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)
  return (
    <Tip label={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
      <Button size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
        {theme === 'dark' ? <Sun /> : <Moon />}
      </Button>
    </Tip>
  )
}

