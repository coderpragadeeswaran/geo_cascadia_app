/** Drive the street (design pass B §4), a mode of the map reached from a selected street: a scrubber moves through the
 *  pipeline's REAL camera stops in driving order (strictly forward), the map follows with a direction arrow and a view
 *  wedge, and the panel shows the Street View frame for the chosen view (forward / left / right), whether this stretch
 *  is lit or dark, and what you are passing. Each stop you settle on loads ONE billed Street View image; the next stop's
 *  image is loaded ahead so driving forward is smooth. */
import { useMap } from '@vis.gl/react-google-maps'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useConfig } from '@/api/queries'
import { matchLabel, useLabel } from '@/lib/labels'
import { cn, fmt, plural } from '@/lib/utils'
import { flyTo, OBJECT_TILT } from '@/map/camera'
import { useDriveData, useDriveStop, viewHeading, type DriveBranch } from '@/map/drive'
import { useUi, type DriveView } from '@/store/ui'
import { staticUrl } from './EvidencePhoto'
import { StatusDot } from './FindingsTable'

const PASS_M = 20
const REDUCED = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const SETTLE_MS = 350

export function DriveButton({ street }: { street: string }) {
  const setDrive = useUi((s) => s.setDrive)
  return <button className="btn btn-sodium" onClick={() => setDrive({ street, branch: 0, i: 0, view: 'forward' })}><Play /> Drive this street</button>
}

const step = (d: number) => {
  const ui = useUi.getState()
  if (ui.drive) ui.setDrive({ ...ui.drive, i: Math.max(0, ui.drive.i + d) })
}

export function DrivePanel() {
  const { drive, data, branch, stop } = useDriveStop()
  const q = useDriveData()
  const setDrive = useUi((s) => s.setDrive)
  const map = useMap('main')
  const flat = useUi((s) => s.flat)
  // the map follows the camera: centred on the stop, rotated so the travel direction points up
  useEffect(() => {
    if (!map || !stop) return
    flyTo(map, { center: { lat: stop.lat, lng: stop.lon }, zoom: 18.1, tilt: flat ? 0 : OBJECT_TILT, heading: stop.heading }, { duration: REDUCED ? 0 : 650, instant: flat || REDUCED })
  }, [map, stop, flat])
  useEffect(() => () => { if (map) map.moveCamera({ heading: 0 }) }, [map])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea')) return
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (q.isError) return (
    <div className="p-5"><p className="t-body">{(q.error as { status?: number } | null)?.status === 404
      ? 'No camera stops are recorded on this street, so it can’t be driven.' : 'Couldn’t load the drive: the API didn’t answer. Close it and try again.'}</p>
      <button className="btn btn-line mt-3" onClick={() => setDrive(null)}>Back</button></div>
  )
  if (!drive || !data || !branch || !stop) return <p className="t-small ink3 p-5">Loading the drive…</p>
  const i = Math.min(drive.i, branch.stops.length - 1)
  return (
    <>
      <header className="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
        <div className="min-w-0">
          <div className="t-micro">Drive the street</div>
          <h2 className="t-title mt-1 truncate">{data.street}</h2>
          <div className="t-small ink2 mt-0.5"><span className="t-data">{fmt.format(branch.length_m)} m</span> · {branch.stops.length} camera stops</div>
        </div>
        <button className="btn btn-icon" onClick={() => setDrive(null)} aria-label="Stop driving (Esc)"><X /></button>
      </header>
      {data.branches.length > 1 && (
        <div className="flex flex-wrap gap-1 px-5 pb-2" role="tablist" aria-label="Part of the street">
          {data.branches.map((b, k) => (
            <button key={b.id} role="tab" aria-selected={k === drive.branch} aria-pressed={k === drive.branch} className="btn h-7"
              onClick={() => setDrive({ ...drive, branch: k, i: 0 })}>{k === 0 ? 'Main line' : `Side piece ${k}`} · {fmt.format(b.length_m)} m</button>
          ))}
        </div>
      )}
      <Frame branch={branch} i={i} view={drive.view} />
      <div className="flex items-center gap-2 px-5 py-2.5 rule-b">
        <div className="flex overflow-hidden rounded-[var(--ns-r-control)]" role="radiogroup" aria-label="Look">
          {(['left', 'forward', 'right'] as DriveView[]).map((v) => (
            <button key={v} role="radio" aria-checked={drive.view === v} aria-pressed={drive.view === v} className="btn btn-line h-7 rounded-none px-2.5"
              onClick={() => setDrive({ ...drive, view: v })}>{v === 'left' ? 'Left' : v === 'right' ? 'Right' : 'Forward'}</button>
          ))}
        </div>
        <span className="t-data ink2 ml-auto">stop {i + 1}/{branch.stops.length} · {fmt.format(Math.round(stop.s))} m</span>
      </div>
      <Status branch={branch} s={stop.s} />
      <Passing branch={branch} s={stop.s} />
      <p className="t-small ink3 rule-t px-5 py-2">Each stop you stop at loads one Street View image (≈ $0.007); the next stop is loaded ahead so driving forward is smooth.</p>
    </>
  )
}

