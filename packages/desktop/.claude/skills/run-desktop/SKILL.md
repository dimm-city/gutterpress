---
name: run-desktop
description: Build, run, drive and screenshot the Gutterpress desktop app (Electron + SvelteKit) headless on Linux. Use when asked to run, start, launch, screenshot, click through, or visually review the desktop UI, or to confirm a desktop change works in the real app.
---

# Run the Gutterpress desktop app

Paths are relative to `packages/desktop/`. The app is driven by `driver.mjs`
(Playwright `_electron` under xvfb): it launches the real Electron app, opens a
book, then runs one command per line from stdin and writes PNGs.

Plain `vite dev` in a browser does NOT work: ~100 `/api/**` routes need host
hooks that only Electron main registers, so they 503 and no book can open.
Use the Electron path below.

## Prerequisites
```bash
bun install                                  # repo root; does not fetch the Electron binary
(cd node_modules/electron && node install.js)  # downloads dist/electron (~1 min, needs network)
which xvfb-run                               # already present in this container
```

## Build (from packages/desktop)
```bash
bun run --cwd ../cli build:library   # lib the app imports
npx vite build                       # SPA -> build/
npx electron-vite build              # main+preload -> out/
```
Rebuild after any change under `src/` or `electron/`; the driver runs the built output.

## Run (agent path)
```bash
cp -r ../../examples/gutterpress-user-guide /tmp/gpbook   # never point it at the repo copy: edits save to disk
xvfb-run -a -s "-screen 0 1600x1000x24" node .claude/skills/run-desktop/driver.mjs /tmp/gpbook /tmp/shots <<'EOF2'
shot editor
click button:has-text('Read')
shot read
click button:has-text('Export')
shot export
press Escape
size 1024 700
shot narrow
btns
EOF2
```
Then Read the PNGs (`/tmp/shots/editor.png`, ...). Look at them; a blank frame is a failure.
Commands: `shot name`, `click sel`, `fill sel | value`, `press Key`, `move x y` (hover), `size w h`, `wait ms`,
`text` (dump body text), `btns` (visible controls with x,y,w,h), `eval js`.
Failed commands print `FAIL ...` and the script continues. Pass `""` as the book dir to stay on the welcome screen.
Useful selectors: `[aria-label='Book setup']` (toolbar button; the panel it opens is `[aria-label='Book settings']`), `[aria-label='Close book settings']`,
`[aria-label='App preferences']` (app settings, status bar), `[aria-label='Help and about']`, `button:has-text('Publish')`,
`.toggle-strip` (the status-bar Problems badge: icon + count, aria-label "Problems: 2 errors, 1 warning"), `.editor-toolbar .save-btn` (editor Save), `button:has-text('New book')`.

## Human path
`npm run electron:dev` opens a window and blocks; useless headless.

## Gotchas
- Opening a book = typing its path into the welcome screen's "Search your books" box + Enter (the native folder dialog can't be driven).
- A fresh profile opens a book in **Edit** (editor beside the page) with the left panel open (closed if the window is narrow). A saved Read/Edit or panel choice wins on later launches, so delete `GP_HOME` for a first-run view.
- `HOME` is set to `/tmp/gphome` (override with `GP_HOME`) so recents/settings don't leak between runs.
- Settings, Help and Book settings are full-screen pages that cover the workspace (the workspace is inert underneath); Esc or the X (`Close book settings`) closes them.
- The `New book` button is only visible while the left panel is open (already open on a fresh profile; the toggle closes it).
- Selectors like `button:has-text('Edit')` can match several nodes; the first is used. Keep `p.setDefaultTimeout` short (5s) or a bad selector stalls the run.
- Don't `pkill -f "vite dev"` in your own shell command; the pattern matches the shell and kills the session.
- Window size changes via `size` reflow the toolbar (labels collapse to icons at ~1024, page nav disappears at ~800).

## Troubleshooting
- `Cannot find module .../electron/dist/electron` -> run `node install.js` in `node_modules/electron`.
- Welcome screen shows `vunknown` -> you are on plain vite, not Electron (Electron shows the real version).
- Blank window / 503s in console -> you are running via vite, not Electron; see above.
