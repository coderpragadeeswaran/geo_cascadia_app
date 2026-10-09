/** Evidence photos of one object (design pass B §2). USER view: the photo with the object's own box (or, for an asset
 *  photo with no box in the aimed direction, a crosshair labelled as such). "How do we know?" draws EVERY detection on
 *  the photo (building, pole, lamp head, sign) with its class and confidence, a toggle per class, the object's box
 *  highlighted, and says where the boxes come from. "Live 360°" dives into the panorama with pins on the objects. */
import { Rotate3d } from 'lucide-react'
import { useContext, useEffect, useMemo, useState } from 'react'
import { useConfig, useEvidence } from '@/api/queries'
import type { EvidenceBox, EvidenceViewData } from '@/api/types'
import { cn, monthText, monthsAgo, OLD_PHOTO_MONTHS, plural } from '@/lib/utils'
import { useUi } from '@/store/ui'
import { Crosshair, EvidencePhoto, PhotoScale } from './EvidencePhoto'
import { Fact, HowWeKnow } from './HowWeKnow'
import { placeLabels } from '@/lib/labelLayout'
import { CLS_LETTER, CLS_NOUN, isDrawnTarget, LETTER_KEY, SIGN_NOT_MATCHED, tagBoxes } from '@/lib/photoTags'
import { measureText, useFontsReady } from '@/lib/textWidth'
import { shownView, showsBoxes, swapOf } from '@/lib/photoSwap'

/** D62: no building box fits this building's visible outline well enough (M3 overlap below 0.4) */
export const CANT_TELL = 'Can’t tell which box is this building in this photo.'
const BOX_CHOICE_TEXT = {
  same: 'The orange box is the building box that best covers the part of this building the camera can see (other outlines on the map hide the rest). It is also the box the analysis used.',
  changed: 'The orange box is the building box that best covers the part of this building the camera can see (other outlines on the map hide the rest). The analysis used a different box in this photo for this building; its results are unchanged.',
  cant_tell: 'No building box covers enough of the part of this building the camera can see (overlap below 40%), so none is marked. The analysis’ own readings are unchanged.',
} as const

/** overlay colours are fixed (they sit on photos, not on the Night / Daylight surface) */
export const CLS_COLOR: Record<EvidenceBox['cls'], string> = { building: '#cfd6ea', pole: '#ffffff', lamp_head: '#ffc27a', signboard: '#7dcad6' }
export const CLS_LABEL: Record<EvidenceBox['cls'], string> = { building: 'building', pole: 'pole', lamp_head: 'lamp', signboard: 'sign' }
const TARGET = '#ffa23a'
const LINKED = '#ffd29a'          // P7.3: boxes linked to the selected building ("part of this building")
export const LINKED_TEXT = 'part of this building'
const TARGET_NAME = { building: 'This building', pole: 'This pole', lamp: 'This streetlight', sign: 'This sign' } as const
const TAG_PX = 11                 // ui-polish-2: tag font size on screen, whatever size the photo is shown at
const pct = (c: number) => `${Math.round(c * 100)}%`

/** ui-polish-2: the boxes with short tags (B / P / S / L, numbered when several): no long labels on the photo. The orange
 *  box alone is "this building" (or pole …); boxes linked to it get a light-orange tag. Confidence only on hover / tap.
 *  `hl` = the highlighted box (index into `boxes`), shared with the key under the photo (PhotoKey). */
