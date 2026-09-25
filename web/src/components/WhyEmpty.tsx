/** The why_empty funnel as a visible, explained result (never an empty table): each filter step with its count, and a
 *  sentence naming the step that removes the last candidate. Counts come from QueryEngine (/query why_empty). */
import { fmt } from '@/lib/utils'

export function WhyEmpty({ steps, noun = 'buildings', compact }: { steps: { step: string; count: number }[]; noun?: string; compact?: boolean }) {
  if (!steps.length) return null
  const max = Math.max(1, steps[0].count)
  const killer = steps.findIndex((s, i) => i > 0 && s.count === 0 && steps[i - 1].count > 0)
  return (
    <div role="group" aria-label="Why there are no results">
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="grid grid-cols-[1fr_auto] items-center gap-x-2 text-[12px]">
            <span className={i === killer ? 'font-semibold text-no-record' : 'text-fg/85'}>{i === 0 ? s.step : `→ ${s.step}`}</span>
            <span className={`tnum font-semibold ${s.count === 0 ? 'text-no-record' : ''}`}>{fmt.format(s.count)}</span>
            <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-hover">
              <span className={`block h-full rounded-full ${s.count === 0 ? 'bg-no-record/60' : 'bg-accent'}`}
                style={{ width: `${s.count === 0 ? 1.5 : Math.max(3, (Math.log10(s.count + 1) / Math.log10(max + 1)) * 100)}%` }} />
            </span>
          </li>
        ))}
      </ol>
      {killer > 0 && !compact && (
        <p className="mt-2.5 text-[12px] leading-snug text-fg/85">
          No {noun} pass “<b>{steps[killer].step}</b>”: the {fmt.format(steps[killer - 1].count)} left after “{steps[killer - 1].step}” all fail it.
          {' '}Edit or remove a filter chip to widen the question.
        </p>
      )}
      <p className="mt-1.5 text-[10.5px] text-faint">Counts from the pipeline’s QueryEngine (log-scaled bars).</p>
    </div>
  )
}
