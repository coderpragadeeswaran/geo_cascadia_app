/** The one global UI store (CLAUDE.md §9.2): area, selection, filters, query, layers, camera band, mode, motion,
 *  data mode, page. Map, KPIs, panel and table all read the same `filter` / `query`, so selecting a street or a KPI
 *  filters everything together. At most one panel is open (docs/DESIGN.md): see `panelOf`. */
import { create } from 'zustand'
import type { AnyProps, Band, MatchStatus, QueryResponse } from '@/api/types'
import { applyMode } from '@/design/mode'
import type { Mode } from '@/design/tokens'

export type LayerKey =
  | 'buildings' | 'assets' | 'uncertainty' | 'gaps' | 'unmapped' | 'missing'
  | 'streetHealth' | 'density' | 'review' | 'coverage'
/** base map in Daylight (Night is always the dark roadmap: Cloud dark-mode styles do not apply to satellite) */
export type MapTypeMode = 'map' | 'satellite'
export type { Mode }
export type Subject = 'buildings' | 'assets' | 'unmapped'
export type Page = 'explore' | 'review' | 'hood' | 'trust' | 'jobs'
export const PAGES: Page[] = ['explore', 'review', 'hood', 'trust', 'jobs']

export interface Camera { lat: number; lng: number; zoom: number; heading: number; tilt: number; bounds: [number, number, number, number] | null }

export interface Filter {
  subject: Subject
  street: string | null
  match: MatchStatus | null
  /** observed use value, or '__none' = use not known (not classified, D9) */
  use: string | null
  nameQ: 'good' | 'unverified' | null
  google: boolean
  assetType: 'pole' | 'streetlight' | null
  triangulated: boolean
  /** only items waiting in the review queue */
  review: boolean
  /** the streetlight-gap list (dark stretches) */
  gaps: boolean
}
export const EMPTY_FILTER: Filter = {
  subject: 'buildings', street: null, match: null, use: null, nameQ: null, google: false, assetType: null, triangulated: false,
  review: false, gaps: false,
}
export const filterActive = (f: Filter) =>
  f.subject !== 'buildings' || !!(f.street || f.match || f.use || f.nameQ || f.google || f.assetType || f.triangulated || f.review || f.gaps)
/** an attribute filter (not the street, not the record type shown in the table) */
export const attrActive = (f: Filter) => !!(f.match || f.use || f.nameQ || f.google || f.assetType || f.triangulated || f.review || f.gaps)

export interface Dive { pano: string; heading: number; pitch: number; fov: number; at: { lat: number; lng: number } | null }
export interface ReviewFocus { area: string; ids: number[]; label: string }
export type DriveView = 'forward' | 'left' | 'right'
export interface Drive { street: string; branch: number; i: number; view: DriveView }
/** Hood / Trust reading level (P5): same numbers, plain sentences or method names + sources */
export type Detail = 'plain' | 'technical'

const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const stored = <T,>(k: string, d: T): T => {
  try { const v = localStorage.getItem(`gc.${k}`); return v == null ? d : (JSON.parse(v) as T) } catch { return d }
}
const persist = (k: string, v: unknown) => { try { localStorage.setItem(`gc.${k}`, JSON.stringify(v)) } catch { /* private mode */ } }

/** Night is the default (docs/DESIGN.md); the key is new, so earlier light/dark test sessions don't carry over. */
export const storedMode = (): Mode => (stored<string>('mode', 'night') === 'daylight' ? 'daylight' : 'night')

export const bandOf = (zoom: number): Band => (zoom < 13.5 ? 'city' : zoom < 16.5 ? 'area' : zoom < 18.5 ? 'street' : 'object')

/** #/trust/detector → page trust, section "detector" */
export function routeFromHash(h = typeof location !== 'undefined' ? location.hash : ''): { page: Page; section: string | null } {
  const m = /^#\/([a-z]+)(?:\/([\w-]+))?/.exec(h)
  const page = (m && (PAGES as string[]).includes(m[1]) ? m[1] : 'explore') as Page
  return { page, section: m?.[2] ?? null }
}