export function Boxes({ boxes, all, hidden, hl, setHl }: { boxes: EvidenceBox[]; all: boolean; hidden: Set<string>; targetName?: string
  hl?: number | null; setHl?: (i: number | null) => void }) {
  const [own, setOwn] = useState<number | null>(null)
  const H = setHl ? hl ?? null : own
  const S = setHl ?? setOwn
  const k = useContext(PhotoScale)                       // photo units per screen px
  const shown = useMemo(() => tagBoxes(boxes, all, hidden), [boxes, all, hidden])
  const fonts = useFontsReady()
  const tagH = 15 * k, pad = 8 * k, fs = TAG_PX * k
  const tagged = shown.filter((b) => b.tag)
  const spots = useMemo(() => placeLabels(tagged.map((b) => ({ ...b, text: b.tag!, priority: b.linked ? 2 : 1 })), (t) => measureText(t, TAG_PX) * k, tagH, pad),
    [fonts, k, tagged.map((b) => `${b.tag}:${b.x1},${b.y1},${b.x2},${b.y2}`).join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const spotOf = new Map(tagged.map((b, n) => [b.i, spots[n]]))
  const hov = H != null ? shown.find((b) => b.i === H) : undefined
  const tip = hov ? `${hov.tag ? `${hov.tag} · ` : ''}${hov.target ? 'this one · ' : hov.linked ? `${LINKED_TEXT} · ` : ''}${CLS_LABEL[hov.cls]} ${pct(hov.conf)}` : ''
  const tipAt = hov ? (spotOf.get(hov.i) ?? { x: hov.x1, y: Math.max(3, hov.y1 - tagH - 2), w: 0, h: tagH }) : null
  const tipW = tip ? measureText(tip, TAG_PX) * k + pad : 0
  const tipX = tipAt ? Math.max(3, Math.min(tipAt.x, 637 - tipW)) : 0
  const enter = (i: number) => () => S(i)
  const leave = () => S(null)
  const tap = (i: number) => (e: React.MouseEvent) => { e.stopPropagation(); S(H === i ? null : i) }
  return (
    <>
      {shown.map((b) => {
        const c = b.target ? TARGET : b.linked ? LINKED : CLS_COLOR[b.cls]
        const on = H === b.i, dim = H != null && !on
        return (
          <g key={`b${b.i}`} opacity={dim ? 0.35 : 1} data-hl={on ? '1' : undefined}>
            <rect x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} fill="none" stroke={on ? '#fff' : '#000'} strokeOpacity={on ? 0.95 : 0.5} strokeWidth={(b.target ? 8 : 5) + (on ? 3 : 0)} rx="3" />
            <rect x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} fill={b.target ? 'rgb(255 162 58 / 0.08)' : 'none'} stroke={c} strokeWidth={b.target ? 4 : on ? 3.4 : 2.2} rx="3"
              strokeDasharray={b.geom_ok || b.target ? undefined : '6 5'} />
            {/* a wide invisible edge: hover / tap the box itself */}
            <rect x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} fill="none" stroke="transparent" strokeWidth={10 * k} style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onMouseEnter={enter(b.i)} onMouseLeave={leave} onClick={tap(b.i)} />
          </g>
        )
      })}
      {/* tags after every box, so no box line crosses a tag */}
      {tagged.map((b) => {
        const r = spotOf.get(b.i)
        if (!r) return null
        const on = H === b.i, dim = H != null && !on
        return (
          <g key={`t${b.i}`} opacity={dim ? 0.45 : 1} style={{ pointerEvents: 'all', cursor: 'pointer' }} onMouseEnter={enter(b.i)} onMouseLeave={leave} onClick={tap(b.i)}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={2 * k} fill={b.linked ? LINKED : '#000'} fillOpacity={b.linked ? 0.95 : 0.74} stroke={on ? '#fff' : 'none'} strokeWidth={1.5 * k} />
            <text x={r.x + pad / 2} y={r.y + r.h - 4 * k} fill={b.linked ? '#1d1204' : CLS_COLOR[b.cls]} fontSize={fs} fontWeight={600} fontFamily="var(--ns-mono)">{b.tag}</text>
          </g>
        )
      })}
      {hov && tipAt && (
        <g style={{ pointerEvents: 'none' }}>
          <rect x={tipX} y={tipAt.y} width={tipW} height={tagH} rx={2 * k} fill="#000" fillOpacity=".9" stroke="#fff" strokeWidth={1.2 * k} />
          <text x={tipX + pad / 2} y={tipAt.y + tagH - 4 * k} fill="#fff" fontSize={fs} fontFamily="var(--ns-mono)">{tip}</text>
        </g>
      )}
    </>
  )
}

