/** ui-polish-2: short tags for the boxes on an evidence photo, pure so scripts/test-ui.ts can check it.
 *  A letter per kind (B building, P pole, S sign, L streetlight lamp), numbered left to right when the photo shows
 *  several of one kind (S1, S2 …). The orange "this building / pole / …" box has no tag: its colour says it. */
export type BoxCls = 'building' | 'pole' | 'lamp_head' | 'signboard'
export const CLS_LETTER: Record<BoxCls, string> = { building: 'B', pole: 'P', lamp_head: 'L', signboard: 'S' }
/** what each letter stands for, in the key under the photo (order = the key's order) */
export const LETTER_KEY: [string, string][] = [['B', 'building'], ['P', 'pole'], ['S', 'sign'], ['L', 'streetlight']]
export const CLS_NOUN: Record<BoxCls, string> = { building: 'building', pole: 'pole', lamp_head: 'streetlight lamp', signboard: 'shop sign' }

export interface TagIn { cls: BoxCls; x1: number; y1: number; target: boolean; linked?: boolean }
export type Tagged<T> = T & { i: number; tag: string | null }

/** the boxes drawn on the photo (the target and linked boxes always; every other box only with "everything the detector
 *  found" open and its kind not hidden), each with its tag; i = index into the input; targets last so they draw on top */
export function tagBoxes<T extends TagIn>(boxes: T[], all: boolean, hidden: Set<string> = new Set()): Tagged<T>[] {
  const shown = boxes.map((b, i) => ({ ...b, i })).filter((b) => b.target || b.linked || (all && !hidden.has(b.cls)))
  const others = shown.filter((b) => !b.target)
  const total: Record<string, number> = {}
  for (const b of others) total[b.cls] = (total[b.cls] ?? 0) + 1
  const k: Record<string, number> = {}
  const tag = new Map<number, string>()
  for (const b of [...others].sort((a, c) => a.x1 - c.x1 || a.y1 - c.y1)) {
    k[b.cls] = (k[b.cls] ?? 0) + 1
    tag.set(b.i, total[b.cls] > 1 ? `${CLS_LETTER[b.cls]}${k[b.cls]}` : CLS_LETTER[b.cls])
  }
  return shown.map((b) => ({ ...b, tag: b.target ? null : tag.get(b.i) ?? null }))
    .sort((a, c) => Number(a.target) - Number(c.target) || (a.tag ?? '').localeCompare(c.tag ?? '', undefined, { numeric: true }))
}
