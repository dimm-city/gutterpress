# ADR 0007: Receipt-backed npm plugin vendoring

## Status

Accepted (2026-07-26).

## Context

The standalone CLI and packaged viewer must install ordinary markdown-it npm
plugins for authors who do not have npm, Node.js, or Bun installed. Copying
only a plugin's own tarball is insufficient: many plugins import runtime
dependencies, and package-name resolution inside a compiled executable must
not depend on the executable's embedded module cache.

Installing third-party code is also a trust boundary. A plugin runs in the
host process without a sandbox, so archive extraction, provenance, limits,
publication, and user consent must fail closed.

## Decision

1. Installation is an explicit action only. The renderer never installs or
   accesses the network. The installer reads the public npm registry over
   HTTPS, resolves the requested package and every required production
   dependency to exact versions, and creates a private nested `node_modules`
   tree under `plugins/npm/<encoded-name>/<exact-version>/`.
2. Every package download is streamed to disk with per-response and whole-graph
   limits. The strongest registry SRI among SHA-512, SHA-384, and SHA-256 is
   required when available. Old releases with only SHA-1 are accepted for
   compatibility, recorded as legacy SHA-1, and produce a visible warning.
3. Tar extraction rejects traversal, links, bundled `node_modules` (including
   case and Unicode-normalization aliases), special entries, oversized
   files/graphs, and names that are invalid or collide on supported Windows
   filesystems. Package lifecycle scripts are never run.
4. Regular dependencies and non-optional peer dependencies are required.
   Optional dependencies are installed when available and platform-compatible;
   ordinary availability failures are recorded as skipped, but integrity or
   archive-safety failures still abort the whole install. Optional peers are
   recorded as skipped rather than auto-installed. Registry semver ranges and
   dist-tags are supported; `file:`, Git, URL, workspace, link, and npm-alias
   selectors are not.
5. A schema-v2 `.print-md-install.json` receipt records the exact graph,
   dependency edges, tarball URLs, integrity values, skipped optionals,
   deterministic import/require entries, and a SHA-256 digest of every vendored
   file and path. The loader first snapshots the versioned vendor tree, then
   verifies only that private snapshot, including agreement between every
   receipt edge and the package's dependency, optional-dependency, and peer
   declarations. It copies each package separately into a digest-addressed
   process-local tree without dependency links. Starting from the verified root
   entry, literal ESM imports and CommonJS requires are resolved through receipt
   edges and package export/import maps, then rewritten to absolute private
   targets. Unresolved requests and nonliteral dynamic imports/requires in the
   reachable graph fail closed; Node also applies the receipt resolver as
   defense in depth. A present but invalid receipt never falls back to an
   ancestor/global package cache.
6. Exact `version` fields created before this installer remain legacy metadata
   only when no receipt exists. Those entries keep the old project/global
   package resolution behavior so existing projects are not broken silently.
7. Installation is transactional within one process: same-project plugin
   mutations use one FIFO queue; a fresh tree is staged and swapped into place;
   the plugin is load-tested; then `manifest.yaml` is atomically replaced. Any
   pre-commit failure restores the previous tree and manifest. Explicit
   reinstall always downloads and verifies fresh bytes rather than trusting an
   existing vendor directory.
8. The desktop route confines the target to the currently open project's
   canonical root and shows a native confirmation before any third-party
   install. The prompt states that the plugin and dependencies receive the
   app's full filesystem and network privileges. Bundled recommended plugins
   require no download and bypass this third-party trust prompt.

## Consequences

- A project carries the complete JavaScript dependency graph needed by its
  pinned plugins and can build offline on another machine.
- Pure-JavaScript markdown-it plugins with ordinary registry dependencies are
  the supported path. Their plugin function may be the default export or an
  explicitly selected named export. Packages that require lifecycle scripts,
  native addon compilation, bundled dependency trees, or non-registry
  dependency selectors are intentionally unsupported.
- Receipts detect corruption and accidental replacement; they are not code
  signatures. Users must still trust the npm publisher and package source.
- Same-version reinstalls with changed bytes receive a new digest-addressed load
  path, avoiding stale ESM and CommonJS process caches.
- Snapshot-before-verification closes the mutation window between checking a
  project vendor tree and importing its code.
- There is no plugin permission system or sandbox. A permissions checklist
  would imply isolation that does not exist, so the product uses one explicit
  full-privilege warning instead.

## Implementation

- `packages/cli/src/lib/npm-plugin-installer.ts`
- `packages/cli/src/lib/plugin-vendor.ts`
- `packages/cli/src/lib/plugin-manager.ts`
- `packages/cli/src/lib/markdown/plugins.ts`
- `packages/viewer/src/routes/api/plugin/add-npm/+server.ts`
