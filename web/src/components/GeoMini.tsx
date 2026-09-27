/** A small plan of the area drawn from our own geometry (P5): street lines, a highlighted street, points (with an
 *  optional uncertainty circle), and lines such as dark stretches. Pure SVG in the design tokens, so it follows Night /
 *  Daylight and costs no second Google Map instance (D3 / D21). North is up; a scale bar gives metres. */
import { useMemo } from 'react'

export type Tone = 'sodium' | 'matched' | 'discrepancy' | 'no_record' | 'review' | 'ink' | 'drop'
export interface MiniPoint { lat: number; lon: number; tone?: Tone; r_m?: number | null; dashed?: boolean; label?: string; pulse?: boolean; hollow?: boolean }
export interface MiniLine { coords: [number, number][]; tone?: 'dark' | 'sodium' | 'drop' }
/** a building outline ([lat, lon] ring); `hl` = the one the sentence is about */
export interface MiniPolygon { ring: [number, number][]; hl?: boolean; label?: string }
/** a camera looking in a direction: drawn as a wedge `fov` wide and `len_m` long (a line when fov is 0) */
export interface MiniRay { lat: number; lon: number; heading: number; fov?: number; len_m?: number; hl?: boolean; to?: { lat: number; lon: number } }
export interface MiniStreet { name: string; geometry: GeoJSON.MultiLineString | GeoJSON.LineString | null }

const TONE: Record<Tone, string> = {
  sodium: 'var(--ns-sodium)', matched: 'var(--ns-matched)', discrepancy: 'var(--ns-discrepancy)', no_record: 'var(--ns-no-record)',
  review: 'var(--ns-review)', ink: 'var(--ns-ink2)', drop: 'var(--ns-ink3)',
}
const SCALES = [10, 20, 50, 100, 200, 500, 1000, 2000]

const linesOf = (g: MiniStreet['geometry']): [number, number][][] =>
  !g ? [] : g.type === 'LineString' ? [g.coordinates as [number, number][]] : (g.coordinates as [number, number][][])   // [lon, lat]

/** D36: the top and bottom bands hold the N and scale plates; nothing is fitted into them, so they never cover the object */
const BAND = 30

