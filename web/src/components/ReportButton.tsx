/** D55: "Download report" for the open area, or for one street when a street is selected. The API builds the files
 *  (backend/app/report.py) from the same records the app shows: a PDF for officials and an Excel workbook with the same
 *  tables. Fetched as a blob so a failure is said in words instead of opening an error page. */
import { Download, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { API_URL } from '@/api/client'
import { cn } from '@/lib/utils'

type Kind = 'pdf' | 'xlsx'

export function ReportButton({ area, street, className }: { area: string | null; street?: string | null; className?: string }) {
  const [busy, setBusy] = useState<Kind | null>(null)
  const [err, setErr] = useState<string | null>(null)
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
    <button className="btn h-7" onClick={() => get(kind)} disabled={busy != null} aria-busy={busy === kind}
      title={kind === 'pdf' ? 'Summary for officials: key numbers, a map from our own data, findings, possible dark stretches by priority, review queue, cost, limits'
        : 'The same tables as the PDF, one sheet each'}>
      {busy === kind ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}{busy === kind ? 'Preparing…' : label}
    </button>
  )
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} aria-label={street ? `Download a report for ${street}` : 'Download a report for this area'}>
      <span className="t-small ink3">{street ? 'Report for this street:' : 'Download report:'}</span>
      {btn('pdf', 'PDF')}
      {btn('xlsx', 'Excel')}
      {err && <span className="t-small sodium w-full" role="alert">{err}</span>}
    </div>
  )
}
