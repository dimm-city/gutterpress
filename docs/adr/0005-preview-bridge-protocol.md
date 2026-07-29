# ADR 0005: Preview bridge protocol (gutterpress:* postMessage seam)

> **Note:** reconstructed 2026-07-11 from in-repo citations; original ADR
> lost. Rebuilt from the surviving `(ADR 0005 …)` comments across the
> preview bridge implementation (see "Sources"). Treat it as an honest
> best-effort summary, not a verbatim restoration.

## Status

Accepted (as evidenced by the shipped implementation).

## Context

The desktop app renders the book preview in a cross-origin iframe (the preview
HTTP server on `127.0.0.1` inside the `app://` shell). The editor needs
rich, typed interaction with the paginated Paged.js document — scroll/zoom
state, page navigation, source-position sync (editor line ⇄ rendered page),
click-to-source, and an outline of rendered headings — without coupling the
SPA to the preview document's internals.

## Decision

A single postMessage-based bridge with a versioned message envelope
(`gutterpress:cmd` / `gutterpress:reply` / `gutterpress:event`):

- The preview side is implemented by the embedded preview scripts
  (`pagedjs-interface.js` exposes generic primitives and source-mapping
  helpers; `pagedjs-bridge.js` wires source-position sync and
  click-to-source events).
- The SPA side is `src/lib/preview-client.ts` (`PreviewClient`), which wraps
  the wire protocol in typed convenience methods (`getOutline()`,
  `scrollTo()`, `highlight()`, source-position queries) and forwards
  `gutterpress:event` pushes (render lifecycle, page counts, element activation).
- Source mapping rides on the renderer's source-map plugin output
  (`data-*` source attributes emitted at build time), so the bridge needs no
  access to project files.

## Consequences

- The editor ⇄ preview integration has one seam; preview internals can
  change freely behind the `gutterpress:*` protocol.
- The same bridge serves the CLI's standalone preview page and the desktop app.
- Security note: the preview iframe is sandboxed (2026-07 hardening);
  message origin/source validation on the SPA side is tracked in the
  2026-07-10 UX review (finding M31).

## Sources

- `packages/desktop/src/lib/preview-client.ts` (typed wrappers, OutlineEntry)
- `packages/cli/src/assets/preview/scripts/pagedjs-interface.js`
- `packages/cli/src/assets/preview/scripts/pagedjs-bridge.js`
