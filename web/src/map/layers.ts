/** deck.gl layers for the zoom-driven map (CLAUDE.md §9.3).
 *  city   (z ≤ 13): analysed areas glow as outlines with a count badge; pulsing dot for running jobs
 *  area   (z 14–16): streets coloured by health, dashed glowing streetlight gaps, hexbin density of findings
 *  street (z 17–18): footprints extruded by observed floors (no floor count → flat + hatched, never a guessed height),
 *                    asset icons with uncertainty circles (dashed = approximate), hollow pins for unmapped businesses
 *  object (z ≥ 19):  same as street; selection drives the evidence dive (P4)
 */
import { HexagonLayer } from '@deck.gl/aggregation-layers'
import type { Layer } from '@deck.gl/core'
import { FillStyleExtension, PathStyleExtension } from '@deck.gl/extensions'
import { GeoJsonLayer, IconLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { LineString, MultiLineString, MultiPolygon, Point, Polygon } from 'geojson'
import type {
  AnyProps, AreaCard, AreaFeature, AssetProps, Band, BuildingProps, GapProps, Job, MissingProps, StreetProps, UnmappedProps,
} from '@/api/types'
import type { LayerKey } from '@/store/ui'
import { C, DENSITY_RANGE, healthColor, matchColor, registerColor, withAlpha } from './colors'
import { HATCH_MAPPING, ICONS, hatchAtlas } from './icons'

/** Display scale for extrusion only: observed floors × 3.2 m. Not a measured height. */
export const FLOOR_HEIGHT_M = 3.2

/** lon/lat pair (deck.gl's Position is stricter than GeoJSON's number[]) */
type Position = [number, number]
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

export interface LayerCtx {
  band: Band
  flat: boolean
  layers: Record<LayerKey, boolean>
  areas: AreaCard[]
  activeArea: string | null
  split: Split | null
  jobs: Job[]
  pulse: number
  selectedId: string | null
  light: boolean
}

const pick = { pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 70] as [number, number, number, number] }
const dash = new PathStyleExtension({ dash: true })
const hatch = new FillStyleExtension({ pattern: true })

function outerRings(poly: Polygon | MultiPolygon): Position[][] {
  return (poly.type === 'Polygon' ? [poly.coordinates[0]] : poly.coordinates.map((p) => p[0])) as Position[][]
}

