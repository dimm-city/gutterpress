# Plan: Google Drive publishing (`gdrive` provider)

**Status:** proposed (plan only — no implementation yet)
**Date:** 2026-08-31
**Goal:** a non-technical author clicks *Publish → Google Drive*, approves
Gutterpress in their browser once, picks (or names) a Drive folder, and their
finished PDF — later also the HTML export — lands in that folder. Publishing
again updates the same file, so a share link they sent to an editor or printer
keeps pointing at the newest version.

This plan was written after a review of the existing publish subsystem; the
review findings it builds on are summarized in §1 so the design can be checked
against them.

---

## 1. What exists today (review summary)

The publish subsystem (#35) is a complete provider architecture; Google Drive
is a **new provider inside it**, not a new subsystem.

**Lib (`packages/cli/src/lib/publish/`)**

- `types.ts` — the `PublishProvider` contract: static `info`
  (`PublishProviderInfo`: id, label, `kind: "api" | "guided"`,
  `format: "pdf" | "html"`, `configFields`, `credential {required, host,
  envVar?, tokenUrl?, hint?}`) plus `authenticate` / `preflight` / `upload`
  (and optional `listProducts` / `updateListing`). Everything side-effectful
  enters through `PublishDeps` (injected `tokenStore`, `fetch`, `runCommand`,
  `env`, `onProgress`, `credentialAccount`) — that seam is what makes
  providers unit-testable. Named accounts use compound `<host>#<account>`
  store keys via `publishCredentialKey`.
- `registry.ts` — static provider map (itch, drivethrurpg, kdp, azure-swa,
  shopify). Static on purpose: no computed dynamic imports in the compiled
  binary (CLAUDE.md §3).
- `run-publish.ts` — orchestrator: resolve manifest → artifact checks →
  `preflight` → `authenticate` → `upload`. It does **not** build; it consumes
  an existing artifact. `format` drives the default artifact path and the
  file-vs-directory checks.
- `connect.ts` — verify-before-store for **pasted API keys** (trial deps with
  cleared env + an overlay store, persist only after the platform accepts).
- `selections.ts` / `manifest-publish.ts` — project/global default credential
  selections; non-secret `publish.<id>` manifest settings (YAML round-trip
  that preserves comments).
- Providers use plain `fetch` (`shopify.ts`) or an injected command runner
  (`azure-swa.ts`, `itch.ts`/butler). `shopify.ts` also demonstrates the
  **hard host gate**: tokens are only ever sent to a fixed, validated host, so
  a hostile manifest cannot exfiltrate a credential.

**Auth & credential storage**

- `remote-auth/token-store.ts` — `HostCredential { host, kind:
  "github-oauth" | "token", token, username?, label?, createdAt }` +
  `TokenStore` contract. CLI: `FileTokenStore` (0600 JSON). Desktop:
  `electron/credential-store.ts` (safeStorage-encrypted), which mirrors the
  shape **with an explicit field list** — new fields do not round-trip unless
  added there too.
- `remote-auth/github-auth.ts` — the interactive-connect precedent:
  `GitHubAuthProvider.connect(callbacks)` with host callbacks
  (`onUserCode`, `signal`), injectable fetch/sleep, friendly error mapping,
  a registered OAuth app whose **public** client id is embedded with an env
  override, and a doc block recording the registration settings the app
  relies on.
- Desktop side: `electron/github-device-flow.ts` — single-in-flight
  start/wait/cancel wrapper, exposed over the narrow IPC bridge
  (`remote:connectGitHubStart/Wait/Cancel`), driven by
  `ConnectionsSettings.svelte` via `getPlatform()`.

**Front-ends**

- CLI `commands/publish.ts` — `--list`, `--connect` (token via flag/env/
  stdin), `--disconnect`, publish with `--dry-run/--json/--open`.
- Desktop routes `api/publish/{providers,list,connect,disconnect,set-config,
  preflight,run}` over the shared remote-hooks bridge (`_hooks.ts` re-types
  the lib surface); `PublishSectionController` owns state;
  `PublishWizard.svelte` renders a **data-driven** per-provider setup step
  (text `configFields` + paste-an-API-key connect + saved-account picker),
  then preflight, then publish. `friendlyPublishError`
  (`src/lib/errors.ts`) maps provider failures to author-friendly copy.

**Relevant repo rules:** no bundlers/`Bun.*` at runtime, self-contained
binary (§1/§3) — so **no `googleapis` SDK**; Node-native network operations
via `fetch` (§7 spirit); desktop renderer stays PWA-clean, host work behind
routes or the narrow adapter seam (§8); every change should reduce or justify
complexity.

There is currently **zero** Google/Drive code in the repo.

---

## 2. Design decisions

### D1 — OAuth scope: `drive.file` (non-sensitive), not full `drive`

`https://www.googleapis.com/auth/drive.file` grants access **only to files
and folders the app created** (or that the user later grants via the Google
Picker). Consequences:

- **For users:** the consent screen is calm ("See, edit, create, and delete
  only the specific Google Drive files you use with this app") instead of
  "See and manage ALL your Drive files". Right tone for non-technical
  authors.
- **For the project:** `drive.file` is in Google's *recommended /
  non-sensitive* tier — no restricted-scope verification, no third-party
  security assessment (CASA), no annual re-audit. Full `drive` is a
  *restricted* scope with all of that; it is not a viable burden for this
  project.
- **The trade-off:** the app cannot browse or write into arbitrary
  pre-existing Drive folders. The folder model in D5 is designed around
  this, and it covers the golden path cleanly. The Google Picker API is the
  sanctioned escape hatch for "grant access to an existing folder" and is
  listed as future work (§9), not v1.

Also request `openid email` (non-sensitive) so the stored credential can be
labeled "Google Drive — name@gmail.com" for the accounts picker.

### D2 — Auth flow: loopback redirect + PKCE (system browser)

OAuth 2.0 authorization-code flow for installed apps: Gutterpress binds an
ephemeral `node:http` listener on `127.0.0.1:<os-assigned port>`, opens the
system browser at `accounts.google.com` (PKCE S256 + `state`), the user picks
an account and clicks *Allow*, Google redirects to the loopback, the lib
exchanges the code for tokens and serves a tiny "You're connected — return to
Gutterpress" page. No code to type, nothing to paste.

Why not the device flow, given `GitHubAuthProvider` is the in-repo precedent?

- **UX:** device flow adds "go to google.com/device and type `ABCD-1234`".
  Loopback is *click Allow and you're done* — meaningfully easier for the
  stated audience.
- **Google's steer:** loopback is Google's documented flow for desktop apps.
  The limited-input device flow is scoped to a small allowlist (which does
  include `drive.file` today) and Google has repeatedly narrowed it; building
  the permanent path on it is a risk we don't need to take.
- **Cost:** the loopback listener is a small amount of new code, but the
  host-facing shape stays identical to the GitHub precedent
  (`connect(callbacks)`, AbortSignal cancel, single-in-flight wrapper on the
  desktop) — and it *removes* the user-code display UI a device flow would
  need. Both the CLI and the desktop run on the author's own machine, where a
  browser and the loopback are available. Headless/CI keeps the env-var
  escape hatch (D4).
- Embedded webviews are not an option regardless: Google blocks OAuth in
  embedded user-agents, so the system browser is required either way.

Notes for the implementer: bind to `127.0.0.1` only; accept exactly one
callback; enforce `state`; overall deadline (~5 min) composed with the caller
signal via the existing `withFetchTimeout` policy; use
`access_type=offline&prompt=consent` so a refresh token is issued on every
connect (reconnects included).

### D3 — Client credentials: embedded installed-app client id + "secret", env-overridable (needs a ruling)

Google's token endpoint requires a `client_secret` for Desktop-app OAuth
clients **even with PKCE**. Google's own installed-app docs state that in
this context the client secret is *not treated as a secret* — every installed
Drive/gcloud-style app ships it. This collides with the (GitHub-scoped)
stance in `github-auth.ts` ("never put a client SECRET anywhere in this
codebase — the device flow needs none"), so it needs an explicit,
product-owner-ratified amendment rather than a silent exception:

> Google installed-app client credentials (id **and** secret) are public by
> design per Google's OAuth documentation for native apps. They are embedded
> as defaults exactly like `DEFAULT_GITHUB_CLIENT_ID`, overridable via
> `GUTTERPRESS_GOOGLE_CLIENT_ID` / `GUTTERPRESS_GOOGLE_CLIENT_SECRET`, and
> the security of the flow rests on PKCE + the loopback redirect + user
> consent — not on the secrecy of these values. The GitHub rule is unchanged
> for GitHub. **Confidential** secrets still never enter the codebase.

Record this in a short ADR (docs/adr/0011) together with the registration
settings the app depends on (mirroring the release-blocking doc block in
`github-auth.ts`), since docs/adr is the surviving home for such rulings.

### D4 — Credential storage: refresh token in the existing `HostCredential`, no schema growth

Google access tokens live ~1 hour; the durable secret is the **refresh
token**. Store it as the credential's `token` under logical host key
`"gdrive"` (same convention as `"shopify"` / `"azure-swa"`), with
`kind: "google-oauth"`, `username` = the Google email, `label` = "Google
Drive — email". Providers mint an access token on demand (one refresh POST
per operation, cached in memory for the operation only — never persisted).

Why not store `{accessToken, refreshToken, expiresAt}`? It would require
extending `HostCredential` **and** the desktop credential store's explicit
field mapping and redaction paths, plus expiry bookkeeping — for a saving of
one ~200 ms POST per publish. Refresh-on-demand keeps the schema untouched;
the only type change is widening the `kind` union to include
`"google-oauth"` in `token-store.ts` and the desktop mirror
(`electron/credential-store.ts`). A revoked/expired refresh token surfaces as
Google's `invalid_grant`, which maps to one friendly message: "Your Google
Drive connection expired or was revoked. Connect Google Drive again."

Named accounts (two Google accounts) come for free via the existing compound
`gdrive#<account>` keys, the saved-accounts picker, and
`publish.gdrive.credential` — no new mechanism.

**CI escape hatch:** `envVar: "GDRIVE_REFRESH_TOKEN"` (a refresh token minted
by an interactive connect on a workstation), consistent with
`resolvePublishCredential`'s env-wins rule. Documented as advanced usage.

### D5 — Folder model under `drive.file`: app-created folders, picked or named; the user reorganizes in Drive

The manifest gets (non-secret, per `PublishSettings`):

```yaml
publish:
  gdrive:
    folder: My Books        # display name; created at My Drive root if missing
    folderId: 1AbC…         # stable id — set when a folder is picked in the app
    credential: personal    # optional saved-account label (existing mechanism)
```

Resolution order in the provider: explicit `folderId` (verify it still
exists and isn't trashed; if gone, a friendly "pick the folder again" error)
→ find an app-visible folder matching `folder` by name → create it at My
Drive root. Default `folder` when unset: **"Gutterpress"** (open question
Q3). The desktop wizard sets `folderId` explicitly via the picker (D9); the
CLI path works purely by name and the publish outcome includes a one-line tip
to record the id (the Shopify `productId` pattern).

The key property making this good enough for v1: **Drive moves preserve
ids.** The author can drag the Gutterpress-created folder anywhere in their
Drive (into any existing hierarchy, even a shared folder) and publishing
keeps working, because the app addresses the folder by id, not path. So
"publish into my existing folder tree" is achieved by *moving the app's
folder once in the Drive UI* — one honest sentence of user documentation
instead of a restricted-scope verification program.

### D6 — Update-in-place: stable share links

On upload, search the target folder (app-visible files only) for a file with
the artifact's basename; if found, update its content
(`files/{id}` + upload), else create. Same `fileId` ⇒ the file's
`webViewLink` and any "Anyone with the link" share the author already sent
keep working, and Drive keeps version history. The outcome reports
`url: webViewLink` ("View it in Drive") and a follow-up hint that sharing is
done from Drive's own Share button. No auto-sharing by default (Q5) — we do
not change the file's visibility.

### D7 — Plain REST over injected `fetch`; resumable uploads; no SDK, no new deps

The `googleapis` npm SDK is large, drags in `google-auth-library`, and is
exactly the kind of dependency that breaks or bloats `bun build --compile`
(§1/§3). The provider needs six small REST calls (token refresh, `about.get`,
`files.list`, folder `files.create`, resumable session start, chunk PUT) —
plain `fetch` through `PublishDeps.fetch`, wrapped in the existing
`withFetchTimeout` / `FriendlyHttpError` policy, exactly like `shopify.ts`.

PDFs from this pipeline can be large (print books, hundreds of MB), so use
the **resumable** upload protocol: start a session, PUT 8 MiB chunks
(multiples of 256 KiB), handle `308 Resume Incomplete` + `Range`, retry a
failed chunk up to 3 times on 429/5xx with backoff honoring `Retry-After`,
and drive `onProgress` ("Uploaded 24 of 96 MB…") so the wizard's log shows
life during long uploads. Chunks are read from disk incrementally (fs read
per chunk) — never the whole artifact in memory.

**Fixed-host gate (Shopify precedent):** every request goes to
`accounts.google.com`, `oauth2.googleapis.com`, or `www.googleapis.com` —
never to a host derived from manifest config — so a hostile or typo'd project
cannot redirect a token.

### D8 — HTML export: phase 3, as a ZIP; small `formats` contract extension

The provider contract currently fixes one `format` per provider, and
`run-publish.ts` + the wizard's artifact picker branch on it. The user's goal
includes HTML exports, so:

- **Contract extension (small, explicit):** `PublishProviderInfo` gains
  optional `formats?: PublishArtifactFormat[]`; `resolvePublishRequest`
  computes the effective format (`publish.<id>.format` config, validated
  against `formats`, defaulting to `info.format`) and uses it for the default
  artifact path and checks. Single-format providers are untouched. Mirrors in
  `_hooks.ts` / `shared-types.ts` follow; the wizard's `pickPublishArtifact`
  and the gdrive setup step read the effective format (a PDF/Website radio
  for gdrive only).
- **Drive is file delivery, not web hosting** (Drive dropped site hosting in
  2016) — say so in the UI copy; Azure SWA remains the "publish a website"
  provider. Therefore ship the HTML export as **one ZIP**
  (`<title>-website.zip`), built with `fflate` (already a dependency via
  theme-import): one file to share/download, update-in-place per D6 keeps its
  link stable, and it avoids N-file folder mirroring (partial-failure states,
  orphan cleanup, quota multiplication). Folder mirroring is the recorded
  alternative if users ask for browsable files (Q4).

Phase 1 ships PDF-only (`format: "pdf"`, no `formats` yet) so the golden path
lands without the contract change; phase 3 adds the extension + ZIP.

### D9 — Folder picking: generic optional provider methods, provider-neutral routes

The wizard needs "list folders / create folder". Rather than gdrive-specific
routes, add two optional methods to the provider contract (precedent:
`listProducts`):

```ts
/** Existing places this provider can publish into (gdrive: app-visible Drive
 *  folders). UIs render a picker when implemented. */
listDestinations?(req: PublishRequest): Promise<PublishProduct[]>;
/** Create a new destination (gdrive: a Drive folder at My Drive root). */
createDestination?(req: PublishRequest, name: string): Promise<PublishProduct>;
```

`PublishProduct {id, title, url?}` already fits a folder. Surface through
`_hooks.ts` + two provider-neutral routes
(`api/publish/destinations/list|create`) + `api.ts` wrappers. The card grows
a `destinations?: { label: string; canCreate: boolean }` flag (from a new
`info.destinations` field) so the wizard knows to render the picker and what
to call the thing ("Folder"). A future Dropbox/OneDrive provider reuses all
of it — consistent with the configFields philosophy ("a new provider brings
its own fields, no UI edits").

### D10 — Desktop connect plumbing: mirror the GitHub device-flow trio

Follow the established interactive-OAuth pattern exactly
(`electron/github-device-flow.ts` + `remote:connectGitHub*` + the
`ConnectionsSettings` dialog):

- `electron/google-connect-flow.ts` — same single-in-flight
  start/wait/cancel class; `start(account?)` runs the lib's
  `GoogleAuthProvider.connect`, opens the browser via `shell.openExternal`
  (host-side; navigation policy already routes external links there), returns
  `{ authUrl }` for a "browser didn't open? click here" link; `wait()`
  resolves `{connected, email}` after the credential is stored under
  `publishCredentialKey("gdrive", account)`; `cancel()` aborts.
- IPC: `publish:connectGoogleStart/Wait/Cancel` via `secureHandle`, plus the
  §8(B) checklist: `preload.ts`, `bridge-types.ts`, `types.d.ts`,
  `contract.ts` (`ElectronBridge` + `HostServices`), `electron-adapter.ts`,
  and `web-adapter.ts` (explicit reject — "Connecting Google Drive isn't
  available in the browser yet", the dormant-PWA convention).

Recorded alternative: a start/wait/cancel **route** trio on the publish hooks
bridge would satisfy §8(A)'s route-first default; not chosen so the app keeps
ONE pattern for interactive OAuth connects. If §8 discipline later demands
it, migrate GitHub and Google together in one refactor.

---

## 3. The provider itself (sketch)

```ts
// packages/cli/src/lib/publish/providers/gdrive.ts
const info: PublishProviderInfo = {
  id: "gdrive",
  label: "Google Drive",
  kind: "api",
  format: "pdf",
  description:
    "Upload the finished PDF to a folder in your Google Drive — publishing again updates the same file, so shared links stay current.",
  configFields: [
    { key: "folder", label: "Drive folder", placeholder: "Gutterpress" },
    // folderId is picker-set (never hand-typed) → NOT a configField; it still
    // round-trips through publish.gdrive like `credential` does.
  ],
  credential: {
    required: true,
    host: "gdrive",
    envVar: "GDRIVE_REFRESH_TOKEN",
    connect: "oauth", // NEW field, see §4 — drives the connect UI branch
    hint: "Click Connect Google Drive and approve in your browser — nothing to paste.",
  },
  destinations: { label: "Folder", canCreate: true }, // NEW, see D9
};
```

- `authenticate` — resolve credential (env wins) → refresh POST →
  `about.get` (confirms token + captures email); `invalid_grant` → the
  reconnect message from D4.
- `preflight` — offline-only, like Shopify: nothing to check beyond shared
  artifact checks in v1 (folder name sanity if provided). Quota is checked in
  `upload` *before* any bytes move (`about.get` `storageQuota`): "Your Google
  Drive is full — this PDF needs 96 MB but only 12 MB is free" fails fast.
- `upload` — token → resolve folder (D5) → find-or-create file (D6) →
  resumable upload (D7) → outcome:

  ```
  kind: "published"
  url:  <file webViewLink>
  detail: 'Uploaded "my-book-pdf.pdf" to the "My Books" folder in your Google Drive (updated the existing file).'
  followUp: [
    "To share it, open it in Drive and use the Share button — Gutterpress never changes who can see your files.",
    'Tip (CLI): record the folder id in the manifest (publish.gdrive.folderId: "…") so renaming the folder in Drive can never break publishing.',
  ]
  ```
- `listDestinations` / `createDestination` — app-visible folders
  (`q: mimeType='application/vnd.google-apps.folder' and trashed=false`,
  quote-escaped) / folder create at root.

Supporting modules (all under `packages/cli/src/lib/publish/`):

- `google-auth.ts` — `GoogleAuthProvider.connect(callbacks)` per D2/D3
  (callbacks: `onAuthUrl(url)`, `signal?`), `resolveGoogleClientId/Secret()`
  env-override helpers, `revokeGoogleCredential()` (best-effort POST to
  `oauth2.googleapis.com/revoke`, used by disconnect), and a doc block
  recording the Cloud-Console registration settings (release-blocking, like
  `github-auth.ts`'s).
- `google-drive.ts` — the fetch-based REST client from D7:
  `refreshAccessToken`, `driveAbout`, `listFolders`, `ensureFolder`,
  `findFileInFolder`, `resumableUpload` (+ chunk retry). Everything takes
  `PublishDeps`-style injected fetch; no module state.
- `connect-google.ts` (or an export from `google-auth.ts`) —
  `connectGoogleDrive({account?}, deps, callbacks)`: runs the flow, then
  `tokenStore.set(publishCredentialKey("gdrive", account), credential)`.
  Parallel to how `GitHubDeviceFlow` composes `GitHubAuthProvider` +
  `tokenStore`; shared by CLI `--connect` and the desktop flow class.

---

## 4. Cross-cutting contract changes (the full checklist)

Small but each mirrored in several places — the review found every mirror is
explicit, so listing them all:

1. `PublishProviderId` union + `PROVIDERS` map (`types.ts`, `registry.ts`).
2. `HostCredential.kind` union += `"google-oauth"` —
   `remote-auth/token-store.ts` **and** the desktop mirror
   `electron/credential-store.ts` (`HostCredential` + `StoredEntry` +
   `listRedacted` signature).
3. `PublishProviderInfo.credential.connect?: "token" | "oauth"` (default
   `"token"`) + `info.destinations?` — `types.ts`, mirrored in desktop
   `_hooks.ts` (`LibPublishProviderInfo`), passed through
   `api/publish/list/+server.ts` into `PublishProviderCard`
   (`shared-types.ts`: `connectKind`, `destinations`).
4. Optional provider methods `listDestinations`/`createDestination`
   (`types.ts`) + lib wrapper functions + `_hooks.ts` `PublishLibModule`
   entries + routes + `api.ts`.
5. Manifest schema: `PublishSettings.gdrive?: { folder?; folderId?;
   credential?; format? (phase 3) }` (`schema/manifest.types.ts`).
6. Lib exports: `api/index.ts` (GoogleAuthProvider, connectGoogleDrive,
   revoke helper, new types) — the desktop reaches everything through
   `loadLib()`.
7. CLI strings: `--provider` help/error lists in `commands/publish.ts`, and
   the README provider table (`readme-drift.test.ts` pins these — it will
   fail until both move together).
8. `connectPublishProvider` (pasted-token flow) rejects `connect: "oauth"`
   providers with a pointer to the right gesture ("Run
   `gutterpress publish --provider gdrive --connect` / click Connect Google
   Drive"), so the old path can't store an unverifiable paste.
9. Disconnect paths (CLI branch + `api/publish/disconnect`) call the
   best-effort revoke for `kind: "google-oauth"` before deleting the entry.

---

## 5. Front-end UX

**Desktop wizard (`PublishWizard.svelte` setup step, gdrive card):**

1. Not connected: the API-key paste UI is replaced (branch on
   `card.connectKind === "oauth"`) by **[Connect Google Drive]** → busy state
   "Waiting for your browser — choose your Google account and click Allow"
   (+ *Open the sign-in page again* using the returned `authUrl`, + Cancel
   wired to `connectGoogleCancel`). On success the standard "Connected —
   reusing your saved account" row shows the email; saved-accounts picker and
   "Add another account…" (named credentials) work unchanged.
2. Connected: **Folder** picker (from `api.publish.listDestinations`):
   options = app-visible folders + "New folder…" (inline name +
   `createDestination`); choosing writes `{folderId, folder: name}` via the
   existing `setConfig`. Below it, the existing free-text `folder` field
   remains the no-picker fallback (and the CLI-parity story).
3. Publish step: unchanged — outcome renders "View it in Drive" via the
   existing `outcome.url` handling.

**Settings → Connections (`ConnectionsSettings.svelte`):** the
add-a-publishing-key form branches the same way for oauth providers; the
stored `gdrive` entry lists with its email label; Disconnect uses the
revoking disconnect. An `invalid_grant`-broken credential presents as
"needs reconnecting" (same pattern as the store's `unreadable` state).

**CLI:**

```bash
gutterpress publish --provider gdrive --connect     # opens the browser, waits, stores
gutterpress publish --provider gdrive               # uploads the built PDF
gutterpress publish --provider gdrive --dry-run     # preflight only
GDRIVE_REFRESH_TOKEN=… gutterpress publish --provider gdrive   # CI
```

`--connect` prints the auth URL too ("If the browser didn't open, visit:
…"); `--token` with an oauth provider errors with guidance (§4.8). On a
headless box the flow times out with a message pointing at the env var.

**Friendly errors (`desktop/src/lib/errors.ts` + provider messages):**
`invalid_grant` → reconnect copy (D4); `storageQuotaExceeded` → "Drive is
full" with sizes; folder-gone → "That Drive folder can't be found (moved to
trash?) — pick a folder again in the Google Drive settings"; offline/timeout
→ the shared `withFetchTimeout` copy. All token-free, per the standing
security invariant.

---

## 6. Security invariants (inherited + new)

- Tokens never in logs, error messages, spawned argv, or host/route
  responses (no child processes at all in this provider).
- Fixed-host gate for every request (D7) — no config-derived hosts.
- Loopback listener: `127.0.0.1` only, single-use, `state` verified, PKCE
  S256, ~5-min deadline, success page contains no token material.
- Store only after a successful token exchange (the loopback flow is
  verify-by-construction — no half-stored credentials, matching
  `connect.ts`'s ordering guarantee).
- Manifest carries only non-secret values (`folder`, `folderId`,
  `credential` label, later `format`).
- Desktop: refresh token encrypted via safeStorage like every credential;
  redacted listings unchanged.
- Disconnect revokes at Google best-effort, then deletes locally.

---

## 7. Phases, deliverables, and tests

**Phase 0 — Google Cloud registration (product owner; start immediately —
this is the long pole).** Create the Cloud project; enable the Drive API;
configure the OAuth consent screen (external) with app name, logo, homepage
and privacy-policy URLs (the latter two must exist — flagging as a real
prerequisite); scopes `drive.file`, `openid`, `email`; create a **Desktop
app** OAuth client; record id + "secret" as the embedded defaults. Publish
the consent screen to **In production** and complete basic (brand)
verification to clear the "unverified app" interstitial. Until then,
*Testing* mode works for development with two caveats to plan around:
refresh tokens expire after 7 days and only ~100 test users are allowed.
Verify current Google policy details at implementation time — they shift.
Output: ADR 0011 (D3 ruling + registration settings).

**Phase 1 — lib + CLI (PDF golden path).**
`google-auth.ts`, `google-drive.ts`, `connect-google.ts`,
`providers/gdrive.ts`, registry/type/union changes (§4.1–2, 4.5–4.9),
exports, CLI `--connect` interactive branch. Tests (bun, fake fetch/store,
mirroring `publish.test.ts` / `github-auth.test.ts` style):
- auth: PKCE/state correctness, state-mismatch rejected, cancel/timeout,
  error-param path, no secret in any thrown message; loopback exercised with
  real `fetch` against the ephemeral port.
- drive client: refresh (incl. `invalid_grant` mapping), resumable chunk
  sequencing with `308`/`Range` resume, chunk retry/backoff, quote-escaping
  in `q`.
- provider: folderId-vs-name-vs-create resolution, update-vs-create, quota
  fail-fast, env-credential override, named-account compound keys
  (`named-credentials.test.ts`), `connectPublishProvider` rejection (§4.8).
- `readme-drift.test.ts` + README provider list.
Milestone: `gutterpress publish --provider gdrive` works end-to-end against a
real account.

**Phase 2 — desktop.**
`google-connect-flow.ts` + IPC trio + §8(B) checklist (D10); credential-store
union (§4.2); destinations routes + `api.ts` (D9); wizard oauth branch +
folder picker (§5); `ConnectionsSettings`; revoking disconnect; friendly
errors. Tests: `google-connect-flow.test.ts` (mirror
`github-device-flow.test.ts`), `publish-wizard.test.ts`,
`settings-connections.test.ts`, `friendly-publish-error.test.ts`,
`route-scoping.test.ts` additions.

**Phase 3 — HTML export.** `formats` contract extension +
`publish.gdrive.format` + wizard format choice + ZIP packaging via `fflate`
(D8), with its own upload tests.

**Phase 4 — docs + polish.** User guide `08-publishing.md` (a Google Drive
section written for the non-technical reader: connect once, pick a folder,
links stay stable, move the folder freely in Drive, sharing stays yours);
README; release notes. Future-work backlog: §9.

Rough sizing: phase 1 ≈ 600–900 lines incl. tests; phase 2 ≈ 500–700;
phase 3 ≈ 200–300. No new runtime dependencies in any phase.

---

## 8. Open questions for the product owner

1. **(D3)** Ratify the embedded Google installed-app client id + "secret"
   ruling (env-overridable, public-by-design). Blocking for phase 1.
2. **(D1/D5)** Sign off on the `drive.file` trade-off: v1 cannot write into
   arbitrary pre-existing folders; users move the app-created folder in
   Drive instead (ids survive moves). Escape hatch = Google Picker, §9.
3. **(D5)** Default folder name: proposal **"Gutterpress"** (one folder,
   all books, recognizable origin) over per-book title folders.
4. **(D8)** HTML export as a single ZIP (proposed) vs a mirrored folder of
   loose files.
5. **(D6)** Confirm no auto-sharing: Gutterpress never changes file
   visibility; sharing stays in Drive's UI. (A "make it link-shareable"
   toggle could be later work.)
6. Phase 0 prerequisites: which homepage + privacy-policy URLs to use for
   the consent screen?

## 9. Future work (explicitly out of scope for v1)

- **Google Picker integration** (desktop): grant `drive.file` access to an
  arbitrary existing folder the user picks — removes the D5 limitation
  without scope escalation. Needs an API key + a browser context; design
  when asked for.
- **Shared drives**: pass `supportsAllDrives` from day one in the client so
  files *moved* into shared drives keep working, but defer first-class
  shared-drive targeting.
- Optional link-sharing toggle (Q5), other cloud-storage providers reusing
  the D9 destination seam (Dropbox, OneDrive), and a
  "recently published" deep link on the project screen.
