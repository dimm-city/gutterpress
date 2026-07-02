/// <reference types="@sveltejs/kit" />
/**
 * Service worker — PWA app-shell precache + offline (#33 Phase 4).
 *
 * §8 / ADR 0004: this is BROWSER-ONLY host code. It never imports the lib or any
 * `node:*` module, and it is REGISTERED only when `!isDesktop()` (see
 * `+layout.svelte`). Under Electron the SPA loads via `app://` and ships inside
 * the app (updated as a whole via electron-updater); a SW under `app://` would
 * serve stale assets across app updates, so the desktop build must NEVER
 * register this worker.
 *
 * Strategy (plan §5):
 *  - PRECACHE the app shell on `install`: every adapter-static `build` asset
 *    (`_app/*`), the prerendered `files` (incl. index.html, the manifest, the
 *    icons), and the vendored `/vendor/paged.polyfill.js` so the in-browser
 *    preview (Phase 2) renders OFFLINE.
 *  - RUNTIME: cache-first for same-origin GETs (serve the precached shell, then
 *    fall back to network and populate the cache); network-first is unnecessary
 *    because the shell is content-hashed by Vite — a new build = a new `version`
 *    = a fresh cache.
 *  - UPDATE: a new SvelteKit `version` yields a new cache name; `activate` deletes
 *    every cache that isn't the current one. This is the web auto-update story
 *    (the desktop `updater.*` stays rejecting on web — the SW owns web updates).
 *
 * It does NOT cache project file CONTENTS — those come from FSA/OPFS, not the
 * network — nor cross-origin requests.
 */
import { build, files, version } from "$service-worker";

// One cache per build version → activate can prune everything else.
const CACHE = `print-md-cache-${version}`;

// The app shell: hashed JS/CSS chunks (`build`) + prerendered static assets
// (`files` — index.html, manifest.webmanifest, favicon, icons). Add the vendored
// paged.js explicitly so in-browser preview works offline even though it lives
// under static/ (it IS in `files`, but list it defensively in case a future
// adapter config changes what `files` enumerates).
const SHELL = [...build, ...files, "/vendor/paged.polyfill.js"];

// `self` is the ServiceWorkerGlobalScope inside a SW module.
const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener("install", (event) => {
  // Precache the shell, then take over without waiting for old tabs to close so
  // a freshly installed PWA is immediately offline-capable.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // addAll rejects atomically if any request fails; dedupe to avoid double
      // entries (paged.js may already be in `files`).
      await cache.addAll([...new Set(SHELL)]);
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener("activate", (event) => {
  // Drop every cache from a previous build version, then claim open clients so
  // the new worker controls the page without a reload.
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle same-origin GETs. Cross-origin (e.g. external links) and
  // non-GET (POST/PUT) requests pass through to the network untouched.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      // Cache-first: the shell is content-hashed, so a cache hit is always the
      // correct asset for this build version.
      const cached = await cache.match(req);
      if (cached) return cached;

      // Cache miss → go to the network and populate the cache for next time.
      // On a network failure (offline) fall back to the cached app shell so a
      // hard navigation still boots the SPA.
      try {
        const res = await fetch(req);
        if (res.ok && res.type === "basic") {
          cache.put(req, res.clone());
        }
        return res;
      } catch (err) {
        if (req.mode === "navigate") {
          // Resolve the shell against the SW scope so this survives a future
          // sub-path deployment (e.g. behind a proxy at /viewer/), not just root.
          const shell =
            (await cache.match(sw.registration.scope + "index.html")) ??
            (await cache.match("/index.html"));
          if (shell) return shell;
        }
        throw err;
      }
    })(),
  );
});