/** the Street View frame for the chosen view at this stop: debounced (one billed image per stop you settle on), next stop prefetched */
function Frame({ branch, i, view }: { branch: DriveBranch; i: number; view: DriveView }) {
  const { data: cfg } = useConfig()
  const stop = branch.stops[i]
  const next = branch.stops[i + 1]
  const [src, setSrc] = useState<string | null>(null)
  const url = (st: typeof stop) => (cfg ? staticUrl(cfg.maps_js_key, { pano_id: st.pano_id, heading: viewHeading(st.heading, view), pitch: 0, fov: 90 }, '640x400') : null)
  useEffect(() => {
    const u = url(stop)
    if (!u) return
    const t = setTimeout(() => setSrc(u), SETTLE_MS)
    return () => clearTimeout(t)
  }, [stop, view, cfg]) // eslint-disable-line react-hooks/exhaustive-deps
  const onLoad = () => { if (next) { const n = url(next); if (n) { const img = new Image(); img.referrerPolicy = 'strict-origin-when-cross-origin'; img.src = n } } }
  return (
    <figure className="relative mx-5 aspect-[16/10] overflow-hidden rounded-[var(--ns-r-control)] bg-black">
      <AnimatePresence>
        {src && <motion.img key={src} src={src} alt={`Street View, looking ${view} at this camera stop`} className="absolute inset-0 size-full object-cover"
          referrerPolicy="strict-origin-when-cross-origin" onLoad={onLoad}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: REDUCED ? 0 : 0.3 }} />}
      </AnimatePresence>
      <figcaption className="t-data absolute inset-x-0 bottom-0 flex justify-between px-2.5 py-1.5 text-[13px] text-white/90" style={{ background: 'linear-gradient(transparent, rgb(0 0 0 / 0.72))' }}>
        <span>{view} · {Math.round(viewHeading(stop.heading, view))}°</span><span>Imagery © Google</span>
      </figcaption>
    </figure>
  )
}

function Status({ branch, s }: { branch: DriveBranch; s: number }) {
  const gap = branch.gaps.find((g) => s >= g.s0 - 1 && s <= g.s1 + 1)
  const lamp = branch.lamps.map((l) => Math.abs(l.s - s)).sort((a, b) => a - b)[0]
  return (
    <div className="px-5 py-2.5" aria-live="polite">
      {gap ? (
        <div className="flex items-start gap-3">
          <span className="mt-1 h-3 w-8 shrink-0 rounded-sm" style={{ background: 'var(--ns-dark)', boxShadow: '0 0 0 1px var(--ns-dark-edge)' }} />
          <div>
            <div className="text-[17.5px] font-[580]">{gap.mode === 'check' ? 'Dark stretch to check' : 'Dark stretch: no streetlight seen'}</div>
            <div className="t-small ink2">{fmt.format(Math.round(gap.length_m))} m of this road{gap.mode === 'check' ? ' (the road bends; some lights were seen part way along)' : ''}</div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="dot" style={{ background: '#fff4e0', boxShadow: '0 0 10px 4px var(--ns-sodium-glow)' }} />
          <div className="text-[17.5px] font-[580]">Lit {lamp != null && <span className="t-small ink2 font-normal">· nearest streetlight {fmt.format(Math.round(lamp))} m</span>}</div>
        </div>
      )}
    </div>
  )
}

