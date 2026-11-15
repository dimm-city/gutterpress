# Publishing {#ch-publishing}

@section .lede

When your book is built, Gutterpress can send it to the places readers buy it --- itch.io, DriveThruRPG, Amazon KDP, a website on Azure, your Shopify store, or a folder in your own Google Drive --- without leaving the app.

@end-section

## Two Kinds of Publishing

**Direct upload** --- for platforms with an upload API (itch.io, Azure Static
Web Apps, Shopify, Google Drive), Gutterpress pushes the file for you and
gives you the link.

**Guided publishing** --- DriveThruRPG and Amazon KDP don't offer upload APIs,
so Gutterpress does everything it can: it checks your book, prepares an upload
package (your PDF plus a `LISTING.md` sheet with your title, authors and
notes), and opens the platform's upload page with a step-by-step checklist.

## Publishing From the App

Press **Publish** in the toolbar. Publishing has three steps:

1. **Targets** --- where this book goes. Each target says which file it gets:
   DriveThruRPG (print) gets the print-ready PDF/X, itch.io gets the PDF, and
   a target with a choice (a folder, Google Drive, KDP, Shopify) has a
   **File** menu. Add a target from **Add a target**, or remove one with
   **Remove from book**. The book's targets are saved in `manifest.yaml`, so
   everyone who has the book sees the same ones; untick one to skip it this
   time without removing it.
2. **Set up** --- each target's settings (for itch.io that's your project as
   `user/game`; for Shopify your store domain), saved in `manifest.yaml` ---
   safe to commit, nothing secret --- and its account. For direct-upload
   targets, click **Create a key on ...**, copy the key from the platform,
   paste it and save it. The key is checked with the platform and kept on
   your computer --- never in the book's folder.
3. **Publish** --- Gutterpress lays your book out once, makes each file the
   targets need, checks each one against the rules of each target it goes
   to, and sends it. **Check only** does everything but send.

**Check the files before sending** is on unless you turn it off. A target
whose file breaks its rules is **Held back** --- the others still go --- and
**Send anyway** sends it once you have decided it's fine. If sending fails,
the step says why in plain words, with **Show details** and **Try again**.

```yaml
# manifest.yaml -- the book's targets, and their non-secret settings
publish:
  drivethrurpg-print:      # nothing to set: just its name
  itch:
    target: your-user/your-book
```

A new book starts with its template's targets, or its preset's (a `dtrpg`
book starts with DriveThruRPG print). Change them any time in **Publish**
&rarr; **Targets**.

## Publishing to Google Drive

Google Drive works a little differently from the other targets, because
there's no API key to create or paste.

1. Press **Publish** in the toolbar, add **Google Drive** on the **Targets**
   step, and on **Set up** click **Connect Google Drive**. Your
   browser opens to Google's own sign-in page --- choose your account and click
   **Allow**. That's it: nothing to copy, nothing to type back into
   Gutterpress.
2. Once connected, pick a **Folder** from the dropdown, or choose **New
   folder...** and give it a name. Gutterpress only ever sees folders it
   created itself --- it can't browse the rest of your Drive.
3. Choose **what to publish** --- the PDF, the PDF/X for print, or a zipped
   website --- from Google Drive's **File** menu on the **Targets** step. (It
   is saved as `publish.gdrive.format`: `pdf`, `pdfx` or `html`.)
4. Press **Publish**. The file you chose lands in that folder.

Publishing again **updates the same file** instead of creating a duplicate,
so a link you already emailed to an editor or sent to a printer keeps
pointing at the newest version --- you never have to resend it.

Once the folder exists, you can move it anywhere you like in your own Drive ---
into an existing project folder, a shared folder, wherever makes sense to
you --- and publishing keeps working, because Gutterpress remembers the
folder, not its location.

Gutterpress never changes who can see your files. A freshly published file is
only visible to you, exactly like anything else you add to Drive yourself.
When you're ready to share it, open the file (or its folder) in Drive and use
Drive's own **Share** button.

```yaml
# manifest.yaml -- the non-secret half lives with your project
publish:
  gdrive:
    folder: My Books
    format: pdf   # or pdfx, or html for the zipped website export
```

```bash
gutterpress publish --connect gdrive     # opens your browser once
gutterpress publish gdrive               # makes, checks and uploads (or updates) the file
```

## Publishing From the Terminal

`gutterpress publish` does what the app's **Publish** does: it makes the
files, checks them and sends them, to every target under `publish:`, or only
the ones you name. There is nothing to build first.

```bash
gutterpress publish                  # every target in manifest.yaml
gutterpress publish itch gdrive      # just these
gutterpress publish --dry-run        # make and check the files; send nothing
gutterpress publish drivethrurpg-print --send-anyway   # send a held-back target
```

Accounts you connected in the app work here too, and the other way round.

@section .callout-tip

**Tip:** DriveThruRPG has strict print requirements, and publishing to
DriveThruRPG (print) checks the PDF/X against them for you. To check a file
yourself, run `gutterpress validate
--pdf dist/my-book/my-book-pdfx.pdf --target dtrpg` before uploading --- it checks
bleed, ink density and more. Validate the `-pdfx.pdf` file from a `--format pdfx`
build: the plain PDF is RGB, so it fails the colour and PDF/X checks by design. Without `--pdf`, there's no built PDF to inspect,
so those checks silently pass without measuring anything.

