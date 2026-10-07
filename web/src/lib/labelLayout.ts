/** Evidence photo labels (review fix 11; widths measured, not guessed: walkthrough 2 fix 3), pure so it can be tested without a browser (scripts/test-ui.ts). */
export type Rect = { x: number; y: number; w: number; h: number }
const LABEL_H = 24, EDGE = 3, CAPTION = 48            // caption strip at the bottom of the photo, in 640-px units
const hit = (a: Rect, b: Rect) => a.x < b.x + b.w + 2 && b.x < a.x + a.w + 2 && a.y < b.y + b.h + 2 && b.y < a.y + a.h + 2

/** Review fix 11: every label inside the photo and none overlapping. Greedy: target labels first, then top to bottom;
 *  each tries above its box, inside its top edge, below it and inside its bottom edge, then steps further away
 *  (stacking); x is clamped into the photo. A label that finds no free place is left out (its box is still drawn). */
/** width of a label's text in the photo's 640-px units: measured with the real font when the caller can (canvas),
 *  else a safe estimate for the mono face (0.72 em per character at 18 px) */
export const estimateWidth = (text: string) => text.length * 13

export function placeLabels(items: { x1: number; y1: number; x2: number; y2: number; text: string; priority: number }[],
  width: (text: string) => number = estimateWidth, labelH = LABEL_H, pad = 12) {
  const LABEL_H_ = labelH
  const placed: Rect[] = []
  const out: (Rect | null)[] = items.map(() => null)
  const order = items.map((_, i) => i).sort((a, b) => items[b].priority - items[a].priority || items[a].y1 - items[b].y1)
  const maxY = 640 - CAPTION - LABEL_H_
  for (const i of order) {
    const it = items[i]
    const w = Math.min(640 - 2 * EDGE, Math.ceil(width(it.text)) + pad)     // padding each side (default 6 px)
    const x = Math.max(EDGE, Math.min(it.x1, 640 - EDGE - w))
    const starts = [it.y1 - LABEL_H_ - 2, it.y1 + 2, it.y2 + 2, it.y2 - LABEL_H_ - 2]
    let best: Rect | null = null
    for (let step = 0; step < 8 && !best; step++) {
      for (const [k, y0] of starts.entries()) {
        const dir = k === 0 || k === 3 ? -1 : 1                         // above / inside-bottom stack upward, the others down
        const y = Math.max(EDGE, Math.min(maxY, y0 + dir * step * (LABEL_H_ + 2)))
        const r = { x, y, w, h: LABEL_H_ }
        if (!placed.some((p) => hit(p, r))) { best = r; break }
      }
    }
    if (best) { placed.push(best); out[i] = best }
  }
  return out
}

/** D39: mini-map labels. Requests come in priority order, each with candidate positions (text baseline x, y); the first
 *  candidate that stays inside the plan and overlaps no obstacle (markers, corner plates) and no earlier label wins. A
 *  request with no free candidate is dropped (its text stays in the legend / tooltip). At most `max` labels. */
export type MapLabel = { x: number; y: number; text: string; strong?: boolean }
export function placeMapLabels(reqs: { text: string; cands: [number, number][]; strong?: boolean }[], obstacles: Rect[], W: number, H: number,
  width: (text: string) => number, max = 3, fontPx = 12): MapLabel[] {
  const occ = [...obstacles], out: MapLabel[] = []
  for (const r of reqs) {
    if (out.length >= max) break
    const w = width(r.text), h = fontPx + 4
    for (const [x, y] of r.cands) {
      const b = { x: x - 2, y: y - h + 3, w: w + 4, h }
      if (b.x < 4 || b.x + b.w > W - 4 || b.y < 4 || b.y + b.h > H - 4) continue
      if (occ.some((o) => hit(o, b))) continue
      occ.push(b); out.push({ x, y, text: r.text, strong: r.strong })
      break
    }
  }
  return out
}
