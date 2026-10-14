# Publishing (#35)

Gutterpress can push a finished book to distribution platforms — from the CLI
(`gutterpress publish`, CI-safe) or by pressing **Publish** in the desktop
app's toolbar.

## Provider matrix

| Provider | id | Type | Artifact | How it works |
|---|---|---|---|---|
| itch.io | `itch` | **API** | PDF | Real upload via [butler](https://itch.io/docs/butler/), itch.io's official CLI. Auto-downloaded on first publish. |
| DriveThruRPG | `drivethrurpg` | **Guided** | PDF | DTRPG has no publisher upload API. Gutterpress stages a validated package and opens the publisher hub with a checklist. |
| Amazon KDP | `kdp` | **Guided** | PDF | Amazon has no KDP API (automation violates its ToS). Gutterpress stages a KDP-ready package and opens kdp.amazon.com with a checklist. |
| Azure Static Web Apps | `azure-swa` | **API** | HTML | Deploys the static-site export via the [SWA CLI](https://learn.microsoft.com/azure/static-web-apps/static-web-apps-cli-deploy) (`swa deploy`). Requires the SWA CLI installed (`npm i -g @azure/static-web-apps-cli`). |
| Shopify | `shopify` | **API** (partial) | PDF | Creates/updates the product via the Admin GraphQL API. File attachment is a follow-up step in the Shopify admin (digital delivery has no public API). |
| Google Drive | `gdrive` | **API** | PDF or HTML (zipped) | Uploads to a Drive folder the app created (`drive.file` scope) via a plain-`fetch` resumable upload. Connects with browser OAuth, not a pasted key (#221, [ADR 0011](adr/0011-google-oauth-client-credentials.md)). Re-publishing updates the same file in place, so a shared link stays valid. |

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

# Google Drive has no key to paste — --connect opens the system browser for a
# Google OAuth consent instead, and stores the refresh token it gets back.
gutterpress publish --provider gdrive --connect

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
| Google Drive | `GDRIVE_REFRESH_TOKEN` (a refresh token minted by an interactive `--connect` on a workstation) |

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
  gdrive:
    folder: My Books              # display name; created at My Drive root if missing (default: "Gutterpress")
    folderId: 1AbC…               # stable id, takes precedence over `folder` — picker-set, or hand-recorded from the CLI's post-publish tip
    format: pdf                   # pdf (default) | html — the zipped website export
```

Sections are keyed by the provider id — the same spelling as
`--provider <id>`. Each provider declares its editable fields
(`PublishProviderInfo.configFields`), which is what the desktop app's
settings form renders — adding a provider needs no UI changes.

**Secrets never live in the project.** API keys (and Google Drive's refresh
token — the same store, `kind: "google-oauth"`) are stored:

- **CLI** — `credentials.json` (`0600`) under the Gutterpress user config dir
  (`$GUTTERPRESS_CONFIG_DIR` → `%APPDATA%/gutterpress` → `~/.config/gutterpress`), the
  same `FileTokenStore` the Git remote features use.
- **Desktop app** — Electron `safeStorage` (OS keychain: DPAPI / Keychain /
  libsecret), the same store as GitHub sync credentials.

Token values are never logged, never echoed in errors or host responses, and
never passed on a child-process command line (butler and the SWA CLI receive
them via environment variables; Google Drive's client makes its own `fetch`
calls, no child process at all).

## PDF/X and transparency {#pdfx-transparency}

`--format pdfx` (PDF/X-1a, PDF/X-3) is built on PDF 1.3, which cannot represent
transparency. Soft or `rgba()` box-shadows, alpha-channel PNGs, `opacity`, and
blend modes all need it. Ghostscript's own answer is to flatten the whole page
into one bitmap, text included, so the page loses its fonts and `pdftotext`
finds nothing. The build warns when a book does this.

`pdfx.transparency` in `manifest.yaml` chooses what happens (the same default in
every preset):

```yaml
pdfx:
  transparency: flatten-page   # default
  # transparency: preserve-text
```

- **`flatten-page`** (default): the page is left to Ghostscript, which flattens
  the whole page. What you see is what the page looked like, but its text is
  gone. Occlusion is preserved: an element painted over text still hides it.
- **`preserve-text`** (opt-in): Gutterpress flattens the artwork itself and keeps
  the text live, on the pages where that is faithful.
  1. Pages that use transparency are found. Every other page is left as it is,
     vector text and shapes.
  2. On each such page the **artwork** (everything except the glyphs) is
     composited into one opaque 300 DPI image, and the **text** is kept as live
     vector text drawn on top of it. Page boxes (Trim, Bleed, Crop), links and
     the document's metadata stay as they were.
  3. The usual PDF/X steps run on the result, so `pdfx.blackText: k-only` still
     reaches the text on these pages.

  The build lists the pages it split. Alpha-channel images are still flagged by
  the `dtrpg` preset (`validate.assets.allowAlpha: false`); a book that opts in
  and uses them sets `allowAlpha: true` itself.

Under `preserve-text`, to check the result:

```bash
pdftotext -f 3 -l 3 dist/my-book/my-book-pdfx.pdf -   # the page's words
pdffonts dist/my-book/my-book-pdfx.pdf                 # every font embedded
```

`examples/with-print-effects/` is a small book with one effect per page.

**Fallback.** Four kinds of page cannot be split:

- A page whose text is itself drawn with transparency: `opacity` or
  `mix-blend-mode` on a text block, translucent glyph colour, a soft mask over
  the text, or a translucent or knockout group around it. Drawing that text
  opaque on top of a picture changes how it looks (faint text prints solid,
  multiplied text changes colour).
- A page whose text uses a Type 3 font. Chromium emits one for glyphs it can
  only draw as paths: the synthetic bold of `font-weight: 700` on a webfont
  that has only a regular face, and any text with `-webkit-text-stroke`, even
  in a real bold face (`pdffonts` lists it as `Type 3`). The text layer keeps
  no vector paths, so that text would print nothing. For a synthetic bold, use
  a face with that weight or set the font's own weight; for a stroke, remove it
  or accept the fallback.
- A page whose text is painted with a pattern or used as a clip: SVG
  `<text fill="url(#…)">`, a gradient text fill, `background-clip: text`. The
  picture loses the glyphs and the text layer loses their paint, so that text
  would vanish.
- A page with a `repeating-linear-gradient()`, `repeating-radial-gradient()`,
  `repeating-conic-gradient()` or `conic-gradient()`. Chromium prints these as
  a PostScript-function shading, which the artwork picture renders with
  irregular stripes (#386). The check is conservative: it also sends a page to
  the fallback when Ghostscript would have painted that gradient correctly
  (a `conic-gradient()` did on Ghostscript 10.06), so the page loses its live
  text either way.

Such pages are not split and go to Ghostscript exactly as in `flatten-page`;
the build names them, each with the first cause it found. A page can have more
than one, so fixing the named cause can reveal another.

Known limits of the pages that are split:

- Rules, backgrounds and shapes are part of the 300 DPI picture, not vectors,
  so fine rules lose their vector sharpness.
- File size depends on the book's content and on rasterization: each split
  page carries a 300 DPI full-page picture, and a whole-page fallback carries
  Ghostscript's own page image. Measured on the 228-page Dimm City Field Guide
  against `flatten-page`, the same source came out smaller with `preserve-text`
  (one styling 1126 MB to 235 MB, another 140 MB to 45 MB), mostly because of
  the 300 DPI picture resolution; keeping the text live is the benefit, not the
  size. Compare PDF/X against PDF/X: an RGB `--format pdf` build is not a
  baseline for a CMYK PDF/X file. One blend mode
  anywhere in a book can make Chromium wrap most of its pages in transparency
  groups, so many more pages are split than the effect's own pages.
- Text is always the top layer. If another element is painted over text, the
  text still shows through, and a translucent tint over text no longer tints
  it. Do not use `preserve-text` for a book whose look depends on shapes or
  tints painted over text.
- Keep CSS `filter` off text-bearing elements: Chromium rasterizes those into
  the PDF itself, before this step.

The build lists each fallback page with its cause and the change that fixes it.
Check a `preserve-text` build visually as well as with `pdftotext`: text that
extracts can still be painted wrong.

**For plugin authors.** A plugin cannot choose this; the book's author opts in
with `pdfx.transparency`. If your styles rely on it, say so in your docs, keep
glyph colours opaque and `opacity`/`mix-blend-mode` off text blocks, and don't
paint over text.

## Architecture

Everything lives in the lib (`packages/cli/src/lib/publish/`) and is consumed
by two thin front-ends, mirroring the remote-auth subsystem (CLAUDE.md §7):

```
lib/publish/
  types.ts           PublishProvider contract + PublishDeps (injected seams)
  registry.ts        listPublishProviders() / publishProviderFor(id)
  run-publish.ts     runPublish(): preflight → authenticate → upload
  connect.ts         connectPublishProvider(): verify the pasted key, THEN store
  manifest-publish.ts readPublishSettings/setPublishProviderConfig (yaml round-trip)
  command-runner.ts  injectable child-process seam (secrets via env only)
  butler.ts          butler acquisition (BUTLER_PATH → PATH → cache → download)
  google-auth.ts     GoogleAuthProvider: loopback-redirect + PKCE OAuth connect, client id/secret resolution
  google-drive.ts    plain-fetch Drive REST client: refresh, about.get, list/create folder, resumable upload
  connect-google.ts  connectGoogleDrive(): runs the OAuth flow, then stores the refresh token like any credential
  providers/         itch, drivethrurpg, kdp, azure-swa, shopify, gdrive
```

`PublishProvider` (issue #35's interface, adapted; `listDestinations`/
`createDestination` added for #221 so a provider-neutral folder/place picker
works for any provider that has one — currently just Google Drive):

```ts
interface PublishProvider {
  info: PublishProviderInfo;                    // id, kind, format, credential host
  authenticate(req): Promise<PublishAuthStatus>;
  preflight(req): Promise<PreflightIssue[]>;
  upload(req): Promise<PublishOutcome>;         // "published" | "guided"
  listProducts?(req): Promise<PublishProduct[]>;      // API providers
  updateListing?(req, id, metadata): Promise<PublishProduct>;
  listDestinations?(req): Promise<PublishProduct[]>;  // gdrive: app-visible Drive folders
  createDestination?(req, name): Promise<PublishProduct>;  // gdrive: create a folder
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
