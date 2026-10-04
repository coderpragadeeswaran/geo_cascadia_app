/** NIGHT SURVEY — the one source of design tokens (colours, type, spacing, radii, motion, map styling).
 *  CSS custom properties are generated from this file (`cssVars`), deck.gl reads the RGBA values directly.
 *  Documented in docs/DESIGN.md. Status palettes validated with the dataviz palette checker (see DESIGN.md). */

export type Mode = 'night' | 'daylight'

const palette = {
  night: {
    // surfaces: the city at night — near-black indigo, not neutral grey
    bg0: '#070a14',        // page / deepest
    bg1: '#0b1020',        // panels (flat, no glass)
    bg2: '#121936',        // raised: popovers, sheets
    scrim: 'rgba(7,10,20,0.82)',
    line: 'rgba(160,175,220,0.13)',
    lineStrong: 'rgba(160,175,220,0.28)',
    // ink: moonlit warm white
    ink: '#ebe6da',
    // raised for readability (pass B review): ink2 ≥ 9.9:1, ink3 ≥ 6.0:1 on every surface (WCAG AA 4.5:1)
    ink2: '#bec4d9',
    ink3: '#9098b5',
    // signature accent: sodium-vapour street lamp
    sodium: '#ffa23a',
    sodiumGlow: '#ffc27a',
    sodiumSoft: 'rgba(255,162,58,0.14)',
    // status v2 "soft" (validated vs each other AND sodium: CVD ΔE ≥ 8.2, normal ≥ 16.4, contrast ≥ 3:1 on bg1)
    matched: '#6a7fb0',    // dusk slate: nothing wrong, recedes
    discrepancy: '#7dcad6',// glacier
    noRecord: '#e7819f',   // peony
    review: '#ebe6da',     // chalk: dashed outline, not a fill
    unclassified: '#4a5270',
    dark: '#02040a',       // an unlit stretch of road
    darkEdge: '#34407a',
    // D54 lighting priority of a possible dark stretch: one hue (the dark edge's indigo), dim->bright = low->high.
    // D57: re-stepped to saturated, never pale (adjacent ΔE ≥ 16.8 normal / 15.2 CVD, dataviz validator; low 2.45:1 on
    // bg1 → relief: the black core, the casing, width and the word). Drawn core + edge + casing (darkCasing).
    prioLow: '#3446b8',
    prioMedium: '#6b78ee',
    prioHigh: '#a9b1ff',
    darkCasing: '#070a14', // D57: thin outer line of a dark stretch, so it never melts into the street highlight
  },
  daylight: {
    // paper & ink for projectors
    bg0: '#f4f0e6',
    bg1: '#fbf8f1',
    bg2: '#ffffff',
    scrim: 'rgba(244,240,230,0.9)',
    line: 'rgba(27,31,42,0.12)',
    lineStrong: 'rgba(27,31,42,0.3)',
    ink: '#1b1f2a',
    // darkened for readability (pass B review): ink2 ≥ 8.6:1, ink3 ≥ 5.5:1, sodium ≥ 5.3:1 on paper (WCAG AA 4.5:1)
    ink2: '#3d4356',
    ink3: '#5b6070',
    sodium: '#9c4e07',
    sodiumGlow: '#e08a2a',
    sodiumSoft: 'rgba(182,92,9,0.12)',
    matched: '#8e9dc4',    // pale slate: recedes on paper (2.4:1 → always drawn with an ink outline + in the table)
    discrepancy: '#00849f',
    noRecord: '#cc1f63',
    review: '#1b1f2a',
    unclassified: '#b9b2a2',
    dark: '#1b1f2a',       // unlit stretch = heavy ink
    darkEdge: '#1b1f2a',
    // D54 priority on paper: light -> deep indigo = low -> high; the PDF report uses the same ramp.
    // D57: re-stepped so Medium and Low are no longer pale (adjacent ΔE ≥ 17.6 normal / 16.0 CVD; low 2.36:1 on paper →
    // relief: the ink core, the white casing, width and the word)
    prioLow: '#8f99e3',
    prioMedium: '#5560cc',
    prioHigh: '#2a2a8f',
    darkCasing: '#ffffff', // D57: white outer line, so the ink core never merges with the (ink) street highlight
  },
} as const
export type Palette = { [K in keyof (typeof palette)['night']]: string }

