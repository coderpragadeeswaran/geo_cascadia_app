import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// /design-preview: NIGHT SURVEY design proposal (preview only; the app is unchanged until approved)
const DesignPreview = lazy(() => import('./design/DesignPreview'))
const isPreview = location.pathname.startsWith('/design-preview')

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
