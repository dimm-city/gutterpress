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

**Pass 1 (P5c1+P5c2, `dc900e96..c90ac668` + repair `b77a6524`):** approve
after one round. 9 CONFIRMED — the two that justify the security focus:
`fs:delete` lost its fail-closed VCS-hooks gate in migration (a delete could
proceed un-snapshotted; restored with a file-survives-rejection regression
test), and `tpl:listCustom` exposed an unvalidated renderer-supplied
absolute path (zero real callers — the parameter was deleted from the IPC
surface). Also: a dropped settings-read try/catch, a four-way bridge drift
(including a silently dropped `watchFolder`), a re-implemented shared
function, host-services test-isolation leaks, and ledger corrections.

**Pass 2 (P5c3+P5c4, `b77a6524..0758cb9e` + repairs `df6e9f4f`,
`f1f369e1`):** approve after two rounds. 9+3 CONFIRMED — the directed D12
attack LANDED: the remote/publish error path forwarded an unredacted
message, so a git remote URL with embedded credentials could cross to the
renderer on the rethrow (the sanitizers redacted the log, not the throw).
Fixed in both wrappers with error-path tests driving a credentialed URL
through the REAL handlers. Also: the CI perf gate still POSTed to a deleted
route; P5c4's capability modules missed the friendlyHostError scrub (raw
IPC error prefixes reached author-visible surfaces); the publish-error
JSON-envelope workaround had outlived its transport (deleted, AP-32);
knip's entry for the deleted api.ts; ledger SHAs/metrics; and a
fossil-comment sweep. Round 2 held a false "no assertions were dropped"
claim open until it was actually true.

## Gates

Both passes: PASS, all 13 commands exit 0. End state after P5c4:
**route ratchet 0 == baseline 0**, `src/routes/api/` absent, `api.ts`
deleted, `fetch("/api/…")` zero across the package, 120 validated IPC
handlers (+108 over the P0a baseline of 12, the deliberate counterpart of
−104 routes), desktop 5889:1:0, svelte-check 688 files clean, render purity
clean.
