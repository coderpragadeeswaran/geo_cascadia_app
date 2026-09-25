import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, strictPort: true },
  build: {
    chunkSizeWarningLimit: 1100, // deck.gl + luma.gl is one ~800 kB WebGL engine; split from app code for caching
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'deck', test: /node_modules[\/](@deck\.gl|@luma\.gl|@loaders\.gl|@math\.gl|@probe\.gl|earcut|d3-hexbin)/ },
            { name: 'react', test: /node_modules[\/](react|react-dom|scheduler)[\/]/ },
            { name: 'ui', test: /node_modules[\/](@radix-ui|framer-motion|motion-dom|motion-utils|@tanstack|lucide-react|@vis\.gl)/ },
          ],
        },
      },
    },
  },
})
