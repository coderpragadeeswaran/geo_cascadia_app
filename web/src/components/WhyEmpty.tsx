/** The why_empty funnel as a visible, explained answer (never an empty table): each filter step with its count and a
 *  sentence naming the step that removes the last candidate. Counts come from QueryEngine (/query why_empty); the step
 *  names are put in plain words for the user screen. */
import { fmt, plural } from '@/lib/utils'
import { diffLabel } from '@/lib/labels'

export function plainStep(s: string): string {
  let m
  if (s === 'all buildings') return 'All buildings checked'
  if ((m = /^match status = (\w+)$/.exec(s))) return m[1] === 'no_record' ? 'not in the register' : 'differ from the register'
  if (s === 'observed commercial/mixed') return 'shops & businesses (incl. shop + home)'
  if (s === 'observed residential') return 'homes'
  if (s === 'floor count measured') return 'floors could be counted'
  if ((m = /^floors (>=|>|<|==) (\d+)$/.exec(s))) return `${{ '>': 'more than', '>=': 'at least', '<': 'fewer than', '==': 'exactly' }[m[1]]} ${plural(+m[2], 'floor')}`
  if ((m = /^has (\w+)$/.exec(s))) return diffLabel(m[1])
  if (s === 'sign not in Google') return 'sign not on Google Maps'
  if ((m = /^(\d+) m gap analysis available$/.exec(s))) return `dark stretches measured at ${m[1]} m`
  if ((m = /^(\w+)s detected$/.exec(s))) return `${m[1] === 'pole' ? 'poles' : 'streetlights'} seen`
  if ((m = /^reason: (.+)$/.exec(s))) return m[1]
  return s
}

export function WhyEmpty({ steps, noun = 'buildings', compact }: { steps: { step: string; count: number }[]; noun?: string; compact?: boolean }) {
  if (!steps.length) return null
  const max = Math.max(1, steps[0].count)
  const killer = steps.findIndex((s, i) => i > 0 && s.count === 0 && steps[i - 1].count > 0)
  return (
    <div role="group" aria-label="Why there are no results">
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="grid grid-cols-[1fr_auto] items-center gap-x-3">
            <span className="t-small" style={i === killer ? { color: 'var(--ns-no-record)', fontWeight: 600 } : undefined}>{i === 0 ? plainStep(s.step) : `→ ${plainStep(s.step)}`}</span>
            <span className="t-data" style={s.count === 0 ? { color: 'var(--ns-no-record)' } : undefined}>{fmt.format(s.count)}</span>
            <span className="col-span-2 h-1.5">
              <span className="block h-full" style={{ borderRadius: '0 4px 4px 0', width: `${s.count === 0 ? 1.5 : Math.max(3, (Math.log10(s.count + 1) / Math.log10(max + 1)) * 100)}%`,
                background: s.count === 0 ? 'var(--ns-no-record)' : 'var(--ns-sodium)' }} />
            </span>
          </li>
        ))}
      </ol>
      {killer > 0 && !compact && (
        <p className="t-small mt-3">
          None of the {fmt.format(steps[killer - 1].count)} left after “{plainStep(steps[killer - 1].step)}” {steps[killer - 1].count === 1 ? 'is' : 'are'} “{plainStep(steps[killer].step)}”.
          Change or remove a chip to widen the question.
        </p>
      )}
      <p className="t-small ink3 mt-1.5">Counts from the question engine, step by step (bars on a log scale). No {noun} is hidden.</p>
    </div>
  )
}
