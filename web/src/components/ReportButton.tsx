/** D55: "Download report" for the open area, or for one street when a street is selected. The API builds the files
 *  (backend/app/report.py) from the same records the app shows: a PDF for officials and an Excel workbook with the same
 *  tables. Fetched as a blob so a failure is said in words instead of opening an error page. */
import { ChevronDown, Download, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { API_URL } from '@/api/client'
import { cn } from '@/lib/utils'

type Kind = 'pdf' | 'xlsx' | 'geojson' | 'shp.zip'

const TITLE: Record<Kind, string> = {
  pdf: 'Summary for officials, readable in two minutes: key numbers, charts, a map from our own data, what to do next, method and limits',
  xlsx: 'Every table with every column, one sheet each',
  geojson: 'For GIS (QGIS, ArcGIS): buildings with findings, poles and streetlights, possible dark stretches, review items, businesses vs OpenStreetMap — the Excel columns, WGS84',
  'shp.zip': 'The same GIS layers as zipped Shapefiles (WGS84, .prj), with fields.csv: the key from the short field names to the Excel columns',
}

/** compact (ui-polish-2, street panel): one "Report" button that opens the four downloads, so it shares a row with
 *  "Drive this street" and the street's list keeps its height */
export function ReportButton({ area, street, className, compact = false }: { area: string | null; street?: string | null; className?: string; compact?: boolean }) {
  const [busy, setBusy] = useState<Kind | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); setOpen(false) } }
    window.addEventListener('mousedown', off)
    window.addEventListener('keydown', esc, true)
    return () => { window.removeEventListener('mousedown', off); window.removeEventListener('keydown', esc, true) }
  }, [open])
  if (!area) return null
  const get = async (kind: Kind) => {
    setBusy(kind)
    setErr(null)
    try {
      const q = street ? `?street=${encodeURIComponent(street)}` : ''
      const r = await fetch(`${API_URL}/areas/${encodeURIComponent(area)}/report.${kind}${q}`)
      if (!r.ok) throw new Error(r.status >= 500 ? 'server error' : `the API answered ${r.status}`)
      const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? `report.${kind}`
      const url = URL.createObjectURL(await r.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      setErr(e instanceof TypeError ? 'The API is not reachable.' : `Couldn’t make the report (${(e as Error).message}).`)
    } finally {
      setBusy(null)
    }
  }
  const btn = (kind: Kind, label: string) => (
    <button className={cn('btn h-7', compact && 'w-full justify-start')} onClick={() => get(kind)} disabled={busy != null} aria-busy={busy === kind}
      title={TITLE[kind]}>
      {busy === kind ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}{busy === kind ? 'Preparing…' : label}
    </button>
  )
  if (compact) return (
    <div ref={wrap} className={cn('relative', className)} aria-label={street ? `Download a report for ${street}` : 'Download a report for this area'}>
      <button className="btn h-9 whitespace-nowrap" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)} title={street ? 'Report for this street: PDF, Excel, GeoJSON, Shapefile' : 'Download report: PDF, Excel, GeoJSON, Shapefile'}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}{busy ? 'Preparing…' : street ? 'Street report' : 'Report'}<ChevronDown className="size-3.5" />
      </button>
      {open && (
        <div role="menu" className="sheet absolute right-0 z-20 mt-1 grid w-44 gap-0.5 p-1.5">
          {btn('pdf', 'PDF')}{btn('xlsx', 'Excel')}{btn('geojson', 'GeoJSON')}{btn('shp.zip', 'Shapefile')}
        </div>
      )}
      {err && <span className="t-small sodium block" role="alert">{err}</span>}
    </div>
  )
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} aria-label={street ? `Download a report for ${street}` : 'Download a report for this area'}>
      <span className="t-small ink3">{street ? 'Report for this street:' : 'Download report:'}</span>
      {btn('pdf', 'PDF')}
      {btn('xlsx', 'Excel')}
      {btn('geojson', 'GeoJSON')}
      {btn('shp.zip', 'Shapefile')}
      {err && <span className="t-small sodium w-full" role="alert">{err}</span>}
    </div>
  )
}
