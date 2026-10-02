/** Chart primitives for the verifier pages (P5): pure SVG/CSS in the design tokens, no chart library. Every mark that
 *  has real examples behind it is a button (click or Enter) that opens them. Loaded only with Hood / Trust. */
import { useState } from 'react'
import { STAGE_PLAIN } from '@/lib/labels'
import { cn, fmt, plural } from '@/lib/utils'
import { Badge } from './Detail'

export interface Seg { key: string; label: string; value: number; kind: 'kept' | 'idle' | 'drop' | 'no_record' | 'discrepancy' | 'matched' | 'unclassified' | 'alt'; examples?: string | null }
export const SEG_FILL: Record<Seg['kind'], string> = {
  kept: 'var(--ns-sodium)', idle: 'var(--ns-line-strong)', drop: 'repeating-linear-gradient(135deg, var(--ns-ink3) 0 1.5px, transparent 1.5px 5px)',
  no_record: 'var(--ns-no-record)', discrepancy: 'var(--ns-discrepancy)', matched: 'var(--ns-matched)', unclassified: 'var(--ns-unclassified)',
  alt: 'var(--ns-sodium-glow)',
}
const onKey = (fn: () => void) => (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn() } }

/** kept-vs-dropped bar with a legend; grows in when `run` */
export function SegBar({ segs, run = true, onPick, unit }: { segs: Seg[]; run?: boolean; onPick?: (key: string, label: string) => void; unit?: string }) {
  const total = segs.reduce((a, s) => a + s.value, 0)
  if (!total) return <p className="t-small ink3">Nothing to show for this area.</p>
  return (
    <div className="max-w-[720px]">
      <div className="flex h-3.5 gap-[2px] overflow-hidden" style={{ borderRadius: 3 }} aria-hidden>
        {segs.filter((s) => s.value > 0).map((s) => (
          <span key={s.key} title={`${s.label}: ${fmt.format(s.value)}`} style={{ width: run ? `${Math.max(0.6, (s.value / total) * 100)}%` : '0%', background: SEG_FILL[s.kind], transition: 'width 900ms var(--ns-ease)' }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        {segs.map((s) => {
          const body = (<>
            <span className="inline-block size-2.5 shrink-0" style={{ background: SEG_FILL[s.kind], borderRadius: 2, boxShadow: s.kind === 'drop' ? 'inset 0 0 0 1px var(--ns-ink3)' : undefined }} />
            <span className="t-data">{fmt.format(s.value)}</span> <span className="ink2">{s.label}</span>
          </>)
          return (
            <li key={s.key} className="t-small">
              {s.examples && onPick ? (
                <button className="inline-flex cursor-pointer items-center gap-1.5 rounded-[4px] px-1 -mx-1 hover:bg-line" onClick={() => onPick(s.examples!, s.label)}
                  aria-label={`${s.label}: ${fmt.format(s.value)}${unit ? ` ${unit}` : ''}. Show real examples`}>{body}<span className="sodium text-[13px]">examples</span></button>
              ) : <span className="inline-flex items-center gap-1.5">{body}</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** donut with clickable arcs */
export function Donut({ segs, title, center, onPick, size = 168 }: { segs: Seg[]; title: string; center: React.ReactNode; onPick?: (key: string, label: string) => void; size?: number }) {
  const [hot, setHot] = useState<string | null>(null)
  const total = segs.reduce((a, s) => a + s.value, 0)
  const r = 62, R = 80, c = size / 2
  let a0 = -Math.PI / 2
  const arcs = segs.filter((s) => s.value > 0).map((s) => {
    const a1 = a0 + (s.value / total) * Math.PI * 2 - (segs.length > 1 ? 0.015 : 0)
    const big = a1 - a0 > Math.PI ? 1 : 0
    const p = (rad: number, a: number) => `${c + rad * Math.cos(a)} ${c + rad * Math.sin(a)}`
    const d = s.value === total ? `M${c} ${c - R}A${R} ${R} 0 1 1 ${c - 0.01} ${c - R}L${c - 0.01} ${c - r}A${r} ${r} 0 1 0 ${c} ${c - r}Z`
      : `M${p(R, a0)}A${R} ${R} 0 ${big} 1 ${p(R, a1)}L${p(r, a1)}A${r} ${r} 0 ${big} 0 ${p(r, a0)}Z`
    a0 = a1 + (segs.length > 1 ? 0.015 : 0)
    return { s, d }
  })
  return (
    <figure className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="group" aria-label={title} className="shrink-0">
        <defs><pattern id="gc-hatch-d" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.5" height="5" fill="var(--ns-ink3)" /></pattern></defs>
        {arcs.map(({ s, d }) => {
          const fill = s.kind === 'drop' ? 'url(#gc-hatch-d)' : SEG_FILL[s.kind]
          const click = s.examples && onPick ? () => onPick(s.examples!, s.label) : undefined
          return (
            <path key={s.key} d={d} fill={fill} stroke={s.kind === 'drop' ? 'var(--ns-ink3)' : 'none'} strokeWidth=".8"
              opacity={hot && hot !== s.key ? 0.45 : 1} style={{ cursor: click ? 'pointer' : undefined, transition: 'opacity 160ms' }}
              onMouseEnter={() => setHot(s.key)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(s.key)} onBlur={() => setHot(null)}
              onClick={click} onKeyDown={click ? onKey(click) : undefined} tabIndex={click ? 0 : -1} role={click ? 'button' : undefined}
              aria-label={`${s.label}: ${fmt.format(s.value)}${click ? '. Show real examples' : ''}`}>
              <title>{`${s.label}: ${fmt.format(s.value)}`}</title>
            </path>
          )
        })}
        <foreignObject x={c - r + 6} y={c - 26} width={(r - 6) * 2} height="52">
          <div className="flex h-full flex-col items-center justify-center text-center leading-tight">{center}</div>
        </foreignObject>
      </svg>
      <figcaption>
        <div className="t-micro mb-1">{title}</div>
        <ul className="space-y-0.5">
          {segs.map((s) => (
            <li key={s.key} className="t-small flex items-center gap-1.5" style={{ opacity: hot && hot !== s.key ? 0.55 : 1 }}>
              <span className="inline-block size-2.5 shrink-0" style={{ background: SEG_FILL[s.kind], borderRadius: 2, boxShadow: s.kind === 'drop' ? 'inset 0 0 0 1px var(--ns-ink3)' : undefined }} />
              <span className="t-data">{fmt.format(s.value)}</span>
              {s.examples && onPick ? <button className="link" onClick={() => onPick(s.examples!, s.label)}>{s.label}</button> : <span className="ink2">{s.label}</span>}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  )
}

/** a funnel whose unit can change between steps (a divider marks the change; bars compare within a unit) */
export function Funnel({ rows, onPick, run = true }: { rows: { key: string; label: string; value: number; unit: string; examples?: string | null }[]; onPick?: (key: string, label: string) => void; run?: boolean }) {
  const maxBy: Record<string, number> = {}
  for (const r of rows) maxBy[r.unit] = Math.max(maxBy[r.unit] ?? 0, r.value)
  return (
    <ol className="max-w-[720px] space-y-1.5">
      {rows.map((r, i) => {
        const newUnit = i > 0 && rows[i - 1].unit !== r.unit
        const w = maxBy[r.unit] ? (r.value / maxBy[r.unit]) * 100 : 0
        return (
          <li key={r.key}>
            {newUnit && <div className="t-micro ink3 my-2 flex items-center gap-2"><span className="h-px flex-1" style={{ background: 'var(--ns-line-strong)' }} />now counting {r.unit}<span className="h-px flex-1" style={{ background: 'var(--ns-line-strong)' }} /></div>}
            <button className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_92px] items-center gap-3 rounded-[4px] text-left hover:bg-line disabled:cursor-default disabled:hover:bg-transparent"
              disabled={!r.examples || !onPick} onClick={() => r.examples && onPick?.(r.examples, r.label)}
              aria-label={`${r.label}: ${plural(r.value, r.unit.replace(/s$/, ''), r.unit)}${r.examples ? '. Show real examples' : ''}`}>
              <span className="relative block h-7">
                <span className="absolute inset-y-0 left-0" style={{ width: run ? `${Math.max(1, w)}%` : 0, background: i === rows.length - 1 ? 'var(--ns-sodium)' : 'var(--ns-sodium-soft)',
                  boxShadow: 'inset 0 0 0 1px var(--ns-sodium)', borderRadius: 3, transition: `width 800ms var(--ns-ease) ${i * 90}ms` }} />
                <span className="t-small absolute inset-y-0 left-2 flex items-center" style={{ color: i === rows.length - 1 && w > 40 ? 'var(--ns-bg0)' : 'var(--ns-ink)' }}>{r.label}</span>
              </span>
              <span className="t-data text-right">{fmt.format(r.value)} <span className="ink3 text-[12.5px]">{r.unit}</span></span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

const STAGE_ORDER = ['panoramas', 'area', 'plan', 'detect', 'geometry', 'ocr', 'vlm', 'reference', 'match', 'export']
/** D1: the stored runs were resumed, so their stage timings are not real. Drawn greyed, hatched and badged; never as a
 *  plain Gantt that could be read as the real run. P6 `live`: a fresh run from the app — its own clock, drawn plainly in
 *  sodium with plain stage names (a live run that resumed after a pause keeps its badge and the grey). */
export function StageTimeline({ stages, badge, total, live }: { stages: Record<string, number>; badge: string | null; total: number | null; live?: boolean }) {
  const keys = STAGE_ORDER.filter((k) => k in stages).concat(Object.keys(stages).filter((k) => !STAGE_ORDER.includes(k)))
  const sum = keys.reduce((a, k) => a + (stages[k] || 0), 0)
  if (!keys.length) return <p className="t-small ink3">No stage timings stored for this run.</p>
  const real = !!live && !badge
  let acc = 0
  return (
    <figure className="relative max-w-[760px]" aria-label={real ? 'Time per stage of this analysis' : `Stage timings from a resumed run (${badge}); not the time a full run takes`}>
      {!real && <div className="mb-2 flex flex-wrap items-center gap-2"><Badge tone="warn">{badge}</Badge>
        <span className="t-small ink3">{live ? 'These times are not a full run of this street.' : 'Recorded while resuming from checkpoints: stages that were already done took ~0 s.'}</span></div>}
      <div className="relative space-y-1 rounded-[var(--ns-r-control)] p-3" style={real ? { boxShadow: 'inset 0 0 0 1px var(--ns-line)' } : { opacity: 0.5, filter: 'grayscale(1)', boxShadow: 'inset 0 0 0 1px var(--ns-line)' }}>
        {keys.map((k) => {
          const v = stages[k] || 0, x = sum ? (acc / sum) * 100 : 0, w = sum ? (v / sum) * 100 : 0
          acc += v
          return (
            <div key={k} className={cn('grid items-center gap-2', live ? 'grid-cols-[170px_minmax(0,1fr)_72px]' : 'grid-cols-[92px_minmax(0,1fr)_64px]')}>
              <span className={cn(live ? 't-small' : 't-data text-[13px]', 'ink2')}>{live ? STAGE_PLAIN[k] ?? k : k}</span>
              <span className="relative h-2.5">{real
                ? <span className="absolute inset-y-0" style={{ left: `${x}%`, width: `${Math.max(w, 0.4)}%`, background: 'var(--ns-sodium)', borderRadius: 2 }} />
                : <span className="gc-hatch absolute inset-y-0" style={{ left: `${x}%`, width: `${Math.max(w, 0.4)}%`, boxShadow: 'inset 0 0 0 1px var(--ns-ink3)' }} />}</span>
              <span className="t-data ink3 text-right text-[13px]">{fmt.format(v)} s</span>
            </div>
          )
        })}
        {total != null && <div className="t-data ink3 pt-1 text-right text-[13px]">{real ? `total ${total} min` : live ? `recorded total ${total} min` : `resumed-run total ${total} min`}</div>}
      </div>
    </figure>
  )
}

/** cost waterfall: known amounts stack left to right; amounts that were not recorded are shown as such, never as $0 */
export function CostWaterfall({ lines, dim }: { lines: { key: string; label: string; value: number | null; detail: string; status: string }[]; dim?: boolean }) {
  const known = lines.filter((l) => l.value != null)
  const sum = known.reduce((a, l) => a + (l.value ?? 0), 0)
  let acc = 0
  return (
    <div className="max-w-[760px] space-y-1.5" style={dim ? { opacity: 0.55, filter: 'grayscale(1)' } : undefined}>
      {lines.map((l) => {
        const x = sum ? (acc / sum) * 100 : 0, w = sum && l.value != null ? (l.value / sum) * 100 : 0
        if (l.value != null) acc += l.value
        return (
          <div key={l.key} className="grid grid-cols-[190px_minmax(0,1fr)_150px] items-center gap-3">
            <span className="t-small">{l.label}</span>
            <span className="relative h-4">
              {l.value != null ? <span className="absolute inset-y-0" style={{ left: `${x}%`, width: `${Math.max(w, 0.6)}%`, background: 'var(--ns-sodium)', borderRadius: 2 }} />
                : <span className="t-small ink3 absolute inset-0 flex items-center rounded-[2px] px-2" style={{ boxShadow: 'inset 0 0 0 1px var(--ns-line-strong)', borderStyle: 'dashed' }}>not recorded</span>}
            </span>
            <span className="t-data text-right">{l.value != null ? `$${l.value < 0.01 ? l.value.toFixed(4) : l.value.toFixed(2)}` : '—'}
              <span className="block"><Badge tone={l.status === 'model_card' ? 'ok' : l.status === 'computed' ? 'muted' : 'warn'}>{l.status === 'model_card' ? 'from the model card' : l.status}</Badge></span></span>
          </div>
        )
      })}
      <div className="t-small ink3">{lines.map((l) => `${l.label}: ${l.detail}`).join(' · ')}</div>
    </div>
  )
}

/** one row of aligned bars (compare mode): the same scale for every area */
export function AlignedBars({ rows, fmtV = (v) => fmt.format(v) }: { rows: { key: string; label: string; value: number | null; tone?: string; note?: string }[]; fmtV?: (v: number) => string }) {
  const max = Math.max(1e-9, ...rows.map((r) => r.value ?? 0))
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[150px_minmax(0,1fr)_84px] items-center gap-2" title={r.note ? `${r.label}: ${r.note}` : r.label}>
          <span className="t-small truncate">{r.label}</span>
          <span className="relative h-3">{r.value != null && <span className="absolute inset-y-0 left-0" style={{ width: `${Math.max(0.8, (r.value / max) * 100)}%`, background: r.tone ?? 'var(--ns-sodium)', borderRadius: 2 }} />}</span>
          <span className="t-data text-right">{r.value == null ? '—' : fmtV(r.value)}</span>
        </div>
      ))}
    </div>
  )
}

/** H4: cost as a table with fixed columns (item | bar | amount | source). Known amounts only get a bar; an amount that
 *  was not recorded says so and is never drawn as $0. */
export function CostTable({ lines }: { lines: { key: string; label: string; value: number | null; detail: string; status: string; source?: string | null }[] }) {
  const max = Math.max(1e-9, ...lines.map((l) => l.value ?? 0))
  const badge = (st: string) => <Badge tone={st === 'model_card' ? 'ok' : st === 'computed' ? 'muted' : 'warn'}>{st === 'model_card' ? 'from the model card' : st}</Badge>
  return (
    <table className="w-full max-w-[820px] table-fixed">
      <colgroup><col style={{ width: 230 }} /><col /><col style={{ width: 96 }} /><col style={{ width: 150 }} /></colgroup>
      <thead><tr className="rule-b">{['item', '', 'amount', 'source'].map((h, i) => <th key={i} className={`t-micro py-1.5 font-[600] ${i === 2 ? 'text-right pr-3' : 'text-left'}`}>{h}</th>)}</tr></thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.key} className="rule-b align-middle">
            <td className="py-2 pr-3"><div className="t-small truncate" title={l.label}>{l.label}</div><div className="t-small ink3 truncate text-[13px]" title={l.detail}>{l.detail}</div></td>
            <td className="py-2 pr-3">{l.value != null
              ? <span className="block h-2.5" style={{ width: `${Math.max(1, (l.value / max) * 100)}%`, background: 'var(--ns-sodium)', borderRadius: 2 }} />
              : <span className="block h-2.5 rounded-[2px]" style={{ boxShadow: 'inset 0 0 0 1px var(--ns-line-strong)' }} />}</td>
            <td className="t-data py-2 pr-3 text-right">{l.value != null ? `$${l.value < 0.01 ? l.value.toFixed(4) : l.value.toFixed(2)}` : '—'}</td>
            <td className="py-2">{badge(l.status)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
