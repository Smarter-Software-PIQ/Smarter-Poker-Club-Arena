import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// The case owns a real disposable account and its cleanup. It must not run
// unrelated global onboarding or load a shared authentication state.
export default defineConfig({
  ...base,
  globalSetup: undefined,
  webServer: undefined,
  testMatch: /gameplay-customization-runtime\.spec\.ts$/,
  grep: /only an awarded hero celebrates a published showdown, including chops$/,
  workers: 1,
  retries: 0,
  use: { ...base.use, storageState: undefined, trace: 'off', video: 'off' },
  projects: [{ name: 'chromium' }],
});
