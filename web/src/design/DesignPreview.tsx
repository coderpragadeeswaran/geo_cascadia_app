/** /design-preview — NIGHT SURVEY design proposal on real Ward 29 data. Preview only: the real pages are unchanged.
 *  Two map frames (area + street level) exist only on this page; the app itself keeps one map instance (D3). */
import { GoogleMapsOverlay } from '@deck.gl/google-maps'
import { useQuery } from '@tanstack/react-query'
import { APIProvider, Map, useMap } from '@vis.gl/react-google-maps'
import { useEffect, useMemo, useRef, useState } from 'react'
import { post, useConfig } from '@/api/queries'
import type { Building, GapRow, JobPreview, QueryResponse } from '@/api/types'
import { charts } from '@/lib/derive'
import { useAreaData } from '@/lib/useAreaData'
import { flyTo } from '@/map/camera'
import { splitFeatures, type Split } from '@/map/layers'
import { useUi } from '@/store/ui'
import './night-survey.css'
import { NsDrive } from './NsDrive'
import { NsShell } from './NsShell'
import { NsStory } from './NsStory'
import { NsAltimeter, NsAnalyseSheet, NsChart, NsEvidence, NsFindingsTable, NsGapsPanel, NsKey, NsKpis, NsTopBar } from './NsParts'
import { nsLayers } from './nsLayers'
import { colors, cssVars, mapStyleJson, motion, statusV1Night, type Mode } from './tokens'

// Self-hosted fonts only: stop the Maps JS API from injecting its Roboto stylesheet from fonts.googleapis.com
// (we disable Google's default UI; attribution text falls back to our font stack).
if (typeof document !== 'undefined' && !(window as unknown as { __nsNoRoboto?: boolean }).__nsNoRoboto) {
  ;(window as unknown as { __nsNoRoboto?: boolean }).__nsNoRoboto = true
  const head = document.head
  const orig = head.insertBefore.bind(head)
  head.insertBefore = function <T extends Node>(node: T, ref: Node | null): T {
    const href = (node as unknown as HTMLLinkElement).href
    if (typeof href === 'string' && href.includes('fonts.googleapis.com')) return node
    return orig(node, ref) as T
  }
}

const Q2 = 'Show streets where no streetlight is detected within 60 m'
const BUILDING = 'w1252504515'
const REDUCED = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const WARD29_AREA = { center: { lat: 11.0316, lng: 76.9788 }, zoom: 15.55 }

export default function DesignPreview() {
  const cfg = useConfig()
  const [mode, setMode] = useState<Mode>('night')
  useEffect(() => { useUi.setState({ area: 'ward29' }); document.title = 'Night Survey · design preview' }, [])
  if (!cfg.data) return <div style={{ background: '#070a14', height: '100vh' }} />
  return (
    <APIProvider apiKey={cfg.data.maps_js_key} version="quarterly">
      <Page mode={mode} setMode={setMode} mapId={cfg.data.map_id} />
    </APIProvider>
  )
}

