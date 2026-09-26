/** "How do we know?" — the one door from a plain-language USER screen to the technical detail behind a finding
 *  (docs/DECISIONS.md D16). Collapsed by default; the last choice is remembered for the session and applies to every
 *  finding. Links go to the matching section of Under the Hood or Trust. */
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { create } from 'zustand'
import { cn } from '@/lib/utils'
import { useUi, type Page } from '@/store/ui'

const KEY = 'gc.howWeKnow'
const read = () => { try { return sessionStorage.getItem(KEY) === 'open' } catch { return false } }
export const useHow = create<{ open: boolean; toggle: () => void }>((set, get) => ({
  open: read(),
  toggle: () => { const open = !get().open; try { sessionStorage.setItem(KEY, open ? 'open' : 'closed') } catch { /* private mode */ } set({ open }) },
}))

export interface HowLink { page: Extract<Page, 'hood' | 'trust'>; section: string; label: string }

export function HowWeKnow({ children, links = [], className, label = 'How do we know?' }: {
  children: React.ReactNode; links?: HowLink[]; className?: string; label?: string }) {
  const open = useHow((s) => s.open)
  const toggle = useHow((s) => s.toggle)
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

/** a label: value line inside "How do we know?" */
export const Fact = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[112px_1fr] gap-2"><span className="ink3">{k}</span><span className="text-ink">{children}</span></div>
)
