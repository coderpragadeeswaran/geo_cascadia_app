/** Right panel: Findings | Charts | Streetlights, or the evidence drawer when an object is selected. Collapsible and
 *  expandable (the findings table has 8 spec columns). */
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronsLeft, ChevronsRight, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { PANEL_W } from '@/map/MapView'
import { useUi, type Tab } from '@/store/ui'
import { EvidenceDrawer } from './EvidenceDrawer'
import { FindingsTable } from './FindingsTable'
import { StreetlightsTab } from './StreetlightsTab'

// Recharts is only needed when the Charts tab opens: load it lazily (keeps the first paint lean, D3)
const ChartsTab = lazy(() => import('./ChartsTab').then((m) => ({ default: m.ChartsTab })))
const Skeleton = () => <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-hover" />)}</div>

const TABS: { key: Tab; label: string }[] = [{ key: 'findings', label: 'Findings' }, { key: 'charts', label: 'Charts' }, { key: 'streetlights', label: 'Streetlights' }]

export function RightPanel() {
  const tab = useUi((s) => s.tab)
  const setTab = useUi((s) => s.setTab)
  const open = useUi((s) => s.panelOpen)
  const setOpen = useUi((s) => s.setPanelOpen)
  const sel = useUi((s) => s.selected)
  const [wide, setWide] = useState(false)
  const drawer = sel && sel.kind !== 'area' && sel.kind !== 'street'

  if (!open) {
    return (
      <div className="pointer-events-auto absolute right-3 top-[122px] z-20">
        <Tip label="Show panel" side="left"><Button variant="subtle" className="glass" size="icon" onClick={() => setOpen(true)} aria-label="Show panel"><PanelRightOpen /></Button></Tip>
      </div>
    )
  }
  return (
    <motion.aside layout initial={false} animate={{ width: wide && !drawer ? 820 : PANEL_W - 16 }} transition={{ type: 'spring', stiffness: 380, damping: 38 }}
      className="glass pointer-events-auto absolute bottom-9 right-3 top-[122px] z-20 flex flex-col overflow-hidden" aria-label="Findings panel">
      <AnimatePresence mode="wait" initial={false}>
        {drawer ? <EvidenceDrawer key="drawer" sel={sel} /> : (
          <motion.div key="tabs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-0.5 px-2 pb-2 pt-2" role="tablist" aria-label="Panel">
              {TABS.map((t) => (
                <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                  className={cn('relative h-8 cursor-pointer rounded-lg px-3 text-[12.5px] font-medium', tab === t.key ? 'text-fg' : 'text-muted hover:text-fg')}>
                  {tab === t.key && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-lg bg-hover" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                  <span className="relative">{t.label}</span>
                </button>
              ))}
              <div className="flex-1" />
              {tab === 'findings' && (
                <Tip label={wide ? 'Narrow panel' : 'Widen table'}><Button size="icon-sm" onClick={() => setWide(!wide)} aria-label={wide ? 'Narrow panel' : 'Widen table'}>{wide ? <ChevronsRight /> : <ChevronsLeft />}</Button></Tip>
              )}
              <Tip label="Hide panel"><Button size="icon-sm" onClick={() => setOpen(false)} aria-label="Hide panel"><PanelRightClose /></Button></Tip>
            </div>
            <div className={cn('min-h-0 flex-1', tab === 'findings' ? 'flex flex-col' : 'overflow-y-auto')}>
              {tab === 'findings' ? <FindingsTable /> : tab === 'charts' ? <Suspense fallback={<Skeleton />}><ChartsTab /></Suspense> : <StreetlightsTab />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.aside>
  )
}
