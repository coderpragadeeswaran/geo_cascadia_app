/** "Drive the street" mock (Night Survey): a scrubber along one street that moves the camera through the pipeline's
 *  real camera stops (plan.json), shows the forward Street View frame at each stop, and lets findings appear as you
 *  pass them. Data: tools/export_drive_street.py → data/ward29-sathy-drive.json (real Ward 29). */
import { GoogleMapsOverlay } from '@deck.gl/google-maps'
import { PathLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers'
import { Map, useMap } from '@vis.gl/react-google-maps'
import { AnimatePresence, motion } from 'framer-motion'
import { Pause, Play } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useConfig } from '@/api/queries'
import drive from './data/ward29-sathy-drive.json'
import { Status } from './NsParts'
import { colors, mapStyleJson, rgba, statusColor, type Mode } from './tokens'

type D = typeof drive
const fmt = new Intl.NumberFormat('en-IN')
const PASS_M = 20
const REDUCED = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** point along the street line at distance s (for the camera marker between stops) */
function lineAt(line: number[][], s: number) {
  const kx = 111320 * Math.cos((line[0][0] * Math.PI) / 180), ky = 110540
  let acc = 0
  for (let i = 0; i < line.length - 1; i++) {
    const [a, b] = [line[i], line[i + 1]]
    const d = Math.hypot((b[1] - a[1]) * kx, (b[0] - a[0]) * ky)
    if (acc + d >= s) { const t = d ? (s - acc) / d : 0; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] }
    acc += d
  }
  return line[line.length - 1]
}
function sliceLine(line: number[][], s0: number, s1: number) {
  const pts: number[][] = [], kx = 111320 * Math.cos((line[0][0] * Math.PI) / 180), ky = 110540
  pts.push(lineAt(line, s0))
  let acc = 0
  for (let i = 0; i < line.length - 1; i++) { acc += Math.hypot((line[i + 1][1] - line[i][1]) * kx, (line[i + 1][0] - line[i][0]) * ky); if (acc > s0 && acc < s1) pts.push(line[i + 1]) }
  pts.push(lineAt(line, s1))
  return pts.map((p) => [p[1], p[0]] as [number, number])
}

