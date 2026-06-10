/**
 * Playwright config for the cross-browser preview smoke test (issue #46).
 *
 * Run from packages/cli:
 *   node_modules/.bin/playwright test -c tests/compat/playwright.config.ts
 *
 * Browsers must be installed first:
 *   node_modules/.bin/playwright install --with-deps chromium firefox webkit
 *
 * The spec launches chromium/firefox/webkit itself (it needs a chromium
 * baseline to compare the other engines against in a single test), so this
 * config defines no browser projects — it only provides the runner and the
 * preview web servers.
 */
import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "test-results",
  timeout: 600_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  webServer: [
    {
      // Simple example: the shipped user guide.
      command: "bun src/cli.ts preview ../../examples/print-md-user-guide --open false --port 4111",
      cwd: "../..",
      url: "http://127.0.0.1:4111/book.html",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Design-guide example (named pages, string() headers, two-column).
      command: "bun src/cli.ts preview ../../examples/with-design-guide/design-guide --open false --port 4112",
      cwd: "../..",
      url: "http://127.0.0.1:4112/book.html",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Synthetic fixture covering position: running() and custom properties
      // in @page margin boxes (no shipped example uses position: running()).
      command: "bun src/cli.ts preview tests/compat/fixtures/feature-probe --open false --port 4113",
      cwd: "../..",
      url: "http://127.0.0.1:4113/book.html",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
