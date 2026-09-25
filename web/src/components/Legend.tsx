import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { HEALTH_STOPS, healthCss } from '@/map/colors'
import { FLOOR_HEIGHT_M } from '@/map/layers'
import { useAreaGeo } from '@/api/queries'
import { useUi } from '@/store/ui'
import { cn } from '@/lib/utils'

const Swatch = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <span className={cn('inline-block size-3 shrink-0 rounded-[3px]', className)} style={style} />
)
const Row = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => (
  <div className="flex items-center gap-2.5 py-[3px] text-[12px] leading-tight">{icon}<span className="text-fg/85">{children}</span></div>
)

export function Legend() {
  const band = useUi((s) => s.band)
  const layers = useUi((s) => s.layers)
  const flat = useUi((s) => s.flat)
  const [open, setOpen] = useState(true)
  const { data: geo } = useAreaGeo(useUi((s) => s.area))
  const hasCheckGap = !!geo?.features.some((f) => f.properties.kind === 'streetlight_gap' && f.properties.display_mode === 'check')
  const near = band === 'street' || band === 'object'

  return (
    <section className="glass pointer-events-auto absolute bottom-9 left-3 z-10 w-[236px] overflow-hidden" aria-label="Legend">
      <button onClick={() => setOpen(!open)} className="flex w-full cursor-pointer items-center justify-between px-3.5 py-2.5" aria-expanded={open}>
        <span className="eyebrow">Legend</span>
        <ChevronDown className={cn('size-4 text-muted transition-transform', !open && '-rotate-90')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }} className="px-3.5 pb-3">
            {band === 'city' && (
              <>
                <Row icon={<Swatch className="border-2 border-accent bg-accent-soft" />}>Analysed area</Row>
                <Row icon={<span className="relative flex size-3 items-center justify-center"><span className="absolute size-3 animate-ping rounded-full bg-accent/60" /><span className="size-2 rounded-full bg-accent" /></span>}>Analysis running</Row>
                <p className="mt-1.5 text-[11px] text-faint">Zoom in or click an area to open it.</p>
              </>
            )}
            {band === 'area' && (
              <>
                {layers.streetHealth && (
                  <div className="mb-2">
                    <div className="mb-1 text-[11.5px] text-muted">Street health · issues per km</div>
                    <div className="h-2 rounded-full" style={{ background: `linear-gradient(90deg, ${HEALTH_STOPS.map((v) => healthCss(v)).join(',')})` }} />
                    <div className="tnum mt-1 flex justify-between text-[10.5px] text-faint">{HEALTH_STOPS.map((v, i) => <span key={v}>{i === HEALTH_STOPS.length - 1 ? `${v}+` : v}</span>)}</div>
                    <Row icon={<span className="h-1 w-4 rounded bg-unclassified/70" />}>No data for this line</Row>
                  </div>
                )}
                {layers.gaps && <Row icon={<span className="h-[3px] w-4 rounded bg-[repeating-linear-gradient(90deg,var(--no-record)_0_5px,transparent_5px_8px)] shadow-[0_0_8px_var(--no-record)]" />}>No streetlight within 60 m</Row>}
                {layers.gaps && hasCheckGap && <Row icon={<span className="h-[3px] w-4 rounded bg-[repeating-linear-gradient(90deg,var(--discrepancy)_0_2px,transparent_2px_5px)]" />}>Gap to check (street bends)</Row>}
                {layers.density && <Row icon={<Swatch className="rotate-45 rounded-[2px] bg-gradient-to-br from-[#ffd666] to-[#d6326e] opacity-80" />}>Density of findings</Row>}
              </>
            )}
            {near && (
              <>
                {layers.buildings && (
                  <>
                    <Row icon={<Swatch className="bg-matched" />}>Matched register record</Row>
                    <Row icon={<Swatch className="bg-discrepancy" />}>Discrepancy</Row>
                    <Row icon={<Swatch className="bg-no-record" />}>No register record</Row>
                    <Row icon={<Swatch className="hatch border border-unclassified text-unclassified" />}>Floors not classified (flat)</Row>
                    {!flat && <p className="mb-1 mt-0.5 text-[10.5px] leading-snug text-faint">Height = observed floors × {FLOOR_HEIGHT_M} m (display scale). Faded = low-confidence floor count.</p>}
                  </>
                )}
                {layers.assets && (
                  <>
                    <Row icon={<span className="size-3 rounded-full border-2 border-matched bg-[#0b0f16]" />}>Pole / streetlight · ring = register</Row>
                    {layers.uncertainty && <Row icon={<span className="size-3 rounded-full border border-dashed border-fg/70" />}>Approximate (single camera)</Row>}
                  </>
                )}
                {layers.unmapped && <Row icon={<svg width="12" height="14" viewBox="0 0 48 64"><path fill="none" stroke="var(--unmapped)" strokeWidth="6" d="M24 60s-18-19-18-33a18 18 0 0 1 36 0c0 14-18 33-18 33z" /></svg>}>Unmapped business (approx.)</Row>}
                {layers.missing && <Row icon={<span className="size-3 rounded-[3px] border border-dashed border-no-record" />}>Register record, nothing seen</Row>}
                {layers.review && <Row icon={<Swatch className="border-2 border-review" />}>In review queue</Row>}
                {layers.gaps && <Row icon={<span className="h-[3px] w-4 rounded bg-[repeating-linear-gradient(90deg,var(--no-record)_0_5px,transparent_5px_8px)]" />}>Streetlight gap (60 m)</Row>}
                {layers.gaps && hasCheckGap && <Row icon={<span className="h-[3px] w-4 rounded bg-[repeating-linear-gradient(90deg,var(--discrepancy)_0_2px,transparent_2px_5px)]" />}>Gap to check (street bends)</Row>}
              </>
            )}
            <div className="mt-2 inline-flex items-center rounded-md border border-dashed border-glass-border px-1.5 py-0.5 text-[10.5px] text-muted">
              Synthetic register (demo)
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