export function NsDrive({ mode }: { mode: Mode }) {
  const [i, setI] = useState(0)
  const [playing, setPlaying] = useState(false)
  const cams = drive.cameras
  const cam = cams[i]
  const dark = drive.gaps.find((g) => cam.s >= g.s0 - 1 && cam.s <= g.s1 + 1)
  const passing = useMemo(() => ({
    buildings: drive.buildings.filter((b) => Math.abs(b.s - cam.s) <= PASS_M),
    lamps: drive.assets.filter((a) => a.type === 'streetlight' && Math.abs(a.s - cam.s) <= PASS_M),
    unmapped: drive.unmapped.filter((u) => Math.abs(u.s - cam.s) <= PASS_M),
  }), [cam.s])
  const passed = useMemo(() => ({
    lamps: drive.assets.filter((a) => a.type === 'streetlight' && a.s <= cam.s).length,
    poles: drive.assets.filter((a) => a.type === 'pole' && a.s <= cam.s).length,
    b: drive.buildings.filter((b) => b.s <= cam.s),
  }), [cam.s])
  const nextLamp = drive.assets.filter((a) => a.type === 'streetlight').map((a) => Math.abs(a.s - cam.s)).sort((a, b) => a - b)[0]

  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setI((x) => { if (x >= cams.length - 1) { setPlaying(false); return x } return x + 1 }), REDUCED ? 1600 : 1300)
    return () => clearInterval(t)
  }, [playing, cams.length])

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_420px]">
      <div className="relative min-h-0">
        <DriveMap mode={mode} s={cam.s} heading={cam.heading} />
        <div className="scrim-top absolute inset-x-0 top-0 px-5 pb-8 pt-4">
          <div className="t-micro">Drive the street</div>
          <div className="t-title mt-1">{drive.street} <span className="t-data ink3">· {fmt.format(drive.length_m)} m · {cams.length} camera stops</span></div>
        </div>
        <div className="absolute inset-x-5 bottom-4"><Strip i={i} setI={(k) => { setPlaying(false); setI(k) }} /></div>
      </div>
      <aside className="surface rule-l flex min-h-0 flex-col">
        <Frame pano={cam.pano_id} heading={cam.heading} />
        <div className="flex items-center gap-3 px-5 py-3 rule-b">
          <button className="btn btn-sodium" onClick={() => { if (i >= cams.length - 1) setI(0); setPlaying(!playing) }} aria-label={playing ? 'Pause' : 'Drive'}>
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />} {playing ? 'Pause' : 'Drive'}
          </button>
          <span className="t-data ink2">stop {i + 1}/{cams.length} · {fmt.format(Math.round(cam.s))} m · heading {Math.round(cam.heading)}°</span>
        </div>
        <div className="px-5 py-3 rule-b" aria-live="polite">
          {dark ? (
            <div className="flex items-start gap-3">
              <span className="mt-1 h-3 w-8 shrink-0 rounded" style={{ background: colors[mode].dark, boxShadow: `0 0 0 1px ${colors[mode].darkEdge}` }} />
              <div>
                <div className="t-title" style={{ fontSize: 15 }}>Dark stretch · no lamp within 60 m</div>
                <div className="t-small ink2 mt-0.5"><span className="t-data">{dark.id}</span> · {fmt.format(dark.length_m)} m recorded{dark.along_road_m ? <> · <span className="sodium">≈ {fmt.format(dark.along_road_m)} m on road</span></> : null} · {dark.gap_type}</div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="dot" style={{ background: '#fff4e0', boxShadow: `0 0 10px 4px ${colors[mode].sodiumGlow}` }} />
              <div className="t-title" style={{ fontSize: 15 }}>Lit <span className="t-small ink2">· nearest lamp {fmt.format(Math.round(nextLamp ?? 0))} m</span></div>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <div className="t-micro mb-2">Passing now · within {PASS_M} m</div>
          <ul className="space-y-1.5">
            <AnimatePresence initial={false}>
              {passing.buildings.map((b) => (
                <motion.li key={b.id} layout initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.25 }}
                  className="flex items-center justify-between gap-3 rule-b pb-1.5">
                  <span className="min-w-0"><span className="block truncate">{b.name ?? (b.use ? `${b.use.replace(/_/g, ' ')} building` : 'building, use not classified')}</span>
                    <span className="t-data ink3">{b.id} · {b.side} · {b.floors ?? '—'} fl{b.discrepancies.length ? ` · ${b.discrepancies.map((x) => x.replace(/_/g, ' ')).join(', ')}` : ''}</span></span>
                  <Status s={b.status} />
                </motion.li>
              ))}
              {passing.lamps.map((a) => (
                <motion.li key={a.id} layout initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.25 }}
                  className="flex items-center justify-between gap-3 rule-b pb-1.5">
                  <span>Streetlight <span className="t-data ink3">· {a.id} · {a.side} · {a.method === 'triangulated' ? 'triangulated' : 'approximate'}</span></span>
                  <span className="dot" style={{ background: '#fff4e0', boxShadow: `0 0 8px 3px ${colors[mode].sodiumGlow}` }} />
                </motion.li>
              ))}
              {passing.unmapped.map((u) => (
                <motion.li key={u.id} layout initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.25 }}
                  className="flex items-center justify-between gap-3 rule-b pb-1.5">
                  <span className="min-w-0 truncate">{u.name} <span className="t-data ink3">· unmapped business · {u.side}</span></span>
                  <span className="dot" style={{ border: `1.5px solid ${colors[mode].ink2}` }} />
                </motion.li>
              ))}
            </AnimatePresence>
            {!passing.buildings.length && !passing.lamps.length && !passing.unmapped.length && <li className="t-small ink3">Nothing recorded within {PASS_M} m of this stop.</li>}
          </ul>
        </div>
        <div className="t-data ink2 grid grid-cols-3 rule-t px-5 py-3">
          <span>{passed.lamps} lamps</span><span>{passed.poles} poles</span>
          <span>{passed.b.filter((b) => b.status !== 'matched').length} findings / {passed.b.length}</span>
        </div>
      </aside>
    </div>
  )
}

