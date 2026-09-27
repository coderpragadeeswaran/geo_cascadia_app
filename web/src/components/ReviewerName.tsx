/** Who is reviewing (P5): asked once, remembered in this browser (localStorage gc.reviewer), and saved with every
 *  decision and undo. There is no login: the name is a label for the history, not an identity check. */
import { UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useUi } from '@/store/ui'

/** Inline form: the name field and a Save button (used by the Review dialog and the Explore drawer). */
export function ReviewerForm({ onSaved, compact }: { onSaved?: () => void; compact?: boolean }) {
  const current = useUi((s) => s.reviewer)
  const setReviewer = useUi((s) => s.setReviewer)
  const [v, setV] = useState(current ?? '')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const save = () => { if (v.trim()) { setReviewer(v); onSaved?.() } }
  return (
    <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); save() }}>
      <label className="field min-w-0 flex-1 px-2.5" style={{ height: compact ? 34 : 38 }}>
        <UserRound className="size-4 shrink-0 ink3" aria-hidden />
        <input ref={ref} value={v} onChange={(e) => setV(e.target.value)} maxLength={120} placeholder="Your name"
          aria-label="Your name (saved with each decision)" className="t-small min-w-0 flex-1 bg-transparent outline-none" />
      </label>
      <button type="submit" className="btn btn-solid" disabled={!v.trim()}>Save</button>
    </form>
  )
}

/** Modal asked on the Review page when no name is stored yet. Keys are paused while it is open. */
export function ReviewerDialog({ onClose }: { onClose: () => void }) {
  const current = useUi((s) => s.reviewer)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && current) onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [current, onClose])
  return (
    <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--ns-bg0) 70%, transparent)' }}>
      <div role="dialog" aria-modal="true" aria-labelledby="reviewer-title" className="sheet w-[400px] max-w-[92%] p-5">
        <div className="t-micro">Review</div>
        <h2 id="reviewer-title" className="t-title mt-1">Who is reviewing?</h2>
        <p className="t-small ink2 mb-3 mt-1">Your name is saved with every decision, so the history shows who decided what. It is remembered in this
          browser; there is no login.</p>
        <ReviewerForm onSaved={onClose} />
        {current && <button className="link t-small mt-2" onClick={onClose}>Keep “{current}”</button>}
      </div>
    </div>
  )
}
