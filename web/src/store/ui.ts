/** The one global UI store (CLAUDE.md §9.2): area, selection, filters, query, layers, camera band, theme, motion,
 *  data mode. Map, KPI ribbon, table and charts all read the same `filter` / `query`, so selecting a street or a KPI
 *  filters everything together. */
import { create } from 'zustand'
import type { AnyProps, Band, MatchStatus, QueryResponse } from '@/api/types'

export type LayerKey =
  | 'buildings' | 'assets' | 'uncertainty' | 'gaps' | 'unmapped' | 'missing'
  | 'streetHealth' | 'density' | 'review' | 'coverage'
export type MapTypeMode = 'auto' | 'map' | 'satellite'
export type Theme = 'dark' | 'light'
export type Subject = 'buildings' | 'assets' | 'unmapped'
export type Tab = 'findings' | 'charts' | 'streetlights'
export type Page = 'explore' | 'review'

export interface Camera { lat: number; lng: number; zoom: number; heading: number; tilt: number; bounds: [number, number, number, number] | null }

export interface Filter {
  subject: Subject
  street: string | null
  match: MatchStatus | null
  /** observed use value, or '__none' = not classified (D9) */
  use: string | null
  nameQ: 'good' | 'unverified' | null
  google: boolean
  assetType: 'pole' | 'streetlight' | null
  triangulated: boolean
  /** only items waiting in the review queue */
  review: boolean
}
export const EMPTY_FILTER: Filter = {
  subject: 'buildings', street: null, match: null, use: null, nameQ: null, google: false, assetType: null, triangulated: false, review: false,
}
export const filterActive = (f: Filter) =>
  f.subject !== 'buildings' || !!(f.street || f.match || f.use || f.nameQ || f.google || f.assetType || f.triangulated || f.review)

export interface Dive { pano: string; heading: number; pitch: number; fov: number; at: { lat: number; lng: number } | null }
export interface ReviewFocus { area: string; ids: number[]; label: string }

const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const stored = <T,>(k: string, d: T): T => {
  try { const v = localStorage.getItem(`gc.${k}`); return v == null ? d : (JSON.parse(v) as T) } catch { return d }
}
const persist = (k: string, v: unknown) => { try { localStorage.setItem(`gc.${k}`, JSON.stringify(v)) } catch { /* private mode */ } }

export const bandOf = (zoom: number): Band => (zoom < 13.5 ? 'city' : zoom < 16.5 ? 'area' : zoom < 18.5 ? 'street' : 'object')

interface UiState {
  area: string | null
  theme: Theme
  /** reduce-motion / 2D mode (D3): no tilt, no extrusion, no camera animation */
  flat: boolean
  mapType: MapTypeMode
  layers: Record<LayerKey, boolean>
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
  tab: Tab
  panelOpen: boolean
  dive: Dive | null
  svCam: { lat: number; lng: number; heading: number } | null
  analyse: boolean
  paletteOpen: boolean
  page: Page
  reviewFocus: ReviewFocus | null
  /** bumps when something asks the map to frame the current filter/query/street */
  frameTick: number
  setArea: (slug: string) => void
  setTheme: (t: Theme) => void
  setFlat: (f: boolean) => void
  setMapType: (m: MapTypeMode) => void
  toggleLayer: (k: LayerKey) => void
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
  setTab: (t: Tab) => void
  setPanelOpen: (o: boolean) => void
  setDive: (d: Dive | null) => void
  setSvCam: (c: UiState['svCam']) => void
  setAnalyse: (a: boolean) => void
  setPaletteOpen: (o: boolean) => void
  setPage: (p: Page) => void
  sendToReview: (f: ReviewFocus) => void
}

const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  buildings: true, assets: true, uncertainty: true, gaps: true, unmapped: true, missing: true,
  streetHealth: true, density: true, review: false, coverage: false,
}

const pageFromHash = (): Page => (typeof location !== 'undefined' && location.hash.startsWith('#/review') ? 'review' : 'explore')

export const useUi = create<UiState>((set, get) => ({
  area: stored('area', 'ward29'),
  theme: stored<Theme>('theme', 'dark'),
  // 3D is on by default (key renamed so earlier test sessions don't carry over); OS reduced-motion still starts in 2D (D3)
  flat: !stored('threeD', !prefersReducedMotion),
  mapType: stored<MapTypeMode>('mapType', 'auto'),
  layers: { ...DEFAULT_LAYERS, ...stored('layers', {}) },
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
  tab: 'findings',
  panelOpen: true,
  dive: null,
  svCam: null,
  analyse: false,
  paletteOpen: false,
  page: pageFromHash(),
  reviewFocus: null,
  frameTick: 0,
  setArea: (area) => {
    persist('area', area)
    set({ area, selected: null, filter: EMPTY_FILTER, kpi: null, query: null, dive: null, reviewFocus: null })
  },
  setTheme: (theme) => { persist('theme', theme); document.documentElement.dataset.theme = theme; set({ theme }) },
  setFlat: (flat) => { persist('threeD', !flat); set({ flat }) },
  setMapType: (mapType) => { persist('mapType', mapType); set({ mapType }) },
  toggleLayer: (k) => { const layers = { ...get().layers, [k]: !get().layers[k] }; persist('layers', layers); set({ layers }) },
  setCamera: (camera) => {
    const band = bandOf(camera.zoom)
    set(band === get().band ? { camera } : { camera, band })
  },
  setHovered: (hovered) => set({ hovered }),
  select: (selected) => set({ selected, ...(selected ? {} : { dive: null }) }),
  setOffline: (offline) => { if (offline !== get().offline) set({ offline }) },
  setApiReachable: (apiReachable) => { if (apiReachable !== get().apiReachable) set({ apiReachable }) },
  setFilter: (f, opts) => set((s) => ({
    filter: { ...s.filter, ...f }, query: null,
    kpi: opts && 'kpi' in opts ? opts.kpi ?? null : s.kpi,
    frameTick: opts?.frame ? s.frameTick + 1 : s.frameTick,
  })),
  resetFilter: () => set({ filter: EMPTY_FILTER, kpi: null, query: null }),
  // a by-street question (grouped chart) stays open while you pick its streets; other questions give way to the filter
  selectStreet: (street) => set((s) => ({ filter: { ...s.filter, street }, query: s.query?.groups ? s.query : null, frameTick: s.frameTick + 1 })),
  setQuery: (query) => set((s) => ({ query, frameTick: query ? s.frameTick + 1 : s.frameTick })),
  setQueryBusy: (queryBusy) => set({ queryBusy }),
  setTab: (tab) => set({ tab, panelOpen: true }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setDive: (dive) => set({ dive, ...(dive ? {} : { svCam: null }) }),
  setSvCam: (svCam) => set({ svCam }),
  setAnalyse: (analyse) => set({ analyse, ...(analyse ? { selected: null, dive: null } : {}) }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setPage: (page) => { location.hash = page === 'review' ? '#/review' : ''; set({ page, dive: null }) },
  sendToReview: (reviewFocus) => { location.hash = '#/review'; set({ reviewFocus, page: 'review', dive: null }) },
}))

if (typeof window !== 'undefined') window.addEventListener('hashchange', () => useUi.setState({ page: pageFromHash() }))