interface UiState {
  area: string | null
  mode: Mode
  /** reduce-motion / 2D mode (D3): no tilt, no extrusion, no camera animation */
  flat: boolean
  mapType: MapTypeMode
  layers: Record<LayerKey, boolean>
  minimap: boolean
  band: Band
  camera: Camera | null
  hovered: { props: AnyProps; x: number; y: number } | null
  selected: AnyProps | null
  offline: boolean
  apiReachable: boolean
  filter: Filter
  kpi: string | null
  query: QueryResponse | null
  queryBusy: boolean
  /** the click-only question builder is open (no question typed yet) */
  builder: boolean
  /** the "What stands out" overview panel (opened by the Findings button) */
  panelOpen: boolean
  dive: Dive | null
  svCam: { lat: number; lng: number; heading: number } | null
  analyse: boolean
  drive: Drive | null
  paletteOpen: boolean
  page: Page
  /** anchor inside a verifier page (#/trust/detector) */
  section: string | null
  reviewFocus: ReviewFocus | null
  /** who is reviewing: asked once, remembered in this browser, saved with every decision (no login) */
  reviewer: string | null
  /** Plain / Technical on Under the Hood and Trust, remembered in this browser */
  detail: Detail
  /** bumps when something asks the map to frame the current filter/query/street */
  frameTick: number
  setArea: (slug: string) => void
  setMode: (m: Mode) => void
  setFlat: (f: boolean) => void
  setMapType: (m: MapTypeMode) => void
  toggleLayer: (k: LayerKey) => void
  setMinimap: (on: boolean) => void
  setCamera: (c: Camera) => void
  setHovered: (h: UiState['hovered']) => void
  select: (p: AnyProps | null) => void
  setOffline: (o: boolean) => void
  setApiReachable: (r: boolean) => void
  setFilter: (f: Partial<Filter>, opts?: { kpi?: string | null; frame?: boolean }) => void
  resetFilter: () => void
  selectStreet: (street: string | null) => void
  setQuery: (q: QueryResponse | null) => void
  setQueryBusy: (b: boolean) => void
  setBuilder: (b: boolean) => void
  setPanelOpen: (o: boolean) => void
  closePanel: () => void
  setDive: (d: Dive | null) => void
  setSvCam: (c: UiState['svCam']) => void
  setAnalyse: (a: boolean) => void
  setDrive: (d: Drive | null) => void
  setPaletteOpen: (o: boolean) => void
  go: (page: Page, section?: string | null) => void
  sendToReview: (f: ReviewFocus) => void
  setReviewer: (name: string | null) => void
  setDetail: (d: Detail) => void
}

const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  buildings: true, assets: true, uncertainty: true, gaps: true, unmapped: true, missing: true,
  // declutter (docs/DESIGN.md): findings density and street-health colouring are opt-in; coverage lines belong to Analyse
  streetHealth: false, density: false, review: false, coverage: false,
}

