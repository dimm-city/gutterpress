# SFE-P5c — Migrate desktop HTTP APIs to typed IPC (four subruns)

## Objective

Move every request/reply operation off the internal HTTP server onto typed,
runtime-validated IPC, one bounded-context group at a time, deleting each
group's `+server.ts` routes and `api.ts` client methods **in the same
subrun** — so the route ratchet only ever moves down and no dual transport
lingers. P5d deletes the server itself once the route count reaches zero.

## Subrun scoping (the plan's own grouping, which wins over the map's)

| Subrun | Plan text | api.ts namespaces / route dirs (dispatch scoping) |
|---|---|---|
| P5c1 | Files, dialogs, shell, logs, settings | `fs`, `dialog`, `shell`, `log`, `app` (kept whole here — its settings/prefs/dirty-state/discovery members are one bounded context; splitting one namespace across subruns is worse) |
| P5c2 | Project configuration, templates, snippets, media, plugins, themes, history | `project`, `manifest`, `tpl`, `snip`, `media`, `plugin`, `theme`, `vcs`, `style` |
| P5c3 | Remote, synchronization, publishing, credentials | `remote`, `sync`, `publish` |
| P5c4 | Build, preview, updater, recovery, and remaining routes | `updater`, `recovery`, `doctor`, `lint`, `status`, `api`/`_lib` remnants, and every route still standing |

`docs/plans/source-first-editor/capability-map.md` §6 is the namespace
reference (audited by SFE-P5b's review); its two recorded grouping
disagreements are resolved in favor of the plan, as it itself notes.

## Per-subrun rules (the plan's, binding)

1. **Runtime validate request AND response payloads** at the IPC boundary —
   `secureHandle` with per-argument checks in the established main.ts style;
   malformed input rejects with a typed error, never a generic "failed".
2. **Preserve typed diagnostic categories** and each route's error
   semantics — a caller that distinguished 404-ish from 500-ish outcomes
   must still be able to.
3. **Test unauthorized / path-invalid / host-disconnected** cases per group.
4. **Delete the routes and the client methods in the same subrun**; lower
   `tools/architecture-baseline.json`'s `desktopHttpRoutes` to the new count
   in the same commit (the ratchet's WARN-on-lower prompts the re-baseline —
   Rule 2's contract).
5. **Update the preload/bridge surface exactly once per subrun.**
6. **Callers land on the bounded context's capability module** (SFE-P5b's
   modules; a subrun may create the module its context lacks — files/dialog
   and project-config have none yet — under P5b's design constraints: plain
   functions, DTOs in the module, no ceremony for single-consumer slices).
7. **Root/path validation is REUSED, not re-derived** — the routes' existing
   workspace-root scoping and traversal guards move with the logic;
   security protections are never deleted because the transport changed
   (D12). Where a route's handler logic lives in a shared server module, the
   logic MOVES to a main-process module the IPC handler calls; nothing is
   duplicated.
8. **Push streams stay IPC as they are** — this migration touches
   request/reply only.
9. Net LOC per subrun should trend negative (route files + fetch plumbing
   die; validation moves rather than grows).

## Sequencing and review batching

Subruns run sequentially (P5c1 → P5c4), each committed and self-verified;
the adversarial review runs in TWO batched passes — after P5c2 (covering
P5c1+P5c2) and after P5c4 (covering P5c3+P5c4) — an economy measure over
mechanical migrations; the review depth per finding is unchanged. The gate
runs after each review pass.

## Gate (per review pass)

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `cd packages/cli && bun run build && bun run test`
- `cd packages/editor && bun run test`
- `cd packages/desktop && bun run test && bun run check && bun run lint && bun run build`
- `bun run check:architecture && bun run check:generated-files && bun run knip`

## Review log

<!-- Appended by the review stages. -->
