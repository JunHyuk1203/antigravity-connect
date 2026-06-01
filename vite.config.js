import { defineConfig } from 'vite'

export default defineConfig({
  // GitHub Pages: https://JunHyuk1203.github.io/antigravity-connect/
  base: '/antigravity-connect/',

  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'index.html',
      },
    },
  },

  // Dev server settings
  server: {
    port: 5173,
    open: true,
  },
})
