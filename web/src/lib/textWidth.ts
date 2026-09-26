/** Measure label text with the font the SVG actually uses (Martian Mono via --ns-mono), in px at the given size. The
 *  photo's SVG viewBox is 640 wide and its labels are 18 units high, so px at 18 px = viewBox units. Needs the web
 *  font loaded: callers re-measure after document.fonts.ready. */
import { useEffect, useState } from 'react'
import { estimateWidth } from './labelLayout'

let ctx: CanvasRenderingContext2D | null | undefined
export function measureText(text: string, sizePx = 18) {
  if (typeof document === 'undefined') return estimateWidth(text)
  if (ctx === undefined) ctx = document.createElement('canvas').getContext('2d')
  const fam = getComputedStyle(document.documentElement).getPropertyValue('--ns-mono').trim() || 'monospace'
  if (!ctx) return estimateWidth(text)
  ctx.font = `400 ${sizePx}px ${fam}`
  return Math.max(ctx.measureText(text).width, 0)
}

/** true once the web fonts are ready (labels are laid out again then) */
export function useFontsReady() {
  const [ready, setReady] = useState(() => typeof document !== 'undefined' && document.fonts?.status === 'loaded')
  useEffect(() => { if (!ready) document.fonts?.ready.then(() => setReady(true)) }, [ready])
  return ready
}
