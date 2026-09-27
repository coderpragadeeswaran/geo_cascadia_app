/** deck.gl layers in the NIGHT SURVEY map language (docs/DESIGN.md "Map language"), by zoom band (CLAUDE.md §9.3):
 *  city   (z < 13.5): analysed areas glow as sodium outlines with a count badge; pulsing dot for running jobs
 *  area   (13.5–16.5): analysed roads lit (sodium glow), every streetlight gap a DARK stretch on top, streetlights glow;
 *                      buildings only as findings points (no record / discrepancy). Poles, matched buildings and
 *                      unmapped businesses appear from street level (declutter rule 8)
 *  street (16.5–18.5) / object (≥ 18.5): footprints extruded by observed floors (no floor count → flat + hatched, never a
 *                      guessed height), poles with uncertainty rings (dashed = approximate), lamps, unmapped rings
 *  Colours come from design/tokens.ts (one palette for CSS and deck.gl). */
import { HexagonLayer } from '@deck.gl/aggregation-layers'
import type { Layer } from '@deck.gl/core'
import { FillStyleExtension, PathStyleExtension } from '@deck.gl/extensions'
import { IconLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { LineString, MultiLineString, MultiPolygon, Point, Polygon } from 'geojson'
import type {
  AnyProps, AreaCard, AreaFeature, AssetProps, Band, BuildingProps, GapProps, Job, MissingProps, StreetProps, UnmappedProps,
} from '@/api/types'
import { colors, rgba, statusColor, type Mode, type RGBA } from '@/design/tokens'
import type { Focus } from '@/lib/derive'
import type { LayerKey } from '@/store/ui'
import { HATCH_MAPPING, ICONS, hatchAtlas } from './icons'
import { plural } from '@/lib/utils'
import { mainLine, pointAt, slice } from './trim'

/** Display scale for extrusion only: observed floors × 3.2 m. Not a measured height. */
export const FLOOR_HEIGHT_M = 3.2

/** lon/lat pair (deck.gl's Position is stricter than GeoJSON's number[]) */
export type Position = [number, number]
type D<P, G> = { p: P } & G
type BuildingD = D<BuildingProps, { polygon: Position[][] }>
type AssetD = D<AssetProps, { position: Position; ring: Position[] }>
export interface Split {
  streets: D<StreetProps, { path: Position[] }>[]
  extruded: BuildingD[]
  unclassified: BuildingD[]
  assets: AssetD[]
  gaps: D<GapProps, { path: Position[] }>[]
  unmapped: D<UnmappedProps, { position: Position }>[]
  missing: D<MissingProps, { position: Position }>[]
  findings: Position[]
}

function ring(lon: number, lat: number, r: number, n = 28): Position[] {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180)
  const out: Position[] = []
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI
    out.push([lon + (r * Math.cos(a)) / kx, lat + (r * Math.sin(a)) / 110540])
  }
  return out
}

/** Split the area GeoJSON once per load (layers then only re-filter/restyle). */
export function splitFeatures(features: AreaFeature[]): Split {
  const s: Split = { streets: [], extruded: [], unclassified: [], assets: [], gaps: [], unmapped: [], missing: [], findings: [] }
  for (const f of features) {
    const p = f.properties
    const g = f.geometry
    switch (p.kind) {
      case 'street': {
        const lines = g.type === 'MultiLineString' ? (g as MultiLineString).coordinates : [(g as LineString).coordinates]
        for (const path of lines) s.streets.push({ p, path: path as Position[] })
        break
      }
      case 'building': {
        if (g.type !== 'Polygon') break
        const d = { p, polygon: (g as Polygon).coordinates as Position[][] }
        ;(p.floors == null ? s.unclassified : s.extruded).push(d)
        if (p.match_status !== 'matched') s.findings.push([p.lon, p.lat])
        break
      }
      case 'pole':
      case 'streetlight': {
        const [lon, lat] = (g as Point).coordinates as Position
        s.assets.push({ p, position: [lon, lat], ring: ring(lon, lat, p.uncertainty_m ?? 3.5) })
        if (p.register_status === 'discrepancy' || p.register_status === 'unrecorded_asset') s.findings.push([lon, lat])
        break
      }
      case 'streetlight_gap':
        s.gaps.push({ p, path: (g as LineString).coordinates as Position[] })   // display path from the API (D13)
        break
      case 'unmapped_business':
        s.unmapped.push({ p, position: (g as Point).coordinates as Position })
        s.findings.push((g as Point).coordinates as Position)
        break
      case 'missing_asset_record':
        s.missing.push({ p, position: (g as Point).coordinates as Position })
        s.findings.push((g as Point).coordinates as Position)
        break
    }
  }
  return s
}

