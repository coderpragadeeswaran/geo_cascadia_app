import { Layers3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Tip } from '@/components/ui/tooltip'
import { useUi, type LayerKey, type MapTypeMode } from '@/store/ui'
import { cn } from '@/lib/utils'

const GROUPS: { title: string; items: { key: LayerKey; label: string; hint: string }[] }[] = [
  {
    title: 'Findings',
    items: [
      { key: 'buildings', label: 'Buildings', hint: 'Footprints · 3D by observed floors at street level' },
      { key: 'assets', label: 'Poles & streetlights', hint: 'Detected assets, ring = register status' },
      { key: 'uncertainty', label: 'Position uncertainty', hint: 'Circles · dashed = approximate (single camera)' },
      { key: 'gaps', label: 'Streetlight gaps', hint: 'No lamp detected within 60 m' },
      { key: 'unmapped', label: 'Unmapped businesses', hint: 'Signs on frontage with no building outline' },
      { key: 'missing', label: 'Register records not seen', hint: 'Synthetic register record, nothing detected' },
      { key: 'review', label: 'Review queue', hint: 'Outline items waiting for a human decision' },
    ],
  },
  {
    title: 'Context',
    items: [
      { key: 'streetHealth', label: 'Street health', hint: 'Discrepancies + no-record buildings per km' },
      { key: 'density', label: 'Findings density', hint: 'Hexbins at area level' },
      { key: 'coverage', label: 'Street View coverage', hint: "Google's blue coverage lines" },
    ],
  },
]

const MAP_TYPES: { key: MapTypeMode; label: string }[] = [
  { key: 'auto', label: 'Auto' }, { key: 'map', label: 'Map' }, { key: 'satellite', label: 'Satellite' },
]

export function LayerPanel() {
  const layers = useUi((s) => s.layers)
  const toggle = useUi((s) => s.toggleLayer)
  const mapType = useUi((s) => s.mapType)
  const setMapType = useUi((s) => s.setMapType)
  return (
    <Popover>
      <Tip label="Layers">
        <PopoverTrigger asChild>
          <Button size="icon" aria-label="Layers">
            <Layers3 />
          </Button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent className="w-[300px]">
        <div className="eyebrow mb-2">Base map</div>
        <div className="mb-3 grid grid-cols-3 gap-1 rounded-[10px] bg-hover p-1" role="radiogroup" aria-label="Base map">
          {MAP_TYPES.map((m) => (
            <button
              key={m.key}
              role="radio"
              aria-checked={mapType === m.key}
              onClick={() => setMapType(m.key)}
              className={cn('cursor-pointer rounded-md py-1.5 text-[12px] font-medium transition-colors',
                mapType === m.key ? 'bg-[var(--glass-strong)] text-fg shadow-sm' : 'text-muted hover:text-fg')}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="-mt-1.5 mb-3 text-[11px] leading-snug text-faint">Auto: dark map at city level, satellite from area level down.</p>
        {GROUPS.map((g) => (
          <div key={g.title} className="mb-2 last:mb-0">
            <div className="eyebrow mb-1">{g.title}</div>
            {g.items.map((it) => (
              <label key={it.key} className="flex cursor-pointer items-center gap-3 rounded-lg px-1.5 py-1.5 hover:bg-hover">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] leading-tight">{it.label}</div>
                  <div className="truncate text-[11px] leading-tight text-faint">{it.hint}</div>
                </div>
                <Switch checked={layers[it.key]} onCheckedChange={() => toggle(it.key)} aria-label={it.label} />
              </label>
            ))}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}