function Page({ mode, setMode, mapId }: { mode: Mode; setMode: (m: Mode) => void; mapId: string }) {
  const { records, geo, streets } = useAreaData()
  const split = useMemo(() => (geo ? splitFeatures(geo.features) : null), [geo])
  const q2 = useQuery({ queryKey: ['ns-q2'], queryFn: () => post<QueryResponse>('/query', { area: 'ward29', text: Q2 }) })
  const prev = useQuery({ queryKey: ['ns-analyse'], queryFn: () => post<JobPreview>('/jobs/preview', { lat: 11.0311766, lon: 76.9732893 }), retry: 0 })
  const [base, setBase] = useState<'json' | 'mapid'>('json')
  const [replay, setReplay] = useState(0)
  const introMode = useRef(mode)            // the opening plays on first load and on "Replay", not on every mode switch
  const [analyse, setAnalyse] = useState(false)
  const [fx, setFx] = useState<{ x: number; y: number } | null>(null)
  const building = records?.buildings.find((b) => b.id === BUILDING)
  const gaps = (q2.data?.rows ?? []) as unknown as GapRow[]
  const chart = useMemo(() => (records ? charts(records, null, streets.map((s) => s.props.name)).unmatched_by_street : []), [records, streets])

  return (
    <div className="ns min-h-screen overflow-y-auto" style={{ ...cssVars(mode), height: '100vh' } as React.CSSProperties}>
      <header className="rule-b mx-auto flex max-w-[1400px] flex-wrap items-end justify-between gap-4 px-6 pb-5 pt-8">
        <div>
          <div className="t-micro sodium">Design proposal · preview only</div>
          <h1 className="t-display mt-2" style={{ fontSize: 44 }}>Night Survey</h1>
          <p className="t-body ink2 mt-2 max-w-[680px]">The city at night, lit by its own streetlights. Roads the pipeline analysed glow sodium orange;
            every stretch with no lamp within 60 m stays dark. Real Ward 29 data. Tokens: <span className="t-data">web/src/design/tokens.ts</span>, rationale: <span className="t-data">docs/DESIGN.md</span>.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden" style={{ border: '1px solid var(--ns-line-strong)', borderRadius: 'var(--ns-r-control)' }} role="radiogroup" aria-label="Mode">
            {(['night', 'daylight'] as const).map((m) => (
              <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className="btn" style={{ borderRadius: 0, color: mode === m ? 'var(--ns-bg0)' : undefined, background: mode === m ? 'var(--ns-ink)' : undefined }}>{m === 'night' ? 'Night' : 'Daylight'}</button>
            ))}
          </div>
          <button className="btn btn-sodium" onClick={() => setReplay((r) => r + 1)}>Replay opening</button>
        </div>
      </header>

      <Section n="00" title="Status colours: v1 → v2 (softer)" note="v1 was electric (ice cyan, neon rose). v2 keeps the logic (warm sodium = the lit city, cool = findings, slate = nothing wrong) at lower chroma. Validated against each other and against sodium: colour-blind ΔE ≥ 8.2 (protan), normal-vision ≥ 16.4, contrast ≥ 3:1 on the panel colour. Status always comes with a text label.">
        <StatusCompare />
      </Section>

      <Section n="01" title="Area level" note="Map is the hero. Top bar and five numbers sit on a scrim, not on cards. The panel appears because a question was asked (query 2).">
        <Frame h={720} onMove={analyse ? setFx : undefined}>
          {split && <PreviewMap key={`a-${mode}-${base}-${replay}`} id="ns-area" mode={mode} level="area" base={base} mapId={mapId} split={split} flyIn={replay > 0 || mode === introMode.current} coverage={analyse} />}
          {analyse && <div className="flashlight" style={{ '--fx': `${fx?.x ?? -999}px`, '--fy': `${fx?.y ?? -999}px`, right: 380 } as React.CSSProperties} />}
          <div className="scrim-top pointer-events-none absolute inset-x-0 top-0 pb-10 [&>*]:pointer-events-auto" style={{ right: 380 }}>
            <NsTopBar area="Ward 29, Coimbatore" query={Q2} mode={mode} setMode={setMode} analyse={analyse} onAnalyse={() => setAnalyse(!analyse)} />
            {records && !analyse && <div className="pt-1"><NsKpis records={records} /></div>}
            {analyse && <p className="t-small ink2 px-5 pt-2">Analyse: move the pointer over a street. Street View coverage shows only around it. Click “Analyse” again to leave.</p>}
          </div>
          <div className="absolute bottom-0 right-0 top-0 w-[380px] rule-l">{gaps.length > 0 && <NsGapsPanel rows={gaps} query={Q2} />}</div>
          <NsKey mode={mode} level="area" />
          <div className="absolute bottom-5 flex items-center gap-2" style={{ right: 400 }}>
            <span className="t-micro">Base</span>
            {(['json', 'mapid'] as const).map((b) => (
              <button key={b} className="btn" onClick={() => setBase(b)} style={{ color: base === b ? 'var(--ns-sodium)' : undefined }}>{b === 'json' ? 'Intended style (JSON preview)' : 'Your Map ID today'}</button>
            ))}
          </div>
          <div style={{ position: 'absolute', right: 400, bottom: 56 }}><NsAltimeter level="area" /></div>
        </Frame>
      </Section>

      <Section n="02" title="Street level + selection" note="Tilted 3D: footprints extruded by observed floors, status colour on the building itself; no-floor buildings stay flat and hatched. Lamps glow on their poles; the dark stretch is still dark. The drawer opens only on selection. 3D needs your vector Map ID: until the Cloud map style from docs/DESIGN.md is applied, Google's own blue 3D buildings and POI labels still show here.">
        <Frame h={680}>
          {split && building && <Lazy><PreviewMap key={`s-${mode}-${replay}`} id="ns-street" mode={mode} level="street" base="mapid" mapId={mapId} split={split}
            center={{ lat: building.lat, lng: building.lon }} selectedId={BUILDING} /></Lazy>}
          <div className="absolute inset-x-0 top-0" style={{ right: 400 }}><NsTopBar area="Ward 29, Coimbatore" mode={mode} /></div>
          <div className="absolute bottom-0 right-0 top-0 w-[400px] rule-l">{building && <NsEvidence b={building} />}</div>
          <NsKey mode={mode} level="street" />
        </Frame>
      </Section>

      <Section n="03" title="Components" note="Findings table fits its panel: columns drop by priority (location and model routes move to the row tooltip and the drawer). One chart per question. Analyse is a sheet, not a panel.">
        <div className="grid gap-8 lg:grid-cols-[380px_1fr]">
          <Panel label="Findings · panel width 380 px">{records && <NsFindingsTable rows={records.buildings.filter((b) => b.match_status !== 'matched').slice(0, 9)} />}</Panel>
          <Panel label="Findings · widened to 640 px (more columns appear)"><div className="max-w-[640px]">{records && <NsFindingsTable rows={records.buildings.filter((b) => b.match_status !== 'matched').slice(0, 9)} />}</div></Panel>
          <Panel label="One chart"><div className="px-5 py-4"><NsChart data={chart} /></div></Panel>
          <Panel label="Analyse · confirm sheet (real /jobs/preview)">
            <div className="flex min-h-[300px] items-center justify-center p-6" style={{ background: 'var(--ns-bg0)' }}>
              {prev.data ? <NsAnalyseSheet p={prev.data} /> : <span className="t-small ink3">{prev.isError ? 'Street lookup unavailable (Overpass).' : 'Looking up the street…'}</span>}
            </div>
            <p className="t-small ink3 px-5 py-3">In Analyse mode the map dims like a flashlight: Street View coverage lines are shown only in a 150 px circle around the cursor.</p>
          </Panel>
        </div>
      </Section>

      <Section n="03b" title="Type" note="Anek Tamil (Ek Type) sets Latin and Tamil in one variable family, with a width axis: condensed for titles, normal for reading. Martian Mono carries every measurement, count and ID. Both self-hosted.">
        <Specimen tamil={records?.buildings.find((b) => b.id === 'w1251626159')?.evidence?.sign_view?.ocr_text ?? null} />
      </Section>

      <Section n="04" title="Night and daylight" note="Daylight is paper and ink for projectors: the same structure, darker status steps, unlit stretches as heavy ink.">
        <div className="grid gap-6 lg:grid-cols-2">
          {(['night', 'daylight'] as const).map((m) => (
            <div key={m} className="ns" style={{ ...cssVars(m), border: '1px solid var(--ns-line)', borderRadius: 'var(--ns-r-sheet)', overflow: 'hidden' } as React.CSSProperties}>
              <div className="t-micro px-5 pt-4">{m}</div>
              {records && <div className="py-3"><NsKpis records={records} /></div>}
              <div className="rule-t">{records && <NsFindingsTable rows={records.buildings.filter((b) => b.match_status !== 'matched').slice(0, 4)} />}</div>
              <div className="px-5 py-4"><NsChart data={chart.slice(0, 4)} /></div>
              <Swatches m={m} />
            </div>
          ))}
        </div>
      </Section>
      <Section n="05" title="App shell" note="The map is home: Explore and Analyse are modes of the map, never separate pages, and at most one panel is open. A 64 px rail reaches Review, Under the Hood, Trust and Jobs. Click the rail; in Explore try Analyse (flashlight + confirm sheet).">
        <Frame h={700}>
          <Lazy><NsShell mode={mode} records={records} split={split} analysePreview={prev.data}
            renderMap={({ coverage }) => split && <PreviewMap key={`sh-${mode}`} id="ns-shell" mode={mode} level="area" base="json" mapId={mapId} split={split} coverage={coverage} />} /></Lazy>
        </Frame>
      </Section>

      <Section n="06" title="Drive the street" note="Pick a street and drive it: the scrubber steps through the pipeline’s real camera stops on Sathy Main Road (803 m). The map follows the camera, the Street View frame shows the view ahead, findings appear as you pass them, and the first 412 m read as one dark stretch before the lamps begin. One billed Street View image per stop you settle on.">
        <Frame h={640}><Lazy><NsDrive mode={mode} /></Lazy></Frame>
      </Section>

      <Section n="07" title="Under the Hood, as a story" note="Scroll: each step counts up and shows what was kept and what was dropped. Pipeline counts come from run_report.json; countable facts are computed from the records (20 triangulated, not the report’s 29). No timings (resumed run, D1).">
        <div className="mx-auto max-w-[900px]"><NsStory records={records} /></div>
      </Section>

      <footer className="rule-t mx-auto max-w-[1400px] px-6 py-6 t-small ink3">Registers are synthetic demo data. Prototype — imagery © Google.</footer>
    </div>
  )
}

