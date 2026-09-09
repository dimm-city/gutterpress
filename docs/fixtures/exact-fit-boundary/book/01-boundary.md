# Exact Fit {#ch-exact-fit}

@section .lede

Gutterpress uses plain CSS for all styling. Control colors, fonts, and layout through CSS custom properties. A book's **look** is an extension — a folder of stylesheets listed in the manifest — and your own stylesheets always load on top of it.

@end-section

## Built-in Looks

Gutterpress ships three built-in looks, embedded in the CLI binary and library:

| Look id | Description |
|----------|-------------|
| `clean-book` | A calm, classic book look: serif body, generous margins, restrained accents. |
| `zine` | High-contrast, punchy sans-serif look for short photocopier-friendly zines. |
| `technical-doc` | Clean sans-serif manual look with clear hierarchy, code styling, and tidy tables. |

A look (a *theme*, in older docs and in `gutterpress new --kind theme`) is an
**extension**: a folder holding a stylesheet — `theme.css` — plus a small
metadata file, listed in the manifest's `extensions:` list alongside any
plugins (Chapter 5 covers that list in full). Adding a
built-in look **copies** it into your project at `extensions/<id>/`, so the
book owns editable files rather than a hidden dependency on whichever
Gutterpress version happens to be installed, and adds `./extensions/<id>` to
the list:

```sh
gutterpress ext add clean-book ./my-book --look   # copy the built-in look in and list it
gutterpress ext list ./my-book                    # every extension, in load (= cascade) order
```

`gutterpress new` does exactly this with its template's starter look, so even
a freshly scaffolded project has a real, editable look from the start. The
resulting manifest reads:

```yaml
extensions:
  - ./extensions/clean-book   # The look: extensions/clean-book/theme.css
styles:
  - styles/book.css           # Your own overrides, loaded after every extension
```

`styles/book.css` starts as a comment block explaining this split. It is the
project's own layer: everything under `styles:` loads after every extension,
so a rule you write there overrides the look at equal specificity. Edit
`extensions/clean-book/theme.css` directly when you want to change the look
itself — it is your copy.

### Adding and switching looks

Any of these adds a look to the list:

```sh
gutterpress ext add zine ./my-book --look                     # another built-in (copied to extensions/zine/)
gutterpress ext add ./house-style ./my-book                   # a folder you already have — referenced in place, never copied
gutterpress ext add ./parchment.zip ./my-book                 # a packaged look → extensions/parchment/
gutterpress ext add ./parchment.css ./my-book                 # a single stylesheet → extensions/parchment/
gutterpress ext add https://example.com/looks/cool/ ./my-book # theme.css (+ optional theme.json) fetched → extensions/cool/
```

Zip, CSS and URL imports are checked before they land: every declared sheet
must exist and parse, and print-safety findings (a remote `url()`, say) are
reported as warnings. A look with fonts or images of its own travels as a
folder or a `.zip`; a URL import fetches only the stylesheet and metadata.

Two looks listed at once both load, and the later one wins ties — so
switching is adding the new look, then disabling or removing the old one:

```sh
gutterpress ext add zine ./my-book --look
gutterpress ext disable ./extensions/clean-book ./my-book   # keep it around, stop loading it
gutterpress ext remove ./extensions/clean-book ./my-book    # or drop the entry (the folder stays yours)
```

The desktop app's **Project settings → Look** view is the same list: add a
look, drag entries into a new order, switch one off, or remove it. There is no
separate apply or revert step — a look is just an entry, and the snapshot
history versions the manifest change like any other edit.

Bundled looks define the full token set (see below) so you only need to
override the tokens you want to change. This guide's own project (the one
you're reading) does not use a bundled look — it declares its own
`styles/guide.css` directly under `styles:` in `manifest.yaml`.

## After the boundary

This paragraph exists so the boundary page has a successor.
