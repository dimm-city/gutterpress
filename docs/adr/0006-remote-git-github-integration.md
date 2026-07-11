# ADR 0006: Remote Git / GitHub integration (D1–D7) and its release checklist

> **Note:** reconstructed 2026-07-11 from in-repo citations; original ADR
> lost. Dozens of comments across `packages/cli/src/lib/remote-auth/`,
> `packages/viewer/electron/`, and `packages/viewer/src/lib/platform/`
> reference specific sub-decisions "D1" through "D7" of this ADR, plus a
> "release checklist" (`electron.vite.config.ts`, `.github/workflows/
> release.yml`). This document reconstructs each labeled sub-decision from
> those citations' context; it is a best-effort summary of decisions already
> implemented, not a verbatim restoration of an original discussion.

## Status

Accepted (as evidenced by the shipped implementation, issues #14/#15).

## Context

print-md needed remote Git (GitHub) integration for non-technical writers —
connect a project to GitHub, sync changes, recover from conflicts — while
honoring `CLAUDE.md` §7 (Node-native git only: no shelling out to a system
`git` binary or the `gh` CLI; all Git and GitHub operations go through
`isomorphic-git` and the REST API).

## Decisions

- **D1 — GitHub auth model: OAuth App device flow.** A registered OAuth App's
  PUBLIC client id (not a secret) drives the OAuth Device Authorization Grant
  (`packages/cli/src/lib/remote-auth/github-auth.ts`): POST the client id +
  `scope: "repo"` to `login/device/code`, show the user code, poll
  `login/oauth/access_token` — the same mechanism the `gh` CLI uses, with no
  redirect URI, loopback server, or client secret. **Amendment (2026-06-10):**
  the model moved from a GitHub App with per-repo installations to a plain
  OAuth App with no installations, so every repo the user can access is
  visible with zero install/selection steps; new clones no longer write an
  `installationId`, kept optional on `ProjectProvenance` only so provenance
  files from 0.4.x betas still parse.
- **D2 — A managed remote project IS a local clone.** `cloneRepository`
  (`remote-auth/clone.ts`) clones the **whole** repository once via pure
  isomorphic-git over smart HTTPS; the resulting folder classifies as an
  ordinary `local-git-folder` (`hasRemote: true`), so every existing feature
  (preview, watcher, snapshots, restore) works unchanged. What makes it
  "managed" is the host-keyed credential plus the provenance sidecar (D4).
  Because it's a plain local git repo, snapshot/restore and sync/clone share
  the **same per-repo lock** (`source-provider.ts`'s `withRepoLock` queue).
- **D3 — Layered credential storage.** Credentials are keyed by **remote
  host** (e.g. `github.com`), not by project, so one credential makes every
  project whose origin points at that host syncable. Three layers:
  1. The lib defines the `TokenStore` contract only; it never touches an OS
     keychain itself.
  2. Each **host application** supplies the implementation: the Electron
     viewer uses `safeStorage` (`electron/credential-store.ts`); the CLI uses
     a `0600` JSON file under the user config dir (the `gh` CLI model —
     encrypted-at-rest is explicitly **not** required for the CLI, since it
     has no OS keychain to depend on).
  3. A **per-host auth-acquisition provider** plugin contract
     (`RemoteAuthProvider`): `github.com` gets the D1 device flow; every other
     Git host gets a generic token-entry flow (issue #14).
- **D4 — Provenance is advisory metadata, never a gate.** `ProjectProvenance`
  (provider/owner/repo, recorded beside a clone) exists only for the repo
  picker and re-auth UX; it is explicitly never consulted by the editing,
  preview, or build paths. The credential-aware **sync gate** is a related
  but separate D4 concept: the toolbar's sync action and auto-sync's preflight
  key off whether a usable credential is actually stored for the remote host
  — not off `capabilitiesFor().canSync` alone — so sync doesn't offer an
  action that would immediately fail for lack of a credential.
- **D5 — Snapshot-first sync + conflict resolution.** Both `pullChanges` and
  `pushChanges` commit any unsaved work in the **whole repo** *before* any
  network or merge step touches it (`remote-auth/sync.ts`, `transport.ts`).
  A true conflict aborts cleanly — the working tree is never left with
  conflict markers — and returns `{status: "conflict", files}` so the UI can
  ask, per file: **Keep my version** · **Use the online version** · **Keep
  both** (the safe, lossless default), implemented as an honest two-parent
  merge commit (`conflict-resolution.ts`). Failure model: offline → friendly
  retry-later (the snapshot already saved the work locally); 401/403 →
  `{status: "auth"}` for a single "Reconnect" action; anything else → a
  friendly, jargon-free message (D5/D7). The same snapshot-first invariant is
  the safety contract behind version-history **restore**: the lib snapshots
  current state before restoring, so a restore can never lose author work
  (`routes/api/vcs/restore-snapshot/+server.ts`).
- **D6 — HTTPS-only transport.** `isomorphic-git` has no SSH transport, so
  SSH remote URLs are rejected up front with author-friendly guidance to
  switch to HTTPS, rather than failing deep inside a clone/sync attempt.
- **D7 — Diagnostics stay in the lib, sanitized.** `diagnose.ts` is a
  pure-lib replacement for the issue's original shell-based diagnostics
  (`git status` / `git remote -v` / `git branch --show-current` — all
  forbidden by `CLAUDE.md` §7): it reuses `detectProjectSource` for folder
  classification and an injected `TokenStore` for the stored-credential
  check. The only network diagnostic is the explicit, user-initiated
  `testRemoteAccess` probe. **Security invariant:** `remoteUrl` is sanitized
  before it reaches the UI — credentials embedded in a clone URL never
  appear in the diagnosis, and legacy embedded-credential URLs are migrated
  away from on read (`token-store.ts`).

## Release checklist

The GitHub OAuth App's client id is public but still an operational
dependency: it must exist as the `PRINT_MD_GITHUB_CLIENT_ID` repository
variable before a release build, because release CI bakes it into both the
viewer's main-process bundle (`electron.vite.config.ts`'s `define`) and the
release workflow's env (`.github/workflows/release.yml`). If the registration
is ever rotated, this variable is the one place that needs updating; when
unset, both build steps bake `""`, which `resolveGitHubClientId` treats as
"use the default registration" rather than failing.

## Consequences

- Non-technical users get GitHub connectivity with a one-time device-flow
  sign-in and no manually-managed SSH keys — but SSH remotes are a hard
  no per D6.
- The lib stays git-binary-free (§7) at the cost of re-implementing the
  fetch/merge negotiation itself in places (see `transport.ts`'s note on why
  `git.pull` was replaced with separate `git.fetch` + `git.merge` +
  `git.checkout` calls to avoid a full-repository re-fetch on snapshot-heavy
  repos).
- Credential storage strength varies by host app (Electron: OS keychain via
  `safeStorage`; CLI: a `0600` file) by design — the lib never assumes a
  keychain is available.

## Sources

Reconstructed from citations in: `packages/cli/src/lib/remote-auth/{github-auth,
token-store,clone,sync,transport,diagnose,generic-auth,github-repos,
resolution-plan,sync-types,conflict-resolution,test-access}.ts` and their
`recovery/` subfolder, `packages/cli/src/lib/source-provider.ts`,
`packages/cli/src/lib/publish/types.ts`, `packages/viewer/electron/
credential-store.ts`, `packages/viewer/electron/export/controller.ts`,
`packages/viewer/electron/auto-sync/orchestrator.ts`,
`packages/viewer/electron/main.ts`, `packages/viewer/electron.vite.config.ts`,
`packages/viewer/src/lib/platform/{contract,shared-types,electron-adapter}.ts`,
`packages/viewer/src/routes/api/vcs/restore-snapshot/+server.ts`,
`packages/viewer/src/lib/routes/project-session-controller.svelte.ts`,
`docs/publishing.md`, `.github/workflows/release.yml`.
