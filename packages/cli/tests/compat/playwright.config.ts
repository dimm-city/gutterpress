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
 *
 * Every web server pins `--engine paged`. This suite exists to prove the
 * PAGED.JS preview still renders in all three browser engines, and the spec
 * measures `.pagedjs_page` elements; the native engine is a Chromium-only
 * CDP/multicol pipeline that emits `.folio-sheet` instead, so with the
 * manifest default (now `native`) every target measured 0 pages. The pin
 * keeps this gate testing the thing it is named for.
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
        "bun src/cli.ts preview ../../examples/gutterpress-user-guide --no-open --port 4111 --engine paged",
      cwd: "../..",
      url: "http://127.0.0.1:4111/book.html",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Design-guide example (named pages, string() headers, two-column).
      command:
        "bun src/cli.ts preview ../../examples/with-design-guide/design-guide --no-open --port 4112 --engine paged",
      cwd: "../..",
      url: "http://127.0.0.1:4112/book.html",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Synthetic fixture covering position: running() and custom properties
      // in @page margin boxes (no shipped example uses position: running()).
      command:
        "bun src/cli.ts preview tests/compat/fixtures/feature-probe --no-open --port 4113 --engine paged",
      cwd: "../..",
      url: "http://127.0.0.1:4113/book.html",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