export interface DriveMark { branch: Position[]; at: Position; heading: number; look: number }

export interface LayerCtx {
  mode: Mode
  band: Band
  flat: boolean
  layers: Record<LayerKey, boolean>
  areas: AreaCard[]
  activeArea: string | null
  split: Split | null
  jobs: Job[]
  /** D35 (F1): each running job's overall progress as drawn (0..1, eased toward the API value, never backwards) */
  jobShown?: Record<string, number>
  pulse: number
  selectedId: string | null
  /** filter / query emphasis: everything outside these ids is dimmed (one global store, CLAUDE.md §9.4) */
  focus: Focus
  /** opening: streetlights fade on (0 → 1) */
  lightsOn: number
  /** analyse mode: the exact snapped street line(s) and the job polygon from /jobs/preview */
  analyseLines: Position[][] | null
  analysePoly: Position[][] | null
  /** trimmed: the whole picked street, drawn faint under the kept stretch */
  analyseRest?: Position[][] | null
  /** drive the street: the branch being driven, camera position, travel heading and view heading */
  drive: DriveMark | null
  /** D27: the selected building's predicted position (point + uncertainty radius in metres, null = not estimated) */
  predicted?: { position: Position; radius_m: number | null } | null
}

const dash = new PathStyleExtension({ dash: true })
const hatch = new FillStyleExtension({ pattern: true })
// additive blending at night: overlapping lamp halos brighten like real light
const ADD = { parameters: { blend: true, blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one',
  blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one' } } as object
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return ((h >>> 0) % 1000) / 1000 }
const mix = (a: RGBA, b: RGBA, t: number, al: number): RGBA => [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * t)).concat(al) as RGBA

function outerRings(poly: Polygon | MultiPolygon): Position[][] {
  return (poly.type === 'Polygon' ? [poly.coordinates[0]] : poly.coordinates.map((p) => p[0])) as Position[][]
}

/** street health (optional layer): issues per km, one hue from quiet ink to peony (sequential, docs/DESIGN.md) */
export const HEALTH_STOPS = [0, 10, 20, 40]
export function healthColor(mode: Mode, perKm: number | null | undefined, a = 235): RGBA {
  const c = colors[mode]
  if (perKm == null) return rgba(c.unclassified, 160)
  return mix(rgba(c.ink3), rgba(c.noRecord), Math.min(1, Math.max(0, perKm / 40)), a)
}

/** asset register findings get a status ring (synthetic register): not in register = peony, differs = glacier */
/** status colour for map marks: at night lifted 18 % toward white so the soft v2 dots and footprints read on the dark map */
const mark = (mode: Mode, s: string | null | undefined, a = 255): RGBA => {
  const c = statusColor(mode, s, a)
  return mode === 'night' ? mix(c, [255, 255, 255, a], 0.18, a) : c
}

const assetStatus = (s: string | null | undefined) => (s === 'unrecorded_asset' ? 'no_record' : s === 'discrepancy' ? 'discrepancy' : null)

