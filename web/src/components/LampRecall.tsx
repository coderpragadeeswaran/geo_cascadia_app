import { useModelCard } from '@/api/queries'
import { cn } from '@/lib/utils'

/** P8: the lamp detector's measured recall (model card), on every dark-stretch card: "possible", because lamps are missed */
export function LampRecall({ className }: { className?: string }) {
  const { data: mc } = useModelCard()
  const lh = (mc as { detector?: { per_class?: Record<string, { R: number; n: number }> } } | undefined)?.detector?.per_class?.lamp_head
  if (!lh) return null
  return (
    <p className={cn('t-small ink2', className)}>
      Possible, not certain: the detector finds about <b>{Math.round(lh.R * 100)}%</b> of lamp heads in a photo (checked by hand on {lh.n} lamps), so some lamps here may have been missed.
    </p>
  )
}
