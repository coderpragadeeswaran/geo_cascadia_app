/** Ctrl/⌘ K command palette (cmdk): ask a question (QueryEngine), the spec's example questions, jump to a place
 *  (Google Places Autocomplete, New API, browser key), switch area, open a page, go to a zoom band, toggle layers. */
import { useMap } from '@vis.gl/react-google-maps'
import { Command } from 'cmdk'
import { AnimatePresence, motion } from 'framer-motion'
import { Layers3, MapPin, Search, Sparkles, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAreas } from '@/api/queries'
import type { Band } from '@/api/types'
import { runQuery, SPEC_QUERIES } from '@/lib/query'
import { flyToBounds } from '@/map/MapView'
import { goToBand, switchMode } from '@/map/bands'
import { useUi, type LayerKey } from '@/store/ui'

type Suggestion = { text: string; toPlace: () => google.maps.places.Place }

function usePlaces(input: string) {
  const [items, setItems] = useState<Suggestion[]>([])
  const token = useRef<google.maps.places.AutocompleteSessionToken | null>(null)
  useEffect(() => {
    if (input.trim().length < 3) { setItems([]); return }
    let off = false
    const t = setTimeout(async () => {
      try {
        const lib = (await google.maps.importLibrary('places')) as google.maps.PlacesLibrary
        token.current ??= new lib.AutocompleteSessionToken()
        const cam = useUi.getState().camera
        const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input, sessionToken: token.current, ...(cam ? { locationBias: { lat: cam.lat, lng: cam.lng } } : {}),
        })
        if (!off) setItems(suggestions.flatMap((s) => s.placePrediction ? [{ text: s.placePrediction.text.toString(), toPlace: () => s.placePrediction!.toPlace() }] : []).slice(0, 5))
      } catch { if (!off) setItems([]) }
    }, 260)
    return () => { off = true; clearTimeout(t) }
  }, [input])
  return { items, endSession: () => { token.current = null } }
}