Books using the `dtrpg` preset are already set up for DriveThruRPG's print
rules:

- **The last page is left blank.** DriveThruRPG prints its own information on
  a book's final page, so Gutterpress pads the book to a multiple of 4 pages
  and makes sure the last one is empty. The page count the build reports is
  the number to enter in DriveThruRPG's cover Template Generator.
- **Black text prints in black ink only.** In a `--format pdfx` build, black
  and near-black text at 24pt and under goes on the black plate alone, as
  DriveThruRPG's spec requires. Coloured text is printed as designed. For grey
  text on the black plate too, at its own tone, set `pdfx: { blackText:
  k-only-neutral }`.
- **Soft shadows and translucent art.** PDF/X-1a has no transparency, so a page
  that uses a soft `rgba()` shadow, a PNG with an alpha channel or `opacity` is
  flattened to a picture in a `--format pdfx` build, and by default that page
  loses its live text. To keep the text, add `pdfx: { transparency:
  preserve-text }` to `manifest.yaml`: only the artwork becomes a 300 DPI
  picture and the text stays live on top. Rules and backgrounds on those pages
  become part of the picture, text always sits above the artwork (text another
  element covers shows through), and a page whose text is itself translucent
  or blended keeps the default. The build lists the pages it flattened, and
  why. A page whose look depends on something painted over its text can be
  flattened whole anyway: list its number in `pdfx: { flattenPages: [4] }`.
  For sharper artwork, set `pdfx: { rasterDpi: 600 }` (larger files); a
  lower value such as 200 makes the file smaller and the artwork softer.

@end-section

## Sharing a Folder Between Formats

`gutterpress build --out <dir>` writes into a plain folder instead of the
project's own `dist/`, which is how you build a static site and its
downloadable PDF into one place:

```bash
gutterpress build --format html --out ./_site
gutterpress build --format pdf --out ./_site
```

Each command only delivers what its own format produces, so the second
command never disturbs the first's output: `--format html` writes
`book.html` (with the viewer), `index.html`, and the referenced assets;
`--format pdf`/`pdfx` adds only its own PDF. `./_site` ends up with both ---
the paginating `book.html` a browser opens, and a PDF a reader can download ---
with neither build overwriting the other's files.

## Publishing From CI

The `publish` command is fully headless. Set the target's environment
variable instead of connecting interactively:

| Target | Environment variable |
|----------|---------------------|
| itch.io | `BUTLER_API_KEY` |
| Azure Static Web Apps | `SWA_CLI_DEPLOYMENT_TOKEN` |
| Shopify | `SHOPIFY_ADMIN_TOKEN` |
| Google Drive | `GDRIVE_REFRESH_TOKEN` (from an interactive connect on a workstation) |

```bash
gutterpress publish itch --json   # machine-readable result, exit 1 on failure
```

## Where Keys Are Stored

API keys never live in your project folder, so they can't end up in Git or a
shared ZIP. The app and the terminal keep them in one private file in your
user configuration folder (`~/.config/gutterpress`, or
`%APPDATA%\gutterpress` on Windows) that only your user account can read, so
a key saved in one works in the other. Disconnecting deletes the stored key.

Google Drive is no different under the hood --- there's no key to paste, but
the connection is stored the same way, and **Disconnect** removes it just
as completely.

## Publishing Plugins (Experimental) {#publishing-plugins}

@section .callout-warning

**Experimental:** publishing plugins are new and may change, or be removed,
in a future release. For anything you rely on, keep using the destinations
above.

@end-section

A **publishing plugin** adds a place to publish that Gutterpress doesn't
offer itself: another website host, another print-on-demand service, or a
workflow of your own. You add one exactly like any other extension (see
[Chapter 5](#ch-plugins)), using the package name its author gives you:

```bash
gutterpress ext add <package-name>
```

In the desktop app, add it from **Book setup** &rarr; **Extensions**, where its
row shows a **Publish destination** badge. From then on it appears under
**Add a target** in **Publish** with an **Experimental** badge, and on the
command line under its package name:

```bash
gutterpress publish --list                      # plugins show as "experimental"
gutterpress publish <package-name>              # makes, checks and sends its file
```

**Its settings** live in `manifest.yaml`, under `publish:` and the plugin's
package name. There is no settings form for plugins yet, so add them by hand,
as the plugin's own instructions describe:

```yaml
publish:
  gutterpress-publish-example:
    site: my-book   # whatever the plugin asks for
    format: html    # pdf (the default), pdfx or html: which file it receives
```

Its **File** menu on the **Targets** step sets `format` for you. A package name
that starts with `@` must be in quotes: `"@studio/publish-site":`.

**Keys and passwords never go in `manifest.yaml`** --- it travels with your book
and into Git. A publishing plugin handles its own sign-in, usually an
environment variable or a login step of its own; its instructions say which.
A plugin that reads its key from an environment variable may only work from
the command line, because the desktop app doesn't see your terminal's
environment.

A plugin is code you choose to run, with the same access to your computer as
any extension, so add only plugins you trust. If one fails, Gutterpress shows
its message, prefixed with the plugin's name, and the files it made stay
where they are.
