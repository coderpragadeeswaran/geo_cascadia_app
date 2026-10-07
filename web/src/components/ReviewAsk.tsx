/** ui-polish-2 (D59): the review question and its answer, shared by Review and the Explore drawer. The question in
 *  plain words (lib/reviewQuestions), Yes / No buttons (keys A / R in Review), and after a No on a value question a
 *  field for the right value plus an optional note. The value is saved with the decision, never over our value. */
import { Check, CircleSlash, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLabel } from '@/lib/labels'
import { correctable, reviewerSays, USE_OPTIONS, type Asked, type Corrected } from '@/lib/reviewQuestions'
import { cn, plural } from '@/lib/utils'

export function QuestionBlock({ q, compact = false }: { q: Asked; compact?: boolean }) {
  return (
    <div aria-label="Review question">
      <div className="t-micro">The question</div>
      <p className={cn('mt-1 font-[600] leading-snug', compact ? 'text-[16px]' : 'text-[18px]')}>{q.main.text}</p>
      {!!q.main.lines?.length && <ul className="t-small ink2 mt-1 space-y-0.5">{q.main.lines.map((l) => <li key={l}>• {l}</li>)}</ul>}
      {q.hint && <p className="t-small ink3 mt-1">{q.hint}</p>}
      {q.also.length > 0 && (
        <div className="t-small ink2 mt-1.5">Also, if you can tell: {q.also.map((x) => x.text).join(' ')} <span className="ink3">(after No you can give the right value)</span></div>
      )}
    </div>
  )
}

/** the reviewer's value next to ours: "Reviewer says: 2 floors" */
export function ReviewerSays({ corrected, className }: { corrected?: Corrected | null; className?: string }) {
  const says = reviewerSays(corrected)
  if (!says) return null
  return <span className={cn('t-small block', className)} style={{ color: 'var(--ns-sodium)' }} aria-label="Reviewer says">Reviewer says: {says}</span>
}

export function AnswerButtons({ busy, disabled, onYes, onNo, keys = false }: {
  busy: 'yes' | 'no' | null; disabled: boolean; onYes: () => void; onNo: () => void; keys?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <button className="btn btn-line justify-between" disabled={disabled} onClick={onYes}>
        <span className="flex items-center gap-1.5">{busy === 'yes' ? <Loader2 className="animate-spin" /> : <Check />} {busy === 'yes' ? 'Saving…' : 'Yes'}</span>{keys && <span className="kbd">A</span>}
      </button>
      <button className="btn btn-line justify-between" disabled={disabled} onClick={onNo}>
        <span className="flex items-center gap-1.5">{busy === 'no' ? <Loader2 className="animate-spin" /> : <CircleSlash />} {busy === 'no' ? 'Saving…' : 'No'}</span>{keys && <span className="kbd">R</span>}
      </button>
    </div>
  )
}

/** after No: the right value for each value question (optional), an optional note, and Save */
export function NoBox({ q, saving, disabled, onSave, onCancel, scrollIn = false }: {
  q: Asked; saving: boolean; disabled: boolean; onSave: (corrected: Corrected | null, note: string) => void; onCancel: () => void; scrollIn?: boolean }) {
  const vals = correctable(q)
  const [floors, setFloors] = useState('')
  const [use, setUse] = useState('')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const first = useRef<HTMLInputElement & HTMLSelectElement>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { first.current?.focus({ preventScroll: true }); if (scrollIn) box.current?.scrollIntoView({ block: 'nearest' }) }, [scrollIn])
  const fl = floors.trim() === '' ? null : Number(floors)
  const badFloors = fl != null && (!Number.isInteger(fl) || fl < 0 || fl > 60)
  const corrected: Corrected = { ...(fl != null && !badFloors ? { floors: fl } : {}), ...(use ? { use } : {}), ...(name.trim() ? { name: name.trim() } : {}) }
  const save = () => { if (!badFloors && !disabled) onSave(Object.keys(corrected).length ? corrected : null, note.trim()) }
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); save() } if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }
  return (
    <div ref={box} className="mt-1 rounded-[var(--ns-r-control)] p-2.5" style={{ boxShadow: 'inset 0 0 0 1px var(--ns-line-strong)' }} onKeyDown={onKey} role="group" aria-label="Your answer: No">
      {vals.map((v, n) => (
        <label key={v.kind} className="t-small mb-2 block">
          {v.kind === 'floors' && <>
            <span className="ink2">Actual floors <span className="ink3">(we have {v.current == null ? 'none' : plural(Number(v.current), 'floor')}; optional)</span></span>
            <input ref={n === 0 ? first : undefined} type="number" min={0} max={60} step={1} inputMode="numeric" value={floors} onChange={(e) => setFloors(e.target.value)} aria-label="Actual floors"
              className="t-data mt-1 block w-24 rounded-[var(--ns-r-control)] border border-line-strong bg-bg0 px-2 py-1 outline-none focus:border-sodium" />
            {badFloors && <span className="block" style={{ color: 'var(--ns-no-record)' }}>A whole number from 0 to 60.</span>}
          </>}
          {v.kind === 'use' && <>
            <span className="ink2">Actual use <span className="ink3">(we have {useLabel(v.current as string | null).toLowerCase()}; optional)</span></span>
            <select ref={n === 0 ? first : undefined} value={use} onChange={(e) => setUse(e.target.value)} aria-label="Actual use"
              className="mt-1 block w-full cursor-pointer rounded-[var(--ns-r-control)] border border-line-strong bg-bg0 px-2 py-1 outline-none focus:border-sodium">
              <option value="">— pick a use —</option>
              {USE_OPTIONS.filter((u) => u !== v.current).map((u) => <option key={u} value={u}>{useLabel(u)}</option>)}
            </select>
          </>}
          {v.kind === 'name' && <>
            <span className="ink2">What the sign says <span className="ink3">(optional)</span></span>
            <input ref={n === 0 ? first : undefined} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-label="What the sign says"
              className="mt-1 block w-full rounded-[var(--ns-r-control)] border border-line-strong bg-bg0 px-2 py-1 outline-none focus:border-sodium" />
          </>}
        </label>
      ))}
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} placeholder="Note (optional)" aria-label="Note (optional)"
        className="t-small w-full resize-none rounded-[var(--ns-r-control)] border border-line-strong bg-bg0 px-2.5 py-2 outline-none focus:border-sodium" />
      <p className="t-small ink3 mt-1">Saved with your answer; our value and the register are not changed.</p>
      <div className="mt-2 flex justify-end gap-1.5">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn-solid" disabled={disabled || badFloors} onClick={save}>{saving ? 'Saving…' : 'Save answer: No'}</button>
      </div>
    </div>
  )
}
