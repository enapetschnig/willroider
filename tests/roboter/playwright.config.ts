import { defineConfig, devices } from "@playwright/test";

// Probefahrten des Roboters — nur gegen die Testumgebung (testumgebung.mjs).
export default defineConfig({
  testDir: ".",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    launchOptions: { executablePath: process.env.TEST_CHROME ?? "/usr/bin/google-chrome" },
  },
});
