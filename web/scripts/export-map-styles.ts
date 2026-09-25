/** Writes docs/map-styles/{night,daylight}.json in Google's NEW cloud-based maps styling JSON format (from
 *  src/design/tokens.ts). Upload them in Google Cloud > Map Styles > Create style > JSON (see docs/DESIGN.md). */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cloudMapStyle } from '../src/design/tokens'

for (const m of ['night', 'daylight'] as const) {
  const out = resolve(import.meta.dirname, '..', '..', 'docs', 'map-styles', `${m}.json`)
  writeFileSync(out, JSON.stringify(cloudMapStyle(m), null, 2) + '\n')
  console.log('wrote', out)
}
