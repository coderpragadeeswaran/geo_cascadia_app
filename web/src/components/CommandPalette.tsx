/** Ctrl/⌘ K command palette (cmdk): ask a question (QueryEngine), the spec's example questions, jump to a place
 *  (Google Places Autocomplete, New API, browser key), switch area, go to a zoom band, toggle layers, run actions. */
import { useMap } from '@vis.gl/react-google-maps'
import { Command } from 'cmdk'
import { AnimatePresence, motion } from 'framer-motion'
import { Layers3, MapPin, Search, Sparkles, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAreas } from '@/api/queries'
import type { Band } from '@/api/types'
import { runQuery, SPEC_QUERIES } from '@/lib/query'
import { flyToBounds } from '@/map/MapView'
import { goToBand } from '@/map/bands'
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
  { k: 'unmapped', label: 'Unmapped businesses' }, { k: 'streetHealth', label: 'Street health' }, { k: 'density', label: 'Findings density' },
  { k: 'review', label: 'Review queue outlines' }, { k: 'coverage', label: 'Street View coverage' },
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
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])
  useEffect(() => { if (!open) setInput('') }, [open])

  const done = (fn: () => void) => () => { setOpen(false); fn() }
  const ui = useUi.getState
  const Item = ({ value, onSelect, icon, children, hint }: { value: string; onSelect: () => void; icon?: React.ReactNode; children: React.ReactNode; hint?: string }) => (
    <Command.Item value={value} onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] data-[selected=true]:bg-hover">
      <span className="text-muted [&_svg]:size-4">{icon}</span><span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 text-[11px] text-faint">{hint}</span>}
    </Command.Item>
  )
  const Group = ({ heading, children }: { heading: React.ReactNode; children: React.ReactNode }) => (
    <Command.Group heading={heading} className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2">{children}</Command.Group>
  )

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
          <motion.div initial={{ y: -8, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: -8, scale: 0.98 }} className="glass glass-strong w-[min(600px,92vw)] overflow-hidden">
            <Command label="Command palette" shouldFilter={true} loop>
              <div className="flex items-center gap-2 border-b border-glass-border px-3.5">
                <Search className="size-4 text-muted" />
                <Command.Input autoFocus value={input} onValueChange={setInput} placeholder="Ask a question, search a place, or type a command…"
                  className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint" />
                <kbd className="rounded border border-glass-border px-1.5 text-[10.5px] text-muted">Esc</kbd>
              </div>
              <Command.List className="max-h-[56vh] overflow-y-auto p-1.5">
                <Command.Empty className="px-3 py-6 text-center text-[13px] text-muted">No matching command.</Command.Empty>
                {input.trim().length > 1 && (
                  <Group heading="Ask this area">
                    <Item value={`ask ${input}`} icon={<Sparkles />} onSelect={done(() => runQuery({ text: input.trim() }))} hint="Enter">Ask: “{input.trim()}”</Item>
                  </Group>
                )}
                <Group heading="Example questions (spec)">
                  {SPEC_QUERIES.map((q) => <Item key={q} value={`example ${q}`} icon={<Sparkles />} onSelect={done(() => runQuery({ text: q }))}>{q}</Item>)}
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
                  {areas?.map((a) => <Item key={a.slug} value={`area ${a.name}`} icon={<MapPin />} onSelect={done(() => ui().setArea(a.slug))} hint={`${a.counts.buildings} bldg`}>{a.name.replace(/^Unseen street: /, '')}</Item>)}
                </Group>
                <Group heading="Go to">
                  {(['city', 'area', 'street', 'object'] as Band[]).map((b) => <Item key={b} value={`go ${b} level`} icon={<Zap />} onSelect={done(() => map && goToBand(map, b, areas))}>{b[0].toUpperCase() + b.slice(1)} level</Item>)}
                </Group>
                <Group heading="Actions">
                  <Item value="analyse a street" icon={<Zap />} onSelect={done(() => ui().setAnalyse(true))}>Analyse a street…</Item>
                  <Item value="open review queue" icon={<Zap />} onSelect={done(() => ui().setPage('review'))}>Open Review</Item>
                  <Item value="clear filters and question" icon={<Zap />} onSelect={done(() => ui().resetFilter())}>Clear filters and question</Item>
                  <Item value="toggle 3d 2d reduce motion" icon={<Zap />} onSelect={done(() => ui().setFlat(!ui().flat))}>Toggle 3D / 2D</Item>
                  <Item value="toggle theme dark light" icon={<Zap />} onSelect={done(() => ui().setTheme(ui().theme === 'dark' ? 'light' : 'dark'))}>Toggle light / dark theme</Item>
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
