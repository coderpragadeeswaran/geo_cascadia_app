/** The whole pipeline as a flow (P5, Under the Hood). Each column counts its own unit (panoramas → photos → detector
 *  boxes → results), so bars compare within a column; a ribbon shows which part of one column feeds which part of the
 *  next and tapers where the unit changes. Hatched = dropped, grey = not used here (still analysed elsewhere). Hover or
 *  focus for counts; click a dropped branch (or any segment with examples) to see real items and the reason. */
import { useMemo, useState } from 'react'
import type { Hood, SankeySeg } from '@/api/p5'
import { fmt } from '@/lib/utils'

const W = 980, H = 400, TOP = 34, BOT = 12, NODE = 14, GAP = 7, GROUP_GAP = 16, MIN_H = 3
const COL_X = [8, 262, 516, 770]

interface Box { seg: SankeySeg; unit: string; x: number; y0: number; y1: number }

/** stack values into [top, bottom] with gaps; tiny values still get MIN_H so they can be seen and clicked */
function stack(values: number[], top: number, bottom: number, gap: number) {
  const n = values.length, avail = bottom - top - gap * Math.max(0, n - 1)
  const total = values.reduce((a, b) => a + b, 0) || 1
  let h = values.map((v) => (v / total) * avail)
  const small = h.map((x) => x < MIN_H)
  const need = small.reduce((a, s, i) => a + (s ? MIN_H - h[i] : 0), 0)
  const bigSum = h.reduce((a, x, i) => a + (small[i] ? 0 : x), 0) || 1
  h = h.map((x, i) => (small[i] ? MIN_H : x - (x / bigSum) * need))
  const out: [number, number][] = []
  let y = top
  for (const x of h) { out.push([y, y + x]); y += x + gap }
  return out
}

const ribbon = (x0: number, a0: number, a1: number, x1: number, b0: number, b1: number) => {
  const xm = (x0 + x1) / 2
  return `M${x0} ${a0}C${xm} ${a0} ${xm} ${b0} ${x1} ${b0}L${x1} ${b1}C${xm} ${b1} ${xm} ${a1} ${x0} ${a1}Z`
}

