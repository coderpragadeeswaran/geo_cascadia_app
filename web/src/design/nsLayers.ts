/** NIGHT SURVEY map layers. The city is dark; analysed roads are lit by their streetlights (sodium glow) and every
 *  streetlight gap is drawn as a dark stretch on top, so the core finding reads without a legend. Streetlights are
 *  glowing orbs that fade on; poles are small unlit dots. Area level shows only findings; street level extrudes
 *  buildings by observed floors (no floor count → flat + hatched, D9). */
import type { Layer } from '@deck.gl/core'
import { FillStyleExtension, PathStyleExtension } from '@deck.gl/extensions'
import { PathLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers'
import { HATCH_MAPPING, hatchAtlas } from '@/map/icons'
import { FLOOR_HEIGHT_M, type Split } from '@/map/layers'
import { colors, rgba, statusColor, type Mode } from './tokens'

const dash = new PathStyleExtension({ dash: true })
const hatch = new FillStyleExtension({ pattern: true })
// additive blending: overlapping lamp halos brighten like real light
const ADD = { parameters: { blend: true, blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one',
  blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one' } } as object

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return ((h >>> 0) % 1000) / 1000 }

export interface NsCtx { mode: Mode; level: 'area' | 'street'; split: Split; lightsOn: number; selectedId?: string | null }

export function nsLayers({ mode, level, split, lightsOn, selectedId }: NsCtx): Layer[] {
  const c = colors[mode]
  const night = mode === 'night'
  const street = level === 'street'
  const lamp = (id: string) => Math.max(0, Math.min(1, (lightsOn - hash(id) * 0.6) / 0.4))   // staggered fade-on
  const lights = split.assets.filter((a) => a.p.kind === 'streetlight')
  const poles = split.assets.filter((a) => a.p.kind === 'pole')
  const L: Layer[] = []

  // lit roads (the analysed streets, glowing where lit)
  L.push(
    new PathLayer({ id: 'ns-road-glow', data: split.streets, getPath: (d) => d.path, widthUnits: 'pixels', getWidth: street ? 26 : 14,
      getColor: rgba(c.sodium, night ? Math.round(26 * lightsOn) : 0), capRounded: true, jointRounded: true, updateTriggers: { getColor: lightsOn },
      ...(night ? ADD : {}) }),
    new PathLayer({ id: 'ns-road', data: split.streets, getPath: (d) => d.path, widthUnits: 'pixels', getWidth: street ? 4 : night ? 3 : 4.5,
      getColor: night ? rgba(c.sodiumGlow, Math.round(40 + 120 * lightsOn)) : rgba(c.sodiumGlow, 230), capRounded: true, jointRounded: true,
      updateTriggers: { getColor: lightsOn } }),
  )
  // dark stretches: no streetlight within 60 m (check-mode gaps get a dotted edge: "verify")
  L.push(
    new PathLayer({ id: 'ns-dark-edge', data: split.gaps, getPath: (d) => d.path, widthUnits: 'pixels', getWidth: street ? 18 : 11,
      getColor: night ? rgba(c.darkEdge, 200) : rgba(c.dark, 40), capRounded: true, jointRounded: true }),
    new PathLayer({ id: 'ns-dark', data: split.gaps, getPath: (d) => d.path, widthUnits: 'pixels', getWidth: street ? 15 : 8,
      getColor: night ? rgba(c.dark, 250) : rgba(c.dark, 235), capRounded: true, jointRounded: true, pickable: true }),
    new PathLayer({ id: 'ns-dark-check', data: split.gaps.filter((d) => d.p.display_mode === 'check'), getPath: (d) => d.path,
      widthUnits: 'pixels', getWidth: 1.6, getColor: rgba(c.ink2, 220), extensions: [dash],
      ...({ getDashArray: [1.5, 3], dashJustified: true } as object) }),
  )

  // buildings
  const all = [...split.extruded, ...split.unclassified]
  if (!street) {
    // area level: only the findings; matched buildings recede (faint at night, hidden in daylight)
    L.push(new ScatterplotLayer({ id: 'ns-bld-points', data: night ? all : all.filter((d) => d.p.match_status !== 'matched'),
      getPosition: (d) => [d.p.lon, d.p.lat], radiusUnits: 'pixels',
      getRadius: (d) => (d.p.match_status === 'matched' ? 1.6 : 3.4), stroked: !night, lineWidthUnits: 'pixels', getLineWidth: 0.8,
      getLineColor: rgba(c.ink, 120),
      getFillColor: (d) => statusColor(mode, d.p.match_status, d.p.match_status === 'matched' ? (night ? 70 : 150) : 255),
      pickable: true, updateTriggers: { getFillColor: mode } }))
  } else {
    L.push(
      new PolygonLayer({ id: 'ns-bld-flat', data: split.unclassified, getPolygon: (d) => d.polygon, stroked: true, lineWidthUnits: 'pixels',
        getLineWidth: 1, getLineColor: (d) => statusColor(mode, d.p.match_status, 200), getFillColor: rgba(c.unclassified, night ? 40 : 90) }),
      new PolygonLayer({ id: 'ns-bld-hatch', data: split.unclassified, getPolygon: (d) => d.polygon, stroked: false,
        getFillColor: (d) => statusColor(mode, d.p.match_status, 150), extensions: [hatch],
        ...({ fillPatternAtlas: hatchAtlas(), fillPatternMapping: HATCH_MAPPING, getFillPattern: () => 'hatch', getFillPatternScale: 0.45, fillPatternMask: true } as object) }),
      new PolygonLayer({ id: 'ns-bld-3d', data: split.extruded, getPolygon: (d) => d.polygon, extruded: true, wireframe: false,
        getElevation: (d) => (d.p.floors ?? 0) * FLOOR_HEIGHT_M,
        getFillColor: (d) => statusColor(mode, d.p.match_status, d.p.floors_status === 'low_confidence' ? 120 : night ? 200 : 235),
        material: { ambient: night ? 0.35 : 0.55, diffuse: 0.55, shininess: 12, specularColor: [40, 40, 50] }, pickable: true }),
    )
    if (selectedId) {
      const sel = all.find((d) => d.p.id === selectedId)
      if (sel) L.push(new PathLayer({ id: 'ns-sel', data: [sel.polygon[0]], getPath: (d) => d, widthUnits: 'pixels', getWidth: 2.5,
        getColor: rgba(c.sodium, 255), jointRounded: true }))
    }
  }

  // unlit poles: at area level barely there at night and hidden in daylight, so lit vs dark roads stay the dominant read
  L.push(new ScatterplotLayer({ id: 'ns-poles', visible: street || night, data: poles, getPosition: (d) => d.position, radiusUnits: 'pixels',
    getRadius: street ? 2.6 : 1.1, getFillColor: rgba(c.ink3, street ? (night ? 150 : 200) : 70), pickable: true }))
  L.push(
    new ScatterplotLayer({ id: 'ns-lamp-halo', visible: night || street, data: lights, getPosition: (d) => d.position, radiusUnits: 'pixels', getRadius: street ? 30 : 14,
      getFillColor: (d) => rgba(c.sodiumGlow, Math.round((night ? 42 : 26) * lamp(d.p.id))), updateTriggers: { getFillColor: lightsOn },
      ...(night ? ADD : {}) }),
    new ScatterplotLayer({ id: 'ns-lamp-inner', data: lights, getPosition: (d) => d.position, radiusUnits: 'pixels', getRadius: street ? 10 : 5,
      getFillColor: (d) => rgba(c.sodiumGlow, Math.round((night ? 110 : 70) * lamp(d.p.id))), updateTriggers: { getFillColor: lightsOn },
      ...(night ? ADD : {}) }),
    new ScatterplotLayer({ id: 'ns-lamp-core', data: lights, getPosition: (d) => d.position, radiusUnits: 'pixels', getRadius: street ? 3.5 : 2,
      getFillColor: (d) => (night ? rgba('#fff4e0', Math.round(255 * lamp(d.p.id))) : rgba(c.sodium, 255)), stroked: !night,
      lineWidthUnits: 'pixels', getLineWidth: 1, getLineColor: rgba(c.bg1, 255), pickable: true, updateTriggers: { getFillColor: lightsOn } }),
  )
  // unmapped businesses: hollow rings (approximate)
  L.push(new ScatterplotLayer({ id: 'ns-unmapped', visible: street || night, data: split.unmapped, getPosition: (d) => d.position, radiusUnits: 'pixels',
    getRadius: street ? 7 : 4, filled: false, stroked: true, lineWidthUnits: 'pixels', getLineWidth: 1.4, getLineColor: rgba(c.ink2, 220), pickable: true }))
  return L
}
