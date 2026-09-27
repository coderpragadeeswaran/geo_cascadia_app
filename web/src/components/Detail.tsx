/** Plain / Technical (P5) for the verifier pages. Same numbers in both: Plain says what they mean in short sentences;
 *  Technical adds method names, thresholds, sample sizes and the file/field each number comes from. Remembered in this
 *  browser (localStorage gc.detail). */
import { useEffect, useRef, useState } from 'react'
import { fmt } from '@/lib/utils'
import { useUi } from '@/store/ui'

/** P5 H9: the verifier pages are plain-only; the Technical view was removed (kept as a type for older code paths) */
export const useDetail = (): 'plain' | 'technical' => 'plain'
export const REDUCED = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function DetailToggle() {
  const detail = useDetail()
  const set = useUi((s) => s.setDetail)
  return (
    <div role="group" aria-label="Reading level" className="inline-flex rounded-[var(--ns-r-control)] p-[3px]" style={{ boxShadow: 'inset 0 0 0 1px var(--ns-line-strong)' }}>
      {(['plain', 'technical'] as const).map((d) => (
        <button key={d} aria-pressed={detail === d} onClick={() => set(d)}
          className="t-small cursor-pointer rounded-[4px] px-3 py-1 transition-colors"
          style={detail === d ? { background: 'var(--ns-sodium)', color: 'var(--ns-bg0)', fontWeight: 600 } : { color: 'var(--ns-ink2)' }}>
          {d === 'plain' ? 'Plain' : 'Technical'}
        </button>
      ))}
    </div>
  )
}

/** the plain or the technical text */
export function T({ plain, tech }: { plain: React.ReactNode; tech: React.ReactNode }) {
  return <>{useDetail() === 'plain' ? plain : tech}</>
}

/** where a number comes from: shown only in Technical */
export function Src({ children, className }: { children: React.ReactNode; className?: string }) {
  if (useDetail() !== 'technical') return null
  return <span className={`t-data ink3 block text-[12.5px] ${className ?? ''}`}>{children}</span>
}

/** fires once when 30 % of the element is visible (always true with reduced motion) */
export function useInView<E extends Element>(threshold = 0.3) {
  const ref = useRef<E>(null)
  const [seen, setSeen] = useState(REDUCED)
  useEffect(() => {
    if (!ref.current || seen) return
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect() } }, { threshold })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [seen, threshold])
  return [ref, seen] as const
}

/** H1: shows the FINAL value unless an animation is actually running. The count-up plays once, the first time the
 *  number scrolls into view; with reduced motion, fast scrolling or no intersection event it simply stays final. */
export function CountUp({ to, run, ms = 900 }: { to: number; run: boolean; ms?: number }) {
  const [v, setV] = useState(to)
  const played = useRef(false)
  useEffect(() => {
    if (REDUCED || !run || played.current) { if (!run || REDUCED) setV(to); return }
    played.current = true
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / ms); setV(k >= 1 ? to : Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); setV(to) }
  }, [to, run, ms])
  return <>{fmt.format(v)}</>
}

/** a topic on a verifier page: its own panel with a heading, a divider and room around it (L1) */
export function Card({ id, title, lead, children, eyebrow, className }: { id: string; title: React.ReactNode; lead?: React.ReactNode; eyebrow?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} data-section className={`scroll-mt-4 rounded-[var(--ns-r-sheet)] px-6 pb-6 pt-5 ${className ?? ''}`}
      style={{ background: 'var(--ns-bg1)', boxShadow: 'inset 0 0 0 1px var(--ns-line-strong)' }}>
      {eyebrow && <div className="t-micro sodium mb-1">{eyebrow}</div>}
      <h2 className="t-title" style={{ fontSize: 22 }}>{title}</h2>
      {lead && <div className="t-small ink2 mt-1 max-w-[720px]">{lead}</div>}
      <div className="mt-4 pt-4 [&>ul>li:first-child]:border-t-0 [&>p.rule-t:first-child]:border-t-0" style={{ borderTop: '1px solid var(--ns-line)' }}>{children}</div>
    </section>
  )
}

/** which section is in view inside a scroll container (for the sticky nav) */
export function useScrollSpy(ids: string[], root: React.RefObject<HTMLElement | null>, deps: unknown[] = []) {
  const [active, setActive] = useState<string | null>(ids[0] ?? null)
  useEffect(() => {
    const host = root.current
    if (!host) return
    const onScroll = () => {
      const top = host.getBoundingClientRect().top + 90
      let cur = ids[0] ?? null
      for (const id of ids) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= top) cur = id
      }
      if (host.scrollTop + host.clientHeight >= host.scrollHeight - 4) cur = ids[ids.length - 1] ?? cur
      setActive(cur)
    }
    onScroll()
    host.addEventListener('scroll', onScroll, { passive: true })
    return () => host.removeEventListener('scroll', onScroll)
  }, [root, ids.join('|'), ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
  return active
}

/** sticky section nav: highlights the section in view, jumps on click */
export function SectionNav({ items, active, onJump, title = 'On this page' }: { items: [string, string][]; active: string | null; onJump: (id: string) => void; title?: string }) {
  return (
    <nav className="sticky top-0 min-h-0 overflow-y-auto px-5 py-8" aria-label={title}>
      <div className="t-micro mb-2">{title}</div>
      <ul className="space-y-0.5">
        {items.map(([id, label]) => (
          <li key={id}>
            <button onClick={() => onJump(id)} aria-current={active === id ? 'location' : undefined}
              className="t-small relative block w-full cursor-pointer rounded-[4px] py-1 pl-3 pr-1 text-left transition-colors hover:text-ink"
              style={{ color: active === id ? 'var(--ns-ink)' : 'var(--ns-ink2)', background: active === id ? 'var(--ns-sodium-soft)' : undefined }}>
              {active === id && <span className="absolute bottom-1 left-0 top-1 w-[2px]" style={{ background: 'var(--ns-sodium)' }} />}
              {label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export const jumpTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' })

/** a small uppercase badge, e.g. "resumed run, not representative" or "from model_card" */
export function Badge({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'sodium' | 'warn' | 'ok' }) {
  const c = tone === 'sodium' ? 'var(--ns-sodium)' : tone === 'warn' ? 'var(--ns-no-record)' : tone === 'ok' ? 'var(--ns-discrepancy)' : 'var(--ns-ink2)'
  return <span className="t-micro inline-flex items-center whitespace-nowrap rounded-[4px] px-1.5 py-[3px]" style={{ color: c, boxShadow: `inset 0 0 0 1px ${c}`, letterSpacing: '0.06em' }}>{children}</span>
}
