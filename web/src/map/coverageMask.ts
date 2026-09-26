/** Analyse "flashlight" (review fix 9): Google's Street View coverage lines are shown ONLY inside a circle around the
 *  pointer, at every zoom. The coverage layer draws its tiles as DOM images in their own pane above the WebGL map; that
 *  pane (the highest ancestor of the tiles that holds no canvas) gets a CSS mask: a circle in screen space. Nothing is
 *  re-hosted or redrawn: Google's own tiles, just clipped (CLAUDE.md §9.6). */

const TILE = 'img[src*="!2ssvv!"]'

/** the pane that holds only the coverage tiles (no WebGL canvas, no other overlay) */
function pane(root: HTMLElement): HTMLElement | null {
  const img = root.querySelector<HTMLElement>(TILE)
  let e = img?.parentElement ?? null
  while (e && e.parentElement && e.parentElement !== root && !e.parentElement.querySelector('canvas')) e = e.parentElement
  return e && !e.querySelector('canvas') ? e : null
}

function apply(el: HTMLElement, mask: string | null, pos = '0px 0px', size = 'auto') {
  for (const pre of ['', '-webkit-']) {
    if (mask == null) {
      for (const k of ['mask-image', 'mask-position', 'mask-size', 'mask-repeat', 'mask-clip']) el.style.removeProperty(pre + k)
      continue
    }
    el.style.setProperty(pre + 'mask-image', mask)
    el.style.setProperty(pre + 'mask-position', pos)
    el.style.setProperty(pre + 'mask-size', size)
    el.style.setProperty(pre + 'mask-repeat', 'no-repeat')
    el.style.setProperty(pre + 'mask-clip', 'no-clip')
  }
}

/** Mask the coverage pane under `root` (the map element) to a circle of radius r at (x, y) in root's coordinates;
 *  null point = hide every coverage line (pointer off the map, or a street already picked). */
export function maskCoverage(root: HTMLElement, at: { x: number; y: number } | null, r: number) {
  const el = pane(root)
  if (!el) return
  // nothing to show (pointer off the map, street picked): hide the pane (a zero-height pane can't be masked to nothing)
  el.dataset.gcMask = '1'
  el.style.visibility = at ? '' : 'hidden'
  if (!at) return
  const m = root.getBoundingClientRect()
  const p = el.getBoundingClientRect()
  // the mask image covers the map's box; its origin is the pane's own (translated) top-left
  apply(el, `radial-gradient(circle ${r}px at ${at.x}px ${at.y}px, #000 0 72%, transparent 100%)`,
    `${m.left - p.left}px ${m.top - p.top}px`, `${m.width}px ${m.height}px`)
}

/** Remove the mask (leaving Analyse: the layer toggle's coverage is shown in full again) */
export function clearCoverageMask(root: HTMLElement | null) {
  if (!root) return
  root.querySelectorAll<HTMLElement>('[data-gc-mask]').forEach((e) => { apply(e, null); e.style.visibility = ''; delete e.dataset.gcMask })
}
