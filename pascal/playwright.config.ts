import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.PASCAL_TEST_PORT || 4180)
const host = '127.0.0.1'
const ci = !!process.env.CI

/** Serves the production-mode test build, including harness entries (`test:e2e` builds first). */
export default defineConfig({
  testDir: 'tests',
  // SwiftShader competes for the runner's CPUs across every open scene.
  workers: ci ? 1 : undefined,
  // Let the existing 60s scene-readiness assertions finish on a software renderer.
  timeout: ci ? 90_000 : 30_000,
  retries: ci ? 1 : 0,
  reporter: ci ? 'github' : 'list',
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
        // Keep the full rendering pipeline, with fewer software-rasterized pixels.
        ...(ci ? { viewport: { width: 800, height: 600 } } : {}),
        // Software WebGL so the smoke runs on machines and CI runners without a GPU.
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
  ],
})
