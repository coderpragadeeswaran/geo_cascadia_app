import './design/fonts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyMode } from './design/mode'
import './index.css'
import { storedMode } from './store/ui'

// Night Survey tokens on <html> before the first paint (Night by default, docs/DESIGN.md)
applyMode(storedMode())
document.body.classList.add('ns')

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
