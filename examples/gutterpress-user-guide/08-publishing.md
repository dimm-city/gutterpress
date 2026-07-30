# Publishing {#ch-publishing}

@section .lede

When your book is built, Gutterpress can send it to the places readers buy it — itch.io, DriveThruRPG, Amazon KDP, a website on Azure, or your Shopify store — without leaving the app.

@end-section

## Two Kinds of Publishing

**Direct upload** — for platforms with an upload API (itch.io, Azure Static
Web Apps, Shopify), Gutterpress pushes the file for you and gives you the link.

**Guided publishing** — DriveThruRPG and Amazon KDP don't offer upload APIs,
so Gutterpress does everything it can: it checks your book, prepares an upload
package (your PDF plus a `LISTING.md` sheet with your title, authors and
notes), and opens the platform's upload page with a step-by-step checklist.

## Setting Up a Provider

1. Open **Project settings → Publish** in the desktop app.
2. Fill in the provider's settings (for itch.io that's your project as
   `user/game`; for Shopify your store domain). These are saved in
   `manifest.yaml` — safe to commit, nothing secret.
3. For direct-upload providers, click **Create an API key**, copy the key from
   the platform, paste it and press **Connect**. The key is verified with the
   platform and stored securely on your computer — never in the project
   folder.

```yaml
# manifest.yaml — the non-secret half lives with your project
publish:
  itch:
    target: your-user/your-book
```

## Publishing

Build first (**Export PDF**, or `gutterpress build`), then press **Publish** on
the provider's card. **Check readiness** runs the same checks without
publishing anything.

From the terminal (or CI):

```bash
gutterpress build
gutterpress publish --provider itch
```

@section .callout-tip

**Tip:** DriveThruRPG has strict print requirements. Run `gutterpress validate
--profile dtrpg` before uploading — it checks bleed, ink density and more.

@end-section

## Publishing From CI

The `publish` command is fully headless. Set the provider's environment
variable instead of connecting interactively:

| Provider | Environment variable |
|----------|---------------------|
| itch.io | `BUTLER_API_KEY` |
| Azure Static Web Apps | `SWA_CLI_DEPLOYMENT_TOKEN` |
| Shopify | `SHOPIFY_ADMIN_TOKEN` |

```bash
gutterpress publish --provider itch --json   # machine-readable result, exit 1 on failure
```

## Where Keys Are Stored

API keys never live in your project folder, so they can't end up in Git or a
shared ZIP. The desktop app keeps them in your operating system's secure
storage; the CLI keeps them in a private file in your user configuration
folder. Disconnecting a provider deletes the stored key.
