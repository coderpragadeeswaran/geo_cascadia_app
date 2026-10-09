/** The key (legend), collapsed by default and contextual (docs/DESIGN.md declutter rule 5): it lists only what is on the
 *  map at this zoom band with the current layers and mode. */
import { ChevronDown } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useAreaGeo, useCameraBuildings } from '@/api/queries'
import { colors } from '@/design/tokens'
import { FLOOR_HEIGHT_M } from '@/map/layers'
import { cn } from '@/lib/utils'
import { StretchSwatch } from './GapList'
import { useUi } from '@/store/ui'

// the label is one inline span, so a count inside it flows with the words instead of becoming its own flex column
const Item = ({ sw, children }: { sw: React.ReactNode; children: React.ReactNode }) => (
  <li className="t-small flex items-center gap-2.5 py-[3px]"><span className="flex w-8 shrink-0 justify-center">{sw}</span><span className="min-w-0">{children}</span></li>
)

/** D66: the open key may use only the space between the bottom of the top scrim's content (top bar, key numbers, the
 *  More menu, the coverage note) and the top of the Key button; re-measured when any of them changes size. */
function useKeyMaxHeight(open: boolean, btn: React.RefObject<HTMLButtonElement | null>) {
  const [maxH, setMaxH] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!open) return
    const scrim = () => document.querySelector<HTMLElement>('[data-top-scrim]')
    const measure = () => {
      const b = btn.current
      if (!b) return
      const top = scrim()
      let bottom = 0
      if (top) {
        const r = top.getBoundingClientRect()
        bottom = r.bottom - (parseFloat(getComputedStyle(top).paddingBottom) || 0)
        top.querySelectorAll<HTMLElement>('[role="menu"]').forEach((m) => { bottom = Math.max(bottom, m.getBoundingClientRect().bottom) })
      }
      const GAP = 8 + 8                                         // the sheet's mb-2 above the button + air below the ribbon
      setMaxH(Math.max(96, Math.floor(b.getBoundingClientRect().top - bottom - GAP)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    const mo = new MutationObserver(measure)
    const top = scrim()
    if (top) { ro.observe(top); mo.observe(top, { childList: true, subtree: true }) }
    if (btn.current) ro.observe(btn.current)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', measure) }
  }, [open, btn])
  return maxH
}

export function Key() {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const maxH = useKeyMaxHeight(open, btn)
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
  const prios = new Set(geo?.features.map((f) => (f.properties.kind === 'streetlight_gap' ? f.properties.priority : null)).filter(Boolean))
  const lamp = <span className="dot" style={night ? { background: '#fff4e0', boxShadow: `0 0 8px 3px ${c.sodiumGlow}` } : { background: c.sodium, boxShadow: `0 0 0 1.5px ${c.bg1}` }} />
  return (
    <div className="pointer-events-auto absolute bottom-8 left-4 z-10">
      {open && (
        <ul className="sheet mb-2 w-[272px] overflow-y-auto px-4 py-3" aria-label="Map key" tabIndex={0} data-map-key
          style={{ maxHeight: maxH ?? undefined, scrollbarWidth: 'thin', scrollbarColor: 'var(--ns-ink3) transparent' }}>
          {band === 'city' ? (
            <>
              <Item sw={<span className="h-2.5 w-4 rounded-[2px]" style={{ boxShadow: `inset 0 0 0 1.5px ${c.sodium}`, background: c.sodiumSoft }} />}>Analysed area</Item>
              <Item sw={<span className="size-2 animate-pulse rounded-full" style={{ background: c.sodium }} />}>Analysis running</Item>
              <li className="t-small ink3 pt-1">Zoom in or click an area to open it.</li>
            </>
          ) : (
            <>
              <Item sw={<span className="h-1 w-5 rounded" style={{ background: c.sodiumGlow, boxShadow: night ? `0 0 8px ${c.sodium}` : undefined }} />}>Analysed road, lit</Item>
              {layers.gaps && !prios.size && <Item sw={<StretchSwatch width={12} />}>Dark: no streetlight seen in 60 m</Item>}
              {layers.gaps && (['high', 'medium', 'low'] as const).filter((p) => prios.has(p)).map((p) => (
                <Item key={p} sw={<StretchSwatch p={p} width={12} />}>Possible dark stretch, {p} priority</Item>
              ))}
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
                  Building seen by camera only, no map outline · <span className="t-data">{camB!.count}</span>{near ? null : ' (street zoom)'}</Item>
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
      <button ref={btn} className="btn" onClick={() => setOpen(!open)} aria-expanded={open} style={{ background: 'color-mix(in srgb, var(--ns-bg1) 80%, transparent)' }}>
        Key <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
      </button>
    </div>
  )
}
