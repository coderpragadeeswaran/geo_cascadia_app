/** Browser-only: apply a mode's CSS custom properties (from tokens.ts) to an element; the app applies them to <html>.
 *  Kept out of tokens.ts so Node scripts (npm run map-styles) can import the tokens. */
import { cssVars, type Mode } from './tokens'

export function applyMode(m: Mode, el: HTMLElement = document.documentElement) {
  for (const [k, v] of Object.entries(cssVars(m))) {
    if (k === 'colorScheme') el.style.colorScheme = v
    else el.style.setProperty(k, v)
  }
  el.dataset.mode = m
}