/** v1 night statuses (first preview), kept only for the old-vs-new comparison in the preview */
export const statusV1Night = { matched: '#7c93c9', discrepancy: '#3fd4e0', noRecord: '#ff4f9a' } as const
export const colors: Record<Mode, Palette> = palette

export const type = {
  // Anek Tamil: one variable family for Latin + Tamil (width 75–125 %, weight 100–800), by Ek Type.
  // Martian Mono: instrument-like mono for measurements, counts and IDs (tabular by nature).
  sans: "'Anek Tamil Variable', 'Anek Tamil', system-ui, sans-serif",
  mono: "'Martian Mono Variable', 'Martian Mono', ui-monospace, monospace",
  // size / line-height / weight / width (font-stretch)
  scale: {
    display: { size: 32, lh: 1.0, weight: 640, stretch: 78 },   // area title, hero numbers' labels
    title: { size: 20, lh: 1.15, weight: 600, stretch: 85 },
    body: { size: 17, lh: 1.45, weight: 420, stretch: 100 },
    small: { size: 15, lh: 1.4, weight: 430, stretch: 100 },
    micro: { size: 13, lh: 1.2, weight: 600, stretch: 105, tracking: '0.1em', caps: true },   // labels, small caps
    figure: { size: 26, lh: 1.0, weight: 300, stretch: 100, font: 'mono' },                        // KPI numbers
    data: { size: 14, lh: 1.3, weight: 400, stretch: 90, font: 'mono' },                         // IDs, metres, coords
  },
} as const

export const space = { 0: 0, 1: 2, 2: 4, 3: 8, 4: 12, 5: 16, 6: 24, 7: 32, 8: 48 } as const
export const radii = { hair: 2, control: 6, sheet: 10 } as const   // sharper than the glass UI (was 14)

export const motion = {
  quick: 120, base: 200, slow: 320,
  flyIn: 2600,          // opening flight over the dark city
  lightsOn: 1800,       // streetlights fade on, staggered
  ease: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
  easeInOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
} as const

/** deck.gl colours */
export type RGBA = [number, number, number, number]
export const rgba = (hex: string, a = 255): RGBA =>
  [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), a]
export const statusColor = (m: Mode, s: string | null | undefined, a = 255): RGBA => {
  const c = colors[m]
  return rgba(s === 'matched' ? c.matched : s === 'discrepancy' ? c.discrepancy : s === 'no_record' ? c.noRecord : c.unclassified, a)
}

/** CSS custom properties for a mode (set on the root of a themed subtree) */
export function cssVars(m: Mode): Record<string, string> {
  const c = colors[m]
  const v: Record<string, string> = { colorScheme: m === 'night' ? 'dark' : 'light' }
  for (const [k, val] of Object.entries(c)) v[`--ns-${k.replace(/[A-Z]/g, (x) => '-' + x.toLowerCase())}`] = val
  v['--ns-sans'] = type.sans
  v['--ns-mono'] = type.mono
  v['--ns-ease'] = motion.ease
  v['--ns-r-hair'] = `${radii.hair}px`
  v['--ns-r-control'] = `${radii.control}px`
  v['--ns-r-sheet'] = `${radii.sheet}px`
  return v
}