/** the road as a strip: lit vs dark stretches, lamp ticks, buildings above/below by side, camera stops; drag to drive */
function Strip({ i, setI }: { i: number; setI: (k: number) => void }) {
  const L = drive.length_m
  const pct = (s: number) => `${(s / L) * 100}%`
  const cam = drive.cameras[i]
  const ref = useRef<HTMLDivElement>(null)
  const pick = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    const s = ((clientX - r.left) / r.width) * L
    let best = 0
    drive.cameras.forEach((c, k) => { if (Math.abs(c.s - s) < Math.abs(drive.cameras[best].s - s)) best = k })
    setI(best)
  }
  return (
    <div className="sheet px-4 pb-3 pt-3" style={{ background: 'color-mix(in srgb, var(--ns-bg1) 92%, transparent)' }}>
      <div ref={ref} role="slider" tabIndex={0} aria-label="Position along the street" aria-valuemin={0} aria-valuemax={drive.cameras.length - 1} aria-valuenow={i}
        aria-valuetext={`${Math.round(cam.s)} m`} className="relative h-[54px] cursor-pointer select-none"
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); pick(e.clientX) }}
        onPointerMove={(e) => { if (e.buttons) pick(e.clientX) }}
        onKeyDown={(e) => { if (e.key === 'ArrowRight') setI(Math.min(i + 1, drive.cameras.length - 1)); if (e.key === 'ArrowLeft') setI(Math.max(i - 1, 0)) }}>
        {/* buildings: left side above, right side below */}
        {drive.buildings.map((b) => (
          <span key={b.id} className="absolute h-2.5 w-[3px] rounded-sm" style={{ left: pct(b.s), top: b.side === 'left' ? 6 : 38, background: `var(--ns-${b.status === 'no_record' ? 'no-record' : b.status})`, opacity: b.status === 'matched' ? 0.45 : 1 }} />
        ))}
        {/* the road: lit, with dark stretches */}
        <span className="absolute inset-x-0 top-[22px] h-2 rounded-full" style={{ background: 'var(--ns-sodium)', boxShadow: '0 0 12px var(--ns-sodium-soft)' }} />
        {drive.gaps.map((g) => <span key={g.id} className="absolute top-[21px] h-2.5 rounded-sm" style={{ left: pct(g.s0), width: pct(g.s1 - g.s0), background: 'var(--ns-dark)', boxShadow: '0 0 0 1px var(--ns-dark-edge)' }} />)}
        {drive.assets.filter((a) => a.type === 'streetlight').map((a) => <span key={a.id} className="absolute top-[19px] size-[5px] -translate-x-1/2 rounded-full" style={{ left: pct(a.s), background: '#fff4e0', boxShadow: '0 0 6px 2px var(--ns-sodium-glow)' }} />)}
        {drive.cameras.map((c, k) => <span key={k} className="absolute top-[33px] h-1.5 w-px" style={{ left: pct(c.s), background: 'var(--ns-ink3)' }} />)}
        {/* thumb */}
        <span className="absolute top-0 h-full w-px -translate-x-1/2" style={{ left: pct(cam.s), background: 'var(--ns-ink)', transition: 'left 350ms var(--ns-ease)' }}>
          <span className="absolute left-1/2 top-[18px] size-4 -translate-x-1/2 rounded-full" style={{ background: 'var(--ns-ink)', boxShadow: '0 0 0 3px var(--ns-bg1)' }} />
        </span>
      </div>
      <div className="t-data ink3 mt-1 flex justify-between"><span>0 m</span><span>left side above · right side below · ← → to step</span><span>{fmt.format(L)} m</span></div>
    </div>
  )
}

function Frame({ pano, heading }: { pano: string; heading: number }) {
  const { data: cfg } = useConfig()
  const [src, setSrc] = useState<string | null>(null)
  // debounce: one billed Street View image per stop you settle on, not per pixel of scrubbing
  useEffect(() => {
    if (!cfg) return
    const t = setTimeout(() => setSrc(`https://maps.googleapis.com/maps/api/streetview?size=640x400&pano=${encodeURIComponent(pano)}&heading=${heading}&pitch=0&fov=90&return_error_code=true&key=${encodeURIComponent(cfg.maps_js_key)}`), 350)
    return () => clearTimeout(t)
  }, [pano, heading, cfg])
  return (
    <figure className="relative aspect-[16/10] w-full overflow-hidden" style={{ background: '#000' }}>
      <AnimatePresence>
        {src && <motion.img key={src} src={src} alt="Forward Street View at this camera stop" className="absolute inset-0 size-full object-cover"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: REDUCED ? 0 : 0.35 }} />}
      </AnimatePresence>
      <figcaption className="t-data absolute inset-x-0 bottom-0 flex justify-between px-3 py-1.5" style={{ background: 'linear-gradient(transparent, rgb(0 0 0 / 0.7))', color: '#fff', fontSize: 10 }}>
        <span>forward · {Math.round(heading)}°</span><span>Imagery © Google</span>
      </figcaption>
    </figure>
  )
}

