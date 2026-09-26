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
  width: (text: string) => number = estimateWidth) {
  const placed: Rect[] = []
  const out: (Rect | null)[] = items.map(() => null)
  const order = items.map((_, i) => i).sort((a, b) => items[b].priority - items[a].priority || items[a].y1 - items[b].y1)
  const maxY = 640 - CAPTION - LABEL_H
  for (const i of order) {
    const it = items[i]
    const w = Math.min(640 - 2 * EDGE, Math.ceil(width(it.text)) + 12)      // 6 px padding each side
    const x = Math.max(EDGE, Math.min(it.x1, 640 - EDGE - w))
    const starts = [it.y1 - LABEL_H - 2, it.y1 + 2, it.y2 + 2, it.y2 - LABEL_H - 2]
    let best: Rect | null = null
    for (let step = 0; step < 8 && !best; step++) {
      for (const [k, y0] of starts.entries()) {
        const dir = k === 0 || k === 3 ? -1 : 1                         // above / inside-bottom stack upward, the others down
        const y = Math.max(EDGE, Math.min(maxY, y0 + dir * step * (LABEL_H + 2)))
        const r = { x, y, w, h: LABEL_H }
        if (!placed.some((p) => hit(p, r))) { best = r; break }
      }
    }
    if (best) { placed.push(best); out[i] = best }
  }
  return out
}
