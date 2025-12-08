import { createRequire } from 'module'
import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [
    preact({
      babel: {
        cwd: createRequire(import.meta.url).resolve('@preact/preset-vite'),
      },
    }),
  ],
})
