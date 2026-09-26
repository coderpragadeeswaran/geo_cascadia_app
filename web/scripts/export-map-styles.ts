/** Writes docs/map-styles/{night,daylight}.json in Google's NEW cloud-based maps styling JSON format (from
 *  src/design/tokens.ts) after checking every rule against the stylers Google's schema allows (CLOUD_STYLERS).
 *  Upload them in Google Cloud > Map Styles (see docs/DESIGN.md). */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkCloudStyle, cloudMapStyle } from '../src/design/tokens'

let failed = false
for (const m of ['night', 'daylight'] as const) {
  const style = cloudMapStyle(m)
  const problems = checkCloudStyle(style)
  if (problems.length) {
    failed = true
    console.error(`${m}: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`)
    continue
  }
  const out = resolve(import.meta.dirname, '..', '..', 'docs', 'map-styles', `${m}.json`)
  writeFileSync(out, JSON.stringify(style, null, 2) + '\n')
  console.log(`wrote ${out} (${style.styles.length} rules, all stylers allowed by Google's schema)`)
}
if (failed) process.exit(1)