export function buildLayers(ctx: LayerCtx): Layer[] {
  const { band, flat, layers: on, split, light } = ctx
  const L: Layer[] = []
  const near = band === 'street' || band === 'object'

  // ---------------------------------------------------------------- areas (all bands; strongest at city level)
  const outlines = ctx.areas.flatMap((a) => outerRings(a.polygon).map((path) => ({ a, path })))
  const city = band === 'city'
  L.push(
    new PathLayer({
      id: 'area-glow', data: outlines, getPath: (d) => d.path, widthUnits: 'pixels',
      getWidth: city ? 14 : near ? 0 : 8, getColor: (d) => withAlpha(C.accent, d.a.slug === ctx.activeArea ? (city ? 70 : 40) : 30),
      jointRounded: true, capRounded: true, updateTriggers: { getWidth: [city, near], getColor: [ctx.activeArea, city] },
    }),
    new PathLayer({
      id: 'area-line', data: outlines, getPath: (d) => d.path, widthUnits: 'pixels', getWidth: city ? 2.5 : 1.5,
      getColor: withAlpha(light ? [30, 100, 220, 255] : C.accent, near ? 70 : 230), jointRounded: true,
      updateTriggers: { getWidth: city, getColor: [near, light] },
    }),
  )
  // Band-specific layers stay mounted and switch with `visible` (no GPU buffer rebuild on every band change).
  L.push(
      new ScatterplotLayer<AreaCard>({ id: 'area-halo', visible: city, data: ctx.areas, getPosition: (a) => [(a.bbox[0] + a.bbox[2]) / 2, (a.bbox[1] + a.bbox[3]) / 2],
        radiusUnits: 'pixels', getRadius: 16, getFillColor: withAlpha(C.accent, 45), stroked: true, lineWidthUnits: 'pixels',
        getLineWidth: 1.5, getLineColor: withAlpha(C.accent, 200) }),
      new PolygonLayer({
        id: 'area-fill', visible: city, data: ctx.areas.flatMap((a) => outerRings(a.polygon).map((polygon) => ({ p: { kind: 'area' as const, id: a.slug, name: a.name, card: a }, polygon }))),
        getPolygon: (d) => d.polygon, getFillColor: withAlpha(C.accent, 22), stroked: false, ...pick,
      }),
      // created only once areas exist: with no text, the 'auto' font atlas is a 1024×0 canvas and WebGL warns
      // "texSubImage2D: no canvas" (seen when the API answers slowly)
      ...(ctx.areas.length ? [new TextLayer<AreaCard>({
        id: 'area-badge', visible: city, data: ctx.areas,
        getPosition: (a) => [(a.bbox[0] + a.bbox[2]) / 2, a.bbox[3]],
        getText: (a) => `${a.name.replace(/^Unseen street: /, '')}  ·  ${a.counts.buildings} bldg · ${a.counts.assets} assets`,
        getSize: 12, fontFamily: 'Inter Variable, Inter, system-ui, sans-serif', fontWeight: 600,
        getColor: light ? [15, 23, 42, 255] : [232, 237, 245, 255], getPixelOffset: [0, -14],
        background: true, getBackgroundColor: light ? [255, 255, 255, 230] : [14, 18, 26, 225],
        backgroundPadding: [9, 5, 9, 5], getBorderColor: withAlpha(C.accent, 150), getBorderWidth: 1,
        characterSet: 'auto', outlineWidth: 0, updateTriggers: { getColor: light, getBackgroundColor: light },
      })] : []),
  )

  // running jobs: pulsing dot (city + area)
  const jobPts = ctx.jobs
    .map((j) => j.input.click ? [j.input.click.lon, j.input.click.lat] : j.input.polygon ? (j.input.polygon.coordinates[0][0] as Position) : null)
    .filter(Boolean) as Position[]
  if (jobPts.length && !near) {
    const t = ctx.pulse
    L.push(
      new ScatterplotLayer({ id: 'job-pulse', data: jobPts, getPosition: (d) => d, radiusUnits: 'pixels', getRadius: 8 + 22 * t,
        getFillColor: withAlpha(C.accent, Math.round(120 * (1 - t))), updateTriggers: { getRadius: t, getFillColor: t } }),
      new ScatterplotLayer({ id: 'job-dot', data: jobPts, getPosition: (d) => d, radiusUnits: 'pixels', getRadius: 5,
        getFillColor: C.accent, stroked: true, getLineColor: C.white, lineWidthUnits: 'pixels', getLineWidth: 2 }),
    )
  }
  if (!split) return L

  // ---------------------------------------------------------------- area level
  {
    L.push(new HexagonLayer<Position>({
      id: 'density', visible: on.density && band === 'area', data: split.findings, getPosition: (d) => d, radius: 45, coverage: 0.88, extruded: false,
      colorRange: DENSITY_RANGE.map((c) => [c[0], c[1], c[2]] as [number, number, number]), opacity: 0.42,
      pickable: false, gpuAggregation: false,
    }))
  }
  {
    const v = on.streetHealth && !city
    L.push(
      new PathLayer({ id: 'street-casing', visible: v, data: split.streets, getPath: (d) => d.path, widthUnits: 'pixels',
        getWidth: near ? 5 : 9, getColor: [0, 0, 0, near ? 60 : 110], capRounded: true, jointRounded: true, updateTriggers: { getWidth: near } }),
      new PathLayer({ id: 'street-health', visible: v, data: split.streets, getPath: (d) => d.path, widthUnits: 'pixels',
        getWidth: near ? 2.5 : 5, getColor: (d) => healthColor(d.p.issues_per_km, near ? 150 : 240),
        capRounded: true, jointRounded: true, ...pick, updateTriggers: { getWidth: near, getColor: near } }),
    )
  }
  {
    const v = on.gaps && !city
    const sure = split.gaps.filter((d) => d.p.display_mode !== 'check')
    const check = split.gaps.filter((d) => d.p.display_mode === 'check')
    L.push(
      new PathLayer({ id: 'gap-glow', visible: v, data: sure, getPath: (d) => d.path, widthUnits: 'pixels', getWidth: near ? 10 : 14,
        getColor: withAlpha(C.noRecord, 55), capRounded: true, jointRounded: true, updateTriggers: { getWidth: near } }),
      new PathLayer({ id: 'gap-dash', visible: v, data: sure, getPath: (d) => d.path, widthUnits: 'pixels', getWidth: near ? 3 : 4,
        getColor: [255, 96, 104, 255], getDashArray: [2.2, 1.6], dashJustified: true, extensions: [dash], capRounded: true,
        jointRounded: true, ...pick, updateTriggers: { getWidth: near } }),
      // "check": drawn as recorded; lit camera stops lie on the road between its ends (bent street, D13)
      new PathLayer({ id: 'gap-check', visible: v, data: check, getPath: (d) => d.path, widthUnits: 'pixels', getWidth: near ? 2.5 : 3,
        getColor: [245, 165, 36, 235], getDashArray: [0.8, 1.8], dashJustified: true, extensions: [dash], capRounded: true,
        ...pick, updateTriggers: { getWidth: near } }),
    )
  }
  // ---------------------------------------------------------------- street / object level
  {
    const v = on.buildings && near
    // no floor count → flat footprint, hatched, coloured by match status (D9: never a guessed height)
    L.push(
      new PolygonLayer({ id: 'bld-unclassified-base', visible: v, data: split.unclassified, getPolygon: (d) => d.polygon,
        getFillColor: (d) => withAlpha(matchColor(d.p.match_status), 38), stroked: true, lineWidthUnits: 'pixels',
        getLineWidth: 1.2, getLineColor: (d) => withAlpha(matchColor(d.p.match_status), 200), ...pick }),
      new PolygonLayer<BuildingD>({ id: 'bld-unclassified-hatch', visible: v, data: split.unclassified, getPolygon: (d) => d.polygon, stroked: false,
        getFillColor: (d) => withAlpha(matchColor(d.p.match_status), 150), extensions: [hatch], pickable: false,
        // FillStyleExtension props (not in PolygonLayer's own prop types)
        ...({ fillPatternAtlas: hatchAtlas(), fillPatternMapping: HATCH_MAPPING, getFillPattern: () => 'hatch',
              getFillPatternScale: 0.45, fillPatternMask: true } as object) }),
      new PolygonLayer({ id: 'bld-extruded', visible: v, data: split.extruded, getPolygon: (d) => d.polygon,
        extruded: !flat, wireframe: false, getElevation: (d) => (d.p.floors ?? 0) * FLOOR_HEIGHT_M,
        getFillColor: (d) => withAlpha(matchColor(d.p.match_status), d.p.floors_status === 'low_confidence' ? 130 : flat ? 150 : 225),
        stroked: flat, lineWidthUnits: 'pixels', getLineWidth: 1.2, getLineColor: (d) => withAlpha(matchColor(d.p.match_status), 230),
        material: { ambient: 0.42, diffuse: 0.62, shininess: 24, specularColor: [60, 64, 70] }, ...pick,
        updateTriggers: { getFillColor: flat } }),
    )
    {
      const rv = [...split.extruded, ...split.unclassified].filter((d) => d.p.review_status === 'pending')
      L.push(new PolygonLayer({ id: 'bld-review', visible: v && on.review, data: rv, getPolygon: (d) => d.polygon, filled: false, stroked: true,
        extruded: false, lineWidthUnits: 'pixels', getLineWidth: 2.5, getLineColor: C.review }))
    }
  }
  {
    const v = on.assets && near
    const big = band === 'object'
    {
      L.push(
        new ScatterplotLayer({ id: 'asset-unc-fill', visible: v && on.uncertainty, data: split.assets, getPosition: (d) => d.position, radiusUnits: 'meters',
          getRadius: (d) => d.p.uncertainty_m ?? 3.5, getFillColor: (d) => withAlpha(registerColor(d.p.register_status), 26) }),
        new PathLayer<AssetD>({ id: 'asset-unc-ring', visible: v && on.uncertainty, data: split.assets, getPath: (d) => d.ring, widthUnits: 'pixels', getWidth: 1.4,
          getColor: (d) => withAlpha(registerColor(d.p.register_status), 210), extensions: [dash],
          // PathStyleExtension: dashed ring = approximate (single camera), solid = triangulated
          ...({ getDashArray: (d: AssetD) => (d.p.approximate ? [3, 2.5] : [0, 0]), dashJustified: true } as object) }),
      )
    }
    L.push(
      new ScatterplotLayer({ id: 'asset-disc', visible: v, data: split.assets, getPosition: (d) => d.position, radiusUnits: 'pixels',
        getRadius: big ? 11 : 7.5, getFillColor: [11, 15, 22, 235], stroked: true, lineWidthUnits: 'pixels', getLineWidth: big ? 2 : 1.6,
        getLineColor: (d) => registerColor(d.p.register_status), ...pick, updateTriggers: { getRadius: big, getLineWidth: big } }),
      new IconLayer<AssetD>({ id: 'asset-glyph', visible: v, data: split.assets, getPosition: (d) => d.position,
        getIcon: (d) => ICONS[d.p.kind], getSize: big ? 16 : 11, sizeUnits: 'pixels', getColor: [255, 255, 255, 245], pickable: false,
        updateTriggers: { getSize: big } }),
    )
    {
      L.push(new ScatterplotLayer<AssetD>({ id: 'asset-review', visible: v && on.review, data: split.assets.filter((d) => d.p.review_status === 'pending'),
        getPosition: (d) => d.position, radiusUnits: 'pixels', getRadius: 14, filled: false, stroked: true,
        lineWidthUnits: 'pixels', getLineWidth: 2, getLineColor: C.review }))
    }
  }
  {
    L.push(new IconLayer({ id: 'missing', visible: on.missing && near, data: split.missing, getPosition: (d) => d.position, getIcon: () => ICONS.missing,
      getSize: 20, getColor: C.noRecord, ...pick }))
  }
  {
    L.push(new IconLayer({ id: 'unmapped', visible: on.unmapped && near, data: split.unmapped, getPosition: (d) => d.position, getIcon: () => ICONS.pin,
      getSize: 28, getColor: C.unmapped, ...pick }))
  }

  // selection ring / outline
  const sel = near ? ctx.selectedId : null
  if (sel) {
    const b = [...split.extruded, ...split.unclassified].find((d) => d.p.id === sel)
    if (b) L.push(new GeoJsonLayer({ id: 'sel-bld', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: b.polygon }, properties: {} } as never,
      filled: false, stroked: true, lineWidthUnits: 'pixels', getLineWidth: 3, getLineColor: C.white }))
    const pt = split.assets.find((d) => d.p.id === sel)?.position ?? split.unmapped.find((d) => d.p.id === sel)?.position
      ?? split.missing.find((d) => d.p.id === sel)?.position
    if (pt) L.push(new ScatterplotLayer({ id: 'sel-pt', data: [pt], getPosition: (d) => d, radiusUnits: 'pixels', getRadius: 17,
      filled: false, stroked: true, lineWidthUnits: 'pixels', getLineWidth: 2.5, getLineColor: C.white }))
  }
  return L
}

export type Picked = { p: AnyProps } | AreaCard | null
