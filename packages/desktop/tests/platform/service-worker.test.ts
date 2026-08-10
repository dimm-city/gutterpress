import { test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import svelteConfig from "../../svelte.config.js";

// Resolve relative to THIS FILE so the test passes regardless of cwd
// (zero-tolerance: bare `bun test` from the repo root must work).
const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, "..", "..");
const swSource = readFileSync(join(desktopRoot, "src", "service-worker.ts"), "utf8");
const layoutSource = readFileSync(
  join(desktopRoot, "src", "routes", "+layout.svelte"),
  "utf8",
);

// ── #33 Phase 4: service-worker app-shell precache + offline ─────────────────
//
// The SW imports `$service-worker` (only resolvable inside the SvelteKit build),
// so rather than evaluate the module we assert the SOURCE encodes the contract
// the acceptance criteria require. The offline preview gap closes only if the
// native engine's viewer bundle is in the precache list; this guards that
// explicitly.

test("service worker precaches the native engine's viewer bundle (offline preview, #33)", () => {
  // The same-origin vendored viewer bundle (injected into preview HTML by
  // WebAdapter.startPreview) must be in the precache SHELL so preview renders
  // offline.
  expect(swSource).toContain("/engine/gutterpress-viewer.js");
  // And the actual asset must ship in static/ so the build emits it.
  expect(existsSync(join(desktopRoot, "static", "engine", "gutterpress-viewer.js"))).toBe(true);
});

test("service worker precaches the adapter-static build shell (#33)", () => {
  // Precache the hashed JS/CSS chunks (`build`) + prerendered files (`files`,
  // incl. index.html, manifest, icons) so the SPA shell loads offline.
  // Match the actual import + usage, not the word "files" anywhere (e.g. a comment).
  expect(swSource).toMatch(/from\s+["']\$service-worker["']/);
  expect(swSource).toMatch(/\bbuild\b/);
  expect(swSource).toMatch(/\bfiles\b/);
  expect(swSource).toContain("addAll");
});

test("service worker uses a versioned cache and prunes old ones on activate (#33)", () => {
  // A new SvelteKit `version` ⇒ a new cache name; activate deletes the rest.
  // This is the web auto-update story (the desktop updater stays web-rejecting).
  expect(swSource).toMatch(/Gutterpress-cache-\$\{version\}/);
  expect(swSource).toContain("caches.delete");
  expect(swSource).toContain('addEventListener("activate"');
});

test("service worker is cache-first for same-origin GETs only (#33)", () => {
  // Cache-first serve of the content-hashed shell; pass non-GET / cross-origin
  // straight through (never cache project file contents from the network).
  expect(swSource).toContain('addEventListener("fetch"');
  expect(swSource).toContain('req.method !== "GET"');
  expect(swSource).toContain("sw.location.origin");
  expect(swSource).toContain("cache.match(req)");
});

test("service worker registration never runs on Electron's app:// origin", () => {
  // SvelteKit otherwise injects an unconditional registration into rendered
  // HTML, before the guarded component onMount callback gets a chance to run.
  expect(svelteConfig.kit?.serviceWorker?.register).toBe(false);
  expect(layoutSource).toContain('location.protocol !== "http:"');
  expect(layoutSource).toContain('location.protocol !== "https:"');
  expect(layoutSource).toContain("if (isDesktop()) return;");
});
