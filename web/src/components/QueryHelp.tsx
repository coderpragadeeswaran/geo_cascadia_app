/** "How questions are understood": the short in-app version of docs/QUERY.md (rule-based, no LLM). */
import { HelpCircle } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useUi } from '@/store/ui'

/** keep in step with backend/app/queryparse.py SYNONYMS (docs/QUERY.md lists them all) */
export const SYNONYM_HINTS: [string, string][] = [
  ['storeys, stories, story, 3 levels', 'floors'],
  ['2+ floors · with 2 floors · 2-storey shops', 'at least 2 · exactly 2 · shops with exactly 2'],
  ['taller than · fewer than · at most 2 floors', 'more than · less than · less than 3'],
  ['shops, stores, retail, offices, businesses', 'commercial'],
  ['houses, homes, flats, apartments, residences', 'residential'],
  ['not in the register, missing record, unregistered', 'no record'],
  ['differ from the register, wrong in the register', 'discrepancy'],
  ['dark stretches, unlit streets', 'streetlight gaps'],
  ['street lamps, lamp posts, lights', 'streetlights'],
  ['for each street, street-wise', 'by street'],
  ['uncertain, unsure', 'low confidence'],
  ['not on Google Maps', 'not in Google'],
]

export function QueryHelp({ compact }: { compact?: boolean }) {
  const go = useUi((s) => s.go)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={compact ? 'link t-small inline-flex items-center gap-1' : 'btn btn-icon'} aria-label="How questions are understood">
          <HelpCircle className="size-4" />{compact && 'How questions are understood'}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] p-4">
        <div className="t-micro">How questions are understood</div>
        <p className="t-small mt-2">Questions are read by <b>fixed rules, not an AI model</b>: the same question always gives the same answer, it works offline, and every step can be shown.</p>
        <ol className="t-small ink2 mt-2 list-decimal space-y-1 pl-4">
          <li>Common synonyms are replaced first (below).</li>
          <li>The rules look for: <b className="text-ink">what to show</b> (buildings, dark stretches, poles or streetlights, review items), a <b className="text-ink">street</b> of this area, <b className="text-ink">use</b> (commercial / residential), <b className="text-ink">floors</b> (more than, at least, less than, exactly N), the <b className="text-ink">register</b> (no record / differs), a type of difference, <b className="text-ink">by street</b> for a chart, and a distance for dark stretches (60 m).</li>
          <li>Words no rule uses are shown as <b className="text-ink">ignored</b>; nothing is put on the map until you confirm or fix the question.</li>
          <li>Every filter is a chip you can change, or build a question just by clicking.</li>
        </ol>
        <div className="t-micro mt-3">Synonyms</div>
        <ul className="t-small mt-1">
          {SYNONYM_HINTS.map(([a, b]) => <li key={b} className="flex justify-between gap-3 rule-b py-1"><span className="ink2">{a}</span><span>→ {b}</span></li>)}
        </ul>
        <button className="link t-small mt-3" onClick={() => go('trust', 'questions')}>Why rules and not an AI model →</button>
      </PopoverContent>
    </Popover>
  )
}
