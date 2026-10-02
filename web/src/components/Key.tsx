/** The key (legend), collapsed by default and contextual (docs/DESIGN.md declutter rule 5): it lists only what is on the
 *  map at this zoom band with the current layers and mode. */
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useAreaGeo, useCameraBuildings } from '@/api/queries'
import { colors } from '@/design/tokens'
import { FLOOR_HEIGHT_M } from '@/map/layers'
import { cn } from '@/lib/utils'
import { useUi } from '@/store/ui'

const Item = ({ sw, children }: { sw: React.ReactNode; children: React.ReactNode }) => (
  <li className="t-small flex items-center gap-2.5 py-[3px]"><span className="flex w-5 justify-center">{sw}</span>{children}</li>
)

export function Key() {
  const [open, setOpen] = useState(false)
  const band = useUi((s) => s.band)
  const layers = useUi((s) => s.layers)
  const flat = useUi((s) => s.flat)
  const mode = useUi((s) => s.mode)
  const analyse = useUi((s) => s.analyse)
  const drive = useUi((s) => !!s.drive)
  const area = useUi((s) => s.area)
  const { data: geo } = useAreaGeo(area)
  const { data: camB } = useCameraBuildings(area)
  const c = colors[mode]
  const night = mode === 'night'
  const near = band === 'street' || band === 'object'
  const hasCheck = !!geo?.features.some((f) => f.properties.kind === 'streetlight_gap' && f.properties.display_mode === 'check')
  const lamp = <span className="dot" style={night ? { background: '#fff4e0', boxShadow: `0 0 8px 3px ${c.sodiumGlow}` } : { background: c.sodium, boxShadow: `0 0 0 1.5px ${c.bg1}` }} />
  return (
    <div className="pointer-events-auto absolute bottom-8 left-4 z-10">
      {open && (
        <ul className="sheet mb-2 w-[240px] px-4 py-3" aria-label="Map key">
          {band === 'city' ? (
            <>
              <Item sw={<span className="h-2.5 w-4 rounded-[2px]" style={{ boxShadow: `inset 0 0 0 1.5px ${c.sodium}`, background: c.sodiumSoft }} />}>Analysed area</Item>
              <Item sw={<span className="size-2 animate-pulse rounded-full" style={{ background: c.sodium }} />}>Analysis running</Item>
              <li className="t-small ink3 pt-1">Zoom in or click an area to open it.</li>
            </>
          ) : (
            <>
              <Item sw={<span className="h-1 w-5 rounded" style={{ background: c.sodiumGlow, boxShadow: night ? `0 0 8px ${c.sodium}` : undefined }} />}>Analysed road, lit</Item>
              {layers.gaps && <Item sw={<span className="h-2 w-5 rounded-sm" style={{ background: c.dark, boxShadow: `0 0 0 1px ${c.darkEdge}` }} />}>Dark: no streetlight seen in 60 m</Item>}
              {layers.gaps && hasCheck && <Item sw={<span className="h-2 w-5 rounded-sm" style={{ background: c.dark, outline: `1.5px dotted ${c.ink2}` }} />}>Possible dark stretch to check (road bends)</Item>}
              {layers.assets && <Item sw={lamp}>Streetlight</Item>}
              {layers.assets && near && <Item sw={<span className="size-[6px] rounded-full" style={{ background: night ? c.ink2 : c.ink3 }} />}>Pole, no lamp seen</Item>}
              {layers.buildings && (
                <>
                  <Item sw={<span className="dot" style={{ background: c.noRecord }} />}>Not in the register</Item>
                  <Item sw={<span className="dot" style={{ background: c.discrepancy }} />}>Differs from the register</Item>
                  {near && <Item sw={<span className="dot" style={{ background: c.matched }} />}>In the register, no difference found</Item>}
                  {near && <Item sw={<span className="h-3 w-4" style={{ backgroundImage: `repeating-linear-gradient(135deg, ${c.ink3} 0 1.5px, transparent 1.5px 5px)`, boxShadow: `inset 0 0 0 1px ${c.ink3}` }} />}>Floors not known (flat)</Item>}
                  {near && !flat && <li className="t-small ink3 py-[3px] pl-[30px]">Height = floors × {FLOOR_HEIGHT_M} m (display only); faded = floor estimate</li>}
                </>
              )}
              {layers.unmapped && near && <Item sw={<span className="size-2.5 rounded-full" style={{ boxShadow: `inset 0 0 0 1.5px ${c.ink2}` }} />}>Business with no analysed building</Item>}
              {layers.assets && near && layers.uncertainty && <Item sw={<span className="size-3 rounded-full" style={{ border: `1px dashed ${c.ink2}` }} />}>Approximate position</Item>}
              {layers.cameraBuildings && (camB?.count ?? 0) > 0 && (
                <Item sw={<span className="size-2.5 rotate-45 rounded-[1px]" style={{ boxShadow: `inset 0 0 0 1.5px ${night ? c.sodiumGlow : c.sodium}` }} />}>
                  Building seen by camera only, no map outline · <span className="t-data">{camB!.count}</span>{near ? '' : ' (street zoom)'}</Item>
              )}
              {layers.missing && near && <Item sw={<span className="size-3 rounded-[3px]" style={{ border: `1.5px dashed ${c.noRecord}` }} />}>In the register, not seen</Item>}
              {layers.review && near && <Item sw={<span className="h-2.5 w-4 rounded-[2px]" style={{ border: `1.5px dashed ${c.review}` }} />}>Waiting for review</Item>}
              {layers.streetHealth && <Item sw={<span className="h-1 w-5 rounded" style={{ background: `linear-gradient(90deg, ${c.ink3}, ${c.noRecord})` }} />}>Road colour: findings per km</Item>}
              {layers.density && band === 'area' && <Item sw={<span className="size-3 rotate-45 rounded-[2px]" style={{ background: c.noRecord, opacity: 0.5 }} />}>Where findings cluster</Item>}
              {(analyse || layers.coverage) && <Item sw={<span className="h-1 w-5 rounded" style={{ background: '#4fa3ff' }} />}>Google Street View coverage</Item>}
              {drive && <Item sw={<span className="size-3" style={{ background: c.sodium, clipPath: 'polygon(50% 0, 100% 100%, 50% 75%, 0 100%)' }} />}>You, driving</Item>}
            </>
          )}
          <li className="t-micro mt-1.5">Registers are synthetic (demo)</li>
        </ul>
      )}
      <button className="btn" onClick={() => setOpen(!open)} aria-expanded={open} style={{ background: 'color-mix(in srgb, var(--ns-bg1) 80%, transparent)' }}>
        Key <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
      </button>
    </div>
  )
}
