/** D39: THE mini-map. Every small plan in the app is this one component, drawn from our own data (SVG, design tokens,
 *  Night / Daylight; no second Google map, no Street View image, so D3 / D21 memory limits hold).
 *
 *  Always drawn: the roads around (OpenStreetMap, faint, from /areas/{slug}/minimap), the analysed streets, building
 *  outlines near what is shown, north and a scale bar in the corners (never over content), and a legend under the plan
 *  built from whatever is drawn (with counts). Sizes are real pixels: the drawing is re-laid out for the width it gets,
 *  so labels stay 12 px whether the plan is 250 or 740 px wide.
 *
 *  Labels (declutter rule): markers never carry their own text. At most MAX_LABELS labels are written on the plan, in
 *  priority order: the key measurement (e.g. "11 m" between two camera stops), explicit callouts, the highlighted
 *  street's name (+ length), other analysed streets, one neighbouring road. Each is tried at several offsets and is
 *  dropped when it would overlap a marker, another label or the corner plates. Everything else is in the legend and in
 *  the tooltip shown on hover / keyboard focus. */
import { useQuery } from '@tanstack/react-query'
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '@/api/client'
import { useBuildings } from '@/api/queries'
import { placeMapLabels, type Rect } from '@/lib/labelLayout'

export type Tone = 'sodium' | 'matched' | 'discrepancy' | 'no_record' | 'review' | 'ink' | 'drop' | 'pole' | 'sign'
export type Shape = 'dot' | 'ring' | 'tick' | 'x' | 'diamond'
type LL = { lat: number; lon: number }

export interface MiniPoint {
  lat: number; lon: number; tone?: Tone; shape?: Shape
  /** kept for older callers: a hollow ring (= shape 'ring') */
  hollow?: boolean
  /** uncertainty circle (m); dashed = approximate */
  r_m?: number | null; dashed?: boolean; pulse?: boolean
  /** legend entry this marker belongs to (grouped and counted) */
  legend?: string
  /** hover / focus text */
  tip?: string
  /** heading of a tick (degrees): a camera stop's tick lies along its photo direction, i.e. across the road */
  heading?: number
  /** @deprecated markers carry no text (D39); treated as the tooltip */
  label?: string
}
export interface MiniLine { coords: [number, number][]; tone?: 'dark' | 'sodium' | 'drop' | 'sight'; legend?: string; tip?: string
  /** write the line's length on the plan (a measurement label) */
  measure?: boolean
  /** the measurement's text when a recorded value must be shown instead of the drawn length */
  measureText?: string }
/** a building outline ([lat, lon] ring); `hl` = the one the sentence is about; `tone` = fill by register status */
export interface MiniPolygon { ring: [number, number][]; hl?: boolean; tone?: 'matched' | 'discrepancy' | 'no_record' | 'unclassified'; legend?: string; tip?: string
  /** @deprecated treated as the tooltip */
  label?: string }
/** a camera looking in a direction: a wedge `fov` wide and `len_m` long; with `to`, a dashed line of sight instead */
export interface MiniRay { lat: number; lon: number; heading: number; fov?: number; len_m?: number; hl?: boolean; to?: LL; drop?: boolean; legend?: string; tip?: string }
export interface MiniStreet { name: string; geometry: GeoJSON.MultiLineString | GeoJSON.LineString | null; length_m?: number | null }
/** an explicit label on the plan (counts towards MAX_LABELS) */
export interface MiniCallout { lat: number; lon: number; text: string }
/** a dimension line between two places with its distance written on it ("11 m") — the key measurement */
export interface MiniMeasure { a: LL; b: LL; text?: string }

interface Ctx { roads: { name: string | null; type: string | null; lines: [number, number][][] }[]; roads_available: boolean
  stops: { lat: number; lon: number; street: string | null; headings: number[] }[]; stops_available: boolean }

/** roads around the area (or a job's stretch) and the run's camera stops (one request each, cached) */
export const useMiniContext = (path: string | null | undefined) =>
  useQuery({ queryKey: ['minimap', path], queryFn: () => api<Ctx>(path!), enabled: !!path,
    staleTime: (q) => (q.state.data?.roads_available ? Infinity : 120_000), retry: false })

const TONE: Record<Tone, string> = {
  sodium: 'var(--ns-sodium)', matched: 'var(--ns-matched)', discrepancy: 'var(--ns-discrepancy)', no_record: 'var(--ns-no-record)',
  review: 'var(--ns-review)', ink: 'var(--ns-ink2)', drop: 'var(--ns-ink3)', pole: 'var(--ns-ink2)', sign: 'var(--ns-ink)',
}
const POLY_TONE = { matched: 'var(--ns-matched)', discrepancy: 'var(--ns-discrepancy)', no_record: 'var(--ns-no-record)', unclassified: 'var(--ns-unclassified)' }
const SCALES = [2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]
const BAND = 30                        // top / bottom bands hold the N and scale plates; nothing is fitted into them
const MAX_LABELS = 3
const FONT = 12
const NEAR_OUTLINE_M = 25              // auto outlines: buildings this far outside the visible plan are skipped

