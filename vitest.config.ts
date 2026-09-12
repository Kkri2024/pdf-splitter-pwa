import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react(), {
    name: 'test-pwa-register',
    resolveId(id) { if (id === 'virtual:pwa-register/react') return '\0test-pwa-register' },
    load(id) { if (id === '\0test-pwa-register') return 'export const useRegisterSW = () => ({ needRefresh: [false, () => {}], updateServiceWorker: () => {} })' },
  }],
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      reporter: ['text', 'html'],
    },
  },
})