function Passing({ branch, s }: { branch: DriveBranch; s: number }) {
  const p = useMemo(() => ({
    buildings: branch.buildings.filter((b) => Math.abs(b.s - s) <= PASS_M && b.status !== 'matched'),
    lamps: branch.lamps.filter((a) => Math.abs(a.s - s) <= PASS_M),
    unmapped: branch.unmapped.filter((u) => Math.abs(u.s - s) <= PASS_M),
  }), [branch, s])
  const passed = useMemo(() => ({
    lamps: branch.lamps.filter((a) => a.s <= s).length, poles: branch.poles.filter((a) => a.s <= s).length,
    findings: branch.buildings.filter((b) => b.s <= s && b.status !== 'matched').length,
  }), [branch, s])
  const empty = !p.buildings.length && !p.lamps.length && !p.unmapped.length
  return (
    <div className="min-h-0 flex-1 overflow-y-auto rule-t px-5 py-2.5">
      <div className="t-micro mb-1.5">Passing now · within {PASS_M} m</div>
      <ul className="space-y-1">
        <AnimatePresence initial={false}>
          {p.buildings.map((b) => (
            <motion.li key={b.id} layout initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.2 }}
              className="flex items-center justify-between gap-3 rule-b pb-1">
              <span className="min-w-0 truncate">{b.name ?? (b.use ? useLabel(b.use) : 'Building')} <span className="t-small ink3">· on the {b.side}</span></span>
              <StatusDot s={b.status} label={matchLabel(b.status, false, !!b.use)} />
            </motion.li>
          ))}
          {p.lamps.map((a) => (
            <motion.li key={a.id} layout initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.2 }}
              className="flex items-center justify-between gap-3 rule-b pb-1">
              <span>Streetlight <span className="t-small ink3">· on the {a.side}</span></span>
              <span className="dot" style={{ background: '#fff4e0', boxShadow: '0 0 8px 3px var(--ns-sodium-glow)' }} />
            </motion.li>
          ))}
          {p.unmapped.map((u) => (
            <motion.li key={u.id} layout initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.2 }}
              className="flex items-center justify-between gap-3 rule-b pb-1">
              <span className="min-w-0 truncate">{u.name} <span className="t-small ink3">· business with no analysed building</span></span>
              <span className="dot" style={{ boxShadow: 'inset 0 0 0 1.5px var(--ns-ink2)' }} />
            </motion.li>
          ))}
        </AnimatePresence>
        {empty && <li className="t-small ink3">Nothing to note within {PASS_M} m of this stop.</li>}
      </ul>
      <p className="t-data ink2 mt-2">so far: {plural(passed.lamps, 'streetlight')} · {plural(passed.poles, 'pole')} · {plural(passed.findings, 'building')} with a finding</p>
    </div>
  )
}

/** the road as a strip at the bottom of the map: lit vs dark stretches, lamps, findings by side, the camera stops; drag,
 *  click, ← → or ▶ Drive (one stop every 1.3 s) — every step moves forward along the road */
