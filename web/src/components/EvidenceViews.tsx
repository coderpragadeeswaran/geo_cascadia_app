/** Evidence photos of one object (design pass B §2). USER view: the photo with the object's own box (or, for an asset
 *  photo with no box in the aimed direction, a crosshair labelled as such). "How do we know?" draws EVERY detection on
 *  the photo (building, pole, lamp head, sign) with its class and confidence, a toggle per class, the object's box
 *  highlighted, and says where the boxes come from. "Live 360°" dives into the panorama with pins on the objects. */
import { Rotate3d } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useEvidence } from '@/api/queries'
import type { EvidenceBox, EvidenceViewData } from '@/api/types'
import { cn, plural } from '@/lib/utils'
import { useUi } from '@/store/ui'
import { Crosshair, EvidencePhoto } from './EvidencePhoto'
import { Fact, HowWeKnow } from './HowWeKnow'
import { placeLabels } from '@/lib/labelLayout'
import { measureText, useFontsReady } from '@/lib/textWidth'

/** overlay colours are fixed (they sit on photos, not on the Night / Daylight surface) */
export const CLS_COLOR: Record<EvidenceBox['cls'], string> = { building: '#cfd6ea', pole: '#ffffff', lamp_head: '#ffc27a', signboard: '#7dcad6' }
export const CLS_LABEL: Record<EvidenceBox['cls'], string> = { building: 'building', pole: 'pole', lamp_head: 'lamp', signboard: 'sign' }
const TARGET = '#ffa23a'
const TARGET_NAME = { building: 'This building', pole: 'This pole', lamp: 'This streetlight', sign: 'This sign' } as const

function Boxes({ boxes, all, hidden, targetName }: { boxes: EvidenceBox[]; all: boolean; hidden: Set<string>; targetName: string }) {
  // targets last so they sit on top
  const shown = boxes.filter((b) => b.target || (all && !hidden.has(b.cls))).sort((a, b) => Number(a.target) - Number(b.target))
  // "building 43%": how sure the detector was (confidence 0.43)
  const texts = shown.map((b) => (b.target ? (all ? `${targetName.toLowerCase()} · ${CLS_LABEL[b.cls]} ${Math.round(b.conf * 100)}%` : targetName) : `${CLS_LABEL[b.cls]} ${Math.round(b.conf * 100)}%`))
  const labelled = shown.map((b) => all || b.target)
  // only labelled boxes take label space; spots[i] lines up with shown[i]
  const idx = shown.map((_, i) => i).filter((i) => labelled[i])
  const fonts = useFontsReady()          // re-measure once Martian Mono has loaded
  const placedAt = useMemo(() => placeLabels(idx.map((i) => ({ ...shown[i], text: texts[i], priority: shown[i].target ? 2 : 1 })), measureText),
    [fonts, texts.join('|'), shown.map((b) => `${b.x1},${b.y1},${b.x2},${b.y2}`).join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const spots = shown.map((_, i) => (labelled[i] ? placedAt[idx.indexOf(i)] : null))
  return (
    <>
      {shown.map((b, i) => {
        const c = b.target ? TARGET : CLS_COLOR[b.cls]
        return (
          <g key={`b${i}`}>
            <rect x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} fill="none" stroke="#000" strokeOpacity=".5" strokeWidth={b.target ? 8 : 5} rx="3" />
            <rect x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} fill={b.target ? 'rgb(255 162 58 / 0.08)' : 'none'} stroke={c} strokeWidth={b.target ? 4 : 2.2} rx="3"
              strokeDasharray={b.geom_ok || b.target ? undefined : '6 5'} />
          </g>
        )
      })}
      {/* labels after every box, so no box line crosses a label */}
      {shown.map((b, i) => {
        const r = labelled[i] ? spots[i] : null
        if (!r) return null
        return (
          <g key={`l${i}`}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="3" fill="#000" fillOpacity=".72" />
            <text x={r.x + 6} y={r.y + 17} fill={b.target ? TARGET : CLS_COLOR[b.cls]} fontSize="18" fontFamily="var(--ns-mono)">{texts[i]}</text>
          </g>
        )
      })}
    </>
  )
}

