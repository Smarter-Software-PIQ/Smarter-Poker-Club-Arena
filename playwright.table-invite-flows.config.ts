import { defineConfig, devices } from '@playwright/test';
import { portFor } from './scripts/ci/e2e-port.mjs';

const PORT = portFor(5194);
const SHARED_PREVIEW = process.env.ARENA_SHARED_PREVIEW_URL?.replace(/\/$/, '');

export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'table-invite-flows.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 90000,
  reporter: 'line',
  use: {
    baseURL: `${SHARED_PREVIEW ?? `http://127.0.0.1:${PORT}`}/hub/club-arena/`,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], browserName: 'chromium' },
    },
  ],
  ...(SHARED_PREVIEW
    ? {}
    : {
        webServer: {
          command: `VITE_SUPABASE_URL=https://dummy.supabase.co VITE_SUPABASE_ANON_KEY=dummy npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
          url: `http://127.0.0.1:${PORT}/hub/club-arena/`,
          reuseExistingServer: false,
          timeout: 120000,
        },
      }),
});
