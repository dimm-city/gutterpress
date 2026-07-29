# Publishing (#35)

Gutterpress can push a finished book to distribution platforms — from the CLI
(`gutterpress publish`, CI-safe) or from the desktop app's Project settings →
Publish section.

## Provider matrix

| Provider | id | Type | Artifact | How it works |
|---|---|---|---|---|
| itch.io | `itch` | **API** | PDF | Real upload via [butler](https://itch.io/docs/butler/), itch.io's official CLI. Auto-downloaded on first publish. |
| DriveThruRPG | `drivethrurpg` | **Guided** | PDF | DTRPG has no publisher upload API. Gutterpress stages a validated package and opens the publisher hub with a checklist. |
| Amazon KDP | `kdp` | **Guided** | PDF | Amazon has no KDP API (automation violates its ToS). Gutterpress stages a KDP-ready package and opens kdp.amazon.com with a checklist. |
| Azure Static Web Apps | `azure-swa` | **API** | HTML | Deploys the static-site export via the [SWA CLI](https://learn.microsoft.com/azure/static-web-apps/static-web-apps-cli-deploy) (`swa deploy`). Requires the SWA CLI installed (`npm i -g @azure/static-web-apps-cli`). |
| Shopify | `shopify` | **API** (partial) | PDF | Creates/updates the product via the Admin GraphQL API. File attachment is a follow-up step in the Shopify admin (digital delivery has no public API). |

"Guided" providers still do real work: they validate the artifact, stage an
upload package (`<output dir>/publish/<provider>/` with the PDF and a
`LISTING.md` metadata sheet), and give the author the exact upload URL and
steps. If a platform later ships an API the provider upgrades in place.

## CLI

```bash
# What can I publish to, and what's connected?
gutterpress publish --list

# Store an API key. The PASTED key is verified with the platform before it's
# saved (env vars can't shadow it, and a rejected paste leaves any previously
# working key untouched).
gutterpress publish --provider itch --connect --token <key>
echo "$KEY" | gutterpress publish --provider shopify --connect   # or via stdin

# Publish (uses the manifest's output location by default)
gutterpress build && gutterpress publish --provider itch

# Preflight only / CI
gutterpress publish --provider itch --dry-run --json

# Forget a stored key
gutterpress publish --provider itch --disconnect
```

Exit codes: `0` success, `1` publish/auth failure, `2` usage error — with
`--json` emitting the structured result for CI.

### Headless / CI credentials

Environment variables override the stored credential, so CI never needs the
credential file:

| Provider | Variable |
|---|---|
| itch.io | `BUTLER_API_KEY` |
| Azure SWA | `SWA_CLI_DEPLOYMENT_TOKEN` |
| Shopify | `SHOPIFY_ADMIN_TOKEN` |

## Configuration

Non-secret settings live in the manifest under `publish:` (see
`manifest.schema.json`); the desktop app's Publish section edits the same
fields:

```yaml
publish:
  itch:
    target: your-user/your-book   # butler push target
    channel: pdf                  # default: pdf
  drivethrurpg:
    productUrl: https://www.drivethrurpg.com/product/…   # optional, for updates
  azure-swa:
    env: production               # default: production
  shopify:
    shop: my-store.myshopify.com  # must be the myshopify.com domain — the token is only ever sent there
    productId: gid://shopify/Product/…   # optional, update instead of create
    apiVersion: "2026-04"                # optional
```

Sections are keyed by the provider id — the same spelling as
`--provider <id>`. Each provider declares its editable fields
(`PublishProviderInfo.configFields`), which is what the desktop app's
settings form renders — adding a provider needs no UI changes.

**Secrets never live in the project.** API keys are stored:

- **CLI** — `credentials.json` (`0600`) under the Gutterpress user config dir
  (`$GUTTERPRESS_CONFIG_DIR` → `%APPDATA%/gutterpress` → `~/.config/gutterpress`), the
  same `FileTokenStore` the Git remote features use.
- **Desktop app** — Electron `safeStorage` (OS keychain: DPAPI / Keychain /
  libsecret), the same store as GitHub sync credentials.

Token values are never logged, never echoed in errors or host responses, and
never passed on a child-process command line (butler and the SWA CLI receive
them via environment variables).

## Architecture

Everything lives in the lib (`packages/cli/src/lib/publish/`) and is consumed
by two thin front-ends, mirroring the remote-auth subsystem (ADR 0006):

```
lib/publish/
  types.ts           PublishProvider contract + PublishDeps (injected seams)
  registry.ts        listPublishProviders() / publishProviderFor(id)
  run-publish.ts     runPublish(): preflight → authenticate → upload
  connect.ts         connectPublishProvider(): verify the pasted key, THEN store
  manifest-publish.ts readPublishSettings/setPublishProviderConfig (yaml round-trip)
  command-runner.ts  injectable child-process seam (secrets via env only)
  butler.ts          butler acquisition (BUTLER_PATH → PATH → cache → download)
  providers/         itch, drivethrurpg, kdp, azure-swa, shopify
```

`PublishProvider` (issue #35's interface, adapted):

```ts
interface PublishProvider {
  info: PublishProviderInfo;                    // id, kind, format, credential host
  authenticate(req): Promise<PublishAuthStatus>;
  preflight(req): Promise<PreflightIssue[]>;
  upload(req): Promise<PublishOutcome>;         // "published" | "guided"
  listProducts?(req): Promise<PublishProduct[]>;      // API providers
  updateListing?(req, id, metadata): Promise<PublishProduct>;
}
```

Every side effect enters through `PublishDeps` — `tokenStore` (the host's
credential store), `fetch`, `runCommand`, `env`, `configDir`, `onProgress` —
which is what makes providers unit-testable (`publish.test.ts` runs the whole
pipeline with fakes) and keeps the lib free of host concerns: the lib never
touches the OS keychain (CLAUDE.md §7-style host injection).

The desktop app reaches the same code through `/api/publish/*` SvelteKit server
routes (`list`, `connect`, `disconnect`, `set-config`, `run`) that share the
remote-hooks host bridge; the renderer stays PWA-clean (§8) and only ever sees
redacted credential status.
