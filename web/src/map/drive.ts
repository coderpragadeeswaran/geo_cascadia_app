/** Drive the street (design pass B §4): data from GET /areas/{slug}/drive (camera stops per branch in driving order,
 *  forward = road tangent) and the map marker for the current stop. */
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useUi, type DriveView } from '@/store/ui'
import type { DriveMark, Position } from './layers'

export interface DriveStop { pano_id: string; lat: number; lon: number; s: number; heading: number; source: string | null }
export interface DriveGap { id: string; s0: number; s1: number; length_m: number; gap_type: string | null; mode: string; along_road_m: number | null; poles_inside: number | null }
export interface DrivePoint { id: string; lat: number; lon: number; s: number; side: 'left' | 'right' }
export interface DriveBranch {
  id: number; length_m: number; line: [number, number][]; stops: DriveStop[]; gaps: DriveGap[]
  lamps: (DrivePoint & { approximate: boolean; register: string | null })[]; poles: (DrivePoint & { approximate: boolean; register: string | null })[]
  buildings: (DrivePoint & { status: string; use: string | null; floors: number | null; name: string | null; discrepancies: string[] })[]
  unmapped: (DrivePoint & { name: string | null })[]
}
export interface DriveData { street: string; osm_name: string | null; length_m: number; branches: DriveBranch[]; pieces_without_stops_m: number[] }

export const useDriveData = () => {
  const area = useUi((s) => s.area)
  const street = useUi((s) => s.drive?.street ?? null)
  return useQuery({
    queryKey: ['drive', area, street],
    queryFn: () => api<DriveData>(`/areas/${area}/drive?street=${encodeURIComponent(street!)}`),
    enabled: !!(area && street), staleTime: Infinity, retry: 0,
  })
}

export const viewHeading = (travel: number, view: DriveView) => (travel + (view === 'left' ? -90 : view === 'right' ? 90 : 0) + 360) % 360

/** the current branch + stop (clamped) */
export function useDriveStop() {
  const drive = useUi((s) => s.drive)
  const { data } = useDriveData()
  const branch = data?.branches[Math.min(drive?.branch ?? 0, (data?.branches.length ?? 1) - 1)]
  const stop = branch?.stops[Math.min(drive?.i ?? 0, branch.stops.length - 1)]
  return { drive, data, branch, stop }
}

export function useDriveMark(): DriveMark | null {
  const { drive, branch, stop } = useDriveStop()
  if (!drive || !branch || !stop) return null
  return { branch: branch.line.map(([lat, lon]) => [lon, lat] as Position), at: [stop.lon, stop.lat], heading: stop.heading, look: viewHeading(stop.heading, drive.view) }
}
