/** The exact evidence view: a Street View Static image (640×640 at the stored pano / heading / pitch / fov) fetched live
 *  by the browser with the referrer-restricted browser key (never stored or re-hosted, §9.6), with boxes drawn in the
 *  same 640×640 pixel space.
 *  D60: before asking Google for the photo, the app asks its own API whether Google still serves that panorama (free
 *  metadata, cached 30 days). A gone one is never requested: Google's current photo from (almost) the same spot is shown
 *  instead, aimed at the same target, WITHOUT the boxes (they belong to the old photo), with a plain note; with no
 *  current photo nearby, a plain "no photo" message and no request at all. */
import { ImageOff } from 'lucide-react'
import { createContext, useEffect, useRef, useState } from 'react'
import { useConfig, usePhotoStatus } from '@/api/queries'
import type { CurrentPhoto } from '@/api/types'
import { swapNote, swapOf, type Swap } from '@/lib/photoSwap'
import { cn } from '@/lib/utils'

export interface EvidenceView { pano_id: string; heading: number; pitch?: number | null; fov?: number | null; x1?: number | null; y1?: number | null; x2?: number | null; y2?: number | null }

/** D60: is this stored photo still served? `given` = the answer the caller already has (the evidence API's
 *  `served` / `current`); otherwise GET /photos/{pano} (aimed at `aim` when given, else the same heading). */
export function usePhotoSwap(view: EvidenceView | null, aim?: { lat: number; lon: number } | null,
  given?: { served?: boolean | null; current?: CurrentPhoto | null; date?: string | null }): Swap {
  const { data: cfg } = useConfig()
  const ask = given === undefined && !!view && !!cfg?.maps_js_key
  const q = usePhotoStatus(view, aim, ask)
  if (given !== undefined) return swapOf(given.served, given.current, given.date)
  if (ask && q.isPending) return { state: 'checking', current: null, original: null }
  return swapOf(q.data?.served, q.data?.current, q.data?.date)   // API error: shown as before
}

export const staticUrl = (key: string, v: EvidenceView, size = '640x640') =>
  `https://maps.googleapis.com/maps/api/streetview?size=${size}&pano=${encodeURIComponent(v.pano_id)}&heading=${v.heading}` +
  `&pitch=${v.pitch ?? 0}&fov=${v.fov ?? 90}&return_error_code=true&key=${encodeURIComponent(key)}`

/** ui-polish-2: 640-px photo units per screen pixel, so tags drawn in the photo's SVG keep a fixed small screen size
 *  (11 px) whatever size the photo is shown at */
export const PhotoScale = createContext(1)

export function EvidencePhoto({ view, label, crosshair, className, children, swap, aim }: {
  view: EvidenceView; label?: string; crosshair?: boolean; className?: string; children?: React.ReactNode
  /** D60: the answer the caller already has (evidence API); omitted = asked here */
  swap?: { served?: boolean | null; current?: CurrentPhoto | null; date?: string | null }
  /** D60: what a current photo is aimed at when the stored one is gone (else the same heading) */
  aim?: { lat: number; lon: number } | null }) {
  const { data: cfg } = useConfig()
  const sw = usePhotoSwap(view, aim, swap)
  const shown: EvidenceView = sw.state === 'swapped' && sw.current ? sw.current : view
  const note = swapNote(sw)
  const fig = useRef<HTMLElement>(null)
  const [w, setW] = useState(640)
  useEffect(() => {
    const el = fig.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => { if (e.contentRect.width > 0) setW(e.contentRect.width) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [state, setState] = useState<{ src: string; s: 'ok' | 'error' } | null>(null)
  const src = cfg?.maps_js_key && (sw.state === 'served' || sw.state === 'swapped') ? staticUrl(cfg.maps_js_key, shown) : null
  const noKey = !!cfg && !cfg.maps_js_key
  const s = noKey ? 'nokey' : sw.state === 'none' ? 'gone' : state && state.src === src ? state.s : 'loading'
  const hasBox = sw.state === 'served' && [view.x1, view.y1, view.x2, view.y2].every((v) => typeof v === 'number')
  const photo = (
    <figure ref={fig} className={cn('relative aspect-square w-full overflow-hidden rounded-[var(--ns-r-control)] bg-black', className)}>
      {src && (
        <img key={src} src={src} alt={sw.state === 'swapped' ? 'Google’s current Street View photo of this spot (no boxes)' : label ?? 'Street View evidence'} className={cn('absolute inset-0 size-full object-cover transition-opacity duration-300', s === 'ok' ? 'opacity-100' : 'opacity-0')}
          onLoad={() => setState({ src, s: 'ok' })} onError={() => setState({ src, s: 'error' })} referrerPolicy="strict-origin-when-cross-origin" />
      )}
      {s === 'loading' && <div className="t-small absolute inset-0 flex animate-pulse items-center justify-center bg-white/5 text-white/60" role="status">Loading the Street View photo…</div>}
      {s === 'nokey' && <div className="t-small absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-white/70"><ImageOff className="size-5" /> Street View photos need the Google Maps browser key (not set on the API)</div>}
      {s === 'error' && <div className="t-small absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/70"><ImageOff className="size-5" /> No Street View image for this view</div>}
      {s === 'gone' && <div className="t-small absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-white/75"><ImageOff className="size-5" /> No Street View photo available here any more</div>}
      {s === 'ok' && sw.state === 'swapped' && (
        <span className="t-small absolute left-2 top-2 rounded-[var(--ns-r-control)] px-1.5 py-0.5 text-[12.5px] text-white" style={{ background: 'rgb(0 0 0 / 0.72)' }}>Current photo · no boxes</span>
      )}
      {s === 'ok' && sw.state === 'served' && (
        <svg viewBox="0 0 640 640" className="pointer-events-none absolute inset-0 size-full" aria-hidden>
          <PhotoScale.Provider value={640 / w}>
          {children ?? (hasBox ? (
            <>
              <rect x={view.x1!} y={view.y1!} width={view.x2! - view.x1!} height={view.y2! - view.y1!} fill="none" stroke="#000" strokeOpacity=".5" strokeWidth="7" rx="3" />
              <rect x={view.x1!} y={view.y1!} width={view.x2! - view.x1!} height={view.y2! - view.y1!} fill="none" stroke="var(--ns-sodium)" strokeWidth="3.5" rx="3" />
            </>
          ) : crosshair ? <Crosshair /> : null)}
          </PhotoScale.Provider>
        </svg>
      )}
      <figcaption className="t-data absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 px-2.5 pb-1.5 pt-6 text-[13px] text-white/85" style={{ background: 'linear-gradient(transparent, rgb(0 0 0 / 0.72))' }}>
        <span>{sw.state === 'swapped' ? `${Math.round(shown.heading)}°` : sw.state === 'none' ? '' : label ?? ''}</span><span className="shrink-0">Imagery © Google</span>
      </figcaption>
    </figure>
  )
  if (!note) return photo
  return (
    <div className="min-w-0">
      {photo}
      <p className="t-small ink2 mt-1.5" data-photo-swap={sw.state}>{note}</p>
    </div>
  )
}

export const Crosshair = () => (
  <g stroke="var(--ns-sodium)" strokeWidth="3" fill="none">
    <circle cx="320" cy="320" r="26" stroke="#000" strokeOpacity=".5" strokeWidth="6" />
    <circle cx="320" cy="320" r="26" />
    <path d="M320 270v30M320 340v30M270 320h30M340 320h30" />
  </g>
)