export function DriveStrip({ right }: { right: number }) {
  const { drive, branch, stop } = useDriveStop()
  const setDrive = useUi((s) => s.setDrive)
  const [playing, setPlaying] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const n = branch?.stops.length ?? 0
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => {
      const ui = useUi.getState()
      if (!ui.drive) return
      if (ui.drive.i >= n - 1) { setPlaying(false); return }
      ui.setDrive({ ...ui.drive, i: ui.drive.i + 1 })
    }, REDUCED ? 1600 : 1300)
    return () => clearInterval(t)
  }, [playing, n])
  useEffect(() => { setPlaying(false) }, [drive?.branch, drive?.street])
  if (!drive || !branch || !stop) return null
  const L = Math.max(1, branch.length_m)
  const pct = (s: number) => `${Math.min(100, Math.max(0, (s / L) * 100))}%`
  const i = Math.min(drive.i, n - 1)
  const pick = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    const s = ((clientX - r.left) / r.width) * L
    let best = 0
    branch.stops.forEach((c, k) => { if (Math.abs(c.s - s) < Math.abs(branch.stops[best].s - s)) best = k })
    setPlaying(false)
    setDrive({ ...drive, i: best })
  }
  return (
    <div className="pointer-events-auto absolute bottom-9 left-4 z-20" style={{ right: right + 16 }}>
      <div className="sheet px-4 pb-2.5 pt-3" style={{ background: 'color-mix(in srgb, var(--ns-bg1) 94%, transparent)' }}>
        <div className="mb-2 flex items-center gap-2">
          <button className={cn('btn', playing ? 'btn-solid' : 'btn-sodium')} onClick={() => { if (i >= n - 1) setDrive({ ...drive, i: 0 }); setPlaying(!playing) }} aria-label={playing ? 'Pause' : 'Drive'}>
            {playing ? <Pause /> : <Play />} {playing ? 'Pause' : 'Drive'}
          </button>
          <button className="btn btn-icon" onClick={() => { setPlaying(false); step(-1) }} disabled={i === 0} aria-label="Previous stop"><ChevronLeft /></button>
          <button className="btn btn-icon" onClick={() => { setPlaying(false); step(1) }} disabled={i >= n - 1} aria-label="Next stop"><ChevronRight /></button>
          <span className="t-small ink3 ml-2">left side above · right side below · ← → to step · Esc to stop</span>
        </div>
        <div ref={ref} role="slider" tabIndex={0} aria-label="Position along the street" aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={i}
          aria-valuetext={`${Math.round(stop.s)} m of ${branch.length_m} m`} className="relative h-[50px] cursor-pointer select-none"
          onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); pick(e.clientX) }}
          onPointerMove={(e) => { if (e.buttons) pick(e.clientX) }}>
          {branch.buildings.filter((b) => b.status !== 'matched').map((b) => (
            <span key={b.id} className="absolute h-2.5 w-[3px] -translate-x-1/2 rounded-sm" style={{ left: pct(b.s), top: b.side === 'left' ? 4 : 36,
              background: b.status === 'no_record' ? 'var(--ns-no-record)' : 'var(--ns-discrepancy)' }} />
          ))}
          <span className="absolute inset-x-0 top-[20px] h-2 rounded-full" style={{ background: 'var(--ns-sodium)', boxShadow: '0 0 12px var(--ns-sodium-soft)' }} />
          {branch.gaps.map((g) => (
            <span key={g.id} className="absolute top-[19px] h-2.5 rounded-sm" style={{ left: pct(g.s0), width: pct(g.s1 - g.s0), background: 'var(--ns-dark)',
              boxShadow: g.mode === 'check' ? '0 0 0 1px var(--ns-ink2)' : '0 0 0 1px var(--ns-dark-edge)', outline: g.mode === 'check' ? '1px dotted var(--ns-ink2)' : undefined }} title={g.mode === 'check' ? 'Dark stretch to check' : 'Dark stretch'} />
          ))}
          {branch.lamps.map((a) => <span key={a.id} className="absolute top-[17px] size-[5px] -translate-x-1/2 rounded-full" style={{ left: pct(a.s), background: '#fff4e0', boxShadow: '0 0 6px 2px var(--ns-sodium-glow)' }} />)}
          {branch.stops.map((c, k) => <span key={k} className="absolute top-[31px] h-1.5 w-px" style={{ left: pct(c.s), background: 'var(--ns-ink3)' }} />)}
          <span className="absolute top-0 h-full w-px -translate-x-1/2" style={{ left: pct(stop.s), background: 'var(--ns-ink)', transition: REDUCED ? undefined : 'left 320ms var(--ns-ease)' }}>
            <span className="absolute left-1/2 top-[16px] size-4 -translate-x-1/2 rounded-full" style={{ background: 'var(--ns-ink)', boxShadow: '0 0 0 3px var(--ns-bg1)' }} />
          </span>
        </div>
        <div className="t-data ink3 mt-1 flex justify-between"><span>0 m</span><span>{fmt.format(Math.round(stop.s))} m</span><span>{fmt.format(branch.length_m)} m</span></div>
      </div>
    </div>
  )
}
