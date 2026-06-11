import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { openslide } from '@computationalpathologygroup/openslide-js/vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves a project site under /<repo>/, so assets need a
  // non-root base. The Pages workflow passes VITE_BASE=/<repo>/; locally
  // (dev/preview) it stays at the root.
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    react(),
    openslide(), // sets COOP/COEP headers for SharedArrayBuffer support
  ],
})
