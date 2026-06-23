# Runtime UI + Lib Auto-Update via npm — Refactor Plan

**Status:** Proposed (2026-06-23)
**Goal:** Update the viewer's UI *and* engine automatically, sourced from the npm
registry, without shipping a new Electron installer for every fix.
**Decisions (locked):** one published package `@dimm-city/print-md` (lib + cli,
self-contained); trust model = npm `dist.integrity` + HTTPS + 2FA publish (no custom
signing). Supersedes the earlier signed-GitHub-manifest draft of this file.

---

## 1. The three problems, separated

The earlier plan conflated three things. npm solves the first two; only the third needs
code we write — and most of it already exists.

| Problem | Solved by | Action |
|---|---|---|
| **Package layout** | — | Merge lib + cli into one published, self-contained `@dimm-city/print-md`. |
| **Distribution + versioning** | **npm** | Use registry version metadata + `dist-tags` (latest/next) + `dist.integrity`. Delete the Ed25519 keypair, manifest schema, and signing CI. |
| **Runtime loading** (swap a *shipped* app's code without an installer) | **us, but mostly already built** | Reuse the existing stage→promote→rollback loop; point it at npm; load a self-contained bundle from userData with the asar copy as fallback. |

**Why runtime loading is irreducible:** a packaged Electron app's code lives in a read-only
asar. Updating it without an installer *requires* fetching new code at runtime, writing it
to a writable dir (`userData`), loading from there, and keeping the prior copy to roll back.
npm is a CDN + version index — it never loads code into your running app. And `npm install`
at runtime is the one mechanism to avoid (lifecycle scripts, needs npm on the host, resolves
a transitive tree). So we publish a **pre-bundled, self-contained** artifact and keep a small
loader. That loader already exists (`packages/viewer/electron/updater/`); we shrink it.

**One load-bearing constraint that survives repackaging:** the engine runs in the Electron
**main** process, never the renderer. The SPA cannot `import` the lib as a normal dependency
— its node-only deps (`postcss`, `isomorphic-git`, `fileURLToPath`) crash in a browser (the
0.4.0-beta.4 crash). "Reference it as a dependency" is true for the host, false for the
browser bundle. CLAUDE.md §8 stays intact.

---

## 2. Package consolidation

Keep `packages/lib` as **private internal source**; stop publishing it separately. The
published package is `packages/cli` → `@dimm-city/print-md`, whose build already bundles the
lib into `dist/cli.js`. Extend it to ship everything the viewer needs:

```
@dimm-city/print-md   (public, self-contained)
  package.json        // bin + exports + printmd.requiresDesktopApi
  dist/
    cli.js            // bin entry (existing)
    index.js          // lib entry — self-contained ESM (NEW; for the viewer host)
  ui/                 // built SvelteKit SPA (NEW; index.html + _app/…)
```

- `package.json`:
  - `"bin": { "print-md": "./dist/cli.js" }` (unchanged)
  - `"exports": { ".": "./dist/index.js", "./api": "./dist/api/index.js" }`
  - `"files": ["dist", "ui", "README.md", "LICENSE"]`
  - `"printmd": { "requiresDesktopApi": 2 }` — replaces the manifest's compat gate (§4).
  - `dependencies`: empty except `puppeteer-core` (see R1). Everything else is inlined.
- `packages/cli/scripts/build-npm.ts`: additionally emit `dist/index.js` as a
  **self-contained** lib bundle (deps inlined, `target node`, ESM; `puppeteer-core` external
  + lazy), and copy `packages/viewer/build/` → `ui/`.
- Viewer `package.json`: depend on `@dimm-city/print-md` (`workspace:*`) instead of
  `@dimm-city/print-md-lib`; update the `loadLib()` specifier and electron-vite `external`.
- electron-builder still bakes this package into the asar as the **offline baseline**.

> CLI-via-npm users download the ~few-MB `ui/` they don't use. Accepted for simplicity; if
> install size ever matters, split the SPA into its own package later (R4).

---

## 3. The viewer runtime updater (npm-sourced)

Reuse the existing stage/promote/rollback/prune/health machinery; swap two pieces:
**source** (GitHub manifest → npm registry) and **integrity** (Ed25519 → SSRI sha512).

### 3.1 Check
```
GET https://registry.npmjs.org/@dimm-city/print-md
→ pick dist-tags[channel]            // "latest" (stable) or "next" (opt-in beta)
→ meta = versions[picked]
→ { version, tarball: meta.dist.tarball, integrity: meta.dist.integrity,
    requiresDesktopApi: meta.printmd?.requiresDesktopApi ?? 0 }
```
Skip if `version <= activeVersion`, if `requiresDesktopApi > DESKTOP_API`, or if the version
is on the failed-version blocklist (reuse existing). `activeVersion` = max(baseline baked in
asar, currently-promoted pointer).

### 3.2 Download + verify
Download the `.tgz`; verify `dist.integrity` with `node:crypto` (compute sha512 of the bytes,
compare the SSRI hash). Enforce the existing 256 MB size cap.

### 3.3 Extract
npm tarballs are gzipped tar with a `package/` prefix. Gunzip with `fflate` (already a viewer
dep), untar with a tiny pure-JS reader (`nanotar`, or ~50 lines). Extract `package/` into
`<userData>/runtime/versions/<version>/` under the existing path-traversal guard.

### 3.4 One store, atomic promote
```
<userData>/runtime/
  current.json   → { version, path }
  previous.json
  state.json     → { failedVersions, lastCheckAt, … }
  versions/<version>/    // dist/index.js, dist/cli.js, ui/…
```
`current.json` swaps atomically. UI and engine live in one slot, so they promote and roll
back **together** — no UI↔engine mismatch possible.

### 3.5 Resolve + load
`resolveActive()` returns `{ libEntry, webRoot }` from the newest healthy compatible version,
else the asar baseline:
```ts
async function loadLib(): Promise<LibModule> {
  if (!libPromise) {
    const { libEntry } = await resolveActive();        // abs path | bare specifier
    libPromise = (isAbs(libEntry)
      ? import(pathToFileURL(libEntry).href)            // file URL bypasses specifier cache
      : import("@dimm-city/print-md")) as Promise<LibModule>;
  }
  return libPromise;
}
```
`activeWebRoot` (served by the `app://` handler) = `resolveActive().webRoot`.

### 3.6 Promote + health
On promote: set `libPromise = null`, swap pointers, `webContents.reload()`. Then a
**main-process smoke probe** (the renderer's `markReady` can't prove the engine loaded):
```ts
async function probeHealth(): Promise<boolean> {
  libPromise = null;
  try {
    const lib = await Promise.race([
      loadLib(),
      new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 5000)),
    ]);
    lib.classifyGitError(new Error("probe"), {});   // pure, no I/O — module parsed + callable
    return true;
  } catch { return false; }
}
```
Fail → record on the blocklist, roll back the pointer, `libPromise = null` (next call uses the
prior/baseline). Keep the existing 10s renderer watchdog for SPA boot; the two compose.

---

## 4. Compatibility gate (kept, simplified)

`DESKTOP_API` (`updater/contract.ts:20`, currently `2`) stays as the shell's IPC-surface
version. The check reads `printmd.requiresDesktopApi` from the **downloaded package.json**
instead of a manifest file: refuse to activate any version requiring a newer shell, falling
back to baseline. Bump `DESKTOP_API` (and the package's `requiresDesktopApi`) only when the
SPA starts calling a new `ipcMain.handle`. No second integer for the lib (main *calls* the
lib; the lib has no IPC API of its own).

---

## 5. Delete

- `WEB_UI_PUBLIC_KEY`, the Ed25519 keypair + `scripts/gen-web-ui-signing-key.sh`.
- `UpdateManifest` schema, `manifest-validator.ts`, the signature half of `verify.ts`.
- The signing step in `release-web-ui.yml`; the `web-v*` tag line.
- `@dimm-city/print-md-lib` from the npm publish set (becomes private internal source).

**Keep:** integrity check (now SSRI), size cap, path-traversal guard, downgrade floor,
current/previous slots, prune, failed-version blocklist, the renderer watchdog.

---

## 6. CI

- `release.yml` already publishes `@dimm-city/print-md` to npm via OIDC trusted publishing
  with `--provenance`. **Keep provenance** (free authorship trail on top of integrity).
  Ensure the published artifact now includes `dist/index.js` (lib) + `ui/`.
- Channels: stable → `latest`, prerelease (`-` in version) → `next` (already implemented).
- CLI standalone binaries + Electron installers continue via GitHub Releases unchanged.

---

## 7. Change-set summary

1. **`packages/cli/scripts/build-npm.ts`** — emit self-contained `dist/index.js`; copy SPA → `ui/`.
2. **`packages/cli/package.json`** — exports/files/`printmd.requiresDesktopApi`; trim deps.
3. **`packages/viewer/package.json` + `electron.vite.config.ts`** — depend on `@dimm-city/print-md`; update `external`.
4. **`electron/updater/npm-source.ts`** (new) — registry check, integrity verify, tar.gz extract.
5. **`electron/updater/` trim** — drop signing/manifest; one `runtime/` store; `resolveActive()`.
6. **`electron/main.ts`** — file-URL `loadLib()`, `activeWebRoot` from `resolveActive()`, `libPromise=null` + health probe on promote.
7. **CI** — drop `release-web-ui.yml`; ensure `release.yml` publishes the combined artifact.
8. **Tests** — load lib from a temp extracted dir + smoke export; promote→bad-version→rollback; asar fallback; integrity-mismatch rejection.

---

## 8. Risks / spikes

- **R1 — puppeteer-core (✅ RESOLVED, spike 2026-06-23):** it is already lazily imported
  (`await import("puppeteer-core")` in `src/lib/browser-pool.ts:26`; only a `type` import is
  static). A `Bun.build` of `src/index.ts` with `external: ["puppeteer-core"]` and nothing
  else left **zero** third-party static bare imports — only Node builtins (`fs/path/os/crypto`)
  remain. The bundle imported and ran under **plain Node v24** from a temp dir with **no
  reachable `node_modules` containing puppeteer-core**. Keep puppeteer-core a normal
  dependency (npm/CLI users get it) but `external` in the viewer bundle; the viewer path never
  loads it.
- **R2 — embedded assets (✅ RESOLVED, same spike):** all `with { type: "file" }` assets
  (favicon, paged.polyfill, ICC, templates, schema, preview scripts) emitted alongside
  `index.js` with hashed names + rewritten relative paths. From the extracted temp dir,
  `scaffoldProject()` extracted the embedded book template, `yaml`-parsed it, and wrote a
  correct `manifest.yaml`; `checkCss()` exercised bundled `postcss`; `isomorphic-git`
  (`local-git` history) ran and created `.git` — all inlined deps working from a
  node_modules-less dir. Self-contained bundle ≈ 5.5 MB JS + ~3.7 MB ICC profile (the ICC is
  PDF/X-only; consider lazy-loading it later to shrink the common download — see R4).
- **R3 — tar.gz extraction:** npm tarball `package/` prefix; `fflate` gunzip + `nanotar` untar.
- **R4 — CLI install size:** `ui/` adds a few MB to the npm package; split the SPA to its own
  package later only if it becomes a problem.
- **R5 — trust model (accepted):** `dist.integrity` proves the tarball matches the registry,
  not authorship; rely on 2FA-protected publish + provenance. Conscious tradeoff for a small
  project.
