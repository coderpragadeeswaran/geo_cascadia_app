/** "How do we know?" — the one door from a plain-language USER screen to the detail behind a finding (docs/DECISIONS.md
 *  D16). Each section opens and closes on its own (collapsed by default). It starts with one plain sentence (`summary`:
 *  what we checked and how sure we are); each Fact reads in plain words, with the technical term only as a small grey
 *  `hint`. Links go to the matching section of Under the Hood or Trust. */
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useUi, type Page } from '@/store/ui'

export interface HowLink { page: Extract<Page, 'hood' | 'trust'>; section: string; label: string }

export function HowWeKnow({ children, links = [], className, label = 'How do we know?', summary, open: openProp, onOpenChange }: {
  children: React.ReactNode; links?: HowLink[]; className?: string; label?: string; summary?: React.ReactNode
  /** controlled use (the photo's section also switches the photo to "everything the detector found") */
  open?: boolean; onOpenChange?: (open: boolean) => void
}) {
  const [own, setOwn] = useState(false)
  const open = openProp ?? own
  const toggle = () => { const next = !open; if (onOpenChange) onOpenChange(next); if (openProp === undefined) setOwn(next) }
  const go = useUi((s) => s.go)
  return (
    <div className={cn('mt-2', className)}>
      <button onClick={(e) => { e.stopPropagation(); toggle() }} aria-expanded={open}
        className="t-small inline-flex cursor-pointer items-center gap-1 rounded-[var(--ns-r-control)] px-1.5 py-0.5 text-ink3 hover:bg-line hover:text-ink2"
        style={{ boxShadow: 'inset 0 0 0 1px var(--ns-line)' }}>
        {label} <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }} className="overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="t-small ink2 mt-2 space-y-1.5 border-l-2 pl-3" style={{ borderColor: 'var(--ns-line-strong)' }}>
              {summary && <p className="text-ink">{summary}</p>}
              {children}
              {links.length > 0 && (
                <p className="flex flex-wrap gap-x-3 pt-0.5">
                  {links.map((l) => <button key={`${l.page}${l.section}`} className="link" onClick={() => go(l.page, l.section)}>{l.label} →</button>)}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** a label: value line inside "How do we know?"; `hint` = the technical term, small and grey (also on hover) */
export const Fact = ({ k, children, hint }: { k: string; children: React.ReactNode; hint?: string }) => (
  <div className="grid grid-cols-[112px_1fr] gap-2">
    <span className="ink3">{k}</span>
    <span className="text-ink" title={hint}>{children}{hint && <span className="ink3 text-[13px]"> · {hint}</span>}</span>
  </div>
)
