/** The exact evidence view: a Street View Static image (640×640 at the stored pano / heading / pitch / fov) fetched live
 *  by the browser with the referrer-restricted browser key (never stored or re-hosted, §9.6), with the detection box
 *  drawn in the same 640×640 pixel space. */
import { ImageOff } from 'lucide-react'
import { useState } from 'react'
import { useConfig } from '@/api/queries'
import { cn } from '@/lib/utils'

export interface EvidenceView { pano_id: string; heading: number; pitch?: number | null; fov?: number | null; x1?: number | null; y1?: number | null; x2?: number | null; y2?: number | null }

export const staticUrl = (key: string, v: EvidenceView) =>
  `https://maps.googleapis.com/maps/api/streetview?size=640x640&pano=${encodeURIComponent(v.pano_id)}&heading=${v.heading}` +
  `&pitch=${v.pitch ?? 0}&fov=${v.fov ?? 90}&return_error_code=true&key=${encodeURIComponent(key)}`

export function StreetViewImage({ view, crosshair, label, className }: { view: EvidenceView; crosshair?: boolean; label?: string; className?: string }) {
  const { data: cfg } = useConfig()
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const hasBox = [view.x1, view.y1, view.x2, view.y2].every((v) => typeof v === 'number')
  const src = cfg ? staticUrl(cfg.maps_js_key, view) : null
  return (
    <figure className={cn('relative aspect-square w-full overflow-hidden rounded-xl bg-[#0b0f16]', className)}>
      {src && (
        <img key={src} src={src} alt={label ?? 'Street View evidence'} className={cn('absolute inset-0 size-full object-cover transition-opacity duration-300', state === 'ok' ? 'opacity-100' : 'opacity-0')}
          onLoad={() => setState('ok')} onError={() => setState('error')} referrerPolicy="strict-origin-when-cross-origin" />
      )}
      {state === 'loading' && <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-white/5 to-white/0" />}
      {state === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[12px] text-muted">
          <ImageOff className="size-5" /> No Street View image for this view
        </div>
      )}
      {state === 'ok' && (
        <svg viewBox="0 0 640 640" className="pointer-events-none absolute inset-0 size-full" aria-hidden>
          {hasBox && (
            <>
              <rect x={view.x1!} y={view.y1!} width={view.x2! - view.x1!} height={view.y2! - view.y1!} fill="none" stroke="#000" strokeOpacity=".55" strokeWidth="7" rx="4" />
              <rect x={view.x1!} y={view.y1!} width={view.x2! - view.x1!} height={view.y2! - view.y1!} fill="rgb(79 157 255 / 0.10)" stroke="var(--accent)" strokeWidth="3.5" rx="4" />
            </>
          )}
          {crosshair && !hasBox && (
            <g stroke="var(--accent)" strokeWidth="3" fill="none">
              <circle cx="320" cy="320" r="26" stroke="#000" strokeOpacity=".5" strokeWidth="6" />
              <circle cx="320" cy="320" r="26" />
              <path d="M320 270v30M320 340v30M270 320h30M340 320h30" />
            </g>
          )}
        </svg>
      )}
      <figcaption className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/75 to-transparent px-2.5 pb-1.5 pt-6 text-[10.5px] text-white/85">
        <span className="tnum">{label ?? ''} · heading {Math.round(view.heading)}° · pitch {Math.round(view.pitch ?? 0)}° · fov {view.fov ?? 90}°</span>
        <span className="shrink-0">Imagery © Google</span>
      </figcaption>
    </figure>
  )
}