function DriveMap({ mode, s, heading }: { mode: Mode; s: number; heading: number }) {
  const at = lineAt(drive.line, s)
  return (
    <Map id="ns-drive" key={mode} styles={mapStyleJson[mode]} mapTypeId="roadmap" defaultCenter={{ lat: at[0], lng: at[1] }} defaultZoom={17.6}
      disableDefaultUI clickableIcons={false} gestureHandling="cooperative" isFractionalZoomEnabled style={{ position: 'absolute', inset: 0 }}>
      <DriveLayers mode={mode} s={s} heading={heading} />
    </Map>
  )
}

function DriveLayers({ mode, s, heading }: { mode: Mode; s: number; heading: number }) {
  const map = useMap('ns-drive')
  const [overlay, setOverlay] = useState<GoogleMapsOverlay | null>(null)
  useEffect(() => {
    if (!map) return
    let o: GoogleMapsOverlay | null = null
    const t = setTimeout(() => { o = new GoogleMapsOverlay({ interleaved: false, useDevicePixels: Math.min(devicePixelRatio || 1, 1.5) }); o.setMap(map); setOverlay(o) }, 0)
    return () => { clearTimeout(t); o?.finalize(); setOverlay(null) }
  }, [map])
  const at = lineAt(drive.line, s)
  useEffect(() => { map?.panTo({ lat: at[0], lng: at[1] }) }, [map, at[0], at[1]]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!overlay) return
    const c = colors[mode]
    const road = drive.line.map((p) => [p[1], p[0]] as [number, number])
    // view wedge: 90° field of view toward the forward heading, 45 m deep
    const kx = 111320 * Math.cos((at[0] * Math.PI) / 180), ky = 110540
    const wedge: [number, number][] = [[at[1], at[0]]]
    for (let a = -45; a <= 45; a += 9) { const h = ((heading + a) * Math.PI) / 180; wedge.push([at[1] + (45 * Math.sin(h)) / kx, at[0] + (45 * Math.cos(h)) / ky]) }
    overlay.setProps({ layers: [
      new PathLayer({ id: 'd-road', data: [road], getPath: (d) => d, widthUnits: 'pixels', getWidth: 5, getColor: rgba(c.sodiumGlow, 220), capRounded: true, jointRounded: true }),
      new PathLayer({ id: 'd-dark', data: drive.gaps.map((g) => sliceLine(drive.line, g.s0, g.s1)), getPath: (d) => d, widthUnits: 'pixels', getWidth: 10,
        getColor: rgba(c.dark, 245), capRounded: true, jointRounded: true }),
      new ScatterplotLayer({ id: 'd-bld', data: drive.buildings, getPosition: (b) => [b.lon, b.lat], radiusUnits: 'pixels',
        getRadius: (b) => (Math.abs(b.s - s) <= PASS_M ? 6 : 3.5), getFillColor: (b) => statusColor(mode, b.status, b.status === 'matched' ? 140 : 255),
        stroked: true, lineWidthUnits: 'pixels', getLineWidth: (b) => (Math.abs(b.s - s) <= PASS_M ? 2 : 0), getLineColor: rgba(c.ink, 255),
        updateTriggers: { getRadius: s, getLineWidth: s } }),
      new ScatterplotLayer({ id: 'd-lamp-halo', data: drive.assets.filter((a) => a.type === 'streetlight'), getPosition: (a) => [a.lon, a.lat], radiusUnits: 'pixels',
        getRadius: 16, getFillColor: rgba(c.sodiumGlow, mode === 'night' ? 60 : 35) }),
      new ScatterplotLayer({ id: 'd-lamp', data: drive.assets.filter((a) => a.type === 'streetlight'), getPosition: (a) => [a.lon, a.lat], radiusUnits: 'pixels',
        getRadius: 3.5, getFillColor: mode === 'night' ? [255, 244, 224, 255] : rgba(c.sodium, 255) }),
      new PolygonLayer({ id: 'd-wedge', data: [wedge], getPolygon: (d) => d, getFillColor: rgba(c.sodium, 55), stroked: false }),
      new ScatterplotLayer({ id: 'd-cam', data: [at], getPosition: (p) => [p[1], p[0]], radiusUnits: 'pixels', getRadius: 7, getFillColor: rgba(c.sodium, 255),
        stroked: true, lineWidthUnits: 'pixels', getLineWidth: 2.5, getLineColor: rgba(c.bg0, 255) }),
    ] })
  }, [overlay, mode, s, heading, at[0], at[1]]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export type { D }