/** Base-map colours: ONE palette feeding both formats below, so the Map ID style and the preview can't drift apart. */
export const mapBase = {
  night: {
    background: '#070a14', land: '#0b1020', landCover: '#0a0f1f', urban: '#0e1429', water: '#050814',
    local: '#161d38', arterial: '#1b2445', highway: '#232d54', casing: '#0b1020', trail: '#131a33',
    label: '#6b7391', labelLocal: '#4f587a', labelWater: '#4f587a', halo: '#070a14', border: '#2a3561',
    // parks, sports grounds, cemeteries, vegetation: muted to the land's own indigo (Google's green competed with sodium)
    park: '#0d1524', vegetation: '#0b111f',
  },
  daylight: {
    background: '#f4f0e6', land: '#efe9dc', landCover: '#efe9dc', urban: '#e8e1d2', water: '#d3dbe3',
    local: '#fbf8f1', arterial: '#fbf8f1', highway: '#ffffff', casing: '#d6cdb9', trail: '#f1ebdf',
    label: '#6b6457', labelLocal: '#857d6e', labelWater: '#6b7a8a', halo: '#f4f0e6', border: '#c9bfa9',
    // parks etc.: paper with a trace of olive instead of Google's green
    park: '#e6e4d4', vegetation: '#ebe6d8',
  },
} as const

/** Legacy styles array (google.maps.MapTypeStyle[]). Only for the preview's raster "intended style" map: the JS API
 *  `styles` option still takes this format and is ignored on Map ID (vector) maps. Kept local so Node can import it. */
export interface MapStyleRule { featureType?: string; elementType?: string; stylers: Record<string, string | number>[] }
const legacy = (b: (typeof mapBase)[Mode], night: boolean): MapStyleRule[] => [
  { elementType: 'geometry', stylers: [{ color: b.land }] },
  { elementType: 'labels.text.fill', stylers: [{ color: b.label }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: b.halo }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: b.border }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: b.urban }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: b.landCover }] },
  { featureType: 'landscape.natural.landcover', elementType: 'geometry', stylers: [{ color: b.vegetation }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ visibility: 'on' }, { color: b.park }] },
  { featureType: 'road', elementType: night ? 'geometry' : 'geometry.fill', stylers: [{ color: b.local }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: b.casing }] },
  { featureType: 'road.arterial', elementType: night ? 'geometry' : 'geometry.fill', stylers: [{ color: b.arterial }] },
  { featureType: 'road.highway', elementType: night ? 'geometry' : 'geometry.fill', stylers: [{ color: b.highway }] },
  { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ color: b.labelLocal }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: b.water }] },
]
export const mapStyleJson: Record<Mode, MapStyleRule[]> = { night: legacy(mapBase.night, true), daylight: legacy(mapBase.daylight, false) }

/** NEW cloud-based maps styling JSON (Google Cloud > Map Styles > Create style > JSON > Upload JSON File). Reference:
 *  developers.google.com/maps/documentation/javascript/cloud-customization/json-reference. The stylers each feature
 *  accepts come from Google's schema (developers.google.com/static/maps/cbms-json-schema.json); CLOUD_STYLERS below
 *  copies that schema for every id used here and `npm run map-styles` refuses to write anything else.
 *  Building 3D vs Footprints is a Map Settings toggle (not in the JSON). */
export interface CloudStyleRule {
  id: string
  geometry?: { visible?: boolean; fillColor?: string; strokeColor?: string; fillOpacity?: number; strokeOpacity?: number; strokeWidth?: number }
  label?: { visible?: boolean; textFillColor?: string; textStrokeColor?: string; pinFillColor?: string; pinGlyphColor?: string; pinOutlineColor?: string }
}
export interface CloudStyle { variant: 'light' | 'dark'; backgroundColor: string; metadata: Record<string, string>; styles: CloudStyleRule[] }

