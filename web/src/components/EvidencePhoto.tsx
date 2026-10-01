/** The exact evidence view: a Street View Static image (640×640 at the stored pano / heading / pitch / fov) fetched live
 *  by the browser with the referrer-restricted browser key (never stored or re-hosted, §9.6), with boxes drawn in the
 *  same 640×640 pixel space. */
import { ImageOff } from 'lucide-react'
import { useState } from 'react'
import { useConfig } from '@/api/queries'
import { cn } from '@/lib/utils'

export interface EvidenceView { pano_id: string; heading: number; pitch?: number | null; fov?: number | null; x1?: number | null; y1?: number | null; x2?: number | null; y2?: number | null }

export const staticUrl = (key: string, v: EvidenceView, size = '640x640') =>
  `https://maps.googleapis.com/maps/api/streetview?size=${size}&pano=${encodeURIComponent(v.pano_id)}&heading=${v.heading}` +
  `&pitch=${v.pitch ?? 0}&fov=${v.fov ?? 90}&return_error_code=true&key=${encodeURIComponent(key)}`

export function EvidencePhoto({ view, label, crosshair, className, children }: {
  view: EvidenceView; label?: string; crosshair?: boolean; className?: string; children?: React.ReactNode }) {
  const { data: cfg } = useConfig()
  const [state, setState] = useState<{ src: string; s: 'ok' | 'error' } | null>(null)
  const src = cfg?.maps_js_key ? staticUrl(cfg.maps_js_key, view) : null
  const noKey = !!cfg && !cfg.maps_js_key
  const s = noKey ? 'nokey' : state && state.src === src ? state.s : 'loading'
  const hasBox = [view.x1, view.y1, view.x2, view.y2].every((v) => typeof v === 'number')
  return (
    <figure className={cn('relative aspect-square w-full overflow-hidden rounded-[var(--ns-r-control)] bg-black', className)}>
      {src && (
        <img key={src} src={src} alt={label ?? 'Street View evidence'} className={cn('absolute inset-0 size-full object-cover transition-opacity duration-300', s === 'ok' ? 'opacity-100' : 'opacity-0')}
          onLoad={() => setState({ src, s: 'ok' })} onError={() => setState({ src, s: 'error' })} referrerPolicy="strict-origin-when-cross-origin" />
      )}
      {s === 'loading' && <div className="t-small absolute inset-0 flex animate-pulse items-center justify-center bg-white/5 text-white/60" role="status">Loading the Street View photo…</div>}
      {s === 'nokey' && <div className="t-small absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-white/70"><ImageOff className="size-5" /> Street View photos need the Google Maps browser key (not set on the API)</div>}
      {s === 'error' && <div className="t-small absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/70"><ImageOff className="size-5" /> No Street View image for this view</div>}
      {s === 'ok' && (
        <svg viewBox="0 0 640 640" className="pointer-events-none absolute inset-0 size-full" aria-hidden>
          {children ?? (hasBox ? (
            <>
              <rect x={view.x1!} y={view.y1!} width={view.x2! - view.x1!} height={view.y2! - view.y1!} fill="none" stroke="#000" strokeOpacity=".5" strokeWidth="7" rx="3" />
              <rect x={view.x1!} y={view.y1!} width={view.x2! - view.x1!} height={view.y2! - view.y1!} fill="none" stroke="var(--ns-sodium)" strokeWidth="3.5" rx="3" />
            </>
          ) : crosshair ? <Crosshair /> : null)}
        </svg>
      )}
      <figcaption className="t-data absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 px-2.5 pb-1.5 pt-6 text-[13px] text-white/85" style={{ background: 'linear-gradient(transparent, rgb(0 0 0 / 0.72))' }}>
        <span>{label ?? ''}</span><span className="shrink-0">Imagery © Google</span>
      </figcaption>
    </figure>
  )
}

export const Crosshair = () => (
  <g stroke="var(--ns-sodium)" strokeWidth="3" fill="none">
    <circle cx="320" cy="320" r="26" stroke="#000" strokeOpacity=".5" strokeWidth="6" />
    <circle cx="320" cy="320" r="26" />
    <path d="M320 270v30M320 340v30M270 320h30M340 320h30" />
  </g>
)
