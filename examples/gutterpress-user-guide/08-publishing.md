# Publishing {#ch-publishing}

@section .lede

When your book is built, Gutterpress can send it to the places readers buy it — itch.io, DriveThruRPG, Amazon KDP, a website on Azure, your Shopify store, or a folder in your own Google Drive — without leaving the app.

@end-section

## Two Kinds of Publishing

**Direct upload** — for platforms with an upload API (itch.io, Azure Static
Web Apps, Shopify, Google Drive), Gutterpress pushes the file for you and
gives you the link.

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

## Publishing to Google Drive

Google Drive works a little differently from the other providers, because
there's no API key to create or paste.

1. Open **Project settings → Publish** and click **Connect Google Drive**.
   Your browser opens to Google's own sign-in page — choose your account and
   click **Allow**. That's it: nothing to copy, nothing to type back into
   Gutterpress.
2. Once connected, pick a **Folder** from the dropdown, or choose **New
   folder…** and give it a name. Gutterpress only ever sees folders it
   created itself — it can't browse the rest of your Drive.
3. Press **Publish**. Your PDF (or the zipped website export) lands in that
   folder.

Publishing again **updates the same file** instead of creating a duplicate,
so a link you already emailed to an editor or sent to a printer keeps
pointing at the newest version — you never have to resend it.

Once the folder exists, you can move it anywhere you like in your own Drive —
into an existing project folder, a shared folder, wherever makes sense to
you — and publishing keeps working, because Gutterpress remembers the
folder, not its location.

Gutterpress never changes who can see your files. A freshly published file is
only visible to you, exactly like anything else you add to Drive yourself.
When you're ready to share it, open the file (or its folder) in Drive and use
Drive's own **Share** button.

```yaml
# manifest.yaml — the non-secret half lives with your project
publish:
  gdrive:
    folder: My Books
```

```bash
gutterpress publish --provider gdrive --connect     # opens your browser once
gutterpress publish --provider gdrive               # uploads (or updates) the PDF
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
--target dtrpg` before uploading — it checks bleed, ink density and more.

@end-section

## Publishing From CI

The `publish` command is fully headless. Set the provider's environment
variable instead of connecting interactively:

| Provider | Environment variable |
|----------|---------------------|
| itch.io | `BUTLER_API_KEY` |
| Azure Static Web Apps | `SWA_CLI_DEPLOYMENT_TOKEN` |
| Shopify | `SHOPIFY_ADMIN_TOKEN` |
| Google Drive | `GDRIVE_REFRESH_TOKEN` (from an interactive connect on a workstation) |

```bash
gutterpress publish --provider itch --json   # machine-readable result, exit 1 on failure
```

## Where Keys Are Stored

API keys never live in your project folder, so they can't end up in Git or a
shared ZIP. The desktop app keeps them in your operating system's secure
storage; the CLI keeps them in a private file in your user configuration
folder. Disconnecting a provider deletes the stored key.

Google Drive is no different under the hood — there's no key to paste, but
the connection is stored just as securely, and **Disconnect** removes it just
as completely.
