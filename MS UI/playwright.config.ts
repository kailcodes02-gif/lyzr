import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against `next dev` in demo mode (?mock=1): real UI,
// sample Graph data, no Microsoft account needed.
export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  // Serves the real static export (run `npm run build` first; `npm run
  // test:e2e` does). Deterministic and fast, and it tests the shipped artifact.
  webServer: {
    command: "node scripts/serve-static.mjs 3100",
    url: "http://localhost:3100/MS/login/",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