export function GeoMini({ streets, highlight, points = [], lines = [], polygons = [], rays = [], fit = 'items', height = 220, label, minSpanM = 160, className, lit, frame, streetLabel = true }: {
  streets: MiniStreet[]; highlight?: string | null; points?: MiniPoint[]; lines?: MiniLine[]; fit?: 'area' | 'items'
  polygons?: MiniPolygon[]; rays?: MiniRay[]
  height?: number; label: string; minSpanM?: number; className?: string
  /** draw every street as an analysed (lit) road */
  lit?: boolean
  /** fit exactly these places (e.g. the object and its cameras) instead of every item */
  frame?: { lat: number; lon: number }[]
  /** write the highlighted street's name along it (default on) */
  streetLabel?: boolean
}) {
  const W = 480, H = height
  const geo = useMemo(() => {
    const all = streets.flatMap((s) => linesOf(s.geometry).flat())
    const hl = highlight ? streets.filter((s) => s.name === highlight).flatMap((s) => linesOf(s.geometry).flat()) : []
    const items: [number, number][] = [...points.map((p) => [p.lon, p.lat] as [number, number]), ...lines.flatMap((l) => l.coords.map(([la, lo]) => [lo, la] as [number, number])), ...hl,
      ...rays.map((r) => [r.lon, r.lat] as [number, number]), ...rays.filter((r) => r.to).map((r) => [r.to!.lon, r.to!.lat] as [number, number]),
      ...polygons.filter((g) => g.hl).flatMap((g) => g.ring.map(([la, lo]) => [lo, la] as [number, number]))]
    const framed = frame?.map((p) => [p.lon, p.lat] as [number, number]) ?? []
    const basis = framed.length ? framed : fit === 'items' && items.length ? items : all.length ? all : items
    if (!basis.length) return null
    const lat0 = basis.reduce((a, p) => a + p[1], 0) / basis.length
    const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540
    const xs = basis.map((p) => p[0] * kx), ys = basis.map((p) => p[1] * ky)
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
    const extra = fit === 'items' ? Math.max(0, ...points.map((p) => p.r_m ?? 0)) : 0
    x0 -= extra; x1 += extra; y0 -= extra; y1 += extra
    // fit into the middle band only (the corners' plates sit in the top and bottom bands)
    const iw = W - 24, ih = Math.max(40, H - 2 * BAND)
    const w = Math.max(x1 - x0, minSpanM) * 1.15, h = Math.max(y1 - y0, (minSpanM * ih) / iw) * 1.15
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
    const k = Math.min(iw / w, ih / h)
    const sx = (lon: number) => W / 2 + (lon * kx - cx) * k
    const sy = (lat: number) => H / 2 - (lat * ky - cy) * k
    return { sx, sy, k }
  }, [streets, highlight, points, lines, polygons, rays, fit, H, minSpanM, frame])
  if (!geo) return <div className="t-small ink3 p-3">No geometry to draw.</div>
  const { sx, sy, k } = geo
  const path = (ls: [number, number][][]) => ls.map((l) => l.map(([lo, la], i) => `${i ? 'L' : 'M'}${sx(lo).toFixed(1)} ${sy(la).toFixed(1)}`).join('')).join('')
  const bar = SCALES.find((m) => m * k >= 44) ?? SCALES[SCALES.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`w-full rounded-[var(--ns-r-control)] ${className ?? ''}`} role="img" aria-label={label}
      style={{ background: 'var(--ns-bg0)', boxShadow: 'inset 0 0 0 1px var(--ns-line)' }}>
      {polygons.map((g, i) => (
        <polygon key={`g${i}`} points={g.ring.map(([la, lo]) => `${sx(lo).toFixed(1)},${sy(la).toFixed(1)}`).join(' ')}
          fill={g.hl ? 'var(--ns-sodium-soft)' : 'var(--ns-line)'} stroke={g.hl ? 'var(--ns-sodium)' : 'var(--ns-ink3)'} strokeWidth={g.hl ? 1.8 : 0.9} />
      ))}
      {rays.map((r, i) => {
        const x = sx(r.lon), y = sy(r.lat)
        if (r.to) return <path key={`r${i}`} d={`M${x} ${y}L${sx(r.to.lon)} ${sy(r.to.lat)}`} stroke="var(--ns-sodium)" strokeWidth="1.6" strokeDasharray="5 4" />
        const len = (r.len_m ?? 22) * k, f = ((r.fov ?? 90) * Math.PI) / 360
        const pt = (a: number) => `${x + len * Math.sin(a)} ${y - len * Math.cos(a)}`
        const h = (r.heading * Math.PI) / 180
        return (r.fov ?? 90) > 0
          ? <path key={`r${i}`} d={`M${x} ${y}L${pt(h - f)}A${len} ${len} 0 0 1 ${pt(h + f)}Z`} fill="var(--ns-sodium)" fillOpacity={r.hl ? 0.22 : 0.1} stroke="var(--ns-sodium)" strokeOpacity=".7" strokeWidth=".9" />
          : <path key={`r${i}`} d={`M${x} ${y}L${pt(h)}`} stroke="var(--ns-sodium)" strokeWidth="1.6" />
      })}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {streets.map((s) => lit ? (
          <g key={s.name}><path d={path(linesOf(s.geometry))} stroke="var(--ns-sodium-glow)" strokeOpacity=".3" strokeWidth={7} />
            <path d={path(linesOf(s.geometry))} stroke="var(--ns-sodium)" strokeWidth={2.4} /></g>
        ) : <path key={s.name} d={path(linesOf(s.geometry))} stroke="var(--ns-line-strong)" strokeWidth={2} />)}
        {highlight && streets.filter((s) => s.name === highlight).map((s) => (
          <g key={`h-${s.name}`}>
            <path d={path(linesOf(s.geometry))} stroke="var(--ns-sodium-glow)" strokeOpacity=".35" strokeWidth={9} />
            <path d={path(linesOf(s.geometry))} stroke="var(--ns-sodium)" strokeWidth={3.2} />
          </g>
        ))}
        {lines.map((l, i) => {
          const d = path([l.coords.map(([la, lo]) => [lo, la] as [number, number])])
          return l.tone === 'dark' ? (
            <g key={`l${i}`}><path d={d} stroke="var(--ns-dark-edge)" strokeWidth={10} /><path d={d} stroke="var(--ns-dark)" strokeWidth={7} /></g>
          ) : <path key={`l${i}`} d={d} stroke={l.tone === 'drop' ? 'var(--ns-ink3)' : 'var(--ns-sodium)'} strokeWidth={3.5} strokeDasharray={l.tone === 'drop' ? '5 4' : undefined} />
        })}
      </g>
      {points.map((p, i) => {
        const c = TONE[p.tone ?? 'sodium']
        const x = sx(p.lon), y = sy(p.lat)
        return (
          <g key={`p${i}`}>
            {p.r_m != null && p.r_m > 0 && <circle cx={x} cy={y} r={Math.max(3, p.r_m * k)} fill={c} fillOpacity=".12" stroke={c} strokeWidth="1.2" strokeDasharray={p.dashed ? '4 3' : undefined} />}
            {p.pulse && <circle cx={x} cy={y} r="7" fill="none" stroke={c} strokeWidth="2" className="gc-pulse" />}
            <circle cx={x} cy={y} r={p.hollow ? 5 : 5.5} fill={p.hollow ? 'var(--ns-bg0)' : c} stroke={p.hollow ? c : 'var(--ns-bg0)'} strokeWidth={p.hollow ? 2 : 1.8} />
            {p.label && <text x={x + 9} y={y + 4} fontSize="12.5" fill="var(--ns-ink2)" fontFamily="var(--ns-mono)" paintOrder="stroke" stroke="var(--ns-bg0)" strokeWidth="3">{p.label}</text>}
          </g>
        )
      })}
      {streetLabel && highlight && <StreetName name={highlight} lines={streets.filter((s) => s.name === highlight).flatMap((s) => linesOf(s.geometry))}
        sx={sx} sy={sy} W={W} H={H} avoid={[...points.map((p) => [sx(p.lon), sy(p.lat)]), ...rays.map((r) => [sx(r.lon), sy(r.lat)])] as [number, number][]} />}
      {/* F13: scale and north on their own plate, drawn last, so no label or line runs through them */}
      <ScalePlate x={8} y={H - 26} barPx={bar * k} label={bar >= 1000 ? `${bar / 1000} km` : `${bar} m`} />
      <NorthPlate x={W - 24} y={6} />
    </svg>
  )
}

