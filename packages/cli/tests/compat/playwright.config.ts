/**
 * Playwright config for the preview smoke test (issue #46).
 *
 * Run from packages/cli:
 *   node_modules/.bin/playwright test -c tests/compat/playwright.config.ts
 *
 * Chromium must be installed first:
 *   node_modules/.bin/playwright install --with-deps chromium
 *
 * The spec launches chromium itself, so this config defines no browser
 * projects — it only provides the runner and the preview web servers.
 *
 * This suite proves the native engine's IN-BROWSER VIEWER (the client-side
 * pagination bundle every preview/`--format html` build ships — see
 * `src/engine/viewer/`) renders the shipped example projects without
 * collapsing or erroring. Chromium is the only supported engine (CLAUDE.md,
 * ratified 2026-08-23); the firefox/webkit legs this suite used to carry were
 * removed with that ruling. Paged.js has been removed
 * (native-only-migration-plan.md Phase 6); every web server below uses the
 * manifest default (native), no `--engine` flag needed.
 */
import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: ".",
  // .pw.ts (not .spec.ts): `bun test` auto-discovers *.spec.ts and would try
  // to execute Playwright tests under bun's runner, failing the CI test gate.
  testMatch: "**/*.pw.ts",
  outputDir: "test-results",
  timeout: 600_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  webServer: [
    {
      // Simple example: the shipped user guide.
      command:
        "bun src/cli.ts preview ../../examples/gutterpress-user-guide --no-open --port 4111",
      cwd: "../..",
      url: "http://127.0.0.1:4111/book.html",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Design-guide example (named pages, string() headers, two-column).
      command:
        "bun src/cli.ts preview ../../examples/with-design-guide/design-guide --no-open --port 4112",
      cwd: "../..",
      url: "http://127.0.0.1:4112/book.html",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Synthetic fixture covering position: running() and custom properties
      // in @page margin boxes (no shipped example uses position: running()).
      command:
        "bun src/cli.ts preview tests/compat/fixtures/feature-probe --no-open --port 4113",
      cwd: "../..",
      url: "http://127.0.0.1:4113/book.html",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
