import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.PASCAL_TEST_PORT || 4180)
const host = '127.0.0.1'

/** Serves the production-mode test build, including harness entries (`test:e2e` builds first). */
export default defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  webServer: {
    command: `npx vite preview --mode runtime-test --host ${host} --port ${port} --strictPort`,
    url: `http://${host}:${port}`,
    reuseExistingServer: false,
  },
  use: {
    baseURL: `http://${host}:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Software WebGL so the smoke runs on machines and CI runners without a GPU.
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
  ],
})
