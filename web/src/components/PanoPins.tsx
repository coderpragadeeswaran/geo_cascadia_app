/** Pins in the live 360° panorama (design pass B §2) that stay attached to objects while you look around or move.
 *  Each object's position (lat/lon + a height: sign level for buildings and businesses, the base for poles and lamps,
 *  which stays in frame up close) is projected through the panorama's current point of view (heading, pitch, zoom →
 *  horizontal field of view 2·atan(2^(1−zoom)), checked against a static evidence photo) with the same pinhole model as
 *  the evidence photos. Google's deprecated google.maps.Marker is not used. Shows the selected object (sodium) and findings within
 *  60 m: buildings not in / differing from the register, streetlights, businesses with no analysed building. */
import { useMap } from '@vis.gl/react-google-maps'
import { useEffect, useMemo, useState } from 'react'
import { useAreaData } from '@/lib/useAreaData'
import { matchLabel } from '@/lib/labels'
import { useUi } from '@/store/ui'

const CAMERA_H = 2.5          // Google car camera height (m)
const NEAR_M = 60
const kx = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180)

interface Pin { id: string; lat: number; lon: number; h: number; label: string; kind: 'selected' | 'no_record' | 'discrepancy' | 'lamp' | 'unmapped' }
interface View { lat: number; lon: number; heading: number; pitch: number; zoom: number; w: number; h: number }

function project(p: Pin, v: View) {
  const e = (p.lon - v.lon) * kx(v.lat), n = (p.lat - v.lat) * 110540, up = p.h - CAMERA_H
  const dist = Math.hypot(e, n)
  const hd = (v.heading * Math.PI) / 180, pt = (v.pitch * Math.PI) / 180
  const f = [Math.sin(hd) * Math.cos(pt), Math.cos(hd) * Math.cos(pt), Math.sin(pt)]
  const r = [Math.cos(hd), -Math.sin(hd), 0]
  const u = [-Math.sin(hd) * Math.sin(pt), -Math.cos(hd) * Math.sin(pt), Math.cos(pt)]
  const d = [e, n, up]
  const dot = (a: number[]) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2]
  const fz = dot(f)
  if (fz <= 0.5) return null
  const F = v.w / 2 / 2 ** (1 - v.zoom)                    // tan(fov/2) = 2^(1 − zoom) for the live panorama
  const x = v.w / 2 + (F * dot(r)) / fz, y = v.h / 2 - (F * dot(u)) / fz
  if (x < -40 || x > v.w + 40 || y < -40 || y > v.h + 40) return null
  return { x, y, dist }
}

export function PanoPins() {
  const map = useMap('main')
  const dive = useUi((s) => s.dive)
  const selected = useUi((s) => s.selected)
  const { records } = useAreaData()
  const [view, setView] = useState<View | null>(null)
  useEffect(() => {
    if (!map || !dive) return
    const sv = map.getStreetView()
    const div = map.getDiv()
    const upd = () => {
      const pos = sv.getPosition()
      const pov = sv.getPov()
      if (!pos) return
      setView({ lat: pos.lat(), lon: pos.lng(), heading: pov.heading ?? 0, pitch: pov.pitch ?? 0, zoom: sv.getZoom() ?? 1, w: div.clientWidth, h: div.clientHeight })
    }
    const ls = ['pov_changed', 'position_changed', 'zoom_changed'].map((e) => sv.addListener(e, upd))
    const t = setTimeout(upd, 400)
    return () => { ls.forEach((l) => l.remove()); clearTimeout(t) }
  }, [map, dive])

  const pins = useMemo(() => {
    if (!records || !view) return []
    const out: Pin[] = []
    const selId = selected && 'id' in selected ? selected.id : null
    const near = (lat: number, lon: number) => Math.hypot((lon - view.lon) * kx(view.lat), (lat - view.lat) * 110540) <= NEAR_M
    for (const b of records.buildings) {
      const sel = b.id === selId
      if (!sel && (b.match_status === 'matched' || !near(b.lat, b.lon))) continue
      const fl = b.attributes?.floors?.value
      out.push({ id: b.id, lat: b.lat, lon: b.lon, h: fl && fl > 1 ? 4 : 3, kind: sel ? 'selected' : b.match_status === 'no_record' ? 'no_record' : 'discrepancy',
        label: sel ? 'This building' : matchLabel(b.match_status, false, !!b.attributes?.use?.value) })
    }
    for (const a of records.assets) {
      const sel = a.id === selId
      if (!sel && (a.type !== 'streetlight' || !near(a.lat, a.lon))) continue
      out.push({ id: a.id, lat: a.lat, lon: a.lon, h: 1, kind: sel ? 'selected' : 'lamp',
        label: `${sel ? (a.type === 'streetlight' ? 'This streetlight' : 'This pole') : 'Streetlight'}${a.method !== 'triangulated' ? ' · approx.' : ''}` })
    }
    for (const u of records.unmapped) {
      const sel = u.id === selId
      if (!sel && !near(u.lat, u.lon)) continue
      out.push({ id: u.id, lat: u.lat, lon: u.lon, h: 3, kind: sel ? 'selected' : 'unmapped', label: `${sel ? 'This sign' : u.name ?? 'Business'} · approx.` })
    }
    return out
  }, [records, view, selected])

  if (!dive || !view) return null
  const placed = pins.map((p) => ({ p, s: project(p, view) })).filter((x) => x.s).sort((a, b) => b.s!.dist - a.s!.dist)
  const color = { selected: 'var(--ns-sodium)', no_record: '#e7819f', discrepancy: '#7dcad6', lamp: '#ffc27a', unmapped: '#cfd6ea' } as const
  return (
    <div className="pointer-events-none absolute inset-0 z-[6] overflow-hidden" aria-label="Pins on the panorama">
      {placed.map(({ p, s }) => (
        <div key={p.id} className="absolute" style={{ left: s!.x, top: s!.y, transform: 'translate(-50%, -100%)' }}>
          <div className="flex flex-col items-center">
            <span className="t-small whitespace-nowrap rounded-[var(--ns-r-control)] px-1.5 py-0.5 text-[14px]"
              style={{ background: 'rgb(7 10 20 / 0.82)', color: color[p.kind], boxShadow: `inset 0 0 0 1px ${color[p.kind]}`, fontWeight: p.kind === 'selected' ? 650 : 500 }}>
              {p.label} <span className="t-data text-white/60">{Math.round(s!.dist)} m</span>
            </span>
            <span className="h-4 w-px" style={{ background: color[p.kind] }} />
            <span className="size-2 rounded-full" style={{ background: color[p.kind], boxShadow: '0 0 0 2px rgb(0 0 0 / 0.5)' }} />
          </div>
        </div>
      ))}
    </div>
  )
}