/** F13: the scale bar with its label on a small plate (page colour, hairline edge): readable over any line or label */
export function ScalePlate({ x, y, barPx, label }: { x: number; y: number; barPx: number; label: string }) {
  const w = 6 + barPx + 6 + label.length * 7.4 + 6
  return (
    <g aria-hidden>
      <rect x={x} y={y} width={w} height={20} rx={3} fill="var(--ns-bg0)" fillOpacity=".9" stroke="var(--ns-line)" />
      <path d={`M${x + 6} ${y + 14}h${barPx}M${x + 6} ${y + 10}v8M${x + 6 + barPx} ${y + 10}v8`} stroke="var(--ns-ink2)" strokeWidth="1.5" />
      <text x={x + 12 + barPx} y={y + 14.5} fill="var(--ns-ink2)" fontSize="11.5" fontFamily="var(--ns-mono)">{label}</text>
    </g>
  )
}

export function NorthPlate({ x, y }: { x: number; y: number }) {
  return (
    <g aria-hidden>
      <rect x={x} y={y} width={18} height={32} rx={3} fill="var(--ns-bg0)" fillOpacity=".9" stroke="var(--ns-line)" />
      <text x={x + 9} y={y + 13} fill="var(--ns-ink2)" fontSize="11.5" fontFamily="var(--ns-mono)" textAnchor="middle">N</text>
      <path d={`M${x + 9} ${y + 16}v12`} stroke="var(--ns-ink2)" strokeWidth="1.5" />
    </g>
  )
}

/** D36: the street's name, written where it runs through the middle band and farthest from the object and cameras */
function StreetName({ name, lines, sx, sy, W, H, avoid }: { name: string; lines: [number, number][][]; sx: (lon: number) => number
  sy: (lat: number) => number; W: number; H: number; avoid: [number, number][] }) {
  const tw = name.length * 6.6
  let best: { x: number; y: number; score: number } | null = null
  for (const l of lines) {
    for (let i = 1; i < l.length; i++) {
      for (let t = 0; t <= 1; t += 0.25) {
        const x = sx(l[i - 1][0] + (l[i][0] - l[i - 1][0]) * t), y = sy(l[i - 1][1] + (l[i][1] - l[i - 1][1]) * t)
        if (x < 10 || x + tw > W - 30 || y < BAND + 10 || y > H - BAND - 4) continue
        const clear = Math.min(80, ...avoid.map(([ax, ay]) => Math.hypot(ax - (x + tw / 2), ay - y)))
        const score = clear - Math.abs(x + tw / 2 - W / 2) * 0.05
        if (!best || score > best.score) best = { x, y, score }
      }
    }
  }
  if (!best) return null
  return <text x={best.x + 4} y={best.y - 7} fontSize="12" fill="var(--ns-ink)" fontFamily="var(--ns-sans)" paintOrder="stroke"
    stroke="var(--ns-bg0)" strokeWidth="3.5" strokeLinejoin="round">{name}</text>
}