export const useUi = create<UiState>((set, get) => ({
  area: stored('area', 'ward29'),
  mode: storedMode(),
  // 3D is on by default; OS reduced-motion still starts in 2D (D3)
  flat: !stored('threeD', !prefersReducedMotion),
  mapType: stored<string>('mapType', 'map') === 'satellite' ? 'satellite' : 'map',
  layers: { ...DEFAULT_LAYERS, ...stored('layers.v2', {}) },
  minimap: stored('minimap', false),
  band: 'area',
  camera: null,
  hovered: null,
  selected: null,
  offline: false,
  apiReachable: true,
  filter: EMPTY_FILTER,
  kpi: null,
  query: null,
  queryBusy: false,
  builder: false,
  panelOpen: false,
  dive: null,
  svCam: null,
  analyse: false,
  drive: null,
  paletteOpen: false,
  ...routeFromHash(),
  reviewFocus: null,
  reviewer: stored<string | null>('reviewer', null),
  detail: stored<string>('detail', 'plain') === 'technical' ? 'technical' : 'plain',
  frameTick: 0,
  setArea: (area) => {
    persist('area', area)
    set({ area, selected: null, filter: EMPTY_FILTER, kpi: null, query: null, dive: null, drive: null, reviewFocus: null })
  },
  setMode: (mode) => { persist('mode', mode); applyMode(mode); set({ mode }) },
  setFlat: (flat) => { persist('threeD', !flat); set({ flat }) },
  setMapType: (mapType) => { persist('mapType', mapType); set({ mapType }) },
  toggleLayer: (k) => { const layers = { ...get().layers, [k]: !get().layers[k] }; persist('layers.v2', layers); set({ layers }) },
  setMinimap: (minimap) => { persist('minimap', minimap); set({ minimap }) },
  setCamera: (camera) => {
    const band = bandOf(camera.zoom)
    set(band === get().band ? { camera } : { camera, band })
  },
  setHovered: (hovered) => set({ hovered }),
  select: (selected) => set({ selected, ...(selected ? {} : { dive: null }) }),
  setOffline: (offline) => { if (offline !== get().offline) set({ offline }) },
  setApiReachable: (apiReachable) => { if (apiReachable !== get().apiReachable) set({ apiReachable }) },
  setFilter: (f, opts) => set((s) => ({
    filter: { ...s.filter, ...f }, query: null, selected: null,
    kpi: opts && 'kpi' in opts ? opts.kpi ?? null : s.kpi,
    frameTick: opts?.frame ? s.frameTick + 1 : s.frameTick,
  })),
  resetFilter: () => set({ filter: EMPTY_FILTER, kpi: null, query: null }),
  // a by-street question (grouped chart) stays open while you pick its streets; other questions give way to the street
  selectStreet: (street) => set((s) => ({ filter: { ...s.filter, street }, query: s.query?.groups ? s.query : null, selected: null,
    frameTick: s.frameTick + 1 })),
  // one scope (review fix 3): a question replaces the street / KPI filter with its own street (Street chip), so the
  // KPIs, map and list never show one street while the answer counts another. A by-street chart covers every street.
  setQuery: (query) => set((s) => ({ query, selected: null, builder: query ? s.builder : false,
    ...(query ? { kpi: null, filter: { ...EMPTY_FILTER, street: query.groups ? null : query.parsed_filters.street ?? null } } : {}),
    frameTick: query && (query.accepted || !query.understanding || query.understanding.status === 'ok') ? s.frameTick + 1 : s.frameTick })),
  setQueryBusy: (queryBusy) => set({ queryBusy }),
  setBuilder: (builder) => set({ builder, ...(builder ? { selected: null, analyse: false } : {}) }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  /** close whatever the one panel shows (selection → question → KPI → street → overview), innermost first */
  closePanel: () => {
    const s = get()
    if (s.selected) return set({ selected: null, dive: null })
    if (s.query || s.builder) return set({ query: null, builder: false })
    if (s.kpi || attrActive(s.filter)) return set({ kpi: null, filter: { ...EMPTY_FILTER, street: s.filter.street } })
    if (s.filter.street) return set({ filter: { ...s.filter, street: null } })
    set({ panelOpen: false })
  },
  setDive: (dive) => set({ dive, ...(dive ? {} : { svCam: null }) }),
  setSvCam: (svCam) => set({ svCam }),
  setAnalyse: (analyse) => set({ analyse, ...(analyse ? { selected: null, dive: null, drive: null } : {}) }),
  setDrive: (drive) => set({ drive, ...(drive ? { analyse: false, dive: null, selected: null } : {}) }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  go: (page, section = null) => {
    const h = page === 'explore' ? '' : `#/${page}${section ? `/${section}` : ''}`
    if (location.hash !== h) history.pushState(null, '', h || location.pathname + location.search)
    set({ page, section, dive: null, ...(page === 'explore' ? {} : { hovered: null }) })
  },
  sendToReview: (reviewFocus) => {
    history.pushState(null, '', '#/review')
    set({ reviewFocus, page: 'review', section: null, dive: null })
  },
  setReviewer: (name) => { const reviewer = name?.trim().slice(0, 120) || null; persist('reviewer', reviewer); set({ reviewer }) },
  setDetail: (detail) => { persist('detail', detail); set({ detail }) },
}))

if (typeof window !== 'undefined') {
  const sync = () => useUi.setState(routeFromHash())
  window.addEventListener('hashchange', sync)
  window.addEventListener('popstate', sync)
}

/** Which single panel the map shows (docs/DESIGN.md: panels only for a question or a selection). */
export type PanelKind = 'evidence' | 'drive' | 'query' | 'kpi' | 'street' | 'overview' | null
export function panelOf(s: Pick<UiState, 'selected' | 'drive' | 'query' | 'builder' | 'kpi' | 'filter' | 'panelOpen' | 'analyse'>): PanelKind {
  if (s.analyse) return null
  if (s.drive) return 'drive'
  if (s.selected && s.selected.kind !== 'area' && s.selected.kind !== 'street') return 'evidence'
  if (s.query || s.builder) return 'query'
  if (s.kpi || attrActive(s.filter)) return 'kpi'
  if (s.filter.street) return 'street'
  return s.panelOpen ? 'overview' : null
}
export const usePanel = () => useUi((s) => panelOf(s))
