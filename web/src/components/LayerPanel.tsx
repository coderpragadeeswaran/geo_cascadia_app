/** Layers: what the map shows. Plain names; the declutter defaults (findings density, road colour by findings, Street View
 *  coverage, minimap: off). Satellite is a Daylight option only (Cloud dark mode does not apply to satellite). */
import { Layers3 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Tip } from '@/components/ui/tooltip'
import { useUi, type LayerKey, type MapTypeMode } from '@/store/ui'

const GROUPS: { title: string; items: { key: LayerKey; label: string; hint: string }[] }[] = [
  { title: 'Findings', items: [
    { key: 'buildings', label: 'Buildings', hint: 'Raised by floors at street level' },
    { key: 'assets', label: 'Streetlights and poles', hint: 'Lamps glow; poles appear at street level' },
    { key: 'uncertainty', label: 'Approximate positions', hint: 'Dashed circle = seen from one camera only' },
    { key: 'gaps', label: 'Dark stretches', hint: 'No streetlight seen within 60 m' },
    { key: 'unmapped', label: 'Businesses with no analysed building', hint: 'Shop signs on no outline, or on a building outside the analysed ones' },
    { key: 'missing', label: 'In the register, not seen', hint: 'Synthetic register record, nothing detected' },
    { key: 'review', label: 'Waiting for review', hint: 'Dashed outline on items a person should check' },
  ] },
  { title: 'Extra context (off by default)', items: [
    { key: 'density', label: 'Where findings cluster', hint: 'Hexagons at area zoom' },
    { key: 'streetHealth', label: 'Road colour by findings', hint: 'Findings per km of road' },
    { key: 'coverage', label: 'Street View coverage', hint: 'Google’s blue lines (always shown in Analyse)' },
  ] },
]
const MAP_TYPES: { key: MapTypeMode; label: string }[] = [{ key: 'map', label: 'Map' }, { key: 'satellite', label: 'Satellite' }]

export function LayerPanel() {
  const layers = useUi((s) => s.layers)
  const toggle = useUi((s) => s.toggleLayer)
  const mapType = useUi((s) => s.mapType)
  const setMapType = useUi((s) => s.setMapType)
  const mode = useUi((s) => s.mode)
  const minimap = useUi((s) => s.minimap)
  const setMinimap = useUi((s) => s.setMinimap)
  const Line = ({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: () => void }) => (
    <label className="flex cursor-pointer items-center gap-3 rounded-[var(--ns-r-control)] px-1.5 py-1.5 hover:bg-line">
      <div className="min-w-0 flex-1"><div className="text-[15.5px] leading-tight">{label}</div><div className="t-small ink3 truncate text-[13.5px]">{hint}</div></div>
      <Switch checked={on} onCheckedChange={onChange} aria-label={label} />
    </label>
  )
  return (
    <Popover>
      <Tip label="Layers">
        <PopoverTrigger asChild><button className="btn btn-icon" aria-label="Layers"><Layers3 /></button></PopoverTrigger>
      </Tip>
      <PopoverContent className="max-h-[calc(100vh-90px)] w-[310px] overflow-y-auto">
        <div className="t-micro mb-2">Base map</div>
        {mode === 'daylight' ? (
          <div className="mb-3 grid grid-cols-2 gap-1" role="radiogroup" aria-label="Base map">
            {MAP_TYPES.map((m) => (
              <button key={m.key} role="radio" aria-checked={mapType === m.key} aria-pressed={mapType === m.key} onClick={() => setMapType(m.key)} className="btn btn-line justify-center">{m.label}</button>
            ))}
          </div>
        ) : <p className="t-small ink3 mb-3">Night uses the dark map. Satellite is available in Daylight.</p>}
        {GROUPS.map((g) => (
          <div key={g.title} className="mb-2">
            <div className="t-micro mb-1">{g.title}</div>
            {g.items.map((it) => <Line key={it.key} label={it.label} hint={it.hint} on={layers[it.key]} onChange={() => toggle(it.key)} />)}
          </div>
        ))}
        <div className="t-micro mb-1 mt-2">View</div>
        <Line label="Minimap" hint="The whole area with your current view" on={minimap} onChange={() => setMinimap(!minimap)} />
      </PopoverContent>
    </Popover>
  )
}