/** ui-polish-2: the key directly under the photo. "Orange = this building · B building · P pole · S sign · L streetlight",
 *  then the tagged boxes ("S1 = shop sign 'Transport India Pvt Ltd' · 88%"). Hovering an entry highlights its box and
 *  hovering a box highlights its entry (shared `hl`). */
export function PhotoKey({ boxes, all, hidden, targetName, hl, setHl }: { boxes: EvidenceBox[]; all: boolean; hidden: Set<string>; targetName: string
  hl: number | null; setHl: (i: number | null) => void }) {
  const shown = useMemo(() => tagBoxes(boxes, all, hidden), [boxes, all, hidden])
  const target = shown.find((b) => isDrawnTarget(b))            // D66: never promise an orange box that isn't on the photo
  const items = shown.filter((b) => b.tag)
  // keyboard focus highlights too, but not a focus that only follows a click elsewhere (focus-visible)
  const on = (i: number) => ({ onMouseEnter: () => setHl(i), onMouseLeave: () => setHl(null), onBlur: () => setHl(null),
    onFocus: (e: React.FocusEvent<HTMLElement>) => { if (e.currentTarget.matches(':focus-visible')) setHl(i) } })
  return (
    <div className="t-small mt-1.5" aria-label="Photo key">
      <div className="ink2 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
        {target && (
          <button type="button" data-box={target.i} {...on(target.i)} className={cn('inline-flex items-center gap-1.5', hl === target.i && 'text-ink underline')}>
            <span className="inline-block h-2.5 w-3.5 rounded-[2px]" style={{ boxShadow: `inset 0 0 0 2px ${TARGET}` }} aria-hidden />Orange = {targetName.toLowerCase()}
          </button>
        )}
        {items.some((b) => b.linked) && <span className="inline-flex items-center gap-1"><span className="t-data rounded-[2px] px-1 text-[11px] font-[600]" style={{ background: LINKED, color: '#1d1204' }} aria-hidden>S</span> = {LINKED_TEXT}</span>}
        <span className="ink3">{LETTER_KEY.map(([l, w]) => `${l} ${w}`).join(' · ')}</span>
      </div>
      {items.length > 0 && (
        <ul className="mt-1 flex max-h-[64px] flex-wrap gap-x-3 gap-y-0.5 overflow-y-auto" aria-label="Boxes on the photo">
          {items.map((b) => (
            <li key={b.i}>
              <button type="button" data-box={b.i} {...on(b.i)} className={cn('ink2 text-left', hl === b.i && 'text-ink underline')}>
                <span className="t-data rounded-[2px] px-1 text-[11px] font-[600]" style={b.linked ? { background: LINKED, color: '#1d1204' } : { background: '#000', color: CLS_COLOR[b.cls] }}>{b.tag}</span>
                {' '}= {CLS_NOUN[b.cls]}{b.text ? <> “{b.text.length > 28 ? `${b.text.slice(0, 27)}…` : b.text}”</> : null}{b.linked ? `, ${LINKED_TEXT}` : ''} <span className="t-data ink3">· {pct(b.conf)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** ui-polish-2: the photo's largest width (px), so photo + key + the date / Front / Sign / Live 360° row fit at 1366×768
 *  and the next sections come into view: 300 in the Explore drawer, 400 in Review's wider middle column */
export function EvidenceViews({ kind, id, at, target, maxPhoto = 300 }: {
  kind: 'building' | 'asset' | 'unmapped'; id: string; at: { lat: number; lng: number }; target: keyof typeof TARGET_NAME; maxPhoto?: number }) {
  const area = useUi((s) => s.area)
  const { data: views, isPending, isError, refetch } = useEvidence(area, kind, id)
  const [i, setI] = useState(0)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  // this photo's own "How do we know?": open = draw everything the detector found (it never opens other sections)
  const [all, setAll] = useState(false)
  const [hl, setHl] = useState<number | null>(null)       // the box highlighted from the photo or its key
  const dive = useUi((s) => s.dive)
  const setDive = useUi((s) => s.setDive)
  const hasMap = !!useConfig().data?.maps_js_key            // Live 360° needs the map (no browser key: no photos either)
  useEffect(() => { setI(0) }, [id])
  useEffect(() => { setHl(null) }, [id, i, all])
  const v: EvidenceViewData | undefined = views?.[Math.min(i, (views?.length ?? 1) - 1)]
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const b of v?.boxes ?? []) m[b.cls] = (m[b.cls] ?? 0) + 1
    return m
  }, [v])
  if (isPending) return <div style={{ maxWidth: maxPhoto }} className="t-small ink3 flex aspect-square w-full animate-pulse items-center justify-center rounded-[var(--ns-r-control)] bg-line" role="status">Loading the evidence photos…</div>
  if (isError) return <p className="t-small ink2 rounded-[var(--ns-r-control)] p-4" style={{ boxShadow: 'inset 0 0 0 1px var(--ns-line)' }}>Couldn’t load the evidence photos: the API didn’t answer. <button className="link" onClick={() => refetch()}>Try again</button></p>
  if (!v) return <p className="t-small ink3 rounded-[var(--ns-r-control)] p-4" style={{ boxShadow: 'inset 0 0 0 1px var(--ns-line)' }}>No Street View evidence stored for this item.</p>
  const drawn = v.boxes.find((x) => isDrawnTarget(x))
  const name = target === 'building' && drawn?.cls === 'signboard' ? 'This building’s sign' : TARGET_NAME[target]
  // D66: a Sign photo whose sign box couldn't be matched says so in one plain line (no "Orange = …" in the key)
  const signLost = v.key === 'sign' && !drawn
  const toggle = (c: string) => setHidden((h) => { const n = new Set(h); if (n.has(c)) n.delete(c); else n.add(c); return n })
  // D60: the analysis photo is gone from Google: its current photo there (no boxes), or none at all
  const sw = swapOf(v.served, v.current, v.date)
  const ok = showsBoxes(sw)                 // D61: also the same photo under a new Google ID
  const live = sw.state === 'swapped' && sw.current ? sw.current : ok ? shownView(sw, v) : null
  return (
    <div>
      <div style={{ maxWidth: maxPhoto }}>
        <EvidencePhoto view={v} label={`${v.label} · ${Math.round(v.heading)}°`} swap={{ served: v.served, current: v.current, date: v.date }}>
          <Boxes boxes={v.boxes} all={all} hidden={hidden} hl={hl} setHl={setHl} />
          {v.target === 'crosshair' && <Crosshair />}
        </EvidencePhoto>
      </div>
      {ok && <PhotoKey boxes={v.boxes} all={all} hidden={hidden} targetName={name} hl={hl} setHl={setHl} />}
      {ok && v.target === 'crosshair' && <p className="t-small ink2 mt-1.5">No box was found in the aimed direction: the cross marks where the camera was aimed, not a detection.</p>}
      {ok && v.box_choice === 'cant_tell' && <p className="t-small ink2 mt-1.5" data-box-choice="cant_tell">{CANT_TELL}</p>}
      {ok && signLost && <p className="t-small ink2 mt-1.5" data-sign-lost>{kind === 'building' ? SIGN_NOT_MATCHED : 'The sign box couldn’t be matched in this photo.'}</p>}
      {v.user_note ? <p className="t-small ink2 mt-1.5">{v.user_note}</p>
        : ok && !signLost && v.target === 'none' && v.box_choice !== 'cant_tell' && <p className="t-small ink3 mt-1.5">No box for this {kind === 'asset' ? 'object' : 'building'} in this view.</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <PhotoDate date={sw.state === 'swapped' ? sw.current?.date : v.date} />
        {(views?.length ?? 0) > 1 && views!.map((x, k) => (
          <button key={x.key} onClick={() => setI(k)} aria-pressed={k === i} className="btn h-7">{x.label}</button>
        ))}
        <div className="flex-1" />
        {hasMap && (live || dive) && <button className={cn('btn', dive ? 'btn-solid' : 'btn-sodium')} onClick={() => setDive(dive || !live ? null : { pano: live.pano_id, heading: live.heading, pitch: live.pitch, fov: live.fov, at })}>
          <Rotate3d /> {dive ? 'Back to map' : 'Live 360°'}
        </button>}
        {hasMap && !live && !dive && <LiveNearby camera={v.camera} heading={v.heading} at={at} />}
      </div>
      {!ok ? (
        <HowWeKnow label="How do we know? (the analysis photo)" summary={<>The analysis used Google panorama <span className="t-data">{v.pano_id}</span>{monthText(v.date) ? ` (${monthText(v.date)})` : ''}. Google no longer serves it, so the {plural(v.boxes.length, 'box', 'boxes')} the detector found on it can’t be drawn.</>}
          links={[{ page: 'hood', section: 'overview', label: 'Photos Google no longer serves' }]}>
          <Fact k="Analysis photo" hint="no longer served by Google"><span className="t-data">{v.pano_id}</span> · facing {Math.round(v.heading)}°, {v.fov}° wide</Fact>
          {sw.current && <Fact k="Shown instead" hint="Google’s current panorama"><span className="t-data">{sw.current.pano_id}</span> · {monthText(sw.current.date) ?? 'date unknown'} · {sw.current.moved_m} m from the analysis camera · facing {Math.round(sw.current.heading)}° (aimed at this {kind === 'asset' ? 'object' : kind === 'unmapped' ? 'sign' : 'building’s front'})</Fact>}
          <Fact k="Checked" hint="free Street View metadata, kept 30 days">The app asks Google whether a photo is still served before showing it, and never requests one it knows is gone.</Fact>
        </HowWeKnow>
      ) : (
      <HowWeKnow label="How do we know? (everything the detector found)" open={all} onOpenChange={setAll}
        summary={<>The detector marked {plural(v.boxes.length, 'thing')} in this photo, now all drawn. Each box has a short tag (B building, P pole, S sign, L streetlight lamp); hover a tag, a box or its line in the key to see how sure the detector was{v.target === 'box' ? `. The orange box is this ${kind === 'asset' ? 'object' : kind === 'unmapped' ? 'sign' : 'building'}` : ''}.</>}
        links={[{ page: 'hood', section: 'detection', label: 'How detection works' }, { page: 'trust', section: 'detector', label: 'Detector accuracy' }]}>
        <div className="flex flex-wrap gap-1.5 pb-1" role="group" aria-label="Show detections by class">
          {(Object.keys(CLS_LABEL) as EvidenceBox['cls'][]).filter((c) => counts[c]).map((c) => (
            <button key={c} onClick={() => toggle(c)} aria-pressed={!hidden.has(c)} className="chip px-2 text-[14.5px]"
              style={{ opacity: hidden.has(c) ? 0.45 : 1 }}>
              <span className="size-2.5 rounded-[2px]" style={{ boxShadow: `inset 0 0 0 2px ${CLS_COLOR[c]}` }} /> <span className="t-data">{CLS_LETTER[c]}</span> {CLS_LABEL[c]} <span className="t-data ink3">{counts[c]}</span>
            </button>
          ))}
        </div>
        <Fact k="Boxes" hint={`${plural(v.boxes.length, 'YOLO detection')}, confidence`}>Solid boxes were used to work out positions; dashed boxes were not (tilted photos, or photos uploaded by the public). The percentage (on hover, and in the key) is how sure the detector was.</Fact>
        <Fact k="This photo" hint={v.source === 'exact' ? `heading ${Math.round(v.heading)}°, pitch ${v.pitch}°, fov ${v.fov}°` : v.source === 'projected' ? `fov ${v.fov}°, projected` : undefined}>{v.source === 'exact' ? `The same photo the analysis used: facing ${Math.round(v.heading)}°, tilted ${v.pitch}°, ${v.fov}° wide.`
          : v.source === 'projected' ? `Pointed at the object (${v.fov}° wide). The boxes come from the analysis photos taken from the same spot, facing ${v.projected_from?.map((h) => `${Math.round(h)}°`).join(', ')}, redrawn into this view.`
            : 'No detector results are stored for this photo.'}</Fact>
        {v.box_choice && <Fact k="Which box" hint="matched to the building's visible outline">{BOX_CHOICE_TEXT[v.box_choice]}</Fact>}
        {v.target === 'box' && v.aim_offset_deg != null && <Fact k="Which box">The box closest to where the camera was aimed: {v.aim_offset_deg}° from the middle of the photo</Fact>}
        {v.note && !(v.source === 'projected' && v.target === 'box') && <Fact k="Note">{v.note}</Fact>}
        <Fact k="Taken" hint="panorama capture month (Google)">{monthText(v.date) ?? 'Date not stored for this photo'}</Fact>
        {sw.state === 'same' && sw.current ? (
          <Fact k="Photo ID" hint="re-issued by Google"><span className="t-data">{v.pano_id}</span> (analysis) is now served as <span className="t-data">{sw.current.pano_id}</span>: same capture month, {sw.current.moved_m} m apart, and the detector re-run on it found the saved boxes again, so they are drawn as before.</Fact>
        ) : <Fact k="Photo ID" hint="Street View panorama"><span className="t-data">{v.pano_id}</span></Fact>}
      </HowWeKnow>
      )}
    </div>
  )
}

/** D60: no photo of the analysis' panorama nor a current one within 25 m: offer the live 360° view only if Google's
 *  own panorama service finds one within 50 m (asked on click; nothing is requested before) */
function LiveNearby({ camera, heading, at }: { camera?: { lat: number; lon: number } | null; heading: number; at: { lat: number; lng: number } }) {
  const setDive = useUi((s) => s.setDive)
  const [none, setNone] = useState(false)
  if (!camera) return null
  if (none) return <span className="t-small ink3">No live 360° view here either</span>
  const open = () => {
    new google.maps.StreetViewService().getPanorama({ location: { lat: camera.lat, lng: camera.lon }, radius: 50, source: google.maps.StreetViewSource.OUTDOOR },
      (d, st) => {
        const id = d?.location?.pano, p = d?.location?.latLng
        if (st !== google.maps.StreetViewStatus.OK || !id || !p) return setNone(true)
        setDive({ pano: id, heading: google.maps.geometry?.spherical ? google.maps.geometry.spherical.computeHeading(p, at) : heading, pitch: 0, fov: 90, at })
      })
  }
  return <button className="btn btn-sodium" onClick={open}><Rotate3d /> Live 360°</button>
}

/** P8: "Photo from Mar 2023": Google's capture month of this panorama (stored by the analysis, nothing fetched). Older
 *  than three years is said plainly, because the street may have changed since. */
export function PhotoDate({ date }: { date?: string | null }) {
  const t = monthText(date)
  if (!t) return null
  const old = (monthsAgo(date) ?? 0) > OLD_PHOTO_MONTHS
  return (
    <span className="tag mr-1" title={old ? 'Taken more than 3 years ago: the street may have changed since' : 'When Google took this photo'}
      style={old ? { color: 'var(--ns-sodium)', boxShadow: 'inset 0 0 0 1px var(--ns-sodium)' } : undefined}>
      Photo from {t}{old ? ' · over 3 years old' : ''}
    </span>
  )
}
