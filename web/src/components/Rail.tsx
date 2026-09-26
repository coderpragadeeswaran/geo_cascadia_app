/** The slim left rail (docs/DESIGN.md "App structure"): the map is home (Explore + Analyse are modes of the map); the rail
 *  reaches Review, Under the Hood, Trust and Jobs. Active item = sodium bar. Night / Daylight toggle at the bottom. */
import { Activity, Inbox, ListChecks, Map as MapIcon, Moon, ShieldCheck, Sun } from 'lucide-react'
import { useMap } from '@vis.gl/react-google-maps'
import { useActiveJobs, useReviewRows } from '@/api/queries'
import { Tip } from '@/components/ui/tooltip'
import { switchMode } from '@/map/bands'
import { useUi, type Page } from '@/store/ui'

const ITEMS: { k: Page; label: string; short: string; Icon: typeof MapIcon; hint: string }[] = [
  { k: 'explore', label: 'Explore', short: 'Explore', Icon: MapIcon, hint: 'The map: findings, questions, analyse a street' },
  { k: 'review', label: 'Review', short: 'Review', Icon: Inbox, hint: 'Items waiting for a person to check (A / R / E)' },
  { k: 'hood', label: 'Under the hood', short: 'Hood', Icon: Activity, hint: 'How the pipeline turned photos into findings' },
  { k: 'trust', label: 'Trust', short: 'Trust', Icon: ShieldCheck, hint: 'Measured accuracy, limits and what we dropped' },
  { k: 'jobs', label: 'Jobs', short: 'Jobs', Icon: ListChecks, hint: 'Analyses: pre-computed runs and new streets' },
]

export function Rail() {
  const page = useUi((s) => s.page)
  const go = useUi((s) => s.go)
  const area = useUi((s) => s.area)
  const mode = useUi((s) => s.mode)
  const map = useMap('main')
  const { data: review } = useReviewRows(area)
  const { data: jobs } = useActiveJobs()
  const pending = review?.filter((r) => r.status === 'pending').length ?? 0
  const running = jobs?.jobs.length ?? 0
  return (
    <nav className="surface relative z-50 flex flex-col items-center gap-0.5 py-3" style={{ borderRight: '1px solid var(--ns-line)' }} aria-label="Sections">
      <button onClick={() => go('explore')} className="mb-4 cursor-pointer" aria-label="GEO-CASCADIA home (Explore)">
        <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden>
          <path d="M16 2 29 9.5v13L16 30 3 22.5v-13z" fill="none" stroke="var(--ns-sodium)" strokeWidth="2.4" />
          <circle cx="16" cy="16" r="4" fill="var(--ns-sodium)" />
        </svg>
      </button>
      {ITEMS.map(({ k, label, short, Icon, hint }) => {
        const on = page === k
        const badge = k === 'review' && pending ? (pending > 999 ? '999+' : String(pending)) : null
        return (
          <Tip key={k} side="right" label={<><b className="font-semibold">{label}</b><br /><span className="ink2">{hint}</span></>}>
            <button onClick={() => go(k)} aria-current={on ? 'page' : undefined} aria-label={label}
              className="relative flex w-full cursor-pointer flex-col items-center gap-1 py-2.5 transition-colors hover:text-ink"
              style={{ color: on ? 'var(--ns-ink)' : 'var(--ns-ink3)' }}>
              {on && <span className="absolute bottom-2 left-0 top-2 w-[2px]" style={{ background: 'var(--ns-sodium)' }} />}
              <span className="relative">
                <Icon className="size-[18px]" strokeWidth={1.6} />
                {badge && <span className="t-data absolute -right-3.5 -top-2 rounded-[3px] px-[3px] text-[13px] leading-[13px]" style={{ background: 'var(--ns-sodium)', color: 'var(--ns-bg0)' }}>{badge}</span>}
                {k === 'jobs' && running > 0 && <span className="absolute -right-1 -top-1 size-2 animate-pulse rounded-full" style={{ background: 'var(--ns-sodium)' }} />}
              </span>
              <span className="text-[13px] leading-none" style={{ fontStretch: '85%', fontWeight: 560 }}>{short}</span>
            </button>
          </Tip>
        )
      })}
      <div className="flex-1" />
      <Tip side="right" label={mode === 'night' ? 'Daylight: paper and ink, for projectors' : 'Night: the default'}>
        <button onClick={() => switchMode(map)} aria-label={mode === 'night' ? 'Switch to Daylight' : 'Switch to Night'}
          className="flex w-full cursor-pointer flex-col items-center gap-1 py-2.5 text-ink3 transition-colors hover:text-ink">
          {mode === 'night' ? <Sun className="size-[17px]" strokeWidth={1.6} /> : <Moon className="size-[17px]" strokeWidth={1.6} />}
          <span className="text-[13px] leading-none" style={{ fontStretch: '85%', fontWeight: 560 }}>{mode === 'night' ? 'Daylight' : 'Night'}</span>
        </button>
      </Tip>
    </nav>
  )
}