function Section({ n, title, note, children }: { n: string; title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-[1400px] px-6 py-10">
      <div className="mb-5 grid gap-2 md:grid-cols-[80px_1fr]">
        <span className="t-data sodium">{n}</span>
        <div><h2 className="t-title" style={{ fontSize: 22 }}>{title}</h2><p className="t-small ink2 mt-1 max-w-[760px]">{note}</p></div>
      </div>
      {children}
    </section>
  )
}
const Frame = ({ h, children, onMove }: { h: number; children: React.ReactNode; onMove?: (p: { x: number; y: number }) => void }) => (
  <div className="relative overflow-hidden" style={{ height: h, borderRadius: 'var(--ns-r-sheet)', border: '1px solid var(--ns-line)', background: 'var(--ns-bg0)' }}
    onMouseMove={onMove ? (e) => { const r = e.currentTarget.getBoundingClientRect(); onMove({ x: e.clientX - r.left, y: e.clientY - r.top }) } : undefined}>{children}</div>
)
const Panel = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="surface overflow-hidden" style={{ border: '1px solid var(--ns-line)', borderRadius: 'var(--ns-r-sheet)' }}><div className="t-micro rule-b px-5 py-2.5">{label}</div>{children}</div>
)
function Specimen({ tamil }: { tamil: string | null }) {
  const rows: [string, React.ReactNode][] = [
    ['display · 30 / 640 / width 78', <span className="t-display">Ward 29, Coimbatore</span>],
    ['title · 18 / 600 / width 85', <span className="t-title">Buildings with no register record</span>],
    ['body · 14 / 420', <span className="t-body">Every stretch with no lamp within 60 m stays dark.</span>],
    ['micro · 10.5 caps', <span className="t-micro">Dark stretches</span>],
    ['figure · mono 24 / 300', <span className="t-figure">2,019 m</span>],
    ['data · mono 11.5', <span className="t-data">w1251626159 · 11.03144, 76.97499 · ± 3.5 m</span>],
    ['sign text (OCR, from the data)', <span style={{ fontSize: 22, fontWeight: 560 }}>{tamil ?? '—'} <span className="t-small ink3">· chitra tex, w1251626159</span></span>],
  ]
  return (
    <div className="surface" style={{ border: '1px solid var(--ns-line)', borderRadius: 'var(--ns-r-sheet)' }}>
      {rows.map(([k, v], i) => <div key={k} className={`grid items-baseline gap-4 px-5 py-3 md:grid-cols-[240px_1fr] ${i ? 'rule-t' : ''}`}><span className="t-data ink3">{k}</span>{v}</div>)}
    </div>
  )
}

