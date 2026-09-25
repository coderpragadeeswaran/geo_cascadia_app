import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// P0 placeholder — the app shell arrives in P3.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <p style={{ fontFamily: 'system-ui', padding: 24 }}>GEO-CASCADIA — P0 skeleton. Run <code>npm run check:data</code>.</p>
  </StrictMode>,
)
