/** The one panel (docs/DESIGN.md): it appears only for a question, a selection, a key number, a street or "What stands
 *  out", and shows exactly one of them. Plain language; technical detail sits behind "How do we know?" (D16). */
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Inbox, Route, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { GapProps } from '@/api/types'
import { KPI_DEFS, kpis, matchAsset, matchBuilding, matchUnmapped } from '@/lib/derive'
import { shortArea } from '@/lib/labels'
import { areaSentences, kpiSentence, streetLine, streetSentences, type Sentence } from '@/lib/sentences'
import { useAreaData } from '@/lib/useAreaData'
import { cn, fmt, noun } from '@/lib/utils'
import { PANEL_W } from '@/map/MapView'
import { usePanel, useUi } from '@/store/ui'
import { ByStreet, DiffChart, FloorsChart, UseChart } from './Charts'
import { DrivePanel, DriveButton } from './DrivePanel'
import { EvidenceDrawer } from './EvidenceDrawer'
import { FindingsTable } from './FindingsTable'
import { GapList } from './GapList'
import { QueryPanel } from './QueryPanel'
import { ReportButton } from './ReportButton'

export function Panel() {
  const kind = usePanel()
  const sel = useUi((s) => s.selected)
  return (
    <AnimatePresence>
      {kind && (
        <motion.aside key="panel" initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 24, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0.7, 0.2, 1] }}
          // leaves the bottom strip free: Google's attribution must stay visible (§9.6)
          className="surface rule-l pointer-events-auto absolute right-0 top-0 z-30 flex flex-col" style={{ width: PANEL_W, bottom: 26 }}
          aria-label="Findings panel">
          {kind === 'evidence' && sel ? <EvidenceDrawer sel={sel} />
            : kind === 'query' ? <QueryPanel />
              : kind === 'kpi' ? <KpiPanel />
                : kind === 'street' ? <StreetPanel />
                  : kind === 'drive' ? <DrivePanel />
                    : <OverviewPanel />}
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

export function PanelHead({ eyebrow, title, sub, right }: { eyebrow: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode }) {
  const closePanel = useUi((s) => s.closePanel)
  return (
    <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
      <div className="min-w-0">
        <div className="t-micro">{eyebrow}</div>
        <h2 className="t-title mt-1">{title}</h2>
        {sub && <div className="t-small ink2 mt-1">{sub}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {right}
        <button className="btn btn-icon" onClick={closePanel} aria-label="Close panel (Esc)"><X /></button>
      </div>
    </header>
  )
}

const TONE: Record<string, string> = {
  no_record: 'var(--ns-no-record)', discrepancy: 'var(--ns-discrepancy)', dark: 'var(--ns-dark)', unknown: 'var(--ns-ink3)',
  review: 'var(--ns-ink)', unmapped: 'transparent', neutral: 'var(--ns-line-strong)',
}
function SentenceRow({ s, onClick }: { s: Sentence; onClick?: () => void }) {
  const Row = onClick ? 'button' : 'div'
  return (
    <Row onClick={onClick} className={cn('grid w-full grid-cols-[14px_1fr_auto] items-start gap-3 px-5 py-2.5 text-left rule-t', onClick && 'cursor-pointer hover:bg-line')}>
      <span className="mt-[7px] h-2 w-3 rounded-sm" style={{ background: TONE[s.tone ?? 'neutral'], boxShadow: s.tone === 'dark' ? '0 0 0 1px var(--ns-dark-edge)' : s.tone === 'unmapped' ? 'inset 0 0 0 1.5px var(--ns-ink2)' : undefined }} />
      <span className="min-w-0"><span className="block text-[17px] leading-snug">{s.text}</span>{s.sub && <span className="t-small ink3 mt-0.5 block">{s.sub}</span>}</span>
      {onClick && <ArrowRight className="mt-1 size-4 text-ink3" />}
    </Row>
  )
}

function useSentenceAction() {
  return (s: Sentence) => {
    const ui = useUi.getState()
    if (s.action?.page === 'review') return ui.go('review')
    if (s.action?.kpi) {
      const d = KPI_DEFS.find((x) => x.key === s.action!.kpi)
      if (!d) return
      ui.setFilter({ subject: 'buildings', street: s.action.street ?? ui.filter.street, match: null, use: null, nameQ: null, google: false,
        assetType: null, triangulated: false, review: false, gaps: false, ...(d.apply ?? {}) }, { kpi: d.key, frame: true })
    }
  }
}

/** "What stands out" — the area's findings as sentences, then one line per street */
function OverviewPanel() {
  const { records, gaps, streets, area } = useAreaData()
  const areaName = useAreaName(area)
  const act = useSentenceAction()
  const selectStreet = useUi((s) => s.selectStreet)
  const gp = useMemo(() => gaps.map((g) => g.props as GapProps), [gaps])
  if (!records) return <Loading />
  const k = kpis(records, null)
  const lines = streets.map((s) => streetLine(records, s.props.name, gp)).filter((l) => l.buildings || l.text !== 'nothing stands out').sort((a, b) => b.weight - a.weight)
  return (
    <>
      <PanelHead eyebrow="What stands out" title={areaName} />
      <ReportButton area={area} className="px-5 pb-3" />
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {areaSentences(records, k, gp).map((s) => <SentenceRow key={s.key} s={s} onClick={() => act(s)} />)}
        <div className="t-micro px-5 pb-1 pt-5">By street</div>
        <ul>
          {lines.map((l) => (
            <li key={l.street}><button onClick={() => selectStreet(l.street)} className="grid w-full cursor-pointer grid-cols-[1fr_auto] gap-3 px-5 py-2 text-left rule-t hover:bg-line">
              <span className="min-w-0"><span className="block truncate">{l.street}</span><span className="t-small ink3">{l.text}</span></span>
              <span className="t-data ink3 self-center">{fmt.format(l.buildings)} bldg</span>
            </button></li>
          ))}
        </ul>
        <p className="t-small ink3 px-5 pt-3">Registers are synthetic (demo). Every number here is counted from the records.</p>
      </div>
    </>
  )
}

const NOUN: Record<string, (n: number) => string> = {
  unmatched_properties: () => 'not in the register', buildings_with_discrepancy: (n) => (n === 1 ? 'differs from the register' : 'differ from the register'),
  use_not_classified: () => 'use not known', streetlights: (n) => noun(n, 'streetlight'), poles: (n) => `${noun(n, 'pole')} with no lamp seen`,
  unmapped_businesses: (n) => `${noun(n, 'business')} with no analysed building`, buildings_analysed: (n) => `${noun(n, 'building')} checked`,
  named_businesses: (n) => `${noun(n, 'shop name')} read clearly`, names_confirmed_by_google: () => 'also on Google Maps',
  sign_text_unverified: (n) => `${noun(n, 'sign')} to double-check`, low_confidence_observations: () => 'sent to review', waiting_for_review: () => 'waiting for review',
}

/** A key number's list: the finding as a sentence, the streets it sits on, then the list (or its one chart) */
function KpiPanel() {
  const { records, gaps, area } = useAreaData()
  const filter = useUi((s) => s.filter)
  const kpi = useUi((s) => s.kpi)
  const sendToReview = useUi((s) => s.sendToReview)
  const offline = useUi((s) => s.offline)
  const [view, setView] = useState<'list' | 'chart' | 'floors'>('list')
  const selectStreet = useUi((s) => s.selectStreet)
  if (!records) return <Loading />
  const k = kpis(records, filter.street)
  const title = kpi ? kpiSentence(kpi, k) : 'Filtered findings'
  const sub = filter.street ? <>on <b className="text-ink">{filter.street}</b> · <button className="link" onClick={() => selectStreet(null)}>all streets</button></> : undefined

  if (filter.gaps) {
    const rows = gaps.map((g) => g.props as GapProps).filter((g) => !filter.street || g.street === filter.street)
    return (<><PanelHead eyebrow="Possible dark stretches" title={title} sub={sub} /><div className="min-h-0 flex-1 overflow-y-auto pb-4"><GapList rows={rows} /></div></>)
  }
  const subject = filter.subject
  const B = subject === 'buildings' ? records.buildings.filter((b) => matchBuilding(b, filter)) : []
  const A = subject === 'assets' || filter.review ? records.assets.filter((a) => matchAsset(a, filter)) : []
  const U = subject === 'unmapped' ? records.unmapped.filter((u) => matchUnmapped(u, filter)) : []
  const items = subject === 'assets' ? A : subject === 'unmapped' ? U : B
  const color = filter.match === 'no_record' ? 'var(--ns-no-record)' : filter.match === 'discrepancy' ? 'var(--ns-discrepancy)' : 'var(--ns-sodium)'
  const charts: { k: typeof view; label: string }[] = kpi === 'buildings_analysed' ? [{ k: 'chart', label: 'Use' }, { k: 'floors', label: 'Floors' }]
    : kpi === 'buildings_with_discrepancy' ? [{ k: 'chart', label: 'How they differ' }] : !filter.street && items.length ? [{ k: 'chart', label: 'By street' }] : []
  // the streets this finding sits on, as sentences
  const byStreet = (() => {
    if (filter.street || kpi === 'buildings_analysed') return []
    const m = new Map<string, number>()
    for (const x of items) if (x.street) m.set(x.street, (m.get(x.street) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  })()
  const reviewIds = filter.review ? records.review.filter((r) => r.status === 'pending' && (!filter.street || r.street === filter.street) && r.id != null).map((r) => r.id as number) : []
  return (
    <>
      <PanelHead eyebrow={filter.review ? 'Review queue' : 'Finding'} title={title} sub={sub} />
      {filter.review && (
        <div className="px-5 pb-3">
          <button className="btn btn-sodium" disabled={offline || !reviewIds.length} onClick={() => sendToReview({ area: area!, ids: reviewIds, label: title })}>
            <Inbox /> {offline ? 'Offline — read-only' : `Open ${reviewIds.length === 1 ? 'this 1' : `these ${fmt.format(reviewIds.length)}`} in Review`}
          </button>
        </div>
      )}
      {byStreet.length > 0 && kpi && NOUN[kpi] && (
        <ul className="pb-2">
          {byStreet.map(([s, n]) => (
            <li key={s}><button onClick={() => selectStreet(s)} className="t-small w-full cursor-pointer px-5 py-1 text-left hover:bg-line">
              <span className="text-ink">{s}</span>: <span className="t-data">{fmt.format(n)}</span> {NOUN[kpi](n)}
            </button></li>
          ))}
        </ul>
      )}
      {charts.length > 0 && (
        <div className="flex gap-1 px-5 pb-2" role="tablist" aria-label="View">
          {[{ k: 'list' as const, label: 'List' }, ...charts].map((c) => (
            <button key={c.k} role="tab" aria-selected={view === c.k} onClick={() => setView(c.k)} className="btn h-7" aria-pressed={view === c.k}>{c.label}</button>
          ))}
        </div>
      )}
      {view === 'list' || !charts.length ? (
        <FindingsTable kind={subject === 'assets' || (filter.review && !B.length) ? 'asset' : subject === 'unmapped' ? 'unmapped' : 'building'}
          rows={subject === 'assets' || (filter.review && !B.length) ? A : subject === 'unmapped' ? U : B} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1">
          {view === 'floors' ? <FloorsChart records={records} street={filter.street} />
            : kpi === 'buildings_analysed' ? <UseChart records={records} street={filter.street} />
              : kpi === 'buildings_with_discrepancy' ? <DiffChart buildings={B} />
                : <ByStreet items={items} color={color} />}
        </div>
      )}
    </>
  )
}

/** A selected street: what stands out on it, in sentences, then its buildings / lights / businesses */
function StreetPanel() {
  const { records, gaps, streets, area } = useAreaData()
  const street = useUi((s) => s.filter.street)!
  const [tab, setTab] = useState<'building' | 'asset' | 'unmapped'>('building')
  const act = useSentenceAction()
  const gp = useMemo(() => gaps.map((g) => g.props as GapProps), [gaps])
  if (!records) return <Loading />
  const props = streets.find((s) => s.props.name === street)?.props
  const B = records.buildings.filter((b) => b.street === street).sort((a, b) => (a.match_status === 'matched' ? 1 : 0) - (b.match_status === 'matched' ? 1 : 0))
  const A = records.assets.filter((a) => a.street === street)
  const U = records.unmapped.filter((u) => u.street === street)
  return (
    <>
      <PanelHead eyebrow="Street" title={street} sub={props?.length_m ? <><span className="t-data">{fmt.format(Math.round(props.length_m))} m</span> analysed</> : undefined} />
      <div className="max-h-[42%] shrink-0 overflow-y-auto">
        {streetSentences(records, street, gp).map((s) => <SentenceRow key={s.key} s={s} onClick={s.action ? () => act(s) : undefined} />)}
      </div>
      <div className="flex items-center gap-2 px-5 py-3 rule-t">
        <DriveButton street={street} />
        <span className="t-small ink3 flex items-center gap-1"><Route className="size-3.5" /> through the real camera stops</span>
      </div>
      <ReportButton area={area} street={street} className="px-5 pb-3" />
      <div className="flex gap-1 px-5 pb-2" role="tablist" aria-label="Show">
        {([['building', `Buildings ${B.length}`], ['asset', `Lights & poles ${A.length}`], ['unmapped', `Businesses ${U.length}`]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)} className="btn h-7">{l}</button>
        ))}
      </div>
      <FindingsTable kind={tab} rows={tab === 'building' ? B : tab === 'asset' ? A : U} />
    </>
  )
}

function useAreaName(slug: string | null) {
  const { detail } = useAreaData()
  return detail?.name ? shortArea(detail.name) : slug ?? ''
}

function Loading() {
  const { error } = useAreaData()
  const qc = useQueryClient()
  if (error) return <p className="t-small ink2 p-5" role="alert">Couldn’t load this area’s results: the API didn’t answer. <button className="link" onClick={() => qc.invalidateQueries()}>Try again</button></p>
  return <div className="space-y-2 p-5" role="status"><p className="t-small ink3">Loading this area’s results…</p>{[0, 1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded-[var(--ns-r-control)] bg-line" />)}</div>
}