/** mount children only once they come near the viewport (keeps the preview from starting four maps at once) */
function Lazy({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!ref.current || on) return
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setOn(true); io.disconnect() } }, { rootMargin: '300px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [on])
  return <div ref={ref} className="absolute inset-0">{on && children}</div>
}

function StatusCompare() {
  const v2 = colors.night
  const rows: [string, string, string, string][] = [
    ['matched', statusV1Night.matched, v2.matched, 'dusk slate'], ['discrepancy', statusV1Night.discrepancy, v2.discrepancy, 'glacier'],
    ['no record', statusV1Night.noRecord, v2.noRecord, 'peony'],
  ]
  const Sample = ({ c }: { c: string[] }) => (
    <div className="relative h-[120px] overflow-hidden" style={{ background: colors.night.bg0, borderRadius: 'var(--ns-r-control)' }}>
      <span className="absolute left-4 right-4 top-[58px] h-[3px] rounded" style={{ background: colors.night.sodiumGlow, boxShadow: `0 0 10px ${colors.night.sodium}` }} />
      <span className="absolute left-[38%] right-[30%] top-[56px] h-[7px] rounded-sm" style={{ background: colors.night.dark, boxShadow: `0 0 0 1px ${colors.night.darkEdge}` }} />
      {[[12, 30, 0], [22, 76, 1], [30, 26, 2], [48, 80, 0], [62, 30, 1], [70, 78, 2], [84, 34, 0], [90, 80, 1]].map(([x, y, k], i) => (
        <span key={i} className="absolute size-[9px] rounded-full" style={{ left: `${x}%`, top: y, background: c[k] }} />
      ))}
      <span className="absolute size-[7px] rounded-full" style={{ left: '18%', top: 55, background: '#fff4e0', boxShadow: `0 0 10px 4px ${colors.night.sodiumGlow}` }} />
      <span className="absolute size-[7px] rounded-full" style={{ left: '78%', top: 55, background: '#fff4e0', boxShadow: `0 0 10px 4px ${colors.night.sodiumGlow}` }} />
    </div>
  )
  return (
    <div className="ns grid gap-6 md:grid-cols-2" style={cssVars('night') as React.CSSProperties}>
      {(['v1 · electric', 'v2 · soft (proposed)'] as const).map((label, col) => (
        <div key={label} style={{ border: '1px solid var(--ns-line)', borderRadius: 'var(--ns-r-sheet)' }} className="p-5">
          <div className="t-micro mb-3" style={{ color: col ? 'var(--ns-sodium)' : undefined }}>{label}</div>
          <Sample c={rows.map((r) => r[col + 1])} />
          <ul className="mt-4">
            {rows.map(([k, a, b, name]) => (
              <li key={k} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 py-2 rule-b">
                <span className="size-5" style={{ background: col ? b : a, borderRadius: 4 }} />
                <span>{k}{col ? <span className="t-small ink3"> · {name}</span> : null}</span>
                <span className="t-data ink3">{col ? b : a}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function Swatches({ m }: { m: Mode }) {
  const c = colors[m]
  const sw: [string, string][] = [['sodium', c.sodium], ['matched', c.matched], ['discrepancy', c.discrepancy], ['no record', c.noRecord], ['ink', c.ink], ['surface', c.bg1]]
  return (
    <div className="rule-t flex flex-wrap gap-4 px-5 py-4">
      {sw.map(([k, v]) => <div key={k} className="flex items-center gap-2"><span className="size-5" style={{ background: v, borderRadius: 4, boxShadow: 'inset 0 0 0 1px var(--ns-line-strong)' }} /><span className="t-small">{k}</span><span className="t-data ink3">{v}</span></div>)}
    </div>
  )
}

// ------------------------------------------------------------------ map frame with deck overlay, fly-in, lights-on
function PreviewMap({ id, mode, level, base, mapId, split, flyIn, center, selectedId, coverage }: {
  id: string; mode: Mode; level: 'area' | 'street'; base: 'json' | 'mapid'; mapId: string; split: Split; flyIn?: boolean
  center?: google.maps.LatLngLiteral; selectedId?: string; coverage?: boolean }) {
  const street = level === 'street'
  const start = street ? { center: center!, zoom: 18.35, tilt: 58, heading: 32 }
    : flyIn && !REDUCED ? { center: WARD29_AREA.center, zoom: 12.4, tilt: 0, heading: 0 } : { ...WARD29_AREA, tilt: 0, heading: 0 }
  const json = base === 'json' && !street
  return (
    <Map id={id} {...(json ? { styles: mapStyleJson[mode] } : { mapId, renderingType: 'VECTOR' as const, colorScheme: mode === 'night' ? 'DARK' as const : 'LIGHT' as const })}
      mapTypeId="roadmap" defaultCenter={start.center} defaultZoom={start.zoom} defaultTilt={start.tilt} defaultHeading={start.heading}
      disableDefaultUI clickableIcons={false} gestureHandling="cooperative" isFractionalZoomEnabled {...(json ? {} : { tiltInteractionEnabled: true, headingInteractionEnabled: true })}
      style={{ position: 'absolute', inset: 0 }}>
      <NsDeck id={id} mode={mode} level={level} split={split} flyIn={!!flyIn && !street} selectedId={selectedId} />
      {coverage && <Coverage id={id} />}
    </Map>
  )
}

/** Street View coverage: only in Analyse mode (the flashlight overlay limits it to the pointer's surroundings) */
function Coverage({ id }: { id: string }) {
  const map = useMap(id)
  useEffect(() => { if (!map) return; const l = new google.maps.StreetViewCoverageLayer(); l.setMap(map); return () => l.setMap(null) }, [map])
  return null
}

function NsDeck({ id, mode, level, split, flyIn, selectedId }: { id: string; mode: Mode; level: 'area' | 'street'; split: Split; flyIn: boolean; selectedId?: string }) {
  const map = useMap(id)
  const [overlay, setOverlay] = useState<GoogleMapsOverlay | null>(null)
  const [lights, setLights] = useState(flyIn && !REDUCED ? 0 : 1)
  // create the overlay one tick later: StrictMode's immediate cleanup then cancels it before Google calls onAdd on a
  // finalized overlay ("Cannot read properties of null (reading 'addListener')" inside deck.gl)
  useEffect(() => {
    if (!map) return
    let o: GoogleMapsOverlay | null = null
    const t = setTimeout(() => {
      o = new GoogleMapsOverlay({ interleaved: false, useDevicePixels: Math.min(devicePixelRatio || 1, 1.5) })
      o.setMap(map); setOverlay(o)
    }, 0)
    return () => { clearTimeout(t); o?.finalize(); setOverlay(null) }
  }, [map])
  // opening: fly in over the dark city, then the streetlights fade on (staggered); reduced motion → final state at once
  useEffect(() => {
    if (!map || !flyIn || REDUCED) return
    let raf = 0, alive = true
    const once = map.addListener('tilesloaded', async () => {
      once.remove()
      await flyTo(map, { center: WARD29_AREA.center, zoom: WARD29_AREA.zoom, tilt: 0, heading: 0 }, { duration: motion.flyIn })
      if (!alive) return
      const t0 = performance.now()
      const tick = (t: number) => { const k = Math.min(1, (t - t0) / motion.lightsOn); setLights(k); if (k < 1) raf = requestAnimationFrame(tick) }
      raf = requestAnimationFrame(tick)
    })
    return () => { alive = false; once.remove(); cancelAnimationFrame(raf) }
  }, [map, flyIn])
  useEffect(() => { overlay?.setProps({ layers: nsLayers({ mode, level, split, lightsOn: lights, selectedId }) }) }, [overlay, mode, level, split, lights, selectedId])
  return null
}

export type { Building }