export function cloudMapStyle(m: Mode): CloudStyle {
  const b = mapBase[m]
  const text = (fill: string) => ({ textFillColor: fill, textStrokeColor: b.halo })
  return {
    variant: m === 'night' ? 'dark' : 'light',
    backgroundColor: b.background,
    metadata: { name: m === 'night' ? 'GEO Night Survey (dark mode)' : 'GEO Night Survey daylight (light mode)', source: 'web/src/design/tokens.ts' },
    styles: [
      // points of interest: no pins or labels (the data layers are the only points on the map)
      { id: 'pointOfInterest', label: { visible: false } },
      { id: 'infrastructure.transitStation', label: { visible: false } },
      // buildings hidden (footprints and 3D meshes); our extruded buildings are the only buildings on the map
      { id: 'infrastructure.building', geometry: { visible: false } },
      { id: 'infrastructure.building.commercial', geometry: { visible: false } },
      { id: 'infrastructure.businessCorridor', geometry: { visible: false } },
      // ground
      { id: 'natural.land', geometry: { fillColor: b.land } },
      { id: 'natural.land.landCover', geometry: { fillColor: b.landCover } },
      // green areas muted (parks, sports grounds, nature reserves, cemeteries, vegetation): no green competing with sodium
      { id: 'natural.land.landCover.forest', geometry: { fillColor: b.vegetation } },
      { id: 'natural.land.landCover.shrub', geometry: { fillColor: b.vegetation } },
      { id: 'natural.land.landCover.crops', geometry: { fillColor: b.vegetation } },
      { id: 'natural.land.landCover.dryCrops', geometry: { fillColor: b.vegetation } },
      { id: 'pointOfInterest.recreation', geometry: { fillColor: b.park } },
      { id: 'pointOfInterest.recreation.park', geometry: { fillColor: b.park } },
      { id: 'pointOfInterest.recreation.natureReserve', geometry: { fillColor: b.park } },
      { id: 'pointOfInterest.recreation.sportsField', geometry: { fillColor: b.park } },
      { id: 'pointOfInterest.recreation.golfCourse', geometry: { fillColor: b.park } },
      { id: 'pointOfInterest.other.cemetery', geometry: { fillColor: b.park } },
      { id: 'infrastructure.urbanArea', geometry: { fillColor: b.urban } },
      { id: 'natural.water', geometry: { fillColor: b.water }, label: text(b.labelWater) },
      // roads: quiet, so our lit roads and dark stretches carry the meaning
      { id: 'infrastructure.roadNetwork.road', geometry: { fillColor: b.local, strokeColor: b.casing }, label: text(b.label) },
      { id: 'infrastructure.roadNetwork.road.local', geometry: { fillColor: b.local }, label: text(b.labelLocal) },
      { id: 'infrastructure.roadNetwork.road.noOutlet', geometry: { fillColor: b.local }, label: text(b.labelLocal) },
      { id: 'infrastructure.roadNetwork.road.arterial', geometry: { fillColor: b.arterial } },
      { id: 'infrastructure.roadNetwork.road.highway', geometry: { fillColor: b.highway } },
      { id: 'infrastructure.roadNetwork.ramp', geometry: { fillColor: b.highway, strokeColor: b.casing } },
      { id: 'infrastructure.roadNetwork.noTraffic', geometry: { fillColor: b.trail } },
      { id: 'infrastructure.roadNetwork.parkingAisle', geometry: { visible: false } },
      { id: 'infrastructure.roadNetwork.roadShield', label: { visible: false } },
      { id: 'infrastructure.roadNetwork.roadSign', label: { visible: false } },
      // place names stay for context, muted; land parcel lines off (the schema allows geometry only for landParcel)
      { id: 'political', label: text(b.label) },
      { id: 'political.landParcel', geometry: { visible: false } },
    ],
  }
}