const linesOf = (g: MiniStreet['geometry']): [number, number][][] =>
  !g ? [] : g.type === 'LineString' ? [g.coordinates as [number, number][]] : (g.coordinates as [number, number][][])   // [lon, lat]
export const metres = (a: LL, b: LL) => Math.hypot((b.lon - a.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180), (b.lat - a.lat) * 110540)
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`)

let ctx2d: CanvasRenderingContext2D | null | undefined
function textW(s: string, px = FONT) {
  if (ctx2d === undefined) ctx2d = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  if (ctx2d) { ctx2d.font = `500 ${px}px Inter, Geist, system-ui, sans-serif`; return ctx2d.measureText(s).width + 2 }
  return s.length * px * 0.56
}

/** swatch drawn in the legend (and nowhere else) */
export type Sw = { t: 'point'; tone: Tone; shape: Shape } | { t: 'line'; color: string; w: number; dash?: string } | { t: 'dark' }
  | { t: 'poly'; fill: string; stroke: string } | { t: 'ray' } | { t: 'street' } | { t: 'road' } | { t: 'circle'; dashed?: boolean }

export function GeoMini({ streets = [], highlight, highlightText, points = [], lines = [], polygons = [], rays = [], callouts = [], measure,
  fit = 'items', height = 220, label, minSpanM = 160, className, lit, frame, streetLabel = true, area, contextPath, outlines, stops, legendExtra = [], caption, legend = true }: {
  streets?: MiniStreet[]; highlight?: string | null
  /** the highlighted street's label (default: its name, plus its length when known) */
  highlightText?: string
  points?: MiniPoint[]; lines?: MiniLine[]; polygons?: MiniPolygon[]; rays?: MiniRay[]
  callouts?: MiniCallout[]; measure?: MiniMeasure | null
  fit?: 'area' | 'items'; height?: number; label: string; minSpanM?: number; className?: string
  /** draw every analysed street lit (sodium) */
  lit?: boolean
  /** fit exactly these places (e.g. the object and its cameras) */
  frame?: LL[]
  /** write the highlighted street's name on the plan (default on) */
  streetLabel?: boolean
  /** the area: loads the roads around it, and (with outlines="auto") its building outlines */
  area?: string | null
  /** where the roads / stops come from instead of the area's (the Jobs page: /jobs/{id}/minimap) */
  contextPath?: string | null
  /** "auto": the area's building outlines within the plan are drawn (unless given in `polygons`) */
  outlines?: 'auto'
  /** the run's camera stops as small ticks: every stop, or only a street's */
  stops?: 'all' | { street: string }
  legendExtra?: { label: string; sw: Sw; count?: number }[]
  caption?: ReactNode
  legend?: boolean
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(480)
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const set = () => { const w = Math.round(el.getBoundingClientRect().width); if (w > 40) setW(w) }
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const H = height
  const ctx = useMiniContext(contextPath ?? (area ? `/areas/${area}/minimap` : null)).data
  const B = useBuildings(outlines === 'auto' ? area ?? null : null).data
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)

  const geo = useMemo(() => {
    const all = streets.flatMap((s) => linesOf(s.geometry).flat())
    const hl = highlight ? streets.filter((s) => s.name === highlight).flatMap((s) => linesOf(s.geometry).flat()) : []
    // what the plan is about: its own items; the highlighted street only frames the plan when nothing else is drawn
    // (an example's camera stop must not shrink to a speck because its whole street is highlighted)
    const own: [number, number][] = [...points.map((p) => [p.lon, p.lat] as [number, number]),
      ...lines.flatMap((l) => l.coords.map(([la, lo]) => [lo, la] as [number, number])),
      ...rays.map((r) => [r.lon, r.lat] as [number, number]), ...rays.filter((r) => r.to).map((r) => [r.to!.lon, r.to!.lat] as [number, number]),
      ...polygons.filter((g) => g.hl).flatMap((g) => g.ring.map(([la, lo]) => [lo, la] as [number, number])),
      ...(measure ? [[measure.a.lon, measure.a.lat], [measure.b.lon, measure.b.lat]] as [number, number][] : [])]
    const items = own.length ? own : hl
    const framed = frame?.map((p) => [p.lon, p.lat] as [number, number]) ?? []
    const basis = framed.length ? framed : fit === 'items' && items.length ? items : all.length ? all : items
    if (!basis.length) return null
    const lat0 = basis.reduce((a, p) => a + p[1], 0) / basis.length
    const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540
    const xs = basis.map((p) => p[0] * kx), ys = basis.map((p) => p[1] * ky)
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
    const extra = fit === 'items' ? Math.max(0, ...points.map((p) => p.r_m ?? 0)) : 0
    x0 -= extra; x1 += extra; y0 -= extra; y1 += extra
    const iw = W - 24, ih = Math.max(40, H - 2 * BAND)
    const w = Math.max(x1 - x0, minSpanM) * 1.15, h = Math.max(y1 - y0, (minSpanM * ih) / iw) * 1.15
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
    const k = Math.min(iw / w, ih / h)
    const sx = (lon: number) => W / 2 + (lon * kx - cx) * k
    const sy = (lat: number) => H / 2 - (lat * ky - cy) * k
    // what the plan covers, in lat/lon (to pick the outlines, roads and stops worth drawing)
    const view = { w: (cx - W / 2 / k) / kx, e: (cx + W / 2 / k) / kx, s: (cy - H / 2 / k) / ky, n: (cy + H / 2 / k) / ky }
    return { sx, sy, k, view, kx, ky }
  }, [streets, highlight, points, lines, polygons, rays, fit, H, W, minSpanM, frame, measure])

  // ---------------------------------------------------------------- context: outlines, stops, roads
  const inView = (la: number, lo: number, padM = 0) => !!geo && la >= geo.view.s - padM / 110540 && la <= geo.view.n + padM / 110540
    && lo >= geo.view.w - padM / geo.kx * 1 && lo <= geo.view.e + padM / geo.kx * 1
  const autoPolys = useMemo<MiniPolygon[]>(() => {
    if (outlines !== 'auto' || !B || !geo) return []
    const given = new Set(polygons.map((p) => `${p.ring[0]?.[0]},${p.ring[0]?.[1]}`))
    return B.filter((b) => (b.footprint?.polygon_latlon?.length ?? 0) >= 3 && inView(b.lat, b.lon, NEAR_OUTLINE_M))
      .map((b) => ({ ring: b.footprint!.polygon_latlon as [number, number][], legend: 'building outline',
        tip: b.attributes?.name?.value ? `${b.attributes.name.value} (building)` : 'building outline' }))
      .filter((p) => !given.has(`${p.ring[0]?.[0]},${p.ring[0]?.[1]}`)).slice(0, 500)
  }, [outlines, B, geo, polygons]) // eslint-disable-line react-hooks/exhaustive-deps
  const stopPts = useMemo<MiniPoint[]>(() => {
    if (!stops || !ctx?.stops || !geo) return []
    return ctx.stops.filter((s) => (stops === 'all' || s.street === stops.street) && inView(s.lat, s.lon, 10))
      .map((s) => ({ lat: s.lat, lon: s.lon, shape: 'tick' as const, tone: 'ink' as const, heading: s.headings[0], legend: 'camera stop',
        tip: `camera stop${s.street ? ` on ${s.street}` : ''}` }))
  }, [stops, ctx, geo]) // eslint-disable-line react-hooks/exhaustive-deps
  const roads = useMemo(() => {
    if (!ctx?.roads || !geo) return []
    return ctx.roads.filter((r) => r.lines.some((l) => l.some(([la, lo]) => inView(la, lo, 60))))
  }, [ctx, geo]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!geo) return <div className="t-small ink3 p-3">No geometry to draw.</div>
  const { sx, sy, k } = geo
  const path = (ls: [number, number][][]) => ls.map((l) => l.map(([lo, la], i) => `${i ? 'L' : 'M'}${sx(lo).toFixed(1)} ${sy(la).toFixed(1)}`).join('')).join('')
  const pathLL = (ls: [number, number][][]) => path(ls.map((l) => l.map(([la, lo]) => [lo, la] as [number, number])))
  const bar = SCALES.find((m) => m * k >= 44) ?? SCALES[SCALES.length - 1]
  const barLabel = bar >= 1000 ? `${bar / 1000} km` : `${bar} m`
  const allPoints = [...stopPts, ...points]
  // markers shrink when the plan is zoomed out (many markers along a whole street), full size close up
  const mk = k < 0.6 ? 0.55 : k < 1.5 ? 0.75 : 1
  const allPolys = [...autoPolys, ...polygons]
  const lenOf = (s: MiniStreet) => s.length_m ?? null

  // ---------------------------------------------------------------- labels (declutter)
  const scaleW = 6 + bar * k + 6 + textW(barLabel, 11.5) + 6
  // obstacles: the corner plates and every marker; labels are requested in priority order (placeMapLabels)
  const occupied: Rect[] = [{ x: W - 30, y: 0, w: 30, h: 42 }, { x: 0, y: H - 32, w: scaleW + 12, h: 32 }]
  for (const p of allPoints) {
    const r = p.shape === 'tick' ? 4 : Math.max(6 * mk, p.r_m ? Math.min(40, p.r_m * k) : 0)      // uncertainty circles too
    occupied.push({ x: sx(p.lon) - r, y: sy(p.lat) - r, w: 2 * r, h: 2 * r })
  }
  for (const r of rays) occupied.push({ x: sx(r.lon) - 6, y: sy(r.lat) - 6, w: 12, h: 12 })
  const reqs: { text: string; cands: [number, number][]; strong?: boolean }[] = []
  const tryPlace = (cands: [number, number][], text: string, strong?: boolean) => { reqs.push({ cands, text, strong }) }
  const around = (x: number, y: number, text: string): [number, number][] => {
    const w = textW(text)
    return [[x + 9, y - 7], [x + 9, y + 14], [x - 9 - w, y - 7], [x - 9 - w, y + 14], [x - w / 2, y - 11], [x - w / 2, y + 20], [x + 9, y + 4], [x - 9 - w, y + 4]]
  }
  const alongLine = (ls: [number, number][][], text: string): [number, number][] => {
    const w = textW(text), out: { x: number; y: number; s: number }[] = []
    const avoid = allPoints.map((p) => [sx(p.lon), sy(p.lat)])
    // base spots evenly along the whole line (>= 14 px apart), so a free stretch anywhere can take the name
    let px = -1e9, py = -1e9
    for (const l of ls) for (let i = 1; i < l.length; i++) for (let t = 0; t <= 1; t += 0.25) {
      const x = sx(l[i - 1][0] + (l[i][0] - l[i - 1][0]) * t), y = sy(l[i - 1][1] + (l[i][1] - l[i - 1][1]) * t)
      if (y < BAND || y > H - BAND || x < 0 || x > W) continue
      if (Math.hypot(x - px, y - py) < 14) continue
      px = x; py = y
      const clear = Math.min(60, ...avoid.map(([ax, ay]) => Math.hypot(ax - (x + w / 2), ay - y)))
      const s = clear - Math.abs(x + w / 2 - W / 2) * 0.04
      out.push({ x: x + 4, y: y - 9, s }, { x: x + 4, y: y + 19, s: s - 1 }, { x: x - w / 2, y: y - 9, s: s - 2 },
        { x: x + 4, y: y - 17, s: s - 3 }, { x: x - w / 2, y: y + 25, s: s - 4 },
        { x: x + 16, y: y + 4, s: s - 5 }, { x: x - w - 16, y: y + 4, s: s - 6 }, { x: x + 28, y: y + 4, s: s - 7 }, { x: x - w - 28, y: y + 4, s: s - 8 })
    }
    return out.sort((a, b) => b.s - a.s).map((c) => [c.x, c.y])
  }
  // 1. the key measurement
  let measureLine: { x1: number; y1: number; x2: number; y2: number } | null = null
  if (measure) {
    const x1 = sx(measure.a.lon), y1 = sy(measure.a.lat), x2 = sx(measure.b.lon), y2 = sy(measure.b.lat)
    measureLine = { x1, y1, x2, y2 }
    const text = measure.text ?? fmtM(metres(measure.a, measure.b))
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
    tryPlace(around(mx, my, text), text, true)
  }
  for (const l of lines.filter((x) => x.measure)) {
    const c = l.coords, len = c.slice(1).reduce((a, p, i) => a + metres({ lat: c[i][0], lon: c[i][1] }, { lat: p[0], lon: p[1] }), 0)
    const m = c[Math.floor(c.length / 2)], m0 = c[Math.max(0, Math.floor(c.length / 2) - 1)]
    const text = l.measureText ?? fmtM(len)
    tryPlace(around((sx(m[1]) + sx(m0[1])) / 2, (sy(m[0]) + sy(m0[0])) / 2, text), text, true)
  }
  // 2. explicit callouts
  for (const c of callouts) tryPlace(around(sx(c.lon), sy(c.lat), c.text), c.text)
  // 3. the highlighted street (name + length)
  const hs = highlight ? streets.filter((s) => s.name === highlight) : []
  if (streetLabel && hs.length) {
    const len = hs.map(lenOf).find((x) => x != null)
    const text = highlightText ?? (len ? `${highlight} · ${fmtM(len)}` : highlight!)
    tryPlace(alongLine(hs.flatMap((s) => linesOf(s.geometry)), text), text, true)
  }
  // 3b. no street highlighted: name the analysed street nearest the middle of the plan (every plan names its street)
  if (streetLabel && !hs.length && !lit && streets.length) {
    const near = streets.map((s) => ({ s, d: Math.min(...linesOf(s.geometry).flat().map(([lo, la]) => Math.hypot(sx(lo) - W / 2, sy(la) - H / 2))) }))
      .sort((a, b) => a.d - b.d)[0]
    if (near && near.d < Math.max(W, H)) tryPlace(alongLine(linesOf(near.s.geometry), near.s.name), near.s.name, true)
  }
  // 4. other analysed streets when all are lit (longest first), 5. one neighbouring road
  if (lit && !highlight) {
    for (const s of [...streets].sort((a, b) => (lenOf(b) ?? 0) - (lenOf(a) ?? 0))) {
      const len = lenOf(s), text = len ? `${s.name} · ${fmtM(len)}` : s.name
      tryPlace(alongLine(linesOf(s.geometry), text), text)
    }
  }
  const named = new Set(streets.map((s) => s.name))
  const neighbour = roads.filter((r) => r.name && !named.has(r.name))
    .map((r) => ({ r, len: r.lines.reduce((a, l) => a + l.filter(([la, lo]) => inView(la, lo)).length, 0) }))
    .sort((a, b) => b.len - a.len)[0]?.r
  if (neighbour?.name) tryPlace(alongLine(neighbour.lines.map((l) => l.map(([la, lo]) => [lo, la] as [number, number])), neighbour.name), neighbour.name)
  const placed = placeMapLabels(reqs, occupied, W, H, (t) => textW(t), MAX_LABELS, FONT)

  // ---------------------------------------------------------------- legend (whatever is drawn, with counts)
  const leg = new Map<string, { sw: Sw; n: number }>()
  const add = (name: string | undefined, sw: Sw, n = 1) => { if (!name) return; const e = leg.get(name); if (e) e.n += n; else leg.set(name, { sw, n }) }
  if (hs.length) add(streets.length > 1 || roads.length ? 'this street' : 'the street', { t: 'street' })
  else if (lit && streets.length) add(streets.length > 1 ? 'analysed streets' : 'analysed street', { t: 'street' }, streets.length)
  for (const p of allPoints) add(p.legend, { t: 'point', tone: p.tone ?? 'sodium', shape: p.shape ?? (p.hollow ? 'ring' : 'dot') })
  if (allPoints.some((p) => p.r_m)) add(allPoints.some((p) => p.r_m && p.dashed) ? 'could be off by (circle)' : 'position uncertainty (circle)', { t: 'circle', dashed: allPoints.some((p) => p.r_m && p.dashed) })
  for (const r of rays) add(r.legend ?? (r.to ? 'line of sight' : 'photo direction'), r.to ? { t: 'line', color: 'var(--ns-sodium)', w: 1.6, dash: '4 3' } : { t: 'ray' })
  for (const l of lines) add(l.legend, l.tone === 'dark' ? { t: 'dark' } : { t: 'line', color: l.tone === 'drop' ? 'var(--ns-ink3)' : 'var(--ns-sodium)', w: l.tone === 'sight' ? 1.6 : 3, dash: l.tone === 'drop' || l.tone === 'sight' ? '4 3' : undefined })
  for (const g of polygons) add(g.legend ?? (g.hl ? 'the building' : 'building outline'),
    g.tone ? { t: 'poly', fill: POLY_TONE[g.tone], stroke: POLY_TONE[g.tone] } : g.hl ? { t: 'poly', fill: 'var(--ns-sodium-soft)', stroke: 'var(--ns-sodium)' } : { t: 'poly', fill: 'var(--ns-line)', stroke: 'var(--ns-ink3)' })
  if (autoPolys.length) add('building outline', { t: 'poly', fill: 'var(--ns-line)', stroke: 'var(--ns-ink3)' }, autoPolys.length)
  if (!hs.length && !lit && streets.length) add('analysed street', { t: 'line', color: 'var(--ns-line-strong)', w: 2.5 }, 0)
  if (roads.length) add('other road', { t: 'road' }, 0)
  for (const e of legendExtra) add(e.label, e.sw, e.count ?? 0)
  const countOf = (name: string, n: number) => n > 1 && !['this street', 'the street', 'other road', 'analysed street', 'photo direction', 'line of sight', 'could be off by (circle)', 'position uncertainty (circle)'].includes(name)

  // ---------------------------------------------------------------- tooltips
  const hover = (text: string | undefined, x: number, y: number) => text ? {
    onPointerEnter: () => setTip({ x, y, text }), onPointerLeave: () => setTip(null),
  } : {}
  const focus = (text: string | undefined, x: number, y: number) => text ? {
    tabIndex: 0, role: 'img', 'aria-label': text, onFocus: () => setTip({ x, y, text }), onBlur: () => setTip(null),
    style: { outline: 'none' } as const,
  } : {}

  const roadPath = (r: Ctx['roads'][number]) => pathLL(r.lines)
  return (
    <figure className={className}>
      <div ref={wrap} className="relative w-full" onPointerLeave={() => setTip(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="block rounded-[var(--ns-r-control)]" role="img" aria-label={label}
          style={{ background: 'var(--ns-bg0)', boxShadow: 'inset 0 0 0 1px var(--ns-line)' }}>
          {/* roads around (OpenStreetMap): faint */}
          <g fill="none" strokeLinecap="round" strokeLinejoin="round">
            {roads.map((r, i) => <path key={`o${i}`} d={roadPath(r)} stroke="var(--ns-line-strong)" strokeOpacity=".7" strokeWidth={['primary', 'secondary', 'trunk'].includes(r.type ?? '') ? 2 : 1.2} />)}
          </g>
          {allPolys.map((g, i) => {
            const c = g.tone ? POLY_TONE[g.tone] : null
            const pts = g.ring.map(([la, lo]) => `${sx(lo).toFixed(1)},${sy(la).toFixed(1)}`).join(' ')
            const [cx, cy] = [g.ring.reduce((a, p) => a + sx(p[1]), 0) / g.ring.length, g.ring.reduce((a, p) => a + sy(p[0]), 0) / g.ring.length]
            const t = g.tip ?? g.label
            return <polygon key={`g${i}`} points={pts} {...hover(t, cx, cy)} {...(g.hl || g.tone ? focus(t, cx, cy) : {})}
              fill={c ?? (g.hl ? 'var(--ns-sodium-soft)' : 'var(--ns-line)')} fillOpacity={c ? 0.45 : 1}
              stroke={c ?? (g.hl ? 'var(--ns-sodium)' : 'var(--ns-ink3)')} strokeOpacity={c || g.hl ? 1 : 0.55} strokeWidth={g.hl ? 1.8 : c ? 1.1 : 0.8} />
          })}
          {/* analysed streets */}
          <g fill="none" strokeLinecap="round" strokeLinejoin="round">
            {streets.map((s) => {
              const d = path(linesOf(s.geometry)), len = lenOf(s)
              const t = `${s.name}${len ? ` · ${fmtM(len)} analysed` : ' (analysed)'}`
              const mid = linesOf(s.geometry)[0]?.[Math.floor((linesOf(s.geometry)[0]?.length ?? 1) / 2)]
              const hv = mid ? hover(t, sx(mid[0]), sy(mid[1])) : {}
              return (
                <g key={s.name}>
                  {lit && s.name !== highlight ? <><path d={d} stroke="var(--ns-sodium-glow)" strokeOpacity=".25" strokeWidth={6} />
                    <path d={d} stroke="var(--ns-sodium)" strokeWidth={2.2} /></>
                    : s.name !== highlight && <path d={d} stroke="var(--ns-ink3)" strokeOpacity=".75" strokeWidth={2.2} />}
                  <path d={d} stroke="transparent" strokeWidth={12} {...hv} />
                </g>
              )
            })}
            {hs.map((s) => (
              <g key={`h-${s.name}`} style={{ pointerEvents: 'none' }}>
                <path d={path(linesOf(s.geometry))} stroke="var(--ns-sodium-glow)" strokeOpacity=".3" strokeWidth={mk < 1 ? 14 : 8} />
                <path d={path(linesOf(s.geometry))} stroke="var(--ns-sodium)" strokeWidth={3} />
              </g>
            ))}
            {lines.map((l, i) => {
              const d = pathLL([l.coords])
              const m = l.coords[Math.floor(l.coords.length / 2)]
              const hv = hover(l.tip, sx(m[1]), sy(m[0]))
              return l.tone === 'dark' ? (
                <g key={`l${i}`} {...hv} {...focus(l.tip, sx(m[1]), sy(m[0]))}><path d={d} stroke="var(--ns-dark-edge)" strokeWidth={10} /><path d={d} stroke="var(--ns-dark)" strokeWidth={7} /></g>
              ) : <path key={`l${i}`} d={d} {...hv} stroke={l.tone === 'drop' ? 'var(--ns-ink3)' : 'var(--ns-sodium)'} strokeWidth={l.tone === 'sight' ? 1.5 : 3.2}
                strokeDasharray={l.tone === 'drop' || l.tone === 'sight' ? '5 4' : undefined} />
            })}
          </g>
          {rays.map((r, i) => {
            const x = sx(r.lon), y = sy(r.lat)
            const col = r.drop ? 'var(--ns-ink3)' : 'var(--ns-sodium)'
            if (r.to) return <path key={`r${i}`} d={`M${x} ${y}L${sx(r.to.lon)} ${sy(r.to.lat)}`} stroke={col} strokeWidth="1.5" strokeDasharray="5 4" fill="none" />
            const len = Math.max(14, (r.len_m ?? 22) * k), f = ((r.fov ?? 90) * Math.PI) / 360
            const pt = (a: number) => `${x + len * Math.sin(a)} ${y - len * Math.cos(a)}`
            const h = (r.heading * Math.PI) / 180
            return (r.fov ?? 90) > 0
              ? <path key={`r${i}`} d={`M${x} ${y}L${pt(h - f)}A${len} ${len} 0 0 1 ${pt(h + f)}Z`} fill={col} fillOpacity={r.hl ? 0.2 : 0.09} stroke={col} strokeOpacity=".7" strokeWidth=".9" {...hover(r.tip, x, y)} />
              : <path key={`r${i}`} d={`M${x} ${y}L${pt(h)}`} stroke={col} strokeWidth="1.5" />
          })}
          {measureLine && (() => {
            const { x1, y1, x2, y2 } = measureLine, a = Math.atan2(y2 - y1, x2 - x1), nx = -Math.sin(a) * 4, ny = Math.cos(a) * 4
            return <path d={`M${x1} ${y1}L${x2} ${y2}M${x1 + nx} ${y1 + ny}L${x1 - nx} ${y1 - ny}M${x2 + nx} ${y2 + ny}L${x2 - nx} ${y2 - ny}`}
              stroke="var(--ns-ink)" strokeWidth="1.2" fill="none" aria-hidden />
          })()}
          {allPoints.map((p, i) => {
            const c = TONE[p.tone ?? 'sodium'], x = sx(p.lon), y = sy(p.lat)
            const shape = p.shape ?? (p.hollow ? 'ring' : 'dot')
            const t = p.tip ?? p.label
            const own = p.legend !== 'camera stop'           // stops are context: hover only, not a tab stop each
            return (
              <g key={`p${i}`} {...hover(t, x, y)} {...(own ? focus(t, x, y) : {})}>
                {p.r_m != null && p.r_m > 0 && <circle cx={x} cy={y} r={Math.max(4, p.r_m * k)} fill={c} fillOpacity=".1" stroke={c} strokeWidth="1.1" strokeDasharray={p.dashed ? '4 3' : undefined} />}
                {p.pulse && <circle cx={x} cy={y} r="6" fill="none" stroke={c} strokeWidth="2" className="gc-pulse" />}
                <Marker x={x} y={y} c={c} shape={shape} heading={p.heading} size={own ? mk : 1} />
                <circle cx={x} cy={y} r="8" fill="transparent" />
              </g>
            )
          })}
          {placed.map((l, i) => (
            <text key={`t${i}`} x={l.x} y={l.y} fontSize={FONT} fontWeight={l.strong ? 600 : 500} fill={l.strong ? 'var(--ns-ink)' : 'var(--ns-ink2)'}
              fontFamily="var(--ns-sans)" paintOrder="stroke" stroke="var(--ns-bg0)" strokeWidth="3.5" strokeLinejoin="round" style={{ pointerEvents: 'none' }}>{l.text}</text>
          ))}
          {/* scale and north on their own plates, drawn last, in the corners */}
          <ScalePlate x={8} y={H - 26} barPx={bar * k} label={barLabel} />
          <NorthPlate x={W - 24} y={6} />
        </svg>
        {tip && (
          <div role="tooltip" className="pointer-events-none absolute z-10 max-w-[240px] rounded-[var(--ns-r-hair)] px-2 py-1 text-[12.5px] leading-snug"
            style={{ left: Math.min(Math.max(4, tip.x + 10), W - 180), top: tip.y > H / 2 ? tip.y - 34 : tip.y + 12,
              background: 'var(--ns-bg2)', color: 'var(--ns-ink)', boxShadow: '0 0 0 1px var(--ns-line-strong), 0 4px 14px rgba(0,0,0,.25)' }}>
            {tip.text}
          </div>
        )}
      </div>
      {legend && leg.size > 0 && (
        <figcaption className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px] leading-tight ink2">
          {[...leg.entries()].map(([name, e]) => (
            <span key={name} className="inline-flex items-center gap-1.5"><Swatch sw={e.sw} />{name}{countOf(name, e.n) ? <span className="ink3 tabular-nums"> {e.n}</span> : null}</span>
          ))}
          {ctx && !ctx.roads_available && <span className="ink3">other roads not loaded (map server busy)</span>}
        </figcaption>
      )}
      {caption && <p className="t-small ink3 mt-1">{caption}</p>}
    </figure>
  )
}

function Marker({ x, y, c, shape, heading, size = 1 }: { x: number; y: number; c: string; shape: Shape; heading?: number; size?: number }) {
  const R = 4.5 * size, D = 5 * size
  if (shape === 'tick') {
    if (heading == null) return <circle cx={x} cy={y} r="2.2" fill={c} />
    const a = (heading * Math.PI) / 180, dx = Math.sin(a) * 4.5, dy = -Math.cos(a) * 4.5
    return <path d={`M${x - dx} ${y - dy}L${x + dx} ${y + dy}`} stroke={c} strokeWidth="1.6" strokeLinecap="round" />
  }
  if (shape === 'x') return <path d={`M${x - D * 0.8} ${y - D * 0.8}L${x + D * 0.8} ${y + D * 0.8}M${x - D * 0.8} ${y + D * 0.8}L${x + D * 0.8} ${y - D * 0.8}`} stroke={c} strokeWidth="2" strokeLinecap="round" />
  if (shape === 'diamond') return <path d={`M${x} ${y - D}L${x + D} ${y}L${x} ${y + D}L${x - D} ${y}Z`} fill="var(--ns-bg0)" stroke={c} strokeWidth="1.8" />
  if (shape === 'ring') return <circle cx={x} cy={y} r={R} fill="var(--ns-bg0)" stroke={c} strokeWidth={size < 1 ? 1.5 : 2} />
  return <circle cx={x} cy={y} r={R} fill={c} stroke="var(--ns-bg0)" strokeWidth={size < 1 ? 1 : 1.5} />
}

export function Swatch({ sw }: { sw: Sw }) {
  const s = { width: 18, height: 12, viewBox: '0 0 18 12', 'aria-hidden': true as const, className: 'shrink-0' }
  switch (sw.t) {
    case 'point': return <svg {...s}><Marker x={9} y={6} c={TONE[sw.tone]} shape={sw.shape} heading={sw.shape === 'tick' ? 0 : undefined} /></svg>
    case 'line': return <svg {...s}><path d="M1 6h16" stroke={sw.color} strokeWidth={sw.w} strokeDasharray={sw.dash} /></svg>
    case 'dark': return <svg {...s}><path d="M1 6h16" stroke="var(--ns-dark-edge)" strokeWidth="8" /><path d="M1 6h16" stroke="var(--ns-dark)" strokeWidth="5" /></svg>
    case 'poly': return <svg {...s}><rect x="3" y="2" width="12" height="8" fill={sw.fill} fillOpacity=".6" stroke={sw.stroke} strokeWidth="1.2" /></svg>
    case 'ray': return <svg {...s}><path d="M2 10L15 3A8 8 0 0 1 16 10Z" fill="var(--ns-sodium)" fillOpacity=".25" stroke="var(--ns-sodium)" strokeWidth=".9" /></svg>
    case 'street': return <svg {...s}><path d="M1 6h16" stroke="var(--ns-sodium)" strokeWidth="3" /></svg>
    case 'road': return <svg {...s}><path d="M1 6h16" stroke="var(--ns-line-strong)" strokeWidth="1.6" /></svg>
    case 'circle': return <svg {...s}><circle cx="9" cy="6" r="5" fill="none" stroke="var(--ns-ink2)" strokeWidth="1.1" strokeDasharray={sw.dashed ? '3 2' : undefined} /></svg>
  }
}

/** the scale bar with its label on a small plate (page colour, hairline edge): readable over any line */
export function ScalePlate({ x, y, barPx, label }: { x: number; y: number; barPx: number; label: string }) {
  const w = 6 + barPx + 6 + textW(label, 11.5) + 6
  return (
    <g aria-hidden style={{ pointerEvents: 'none' }}>
      <rect x={x} y={y} width={w} height={20} rx={3} fill="var(--ns-bg0)" fillOpacity=".9" stroke="var(--ns-line)" />
      <path d={`M${x + 6} ${y + 14}h${barPx}M${x + 6} ${y + 10}v8M${x + 6 + barPx} ${y + 10}v8`} stroke="var(--ns-ink2)" strokeWidth="1.5" />
      <text x={x + 12 + barPx} y={y + 14.5} fill="var(--ns-ink2)" fontSize="11.5" fontFamily="var(--ns-mono)">{label}</text>
    </g>
  )
}

export function NorthPlate({ x, y }: { x: number; y: number }) {
  return (
    <g aria-hidden style={{ pointerEvents: 'none' }}>
      <rect x={x} y={y} width={18} height={32} rx={3} fill="var(--ns-bg0)" fillOpacity=".9" stroke="var(--ns-line)" />
      <text x={x + 9} y={y + 13} fill="var(--ns-ink2)" fontSize="11.5" fontFamily="var(--ns-mono)" textAnchor="middle">N</text>
      <path d={`M${x + 9} ${y + 16}v12`} stroke="var(--ns-ink2)" strokeWidth="1.5" />
    </g>
  )
}
