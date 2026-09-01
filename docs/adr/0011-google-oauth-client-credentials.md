# ADR 0011 — Google installed-app OAuth client credentials are embedded, env-overridable defaults

Date: 2026-08-31 · Status: accepted

## Context

The `gdrive` publish provider (#221, `docs/gdrive-publish-plan.md`) connects
via an OAuth 2.0 authorization-code flow for installed apps: a loopback
redirect on `127.0.0.1` with PKCE S256 (D2). Google's token endpoint, however,
requires a `client_secret` for a **Desktop app** OAuth client even when PKCE
is used — this was not assumed, it was tested live against a real Desktop
client (`docs/gdrive-publish-plan.md` Appendix B, spike assumption **P2**):
a PKCE-only exchange returned `invalid_request`; adding `client_secret`
returned `200`. Google's own installed-app documentation states that in this
context the "secret" is not treated as confidential — every installed
Drive/gcloud-style app ships it, because a native app has no way to keep a
value truly secret from its own user, and Google does not offer a
public/secret-less token-auth method for Desktop clients (confirmed:
`token_endpoint_auth_methods_supported` at `accounts.google.com`'s discovery
document lists only `client_secret_post` and `client_secret_basic` — `none`
is absent).

This collides with the (GitHub-scoped) rule already recorded in
`packages/cli/src/lib/remote-auth/github-auth.ts`: "never put a client SECRET
anywhere in this codebase — the device flow needs none." That rule is correct
for GitHub, where the OAuth App's Device Authorization Grant needs no secret
at all. It does not generalize to Google's installed-app model, where a
secret is structurally required regardless of PKCE. Silently doing something
different for Google without recording *why* would leave a future reader
believing the GitHub rule had simply been broken.

## Decision

**Google installed-app client credentials — both the client id and the
client "secret" — are embedded in the compiled binary as env-overridable
defaults, exactly like `DEFAULT_GITHUB_CLIENT_ID`.**

- `resolveGoogleClientId(explicit?)` / `resolveGoogleClientSecret(explicit?)`
  (`packages/cli/src/lib/publish/google-auth.ts`) resolve, in order: an
  explicit option → `GUTTERPRESS_GOOGLE_CLIENT_ID` /
  `GUTTERPRESS_GOOGLE_CLIENT_SECRET` → a `DEFAULT_GOOGLE_CLIENT_ID` /
  `DEFAULT_GOOGLE_CLIENT_SECRET` constant — the identical shape
  `resolveGitHubClientId` already uses.
- **What actually secures the flow is PKCE + the loopback redirect + user
  consent, not secrecy of these values.** The verifier never leaves the
  local machine; the authorization code is useless without it; the loopback
  redirect can only be received by a process already running as the same
  local user; and every step requires the account owner to click Allow in
  their own browser. An attacker who extracts the client id/secret from the
  binary (trivial — it ships in every copy) gains nothing they don't already
  have: they still cannot complete a code exchange without the PKCE verifier
  from a live, consented flow.
- **This decision is scoped to Google.** The GitHub rule in
  `github-auth.ts` is UNCHANGED — GitHub's device flow needs no secret, and
  none is embedded there. A **confidential** secret (one that, if leaked,
  grants access on its own — a server-side OAuth client secret, an API key
  with standing privileges, a service-account key) must never enter this
  codebase, embedded or otherwise. This ADR authorizes exactly one thing: a
  Google **Desktop-app** OAuth client's public-by-design pair.
- The defaults shipped **blank** (`""`) until the production Cloud Console
  client was registered; **the maintainer filled them in on 2026-09-01 for
  the 0.10.5 beta.** Nobody may substitute an invented value or a
  confidential one — only the registered Desktop-app client's own
  public-by-design pair belongs there, and an automated coding session must
  not pick one on its own. A build with both constants blanked fails
  `gdrive` connect immediately with a friendly, non-crashing message ("Google
  Drive publishing isn't configured on this build yet…") rather than starting
  a loopback listener nobody can ever complete an exchange against. Every
  test injects its own fake id/secret via the explicit option or the env
  vars, so tests never depend on the embedded values.

## Cloud Console registration settings this decision depends on (release blocking)

Re-registering the OAuth client without matching these breaks `gdrive`
connect for every user of that build:

1. **Enable the Google Drive API** (APIs & Services → Library → "Google
   Drive API" → Enable) in the SAME Cloud project as the OAuth client. This
   is separate from registering the client and from the consent screen, and
   it is the step a fresh project silently lacks: without it every Drive
   call — including the `about.get` the connect flow uses to label the
   account — answers `403 accessNotConfigured`. The lib now reports that
   reason (with Google's enable-it link) instead of a bare "HTTP 403", and
   connect fails fast on it rather than storing a credential that can never
   publish (`google-errors.ts`, `google-auth.ts`'s `fetchEmail`).
2. **OAuth consent screen** (External), scopes:
   `https://www.googleapis.com/auth/drive.file` only.
   `drive.file` is Google's *non-sensitive* scope tier — confirmed against a
   real account (`docs/gdrive-publish-plan.md` Appendix B, spike **P13**:
   Cloud Console's Data Access page lists it under "Your non-sensitive
   scopes," with "Your sensitive scopes: No rows to display"). No restricted-
   scope verification, no CASA third-party security assessment, no annual
   re-audit — a `Testing`-mode app is enough for development.
   **Register (and request) `drive.file` alone — not `openid`/`email` with
   it.** The account email that labels a stored connection comes from
   Drive's own `about.get`, which needs no sign-in scope. Requesting more
   than one scope makes Google's consent screen granular: it lists the Drive
   permission as a checkbox the user can leave unticked and still finish
   sign-in, after which the token lacks `drive.file` and every Drive call
   answers `403` while the connection looks fine (the 0.10.5 bring-up).
   One scope leaves nothing to untick. The connect flow still reads the
   token response's `scope` and refuses a token without `drive.file`
   (`google-auth.ts`, `DRIVE_PERMISSION_NOT_GRANTED_MESSAGE`) as a backstop.
3. **OAuth client type: Desktop app** — not "Web application." Only a
   Desktop-app client accepts an un-registered ephemeral loopback
   `redirect_uri` (`http://127.0.0.1:<OS-assigned port>`); a Web-application
   client requires every redirect URI to be pre-registered, which an
   OS-assigned port can never satisfy. This is also *why* the client secret
   is required here in the first place — Google's Desktop-app client type
   does not support a secret-less (`none`) token-auth method.
4. **Homepage + privacy policy URLs**, required before the consent screen
   can be submitted for production review (D11 of the plan) — the existing
   project README as homepage, and a new `PRIVACY.md` (published via GitHub
   Pages) as the privacy policy, covering the `drive.file` scope, local-only
   token storage, and the absence of any Gutterpress server in the data path.
5. **Publish the consent screen to *In production*** once basic (brand)
   verification clears the "unverified app" interstitial. Until then,
   `Testing` mode works for development with two caveats to plan around:
   refresh tokens expire after ~7 days, and only ~100 test users are
   allowed. Verify current Google policy details at implementation time —
   they shift.

## Consequences

- `gdrive` connect works exactly like every other interactive-OAuth
  precedent in this codebase (`GitHubAuthProvider`) from the app's
  perspective: one `connect(callbacks)` call, a friendly failure/cancel/
  timeout story, no pasted secret ever touching the user's clipboard or the
  manifest.
- The GitHub-scoped "no client secret" rule remains intact and is now
  explicitly bounded to GitHub, rather than silently contradicted.
- Registering (or re-registering) the production OAuth client is a
  release-blocking prerequisite, tracked by this ADR and by
  `docs/gdrive-publish-plan.md`'s Phase 0 — not something an implementer can
  quietly work around by inventing a placeholder id/secret.
