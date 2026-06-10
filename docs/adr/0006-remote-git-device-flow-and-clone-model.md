# ADR 0006 — Remote Git: device-flow auth, clone-based projects, provider-agnostic transport

**Status:** Proposed (2026-06-10)
**Relates to:** ADR 0002 (in-process libraries over OS deps), ADR 0004 (platform abstraction)
**Implements:** GitHub #13, #14, #15; re-scopes/supersedes #16
**Codifies:** CLAUDE.md Architectural Rule §7 (Node-native Git, no external OS tools)

## Context

Milestone 0.5.0 brings remote-Git-backed projects to print-md: non-technical
authors must be able to open, edit, version, and eventually publish projects
that live in remote Git repositories — GitHub first, but also **privately
hosted forges (Gitea, Forgejo, GitLab, Bitbucket, Azure Repos)** — with no
terminal, no Git installation, no PATs pasted into config files, and no
understanding of clone/push/remotes.

Foundations already landed in 0.4.x (#12, #25):

- `packages/lib/src/lib/project-source.ts` — classifies an opened folder as
  `local-folder` / `local-git-folder` (pure `fs` reads, no git binary).
- `packages/lib/src/lib/source-provider.ts` — init/snapshot/list/restore
  version-history operations on `isomorphic-git`.
- `packages/lib/src/lib/project-scaffold.ts` — new-project scaffolding,
  Git-by-default with a `local-folder` escape hatch.

Three constraints shape every decision here:

1. **No external tools** (CLAUDE.md §7): no system `git`, no `gh`, no bundled
   binaries. All Git operations are pure-JS (`isomorphic-git`); all forge API
   calls are plain HTTPS (`fetch`).
2. **No deployed backend.** A hosted token-exchange/sync service is a forever
   liability — it must be deployed, monitored, paid for, and its outage breaks
   every user. The design must require **zero infrastructure** beyond static
   app registrations.
3. **No secrets in the app.** Anything shipped inside the Electron package or
   the compiled CLI binary is extractable. Client *IDs* are public by design;
   client *secrets* and long-lived service credentials must never ship.

## Decision

### D1. Auth: OAuth Device Flow with a GitHub App; no backend, no shipped secret

GitHub authentication uses the **OAuth Device Authorization Grant** against a
registered **GitHub App** (not an OAuth App):

- The app POSTs to `https://github.com/login/device/code` with only the
  **public client ID**, receives a user code, opens
  `https://github.com/login/device` in the system browser
  (`shell.openExternal`), shows the code (e.g. `ABCD-1234`), and polls
  `https://github.com/login/oauth/access_token` until the user approves.
- **No redirect URI, no loopback server, no client secret, no hosted token
  exchange.** This is the same mechanism the `gh` CLI uses; it works on all
  three platforms, behind firewalls and corporate proxies, and in the headless
  CLI as well as the viewer.
- A **GitHub App** (not an OAuth App) because installation grants
  **selected-repository access** with fine-grained permissions (Contents
  read/write only) — the user authorizes their book repos, not `repo` scope
  over their whole account. This satisfies #15's "narrowest practical
  permissions / prefer selected-repository access" requirement.

**Mandatory app-registration setting:** GitHub App user tokens expire after
8 hours by default, and *refreshing* them requires the client secret — which
we cannot ship. Therefore the registration MUST disable
**"user-to-server token expiration"** (App settings → Optional features).
Tokens then behave like classic OAuth tokens: long-lived, revocable by the
user from GitHub → Settings → Applications. If this setting is ever left
enabled, every session silently dies after 8 hours in the wild — treat it as a
release-blocking checklist item for the app registration.

### D2. A managed remote project IS a local clone

A remote-backed project is materialized as a **local clone** (`isomorphic-git`
over smart HTTPS into a user-visible folder). The alternative — a virtual
filesystem over forge content APIs — is rejected: it breaks offline use,
bypasses the entire existing watcher/preview/build pipeline, is rate-limited,
and forces a second code path through every feature.

After clone, the project **is a `local-git-folder`** to the rest of the
system. The preview, file watcher, build pipeline, and the #13
snapshot/history/restore features all work **unchanged**. What makes it
"managed" is not a distinct runtime mode — it is:

- a **credential** stored for the remote's host (D4), and
- optional **provenance metadata** (which provider/picker it came from).

Consequences:

- **Offline is the default state, not an error state.** Editing, preview,
  snapshots, and PDF export never require connectivity.
- "Sync" = fetch + merge; "Publish Changes" = commit + push. Both are
  incremental operations on the clone.
- **Corruption recovery is trivial**: the remote is the source of truth, so
  "Repair project" = move uncommitted files aside → re-clone → restore them.
  No `git fsck`, no manual surgery.
- Clones default to **shallow** (`depth: 1`) with deepen-on-demand when "View
  History" scrolls past the horizon — book repos with art assets can be large.
  (isomorphic-git's shallow-fetch behavior has known quirks; a spike validates
  this before it's load-bearing, with full clone as the fallback default.)
- All Git operations on a repo are **serialized through a per-repo queue** in
  the lib — concurrent isomorphic-git operations on one repository corrupt the
  index.

### D3. Provider-agnostic by construction: four separated layers

"GitHub support" is deliberately decomposed so that GitHub is *one plugin*,
not the architecture. The lib defines four independent layers:

```
┌────────────────────────────────────────────────────────────┐
│ 4. Repo discovery (optional, per-provider)                 │
│    GitHub REST list-installations/repos · paste-a-URL ·    │
│    (later: Gitea/Forgejo & GitLab REST adapters)           │
├────────────────────────────────────────────────────────────┤
│ 3. Auth acquisition (pluggable, per-host UX)               │
│    github.com → device flow (zero typing) ·                │
│    any host  → guided "Connect a Git server" token flow ·  │
│    (later: device flow against self-hosted Gitea/GitLab)   │
├────────────────────────────────────────────────────────────┤
│ 2. Credential store (host-keyed, host-app-provided vault)  │
│    resolves isomorphic-git onAuth by remote origin         │
├────────────────────────────────────────────────────────────┤
│ 1. Transport (universal): isomorphic-git over smart HTTPS  │
│    works against ANY standards-compliant Git server        │
└────────────────────────────────────────────────────────────┘
```

**Layer 1 — transport — is already universal.** isomorphic-git speaks the Git
smart-HTTP protocol with Basic auth; that protocol is identical on GitHub,
Gitea, Forgejo, GitLab, Bitbucket, Azure Repos, and any self-hosted smart-HTTP
server. Nothing GitHub-specific exists at this layer, ever.

**Layer 2 — credentials are keyed by remote host, not by project.** A
credential for `git.example.com` makes *every* project whose `origin` points
at that host publishable — including repos the user cloned externally with
their own tools. Storage goes through a `TokenStore` interface provided by
the host app (ADR 0004 seam): Electron implements it with `safeStorage` (OS
keychain — DPAPI / Keychain / kwallet); the CLI with a `0600` file under the
config dir (the `gh` model). The lib never touches the OS keychain directly
and never logs token values.

**Layer 3 — auth acquisition is a per-host plugin with a shared contract:**

```ts
interface RemoteAuthProvider {
  /** Does this provider handle the given remote host? */
  matches(origin: URL): boolean;
  /** Interactive flow producing a credential for the host. */
  connect(host: HostCallbacks): Promise<HostCredential>;
  /** Cheap revalidation (e.g. a HEAD/refs probe) for stored credentials. */
  validate(cred: HostCredential): Promise<boolean>;
}
```

- `github.com` → the device-flow provider (D1). Zero typing, fully managed.
- **Every other host → the generic token provider**: a guided
  "Connect a Git server" flow — server URL + username + access token. Every
  forge (Gitea, Forgejo, GitLab, Bitbucket, Azure Repos) has a simple
  web UI for creating an access token, and the flow links the user to the
  right page when the host is recognized (e.g. `https://<gitea>/user/settings/applications`).
  The credential is verified with a refs probe (`listServerRefs`) **before**
  it is saved, so a bad paste fails immediately with friendly guidance rather
  than later during a publish.
- Self-hosted **Gitea/Forgejo (≥1.17) and GitLab (≥17.2) also support the
  device grant** — but it requires an OAuth app registered *on that server*,
  which only the server admin can do. The provider interface accommodates a
  future "this server has a print-md OAuth app" configuration; it is not
  0.5.0 scope. The token flow is the universal floor.

**Layer 4 — repo discovery is optional sugar.** GitHub gets the polished
picker (REST: `/user/installations`, `/user/installations/{id}/repositories`
via plain `fetch` — no `@octokit` dependency for ~5 endpoints). Every other
provider starts with **"paste the repository's HTTPS clone URL"**, which is
universal. Gitea and GitLab repo-listing REST adapters are mechanical
follow-ups behind the same interface when demand justifies them.

The result: **adding a new forge is, at minimum, zero work** (token flow +
paste URL already covers it), and at maximum a small discovery adapter plus a
link to its token-settings page.

### D4. Source-type model: `managed-github` collapses into metadata

The #12 `ProjectSource` union keeps `local-folder` and `local-git-folder` as
the real runtime modes. The `managed-github` variant is **not a third runtime
mode** — after clone it is a `local-git-folder` whose remote host has a stored
credential. Provider provenance (installation id, picker origin) is stored as
optional project metadata for the repo picker and re-auth UX, not consulted by
the editing/preview/build paths.

Publishability is a *derived* capability:

```
canPublish = hasRemote
          && remote is smart-HTTPS
          && (credential exists for remote host || remote allows anonymous push)
```

### D5. Conflict and failure model: snapshot-first, never show merge markers

isomorphic-git performs clean merges but has no interactive conflict
resolution — and the audience must never see conflict markers regardless.

Publish sequence: **commit local work as a snapshot first** (the user's work
is now unconditionally safe) → fetch → fast-forward or clean merge → push.
On a true conflict, offer a per-file choice in author language:

> **Keep my version** · **Use the online version** · **Keep both copies**

Because the snapshot precedes any merge attempt, every choice is recoverable
through View History. Failure copy explains feature impact, not mechanics
("Your changes are saved on this computer. print-md couldn't reach the online
repository — it will publish when you're back online.").

### D6. Honest limitation: no SSH remotes for publish

isomorphic-git is HTTPS-only and we do not shell out, so print-md **cannot
push to SSH remotes**. Externally-cloned repos with SSH origins get full local
features (preview, snapshots, history, restore) and truthful guidance:
"publish using your usual Git tool." When the SSH remote points at a host we
*can* manage (e.g. `git@github.com:…`), Advanced Setup offers the upgrade
path ("Connect GitHub to publish from print-md" — which can add/rewrite an
HTTPS origin with consent). Half-supporting SSH (bundled ssh clients, agent
sniffing) is rejected as exactly the brittle surface this ADR exists to avoid.

### D7. Wild-environment robustness requirements

- **Self-signed TLS on private forges**: honor the system CA store and
  `NODE_EXTRA_CA_CERTS`; never silently disable TLS verification. A per-host
  "trust this server's certificate" pin (with fingerprint display) is an
  acceptable later addition; `rejectUnauthorized: false` is not.
- **Proxies**: respect `HTTP(S)_PROXY`/`NO_PROXY` in the lib's HTTP client.
- **Tokens embedded in clone URLs** (`https://user:tok@host/…`, common in the
  wild): detect on open, migrate the token into the credential store, and
  never echo the URL with the token into logs or diagnostics.
- **Token revocation/expiry**: any 401 from transport or API surfaces a
  single friendly "Reconnect to <host>" action that re-runs the matching
  auth provider; it never drops the user into raw error text.
- **Line endings**: isomorphic-git does no autocrlf conversion — we do not
  add any. Files round-trip byte-identical.
- **Diagnostics** (#14): all checks are lib functions — classification,
  remote URL/branch parsing, and "Test Remote Access" =
  `listServerRefs` over HTTPS. No shell commands anywhere.

## Consequences

**Positive**

- Zero infrastructure: nothing to deploy, monitor, or keep funded. The only
  external artifact is a static GitHub App registration.
- Zero bundled binaries: no MinGit, no per-platform packaging branches,
  no second executable to codesign. #16's premise dissolves entirely.
- One code path: remote projects become local git folders, so every existing
  and future feature (preview, build, snapshots, lint) works on them with no
  remote-specific branches.
- Any smart-HTTPS forge — including private Gitea — works on day one via the
  generic token flow; polished per-forge UX is additive, never structural.
- Offline-first by construction.

**Negative / accepted trade-offs**

- Generic-forge users must create an access token once (guided, linked, and
  validated — but still a paste). Removing even that requires per-server
  OAuth registration (admin action) or a hosted broker (rejected).
- No SSH push (D6). Mitigated by honest guidance and the HTTPS upgrade path.
- isomorphic-git is slower than native git on very large repos; mitigated by
  shallow clones and the fact that book projects are not monorepos.
- The GitHub App registration carries one non-obvious foot-gun (token
  expiration setting, D1) that must live in the release checklist.

## Implementation order (0.5.0)

1. **#13** — viewer UI over the existing `source-provider.ts` ops
   (Enable Version History / Save Snapshot / View History / Restore), wired
   through the ADR 0004 five-layer seam. Lowest risk; no auth involved.
2. **#15 core** — credential store + auth-provider interfaces; GitHub device
   flow; repo picker; clone-and-open. Spike shallow-clone behavior early.
3. **#14** — Advanced Setup over lib diagnostics; generic "Connect a Git
   server" token flow (this is where Gitea/GitLab/Bitbucket/Azure land);
   SSH-remote guidance and HTTPS upgrade path.
4. **#15 publish** — snapshot-first publish + conflict choices (D5). Ships in
   0.5.0 only if the conflict flow is complete; otherwise a fast-follow.
5. **#16** — closed in favor of #14 (nothing to bundle under §7).

### Release checklist — GitHub App client id

The packaged viewer cannot read `PRINT_MD_GITHUB_CLIENT_ID` from the end
user's environment; the value is baked into the Electron MAIN bundle at build
time via an electron-vite `define` (`packages/viewer/electron.vite.config.ts`).
Before any release that ships the GitHub flow:

1. Set `PRINT_MD_GITHUB_CLIENT_ID` as a repository secret (the client id is
   public by design — the secret slot is just the distribution mechanism).
2. Expose it as `env` on the viewer build step of the release workflow
   (`PRINT_MD_GITHUB_CLIENT_ID: ${{ secrets.PRINT_MD_GITHUB_CLIENT_ID }}`)
   so the `define` picks it up.
3. If unset at build time, `""` is baked in — `resolveGitHubClientId` treats
   empty as unset and falls back to the placeholder, so Connect GitHub fails
   with a friendly error rather than silently misbehaving.