export function buildLayers(ctx: LayerCtx): Layer[] {
  const { band, flat, layers: on, split, focus: F, mode } = ctx
  const c = colors[mode]
  const night = mode === 'night'
  const fk = F.key
  const dimB = (id: string) => !!F.buildings && !F.buildings.has(id)
  const dimA = (id: string) => !!F.assets && !F.assets.has(id)
  const dimG = (id: string) => !!F.gaps && !F.gaps.has(id)
  const dimU = (id: string) => !!F.unmapped && !F.unmapped.has(id)
  const L: Layer[] = []
  const city = band === 'city'
  const near = band === 'street' || band === 'object'
  const lit = ctx.lightsOn
  const lamp = (id: string) => Math.max(0, Math.min(1, (lit - hash(id) * 0.6) / 0.4))   // staggered fade-on

  // ---------------------------------------------------------------- areas (all bands; strongest at city level)
  const outlines = ctx.areas.flatMap((a) => outerRings(a.polygon).map((path) => ({ a, path })))
  L.push(
    new PathLayer({ id: 'area-glow', data: outlines, getPath: (d) => d.path, widthUnits: 'pixels', getWidth: city ? 14 : near ? 0 : 6,
      getColor: (d) => rgba(c.sodium, d.a.slug === ctx.activeArea ? (city ? 70 : 26) : 22), jointRounded: true, capRounded: true,
      updateTriggers: { getWidth: [city, near], getColor: [ctx.activeArea, city, mode] }, ...(night ? ADD : {}) }),
    // the ward outline: dark ink core on a light halo, so it reads on the dark map, on paper and on satellite alike
    new PathLayer({ id: 'area-halo', data: outlines, getPath: (d) => d.path, widthUnits: 'pixels', getWidth: city ? 6 : 5,
      getColor: night ? rgba(c.ink, near ? 90 : 170) : rgba('#ffffff', near ? 150 : 230), jointRounded: true, capRounded: true,
      updateTriggers: { getWidth: city, getColor: [near, mode] } }),
    new PathLayer({ id: 'area-line', data: outlines, getPath: (d) => d.path, widthUnits: 'pixels', getWidth: city ? 2.5 : 2,
      getColor: night ? rgba(c.dark, near ? 170 : 255) : rgba(c.ink, near ? 170 : 245), jointRounded: true, capRounded: true,
      updateTriggers: { getWidth: city, getColor: [near, mode] } }),
    new PolygonLayer({ id: 'area-fill', visible: city, data: ctx.areas.flatMap((a) => outerRings(a.polygon).map((polygon) => ({ p: { kind: 'area' as const, id: a.slug, name: a.name, card: a }, polygon }))),
      getPolygon: (d) => d.polygon, getFillColor: rgba(c.sodium, 18), stroked: false, pickable: true, updateTriggers: { getFillColor: mode } }),
  )
  // created only once areas exist: with no text, the 'auto' font atlas is a 1024×0 canvas and WebGL warns (D13)
  if (ctx.areas.length) {
    L.push(new TextLayer<AreaCard>({
      id: 'area-badge', visible: city, data: ctx.areas,
      getPosition: (a) => [(a.bbox[0] + a.bbox[2]) / 2, a.bbox[3]],
      getText: (a) => `${a.name.replace(/^Unseen street: /, '')}  ·  ${plural(a.counts.buildings, 'building')} · ${plural(a.counts.streetlight_gaps_60m, 'dark stretch')}`,
      getSize: 14, fontFamily: "'Anek Tamil Variable', system-ui, sans-serif", fontWeight: 600,
      getColor: rgba(c.ink), getPixelOffset: [0, -14], background: true, getBackgroundColor: rgba(c.bg2, 235),
      backgroundPadding: [9, 5, 9, 5], getBorderColor: rgba(c.sodium, 150), getBorderWidth: 1,
      characterSet: 'auto', outlineWidth: 0, updateTriggers: { getColor: mode, getBackgroundColor: mode, getBorderColor: mode },
    }))
  }

  // P6 jobs: the clicked street itself. Running = the stage sweeps along the street (done of total) with a camera head;
  // queued / paused = a still, dashed chalk line (nothing pretends to run). The pulsing dot marks it from the city view.
  for (const t of jobTracks(ctx.jobs, ctx.jobShown)) {
    const running = t.state === 'running'
    L.push(new PathLayer({ id: `job-street-${t.id}`, data: t.paths, getPath: (d) => d, widthUnits: 'pixels', getWidth: running ? 6 : 4,
      getColor: running ? rgba(c.sodium, 70) : rgba(c.ink2, 200), capRounded: true, jointRounded: true,
      ...(running ? {} : { extensions: [dash], ...({ getDashArray: [3, 2.5], dashJustified: true } as object) }),
      updateTriggers: { getColor: [mode, running] } }))
    if (!running) continue
    L.push(new PathLayer({ id: `job-lit-${t.id}`, data: t.lit, getPath: (d) => d, widthUnits: 'pixels', getWidth: 5,
      getColor: rgba(c.sodiumGlow, 235), capRounded: true, jointRounded: true,
      updateTriggers: { getColor: mode }, ...(mode === 'night' ? ADD : {}) }))
    if (t.head) {
      const k = ctx.pulse
      L.push(
        new ScatterplotLayer({ id: `job-head-halo-${t.id}`, data: [t.head], getPosition: (d) => d, radiusUnits: 'pixels',
          getRadius: 7 + 12 * k, getFillColor: rgba(c.sodium, Math.round(130 * (1 - k))), updateTriggers: { getRadius: k, getFillColor: [k, mode] } }),
        new ScatterplotLayer({ id: `job-head-${t.id}`, data: [t.head], getPosition: (d) => d, radiusUnits: 'pixels', getRadius: 5,
          getFillColor: rgba(c.sodium), stroked: true, getLineColor: rgba(c.bg0), lineWidthUnits: 'pixels', getLineWidth: 2 }),
      )
    }
  }
  const jobPts = ctx.jobs
    .map((j) => j.input.click ? [j.input.click.lon, j.input.click.lat] : j.input.polygon ? (j.input.polygon.coordinates[0][0] as Position) : null)
    .filter(Boolean) as Position[]
  if (jobPts.length && !near) {
    const t = ctx.pulse
    L.push(
      new ScatterplotLayer({ id: 'job-pulse', data: jobPts, getPosition: (d) => d, radiusUnits: 'pixels', getRadius: 8 + 22 * t,
        getFillColor: rgba(c.sodium, Math.round(120 * (1 - t))), updateTriggers: { getRadius: t, getFillColor: [t, mode] } }),
      new ScatterplotLayer({ id: 'job-dot', data: jobPts, getPosition: (d) => d, radiusUnits: 'pixels', getRadius: 5,
        getFillColor: rgba(c.sodium), stroked: true, getLineColor: rgba(c.bg0), lineWidthUnits: 'pixels', getLineWidth: 2 }),
    )
  }
  if (!split) return L

  // ---------------------------------------------------------------- roads: lit where analysed (area and closer)
  {
    const v = !city
    const inF = (name: string) => !F.streets || F.streets.has(name)
    const health = on.streetHealth
    L.push(
      new PathLayer({ id: 'road-glow', visible: v && night, data: split.streets, getPath: (d) => d.path, widthUnits: 'pixels',
        getWidth: near ? 26 : 14, getColor: (d) => rgba(c.sodium, Math.round((inF(d.p.name) ? 26 : 8) * lit)), capRounded: true, jointRounded: true,
        updateTriggers: { getWidth: near, getColor: [lit, fk, mode] }, ...ADD }),
      // a selected street: chalk casing under the lit line
      new PathLayer({ id: 'road-selected', visible: v && !!F.streets, data: F.streets ? split.streets.filter((d) => F.streets!.has(d.p.name)) : [],
        getPath: (d) => d.path, widthUnits: 'pixels', getWidth: near ? 10 : 12, getColor: rgba(c.ink, night ? 150 : 200), capRounded: true,
        jointRounded: true, updateTriggers: { getWidth: near, getColor: mode } }),
      new PathLayer({ id: 'road', visible: v, data: split.streets, getPath: (d) => d.path, widthUnits: 'pixels', getWidth: near ? 4 : night ? 3 : 4.5,
        getColor: (d) => health ? healthColor(mode, d.p.issues_per_km, inF(d.p.name) ? 240 : 70)
          : night ? rgba(c.sodiumGlow, Math.round((inF(d.p.name) ? 40 + 150 * lit : 30))) : rgba(c.sodiumGlow, inF(d.p.name) ? 230 : 90),
        capRounded: true, jointRounded: true, pickable: true, autoHighlight: true, highlightColor: rgba(c.ink, 120),
        updateTriggers: { getWidth: [near, night], getColor: [lit, fk, mode, health] } }),
    )
  }
  // ---------------------------------------------------------------- dark stretches: no streetlight seen within 60 m
  {
    const v = on.gaps && !city
    const focused = F.gaps ? split.gaps.filter((d) => F.gaps!.has(d.p.id)) : []
    const selGap = ctx.selectedId ? split.gaps.filter((d) => d.p.id === ctx.selectedId) : []
    L.push(
      // selected dark stretch: a sodium outline around the band
      new PathLayer({ id: 'dark-selected', visible: v && selGap.length > 0, data: selGap, getPath: (d) => d.path, widthUnits: 'pixels',
        getWidth: near ? 26 : 19, getColor: rgba(c.sodium, 235), capRounded: true, jointRounded: true, updateTriggers: { getWidth: near, getColor: mode } }),
      // a question about gaps: the answered stretches get a chalk outline (a dark band can't get brighter)
      new PathLayer({ id: 'dark-focus', visible: v && focused.length > 0, data: focused, getPath: (d) => d.path, widthUnits: 'pixels',
        getWidth: near ? 22 : 15, getColor: rgba(c.ink, night ? 150 : 210), capRounded: true, jointRounded: true, updateTriggers: { getWidth: near, getColor: mode } }),
      new PathLayer({ id: 'dark-edge', visible: v, data: split.gaps, getPath: (d) => d.path, widthUnits: 'pixels', getWidth: near ? 18 : 11,
        getColor: (d) => (night ? rgba(c.darkEdge, dimG(d.p.id) ? 80 : 200) : rgba(c.dark, dimG(d.p.id) ? 15 : 40)), capRounded: true, jointRounded: true,
        updateTriggers: { getWidth: near, getColor: [fk, mode] } }),
      new PathLayer({ id: 'dark', visible: v, data: split.gaps, getPath: (d) => d.path, widthUnits: 'pixels', getWidth: near ? 15 : 8,
        getColor: (d) => rgba(c.dark, dimG(d.p.id) ? 110 : night ? 250 : 235), capRounded: true, jointRounded: true, pickable: true,
        updateTriggers: { getWidth: near, getColor: [fk, mode] } }),
      // "check" (D13): drawn as recorded; lit camera stops lie on the road between its ends → dotted chalk edge
      new PathLayer({ id: 'dark-check', visible: v, data: split.gaps.filter((d) => d.p.display_mode === 'check'), getPath: (d) => d.path,
        widthUnits: 'pixels', getWidth: 1.6, getColor: rgba(c.ink2, 220), extensions: [dash], updateTriggers: { getColor: mode },
        ...({ getDashArray: [1.5, 3], dashJustified: true } as object) }),
    )
  }
  // ---------------------------------------------------------------- findings density (opt-in, area level)
  L.push(new HexagonLayer<Position>({
    id: 'density', visible: on.density && band === 'area', data: split.findings, getPosition: (d) => d, radius: 45, coverage: 0.88, extruded: false,
    colorRange: [0.25, 0.4, 0.55, 0.7, 0.85, 1].map((k) => mix(rgba(c.bg1), rgba(c.noRecord), k, 255).slice(0, 3) as [number, number, number]),
    opacity: 0.35, pickable: false, gpuAggregation: false, updateTriggers: { colorRange: mode },
  }))

  // ---------------------------------------------------------------- buildings
  const allB = [...split.extruded, ...split.unclassified]
  // area level: only the findings (matched buildings appear from street level)
  L.push(new ScatterplotLayer<BuildingD>({ id: 'bld-points', visible: on.buildings && band === 'area',
    data: allB.filter((d) => d.p.match_status !== 'matched'), getPosition: (d) => [d.p.lon, d.p.lat], radiusUnits: 'pixels',
    getRadius: 4, stroked: true, lineWidthUnits: 'pixels', getLineWidth: night ? 1 : 0.8, getLineColor: night ? rgba(c.bg0, 200) : rgba(c.ink, 120),
    getFillColor: (d) => mark(mode, d.p.match_status, dimB(d.p.id) ? 60 : 255), pickable: true,
    updateTriggers: { getFillColor: [mode, fk], getLineColor: mode } }))
  {
    const v = on.buildings && near
    L.push(
      // no floor count → flat footprint, hatched, coloured by match status (D9: never a guessed height)
      new PolygonLayer<BuildingD>({ id: 'bld-flat', visible: v, data: split.unclassified, getPolygon: (d) => d.polygon, stroked: true,
        lineWidthUnits: 'pixels', getLineWidth: 1, getLineColor: (d) => mark(mode, d.p.match_status, dimB(d.p.id) ? 50 : 210),
        getFillColor: (d) => rgba(c.unclassified, dimB(d.p.id) ? 15 : night ? 40 : 90), pickable: true,
        updateTriggers: { getLineColor: [mode, fk], getFillColor: [mode, fk] } }),
      new PolygonLayer<BuildingD>({ id: 'bld-hatch', visible: v, data: split.unclassified, getPolygon: (d) => d.polygon, stroked: false,
        getFillColor: (d) => mark(mode, d.p.match_status, dimB(d.p.id) ? 35 : 150), extensions: [hatch], pickable: false,
        updateTriggers: { getFillColor: [mode, fk] },
        ...({ fillPatternAtlas: hatchAtlas(), fillPatternMapping: HATCH_MAPPING, getFillPattern: () => 'hatch', getFillPatternScale: 0.45, fillPatternMask: true } as object) }),
      new PolygonLayer<BuildingD>({ id: 'bld-3d', visible: v, data: split.extruded, getPolygon: (d) => d.polygon,
        extruded: !flat, wireframe: false, getElevation: (d) => (d.p.floors ?? 0) * FLOOR_HEIGHT_M,
        getFillColor: (d) => mark(mode, d.p.match_status, dimB(d.p.id) ? 40 : d.p.floors_status === 'low_confidence' ? 120 : night ? 205 : 235),
        stroked: flat, lineWidthUnits: 'pixels', getLineWidth: 1.2, getLineColor: rgba(c.ink, 140),
        material: { ambient: night ? 0.35 : 0.55, diffuse: 0.55, shininess: 12, specularColor: [40, 40, 50] }, pickable: true,
        updateTriggers: { getFillColor: [flat, fk, mode], getLineColor: mode } }),
    )
    const rv = allB.filter((d) => d.p.review_status === 'pending')
    L.push(new PathLayer<BuildingD>({ id: 'bld-review', visible: v && on.review, data: rv, getPath: (d) => d.polygon[0], widthUnits: 'pixels',
      getWidth: 1.6, getColor: rgba(c.review, 230), extensions: [dash], updateTriggers: { getColor: mode },
      ...({ getDashArray: [3, 2], dashJustified: true } as object) }))
  }

  // ---------------------------------------------------------------- poles & streetlights
  {
    const lights = split.assets.filter((a) => a.p.kind === 'streetlight')
    const poles = split.assets.filter((a) => a.p.kind === 'pole')
    const v = on.assets && !city
    // uncertainty: dashed ring = approximate (single camera), solid = triangulated (street level)
    L.push(
      new PathLayer<AssetD>({ id: 'asset-unc', visible: v && near && on.uncertainty, data: split.assets, getPath: (d) => d.ring, widthUnits: 'pixels',
        getWidth: 1.1, getColor: (d) => rgba(c.ink2, dimA(d.p.id) ? 30 : 150), extensions: [dash], updateTriggers: { getColor: [fk, mode] },
        ...({ getDashArray: (d: AssetD) => (d.p.approximate ? [3, 2.5] : [0, 0]), dashJustified: true } as object) }),
      // unlit poles: street level only (declutter rule 8)
      new ScatterplotLayer<AssetD>({ id: 'poles', visible: v && near, data: poles, getPosition: (d) => d.position, radiusUnits: 'pixels',
        getRadius: band === 'object' ? 4 : 3, getFillColor: (d) => rgba(night ? c.ink2 : c.ink3, dimA(d.p.id) ? 60 : night ? 235 : 220),
        stroked: true, lineWidthUnits: 'pixels', getLineWidth: 1, getLineColor: rgba(c.bg0, 200), pickable: true,
        updateTriggers: { getRadius: band, getFillColor: [fk, mode], getLineColor: mode } }),
      // register finding on an asset (synthetic register): status ring
      new ScatterplotLayer<AssetD>({ id: 'asset-status', visible: v && near, data: split.assets.filter((d) => assetStatus(d.p.register_status)),
        getPosition: (d) => d.position, radiusUnits: 'pixels', getRadius: 7, filled: false, stroked: true, lineWidthUnits: 'pixels', getLineWidth: 1.6,
        getLineColor: (d) => mark(mode, assetStatus(d.p.register_status), dimA(d.p.id) ? 60 : 235), updateTriggers: { getLineColor: [fk, mode] } }),
      new ScatterplotLayer<AssetD>({ id: 'lamp-halo', visible: v, data: lights, getPosition: (d) => d.position, radiusUnits: 'pixels', getRadius: near ? 30 : 14,
        getFillColor: (d) => rgba(c.sodiumGlow, Math.round((night ? 42 : 26) * lamp(d.p.id) * (dimA(d.p.id) ? 0.3 : 1))),
        updateTriggers: { getRadius: near, getFillColor: [lit, fk, mode] }, ...(night ? ADD : {}) }),
      new ScatterplotLayer<AssetD>({ id: 'lamp-inner', visible: v, data: lights, getPosition: (d) => d.position, radiusUnits: 'pixels', getRadius: near ? 10 : 5,
        getFillColor: (d) => rgba(c.sodiumGlow, Math.round((night ? 110 : 70) * lamp(d.p.id) * (dimA(d.p.id) ? 0.3 : 1))),
        updateTriggers: { getRadius: near, getFillColor: [lit, fk, mode] }, ...(night ? ADD : {}) }),
      new ScatterplotLayer<AssetD>({ id: 'lamp-core', visible: v, data: lights, getPosition: (d) => d.position, radiusUnits: 'pixels', getRadius: near ? 3.8 : 2.2,
        getFillColor: (d) => (night ? rgba('#fff4e0', Math.round(255 * lamp(d.p.id) * (dimA(d.p.id) ? 0.4 : 1))) : rgba(c.sodium, dimA(d.p.id) ? 90 : 255)),
        stroked: !night, lineWidthUnits: 'pixels', getLineWidth: 1, getLineColor: rgba(c.bg1, 255), pickable: true,
        updateTriggers: { getRadius: near, getFillColor: [lit, fk, mode], getLineColor: mode } }),
    )
  }
  // ---------------------------------------------------------------- unmapped businesses (hollow ring = approximate) + register records not seen
  L.push(
    new ScatterplotLayer({ id: 'unmapped', visible: on.unmapped && near, data: split.unmapped, getPosition: (d) => d.position, radiusUnits: 'pixels',
      getRadius: band === 'object' ? 9 : 7, filled: true, getFillColor: rgba(c.bg0, 90), stroked: true, lineWidthUnits: 'pixels', getLineWidth: 1.6,
      getLineColor: (d) => rgba(c.ink2, dimU(d.p.id) ? 70 : 230), pickable: true, updateTriggers: { getRadius: band, getLineColor: [fk, mode], getFillColor: mode } }),
    new IconLayer({ id: 'missing', visible: on.missing && near, data: split.missing, getPosition: (d) => d.position, getIcon: () => ICONS.missing,
      getSize: 18, getColor: rgba(c.noRecord, 230), pickable: true, updateTriggers: { getColor: mode } }),
  )

  // ---------------------------------------------------------------- filter / question results at area level (everything else dims)
  {
    const pts: Position[] = [
      ...(F.buildings ? allB.filter((d) => F.buildings!.has(d.p.id)).map((d) => [d.p.lon, d.p.lat] as Position) : []),
      ...(F.assets ? split.assets.filter((d) => F.assets!.has(d.p.id)).map((d) => d.position) : []),
      ...(F.unmapped ? split.unmapped.filter((d) => F.unmapped!.has(d.p.id)).map((d) => d.position) : []),
    ]
    L.push(new ScatterplotLayer<Position>({ id: 'focus-dots', visible: band === 'area' && !!fk && pts.length > 0, data: pts, getPosition: (d) => d,
      radiusUnits: 'pixels', getRadius: 5, getFillColor: rgba(c.ink, 245), stroked: true, lineWidthUnits: 'pixels',
      getLineWidth: 2, getLineColor: rgba(c.sodium), updateTriggers: { getFillColor: mode, getLineColor: mode } }))
  }

  // ---------------------------------------------------------------- analyse: the exact snapped street (distinct from Google's blue coverage)
  if (ctx.analysePoly) {
    L.push(new PolygonLayer({ id: 'analyse-area', data: [{ polygon: ctx.analysePoly }], getPolygon: (d) => d.polygon,
      getFillColor: rgba(c.ink, night ? 16 : 22), stroked: false }))
  }
  if (ctx.analyseRest?.length) {
    L.push(new PathLayer({ id: 'analyse-rest', data: ctx.analyseRest, getPath: (d) => d, widthUnits: 'pixels', getWidth: 4,
      getColor: rgba(c.ink, 110), capRounded: true, jointRounded: true }))
  }
  if (ctx.analyseLines?.length) {
    const ends = ctx.analyseLines.flatMap((l) => [l[0], l[l.length - 1]])
    L.push(
      new PathLayer({ id: 'analyse-casing', data: ctx.analyseLines, getPath: (d) => d, widthUnits: 'pixels', getWidth: 11,
        getColor: rgba(c.bg0, 230), capRounded: true, jointRounded: true }),
      new PathLayer({ id: 'analyse-line', data: ctx.analyseLines, getPath: (d) => d, widthUnits: 'pixels', getWidth: 5,
        getColor: rgba(c.ink, 255), capRounded: true, jointRounded: true }),
      new ScatterplotLayer({ id: 'analyse-ends', data: ends, getPosition: (d) => d, radiusUnits: 'pixels', getRadius: 5.5,
        getFillColor: rgba(c.sodium), stroked: true, lineWidthUnits: 'pixels', getLineWidth: 2, getLineColor: rgba(c.bg0) }),
    )
  }

  // ---------------------------------------------------------------- drive the street: branch, view wedge, camera + direction arrow
  if (ctx.drive) {
    const { branch, at, heading, look } = ctx.drive
    const kx = 111320 * Math.cos((at[1] * Math.PI) / 180), ky = 110540
    const wedge: Position[] = [at]
    for (let a = -45; a <= 45; a += 9) { const h = ((look + a) * Math.PI) / 180; wedge.push([at[0] + (40 * Math.sin(h)) / kx, at[1] + (40 * Math.cos(h)) / ky]) }
    L.push(
      new PathLayer({ id: 'drive-branch', data: [branch], getPath: (d) => d, widthUnits: 'pixels', getWidth: near ? 8 : 6,
        getColor: rgba(c.ink, night ? 70 : 90), capRounded: true, jointRounded: true }),
      new PolygonLayer({ id: 'drive-wedge', data: [wedge], getPolygon: (d) => d, getFillColor: rgba(c.sodium, 60), stroked: false }),
      new ScatterplotLayer({ id: 'drive-cam', data: [at], getPosition: (d) => d, radiusUnits: 'pixels', getRadius: 7, getFillColor: rgba(c.sodium),
        stroked: true, lineWidthUnits: 'pixels', getLineWidth: 2.5, getLineColor: rgba(c.bg0) }),
      new IconLayer({ id: 'drive-arrow', data: [at], getPosition: (d) => d, getIcon: () => ICONS.arrow, getSize: 30, billboard: false,
        getAngle: -heading, getColor: rgba(c.sodium), updateTriggers: { getAngle: heading } }),
    )
  }

  // ---------------------------------------------------------------- selection
  const sel = ctx.selectedId
  if (sel) {
    const b = near ? allB.find((d) => d.p.id === sel) : null
    if (b) L.push(new PathLayer({ id: 'sel-bld', data: b.polygon, getPath: (d) => d, widthUnits: 'pixels', getWidth: 3,
      getColor: rgba(c.sodium), jointRounded: true }))
    const pt = split.assets.find((d) => d.p.id === sel)?.position ?? split.unmapped.find((d) => d.p.id === sel)?.position
      ?? split.missing.find((d) => d.p.id === sel)?.position ?? (!near ? allB.find((d) => d.p.id === sel)?.p : null)
    const pos = pt && !Array.isArray(pt) ? [pt.lon, pt.lat] as Position : pt
    if (pos) L.push(new ScatterplotLayer({ id: 'sel-pt', data: [pos], getPosition: (d) => d, radiusUnits: 'pixels', getRadius: near ? 13 : 9,
      filled: false, stroked: true, lineWidthUnits: 'pixels', getLineWidth: 2.5, getLineColor: rgba(c.sodium) }))
    // D27: predicted position of the selected building, at OBJECT zoom only (uncertainty circle in metres, then the point)
    const pr = band === 'object' ? ctx.predicted : null
    if (pr) {
      if (pr.radius_m) L.push(new ScatterplotLayer({ id: 'pred-unc', data: [pr.position], getPosition: (d) => d, radiusUnits: 'meters',
        getRadius: pr.radius_m, filled: true, getFillColor: rgba(c.sodium, 40), stroked: true, lineWidthUnits: 'pixels',
        getLineWidth: 1.5, getLineColor: rgba(c.sodium, 210) }))
      L.push(new ScatterplotLayer({ id: 'pred-pt', data: [pr.position], getPosition: (d) => d, radiusUnits: 'pixels', getRadius: 6,
        filled: true, getFillColor: rgba(c.sodium), stroked: true, lineWidthUnits: 'pixels', getLineWidth: 2, getLineColor: rgba(c.bg0) }))
    }
  }
  return L
}

export type Picked = { p: AnyProps } | AreaCard | null

/** P6 / D35 (F1): a job's street for the progress animation. The lit part runs from the street's start to the job's
 *  OVERALL progress (all ten stages), so it only moves forward; `shown` is the eased value MapView draws. */
export function jobTracks(jobs: Job[], shown?: Record<string, number>) {
  return jobs.flatMap((j) => {
    const g = j.input.lines
    const paths = (g ? (g.type === 'LineString' ? [g.coordinates] : g.coordinates)
      : j.input.polygon ? [j.input.polygon.coordinates[0]] : []) as Position[][]
    if (!paths.length) return []
    const state = j.status === 'running' && j.display_status === 'running' ? 'running' : 'waiting'
    const m = mainLine({ type: 'MultiLineString', coordinates: paths as [number, number][][] })
    const frac = Math.min(1, Math.max(0, shown?.[j.id] ?? j.progress ?? 0))
    const lit = m && frac > 0.001 ? [slice(m, 0, frac * m.length) as Position[]] : []
    const head = m ? (pointAt(m, frac * m.length) as Position) : null
    return [{ id: j.id, paths, state, frac, lit, head }]
  })
}
