/** The one global UI store (CLAUDE.md §9.2): area, selection, layers, camera band, theme, motion, data mode. */
import { create } from 'zustand'
import type { AnyProps, Band } from '@/api/types'

export type LayerKey =
  | 'buildings' | 'assets' | 'uncertainty' | 'gaps' | 'unmapped' | 'missing'
  | 'streetHealth' | 'density' | 'review' | 'coverage'
export type MapTypeMode = 'auto' | 'map' | 'satellite'
export type Theme = 'dark' | 'light'

export interface Camera { lat: number; lng: number; zoom: number; heading: number; tilt: number; bounds: [number, number, number, number] | null }

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
}

const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  buildings: true, assets: true, uncertainty: true, gaps: true, unmapped: true, missing: true,
  streetHealth: true, density: true, review: false, coverage: false,
}

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
  setArea: (area) => { persist('area', area); set({ area, selected: null }) },
  setTheme: (theme) => { persist('theme', theme); document.documentElement.dataset.theme = theme; set({ theme }) },
  setFlat: (flat) => { persist('threeD', !flat); set({ flat }) },
  setMapType: (mapType) => { persist('mapType', mapType); set({ mapType }) },
  toggleLayer: (k) => { const layers = { ...get().layers, [k]: !get().layers[k] }; persist('layers', layers); set({ layers }) },
  setCamera: (camera) => {
    const band = bandOf(camera.zoom)
    set(band === get().band ? { camera } : { camera, band })
  },
  setHovered: (hovered) => set({ hovered }),
  select: (selected) => set({ selected }),
  setOffline: (offline) => { if (offline !== get().offline) set({ offline }) },
  setApiReachable: (apiReachable) => { if (apiReachable !== get().apiReachable) set({ apiReachable }) },
}))