export default function Sankey({ hood, onPick }: { hood: Hood; onPick: (key: string, label: string) => void }) {
  const [hot, setHot] = useState<{ text: string; x: number; y: number } | null>(null)
  const { n, sankey } = hood
  const L = useMemo(() => {
    const cols = sankey.columns
    const boxes: Box[][] = []
    // columns 0–2: plain stacks
    for (let i = 0; i < 3; i++) {
      const segs = cols[i].segments ?? []
      const ys = stack(segs.map((s) => s.value), TOP, H - BOT, GAP)
      boxes.push(segs.map((s, k) => ({ seg: s, unit: cols[i].unit, x: COL_X[i], y0: ys[k][0], y1: ys[k][1] })))
    }
    // column 3: groups sized like the class boxes that feed them, then split in the group's own unit
    const c2 = new Map(boxes[2].map((b) => [b.seg.id, b]))
    const groups = cols[3].groups ?? []
    const gh = groups.map((g) => g.from.reduce((a, id) => a + ((c2.get(id)?.y1 ?? 0) - (c2.get(id)?.y0 ?? 0)), 0))
    const gy = stack(gh, TOP, H - BOT, GROUP_GAP)
    const col3: (Box & { group: string })[] = []
    groups.forEach((g, gi) => {
      const ys = stack(g.segments.map((s) => s.value), gy[gi][0], gy[gi][1], 3)
      g.segments.forEach((s, k) => col3.push({ seg: s, unit: g.unit, x: COL_X[3], y0: ys[k][0], y1: ys[k][1], group: g.id }))
    })
    boxes.push(col3)
    // ribbons
    const rib: { d: string; text: string; drop?: boolean }[] = []
    const stops = boxes[0].find((b) => b.seg.id === 'stops')
    if (stops) {
      const c1 = boxes[1]
      rib.push({ d: ribbon(COL_X[0] + NODE, stops.y0, stops.y1, COL_X[1], c1[0].y0, c1[c1.length - 1].y1),
        text: `${fmt.format(n.cameras)} camera stops took ${fmt.format(n.views)} photos` })
    }
    const cls = ['building', 'signboard', 'pole', 'lamp_head']
    const cnt = (view: string, c: string) => n[`boxes_${c}_${view}`] ?? 0
    const tgtUsed: Record<string, number> = {}
    for (const vb of boxes[1]) {
      const view = vb.seg.id                                             // mapped | unmapped
      const tot = cls.reduce((a, c) => a + cnt(view, c), 0) || 1
      let sy = vb.y0
      for (const c of cls) {
        const tb = boxes[2].find((b) => b.seg.id === c)
        const v = cnt(view, c)
        if (!tb || !v) continue
        const sh = ((vb.y1 - vb.y0) * v) / tot
        const th = ((tb.y1 - tb.y0) * v) / (n[`boxes_${c}`] || 1)
        const ty = tb.y0 + (tgtUsed[c] ?? 0)
        tgtUsed[c] = (tgtUsed[c] ?? 0) + th
        rib.push({ d: ribbon(COL_X[1] + NODE, sy, sy + sh, COL_X[2], ty, ty + th),
          text: `${fmt.format(v)} ${tb.seg.label} boxes from photos that ${view === 'mapped' ? 'face a mapped building' : 'face no building outline'}` })
        sy += sh
      }
    }
    groups.forEach((g) => {
      const members = col3.filter((b) => b.group === g.id)
      if (!members.length) return
      const top = members[0].y0, bottom = members[members.length - 1].y1
      const feeders = g.from.map((id) => c2.get(id)).filter(Boolean) as Box[]
      const tot = feeders.reduce((a, b) => a + (b.y1 - b.y0), 0) || 1
      let ty = top
      for (const f of feeders) {
        const th = ((bottom - top) * (f.y1 - f.y0)) / tot
        rib.push({ d: ribbon(COL_X[2] + NODE, f.y0, f.y1, COL_X[3], ty, ty + th), text: `${f.seg.label} boxes → ${g.unit}` })
        ty += th
      }
    })
    return { boxes, rib }
  }, [n, sankey])

  const show = (text: string) => (e: React.MouseEvent | React.FocusEvent) => {
    const t = e.currentTarget as SVGGraphicsElement
    const r = t.getBoundingClientRect(), host = t.ownerSVGElement!.getBoundingClientRect()
    setHot({ text, x: r.left - host.left + r.width / 2, y: r.top - host.top })
  }
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="group" aria-label="Pipeline flow from panoramas to results">
        <defs>
          <pattern id="gc-hatch-s" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.6" height="5" fill="var(--ns-ink3)" /></pattern>
        </defs>
        {sankey.columns.map((c, i) => (
          <text key={c.title} x={COL_X[i]} y={16} fill="var(--ns-ink2)" fontSize="13" fontWeight="600" letterSpacing=".06em">{c.title.toUpperCase()}
            <tspan fill="var(--ns-ink3)" fontWeight="400" letterSpacing="0"> · {c.unit}</tspan></text>
        ))}
        {L.rib.map((r, i) => (
          <path key={i} d={r.d} fill="var(--ns-sodium)" fillOpacity={0.13} className="transition-[fill-opacity] hover:[fill-opacity:0.32]"
            onMouseEnter={show(r.text)} onMouseLeave={() => setHot(null)}><title>{r.text}</title></path>
        ))}
        {L.boxes.flat().map((b) => {
          const s = b.seg
          const fill = s.kind === 'kept' ? 'var(--ns-sodium)' : s.kind === 'drop' ? 'url(#gc-hatch-s)' : 'var(--ns-line-strong)'
          const click = s.examples ? () => onPick(s.examples!, s.label) : undefined
          const text = `${s.label}: ${fmt.format(s.value)} ${b.unit}${s.reason ? ` — ${s.reason}` : ''}`
          const h = b.y1 - b.y0
          return (
            <g key={`${b.x}-${s.id}`} role={click ? 'button' : undefined} tabIndex={click ? 0 : -1} aria-label={`${text}${click ? '. Show real examples' : ''}`}
              style={{ cursor: click ? 'pointer' : 'default' }} onClick={click}
              onKeyDown={click ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click() } } : undefined}
              onMouseEnter={show(text)} onMouseLeave={() => setHot(null)} onFocus={show(text)} onBlur={() => setHot(null)}>
              <rect x={b.x} y={b.y0} width={NODE} height={h} fill={fill} stroke={s.kind === 'drop' ? 'var(--ns-ink3)' : 'none'} strokeWidth=".8" rx="2" />
              <text x={b.x + NODE + 6} y={b.y0 + Math.min(h / 2, 12) + 4} fontSize="12.5" fill={s.kind === 'drop' ? 'var(--ns-ink2)' : 'var(--ns-ink)'}
                paintOrder="stroke" stroke="var(--ns-bg0)" strokeWidth="3.5" strokeLinejoin="round">
                <tspan fontFamily="var(--ns-mono)">{fmt.format(s.value)}</tspan> {s.label}{click ? ' ›' : ''}
              </text>
            </g>
          )
        })}
      </svg>
      {hot && (
        <div className="sheet t-small pointer-events-none absolute z-10 max-w-[320px] -translate-x-1/2 -translate-y-full px-2.5 py-1.5" style={{ left: hot.x, top: hot.y - 6 }}>{hot.text}</div>
      )}
    </div>
  )
}
