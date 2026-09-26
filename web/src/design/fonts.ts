/** Self-hosted fonts only (Anek Tamil + Martian Mono from @fontsource-variable, bundled by Vite). The Maps JS API
 *  injects a Roboto stylesheet from fonts.googleapis.com; we disable Google's default UI, so that request is blocked and
 *  the attribution text falls back to our font stack. Imported once, before the map loads (main.tsx). */
const w = window as unknown as { __nsNoRoboto?: boolean }
if (typeof document !== 'undefined' && !w.__nsNoRoboto) {
  w.__nsNoRoboto = true
  const head = document.head
  const orig = head.insertBefore.bind(head)
  head.insertBefore = function <T extends Node>(node: T, ref: Node | null): T {
    const href = (node as unknown as HTMLLinkElement).href
    if (typeof href === 'string' && href.includes('fonts.googleapis.com')) return node
    return orig(node, ref) as T
  }
}
export {}