const LABEL_TEXT = ['textFillColor', 'textFillOpacity', 'textStrokeColor', 'textStrokeOpacity', 'visible']
const GEO_FILL = ['fillColor', 'fillOpacity', 'visible']
const GEO_FULL = ['fillColor', 'fillOpacity', 'strokeColor', 'strokeOpacity', 'strokeWidth', 'visible']
const POI_LABEL = ['pinFillColor', 'pinGlyphColor', 'pinOutlineColor', ...LABEL_TEXT]
/** Stylers per feature id as Google's schema (cbms-json-schema.json) allows them, for every id used above. */
export const CLOUD_STYLERS: Record<string, { geometry: string[]; label: string[] }> = {
  pointOfInterest: { geometry: GEO_FILL, label: POI_LABEL },
  'pointOfInterest.recreation': { geometry: GEO_FILL, label: POI_LABEL },
  'pointOfInterest.recreation.park': { geometry: GEO_FILL, label: POI_LABEL },
  'pointOfInterest.recreation.natureReserve': { geometry: GEO_FILL, label: LABEL_TEXT },
  'pointOfInterest.recreation.sportsField': { geometry: GEO_FILL, label: POI_LABEL },
  'pointOfInterest.recreation.golfCourse': { geometry: GEO_FILL, label: POI_LABEL },
  'pointOfInterest.other.cemetery': { geometry: GEO_FILL, label: POI_LABEL },
  'infrastructure.transitStation': { geometry: [], label: ['pinFillColor', ...LABEL_TEXT] },
  'infrastructure.building': { geometry: GEO_FULL, label: LABEL_TEXT },
  'infrastructure.building.commercial': { geometry: GEO_FULL, label: [] },
  'infrastructure.businessCorridor': { geometry: GEO_FILL, label: [] },
  'natural.land': { geometry: GEO_FILL, label: [] },
  'natural.land.landCover': { geometry: GEO_FILL, label: [] },
  'natural.land.landCover.forest': { geometry: GEO_FILL, label: [] },
  'natural.land.landCover.shrub': { geometry: GEO_FILL, label: [] },
  'natural.land.landCover.crops': { geometry: GEO_FILL, label: [] },
  'natural.land.landCover.dryCrops': { geometry: GEO_FILL, label: [] },
  'infrastructure.urbanArea': { geometry: GEO_FILL, label: [] },
  'natural.water': { geometry: GEO_FILL, label: LABEL_TEXT },
  'infrastructure.roadNetwork.road': { geometry: GEO_FULL, label: LABEL_TEXT },
  'infrastructure.roadNetwork.road.local': { geometry: GEO_FULL, label: LABEL_TEXT },
  'infrastructure.roadNetwork.road.noOutlet': { geometry: GEO_FULL, label: LABEL_TEXT },
  'infrastructure.roadNetwork.road.arterial': { geometry: GEO_FULL, label: LABEL_TEXT },
  'infrastructure.roadNetwork.road.highway': { geometry: GEO_FULL, label: LABEL_TEXT },
  'infrastructure.roadNetwork.ramp': { geometry: GEO_FULL, label: LABEL_TEXT },
  'infrastructure.roadNetwork.noTraffic': { geometry: GEO_FULL, label: LABEL_TEXT },
  'infrastructure.roadNetwork.parkingAisle': { geometry: GEO_FULL, label: [] },
  'infrastructure.roadNetwork.roadShield': { geometry: [], label: ['visible'] },
  'infrastructure.roadNetwork.roadSign': { geometry: [], label: ['pinFillColor', 'textFillColor', 'textFillOpacity', 'visible'] },
  political: { geometry: ['fillColor', 'visible'], label: ['pinFillColor', ...LABEL_TEXT] },
  'political.landParcel': { geometry: ['strokeColor', 'strokeOpacity', 'strokeWidth', 'visible'], label: [] },
}

/** Problems of a cloud style against CLOUD_STYLERS (empty list = valid). */
export function checkCloudStyle(st: CloudStyle): string[] {
  const out: string[] = []
  for (const r of st.styles) {
    const ok = CLOUD_STYLERS[r.id]
    if (!ok) { out.push(`${r.id}: id not in CLOUD_STYLERS (copy its stylers from Google's schema first)`); continue }
    for (const k of Object.keys(r.geometry ?? {})) if (!ok.geometry.includes(k)) out.push(`${r.id}: geometry.${k} is not supported`)
    for (const k of Object.keys(r.label ?? {})) if (!ok.label.includes(k)) out.push(`${r.id}: label.${k} is not supported`)
  }
  return out
}
