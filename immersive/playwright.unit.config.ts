import { defineConfig } from '@playwright/test'

/** Pure modules (viewer settings): no browser, no build. `npm run test:unit`. */
export default defineConfig({
  testDir: 'tests/unit',
  reporter: process.env.CI ? 'github' : 'list',
})
