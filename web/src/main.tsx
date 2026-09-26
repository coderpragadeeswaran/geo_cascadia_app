import './design/fonts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyMode } from './design/mode'
import './index.css'
import { storedMode } from './store/ui'

// /design-preview: the approved NIGHT SURVEY proposal, kept as a reference route
const DesignPreview = lazy(() => import('./design/DesignPreview'))
const isPreview = location.pathname.startsWith('/design-preview')

// Night Survey tokens on <html> before the first paint (Night by default, docs/DESIGN.md)
applyMode(storedMode())
document.body.classList.add('ns')

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {isPreview ? <Suspense fallback={null}><DesignPreview /></Suspense> : <App />}
    </QueryClientProvider>
  </StrictMode>,
)