export function EvidenceViews({ kind, id, at, target }: {
  kind: 'building' | 'asset' | 'unmapped'; id: string; at: { lat: number; lng: number }; target: keyof typeof TARGET_NAME }) {
  const area = useUi((s) => s.area)
  const { data: views, isPending, isError } = useEvidence(area, kind, id)
  const [i, setI] = useState(0)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  // this photo's own "How do we know?": open = draw everything the detector found (it never opens other sections)
  const [all, setAll] = useState(false)
  const dive = useUi((s) => s.dive)
  const setDive = useUi((s) => s.setDive)
  useEffect(() => { setI(0) }, [id])
  const v: EvidenceViewData | undefined = views?.[Math.min(i, (views?.length ?? 1) - 1)]
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const b of v?.boxes ?? []) m[b.cls] = (m[b.cls] ?? 0) + 1
    return m
  }, [v])
  if (isPending) return <div className="aspect-square w-full animate-pulse rounded-[var(--ns-r-control)] bg-line" />
  if (isError || !v) return <p className="t-small ink3 rounded-[var(--ns-r-control)] p-4" style={{ boxShadow: 'inset 0 0 0 1px var(--ns-line)' }}>No Street View evidence stored for this item.</p>
  const name = TARGET_NAME[target]
  const toggle = (c: string) => setHidden((h) => { const n = new Set(h); if (n.has(c)) n.delete(c); else n.add(c); return n })
  return (
    <div>
      <EvidencePhoto view={v} label={`${v.label} · ${Math.round(v.heading)}°`}>
        <Boxes boxes={v.boxes} all={all} hidden={hidden} targetName={name} />
        {v.target === 'crosshair' && <Crosshair />}
      </EvidencePhoto>
      {v.target === 'crosshair' && <p className="t-small ink2 mt-1.5">No box was found in the aimed direction: the cross marks where the camera was aimed, not a detection.</p>}
      {v.target === 'none' && <p className="t-small ink3 mt-1.5">No box for this {kind === 'asset' ? 'object' : 'building'} in this view.</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {(views?.length ?? 0) > 1 && views!.map((x, k) => (
          <button key={x.key} onClick={() => setI(k)} aria-pressed={k === i} className="btn h-7">{x.label}</button>
        ))}
        <div className="flex-1" />
        <button className={cn('btn', dive ? 'btn-solid' : 'btn-sodium')} onClick={() => setDive(dive ? null : { pano: v.pano_id, heading: v.heading, pitch: v.pitch, fov: v.fov, at })}>
          <Rotate3d /> {dive ? 'Back to map' : 'Live 360°'}
        </button>
      </div>
      <HowWeKnow label="How do we know? (everything the detector found)" open={all} onOpenChange={setAll}
        summary={<>The detector marked {plural(v.boxes.length, 'thing')} in this photo. Each box says what it is and how sure the detector was{v.target === 'box' ? `; the orange box is this ${kind === 'asset' ? 'object' : kind === 'unmapped' ? 'sign' : 'building'}` : ''}.</>}
        links={[{ page: 'hood', section: 'detection', label: 'How detection works' }, { page: 'trust', section: 'detector', label: 'Detector accuracy' }]}>
        <div className="flex flex-wrap gap-1.5 pb-1" role="group" aria-label="Show detections by class">
          {(Object.keys(CLS_LABEL) as EvidenceBox['cls'][]).filter((c) => counts[c]).map((c) => (
            <button key={c} onClick={() => toggle(c)} aria-pressed={!hidden.has(c)} className="chip px-2 text-[14.5px]"
              style={{ opacity: hidden.has(c) ? 0.45 : 1 }}>
              <span className="size-2.5 rounded-[2px]" style={{ boxShadow: `inset 0 0 0 2px ${CLS_COLOR[c]}` }} /> {CLS_LABEL[c]} <span className="t-data ink3">{counts[c]}</span>
            </button>
          ))}
        </div>
        <Fact k="Boxes" hint={`${plural(v.boxes.length, 'YOLO detection')}, confidence`}>Solid boxes were used to work out positions; dashed boxes were not (tilted photos, or photos uploaded by the public). The percentage is how sure the detector was.</Fact>
        <Fact k="This photo" hint={v.source === 'exact' ? `heading ${Math.round(v.heading)}°, pitch ${v.pitch}°, fov ${v.fov}°` : v.source === 'projected' ? `fov ${v.fov}°, projected` : undefined}>{v.source === 'exact' ? `The same photo the analysis used: facing ${Math.round(v.heading)}°, tilted ${v.pitch}°, ${v.fov}° wide.`
          : v.source === 'projected' ? `Pointed at the object (${v.fov}° wide). The boxes come from the analysis photos taken from the same spot, facing ${v.projected_from?.map((h) => `${Math.round(h)}°`).join(', ')}, redrawn into this view.`
            : 'No detector results are stored for this photo.'}</Fact>
        {v.target === 'box' && v.aim_offset_deg != null && <Fact k="Which box">The box closest to where the camera was aimed: {v.aim_offset_deg}° from the middle of the photo</Fact>}
        {v.note && !(v.source === 'projected' && v.target === 'box') && <Fact k="Note">{v.note}</Fact>}
        <Fact k="Photo ID" hint="Street View panorama"><span className="t-data">{v.pano_id}</span></Fact>
      </HowWeKnow>
    </div>
  )
}