const LAYERS: { k: LayerKey; label: string }[] = [
  { k: 'buildings', label: 'Buildings' }, { k: 'assets', label: 'Poles & streetlights' }, { k: 'gaps', label: 'Streetlight gaps' },
  { k: 'unmapped', label: 'Businesses not on the map' }, { k: 'streetHealth', label: 'Road colour by findings' }, { k: 'density', label: 'Where findings cluster' },
  { k: 'review', label: 'Waiting-for-review outlines' }, { k: 'coverage', label: 'Street View coverage' },
]

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen)
  const setOpen = useUi((s) => s.setPaletteOpen)
  const [input, setInput] = useState('')
  const map = useMap('main')
  const { data: areas } = useAreas()
  const places = usePlaces(open ? input : '')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(!useUi.getState().paletteOpen) }
      else if (e.key === 'Escape' && useUi.getState().paletteOpen) { e.preventDefault(); setOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])
  useEffect(() => { if (!open) setInput('') }, [open])

  const done = (fn: () => void) => () => { setOpen(false); fn() }
  const ui = useUi.getState
  const Item = ({ value, onSelect, icon, children, hint }: { value: string; onSelect: () => void; icon?: React.ReactNode; children: React.ReactNode; hint?: string }) => (
    <Command.Item value={value} onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-[var(--ns-r-control)] px-2.5 py-2 text-[16px] data-[selected=true]:bg-accent-soft">
      <span className="ink3 [&_svg]:size-4">{icon}</span><span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="t-data ink3 shrink-0">{hint}</span>}
    </Command.Item>
  )
  const Group = ({ heading, children }: { heading: React.ReactNode; children: React.ReactNode }) => (
    <Command.Group heading={heading} className="[&_[cmdk-group-heading]]:t-micro [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2">{children}</Command.Group>
  )

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]" style={{ background: 'color-mix(in srgb, var(--ns-bg0) 55%, transparent)' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
          <motion.div initial={{ y: -8, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: -8, scale: 0.98 }} className="sheet w-[min(600px,92vw)] overflow-hidden">
            <Command label="Command palette" shouldFilter={true} loop>
              <div className="flex items-center gap-2 rule-b px-3.5">
                <Search className="size-4 sodium" />
                <Command.Input autoFocus value={input} onValueChange={setInput} placeholder="Ask a question, search a place, or type a command…"
                  className="h-12 flex-1 bg-transparent text-[16.5px] outline-none placeholder:text-ink3" />
                <kbd className="kbd">Esc</kbd>
              </div>
              <Command.List className="max-h-[56vh] overflow-y-auto p-1.5">
                <Command.Empty className="t-small ink3 px-3 py-6 text-center">No matching command.</Command.Empty>
                {input.trim().length > 1 && (
                  <Group heading="Ask this area">
                    <Item value={`ask ${input}`} icon={<Sparkles />} onSelect={done(() => { ui().go('explore'); runQuery({ text: input.trim() }) })} hint="Enter">Ask: “{input.trim()}”</Item>
                  </Group>
                )}
                <Group heading="Example questions (spec)">
                  {SPEC_QUERIES.map((q) => <Item key={q} value={`example ${q}`} icon={<Sparkles />} onSelect={done(() => { ui().go('explore'); runQuery({ text: q }) })}>{q}</Item>)}
                </Group>
                {places.items.length > 0 && (
                  <Group heading={<span className="flex items-center justify-between">Places <span className="normal-case tracking-normal">powered by Google</span></span>}>
                    {places.items.map((p) => (
                      <Item key={p.text} value={`place ${p.text} ${input}`} icon={<MapPin />} onSelect={done(async () => {
                        const place = p.toPlace()
                        await place.fetchFields({ fields: ['location', 'viewport'] })
                        places.endSession()
                        const vp = place.viewport?.toJSON()
                        if (map && vp) flyToBounds(map, [vp.west, vp.south, vp.east, vp.north], { maxZoom: 18 })
                        else if (map && place.location) map.panTo(place.location)
                      })}>{p.text}</Item>
                    ))}
                  </Group>
                )}
                <Group heading="Areas">
                  {areas?.map((a) => <Item key={a.slug} value={`area ${a.name}`} icon={<MapPin />} onSelect={done(() => { ui().go('explore'); ui().setArea(a.slug) })} hint={`${a.counts.buildings} bldg`}>{a.name.replace(/^Unseen street: /, '')}</Item>)}
                </Group>
                <Group heading="Go to">
                  {(['city', 'area', 'street', 'object'] as Band[]).map((b) => <Item key={b} value={`go ${b} level`} icon={<Zap />} onSelect={done(() => map && goToBand(map, b, areas))}>{b[0].toUpperCase() + b.slice(1)} level</Item>)}
                </Group>
                <Group heading="Pages">
                  <Item value="page explore map" icon={<Zap />} onSelect={done(() => ui().go('explore'))}>Explore (the map)</Item>
                  <Item value="page review queue" icon={<Zap />} onSelect={done(() => ui().go('review'))}>Review</Item>
                  <Item value="page under the hood pipeline story" icon={<Zap />} onSelect={done(() => ui().go('hood'))}>Under the hood</Item>
                  <Item value="page trust model card accuracy" icon={<Zap />} onSelect={done(() => ui().go('trust'))}>Trust</Item>
                  <Item value="page jobs analyses" icon={<Zap />} onSelect={done(() => ui().go('jobs'))}>Jobs</Item>
                </Group>
                <Group heading="Actions">
                  <Item value="analyse a street" icon={<Zap />} onSelect={done(() => { ui().go('explore'); ui().setAnalyse(true) })}>Analyse a street…</Item>
                  <Item value="what stands out overview findings" icon={<Zap />} onSelect={done(() => { ui().go('explore'); ui().resetFilter(); ui().setPanelOpen(true) })}>What stands out</Item>
                  <Item value="build a question by clicking" icon={<Zap />} onSelect={done(() => { ui().go('explore'); ui().setBuilder(true) })}>Build a question by clicking</Item>
                  <Item value="clear filters and question" icon={<Zap />} onSelect={done(() => ui().resetFilter())}>Clear filters and question</Item>
                  <Item value="toggle 3d 2d reduce motion" icon={<Zap />} onSelect={done(() => ui().setFlat(!ui().flat))}>Toggle 3D / 2D</Item>
                  <Item value="toggle night daylight theme" icon={<Zap />} onSelect={done(() => switchMode(map))}>{ui().mode === 'night' ? 'Switch to Daylight' : 'Switch to Night'}</Item>
                  <Item value="toggle minimap" icon={<Zap />} onSelect={done(() => ui().setMinimap(!ui().minimap))} hint={ui().minimap ? 'on' : 'off'}>Minimap</Item>
                </Group>
                <Group heading="Layers">
                  {LAYERS.map((l) => <Item key={l.k} value={`layer ${l.label}`} icon={<Layers3 />} onSelect={done(() => ui().toggleLayer(l.k))} hint={ui().layers[l.k] ? 'on' : 'off'}>{l.label}</Item>)}
                </Group>
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
