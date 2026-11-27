import { defineConfig } from '@playwright/test'

/** The linking tests: plain functions, no build, no browser (`npm run test:link`). */
export default defineConfig({
  testDir: 'tests/link',
  reporter: 'list',
})
