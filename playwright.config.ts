import { defineConfig, devices } from '@playwright/test'

/**
 * Browser-driven smoke tests: they drive the real app (load, upload a sound,
 * plug, play) and assert no console errors, capturing screenshots along the
 * way. Kept as flow checks rather than pixel-diff snapshots — the 3D stage
 * and Web Audio make exact renders nondeterministic.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Generous budget: building the audio graph and decoding uploads is slower
  // on the headless CI runner than locally.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    // Never gate the AudioContext behind a gesture heuristic in headless runs.
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
