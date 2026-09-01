# ADR 0015 — Electron converges on one transport: typed IPC

Date: 2026-09-01 · Status: accepted · Implemented by: SFE-P5c (P5c1–P5c4), P5d

## Context

The packaged desktop app ran two host transports side by side. `api.ts`
drove 104 SvelteKit `+server.ts` routes over `fetch`, served by a local
`adapter-node` HTTP server that Electron started as a loopback listener and
proxied `app://` requests through — with its own per-session bearer token,
an `AUTH_HEADER`/`isAuthorizedRequest`/`withTokenAuth` authorization layer,
and a `fetch`-based request-forwarding proxy. `preload.ts` separately
exposed a narrower IPC surface (12 `ipcMain.handle` registrations at
baseline) for push events and the handful of operations that needed a live
`BrowserWindow`. Every capability the renderer needed therefore had two
possible transports to check, two DTO shapes to keep in sync, and a local
HTTP server plus a bearer-token/proxy layer whose only job was to stand in
for a transport IPC could carry directly.

## Decision

**Electron request/reply operations converge on typed IPC; the HTTP
transport is deleted, not deprecated in place** (plan D10). Migration ran
in four bounded route groups (SFE-P5c1: fs/dialog/shell/log/app;
P5c2: project/manifest/tpl/snip/media/plugin/theme/vcs/style;
P5c3: remote/sync/publish; P5c4: updater/recovery/doctor/lint and every
route still standing) rather than one big-bang rewrite — the plan
explicitly forbids attempting the transport deletion before every route
caller is migrated (stop condition: "P5 transport deletion is attempted
before all corresponding route callers are migrated").

- **Route count: 104 → 0.** `src/routes/api/**` no longer exists.
  `src/lib/api.ts` (722 lines) is deleted with it.
- **IPC handler count: 12 → 120** `secureHandle(...)` registrations —
  every deleted route became one or more typed, runtime-validated IPC
  channels; the pre-existing 12 plus one P3e addition became 120 by the
  end of P5c. Every registration validates its arguments at the boundary
  (plan D10: "runtime validation is required at every IPC request
  boundary") — the same discipline the deleted HTTP routes were supposed
  to provide, now enforced per-channel instead of per-route-handler.
- **After the last route migration, the desktop renderer is a static
  build** (SFE-P5d): `@sveltejs/adapter-node` is replaced by
  `@sveltejs/adapter-static`, emitting a plain file tree
  (`build/index.html`, `build/_app/**`) with no server bundle at all.
  Electron's main process registers a custom `app://` protocol handler
  (`electron/app-protocol.ts`) that reads that tree straight off disk —
  including out of the packaged asar — and returns file bytes directly.
  `electron/sveltekit-host.ts` (236 lines: the loopback `createServer(...)
  .listen(0, "127.0.0.1")` bind, `getSvelteKitHandlerPath`) is deleted
  outright, along with the per-session bearer token
  (`AUTH_HEADER`/`isAuthorizedRequest`/`withTokenAuth`/`skAuthToken`) and
  the `fetch`-based proxy in `registerAppProtocol`.
- **Security is not weaker for having lost the token** — a stated,
  evidenced equivalence, not an assumption: `app-protocol.ts` gates what it
  serves from disk with a differently-reasoned host/origin check (kept for
  `APP_ORIGIN` identity consistency, not proxy protection — see that
  file's own header for the security-equivalence statement and the
  traversal-refusal proof), and there is no longer a local network listener
  or a token to leak in the first place. The push-stream half of IPC
  (build progress, folder-changed, sync status, updater events, and calls
  that must drive a live `BrowserWindow` such as `webContents.printToPDF`)
  was never part of the HTTP transport and is unaffected — it stays IPC,
  as it always was.
- **No new desktop HTTP route may be added during or after the migration**
  without an explicit decision-record exception (plan D10, enforced as an
  architecture-fitness ratchet from P0b onward).

## Consequences

- One transport, one DTO shape per capability, one place
  (`electron/api/*.ts` + a handful of bespoke registrars — see ADR 0016)
  that owns argument validation for a given operation.
- The packaged app has no local network listener at all in the desktop's
  own process — a smaller and simpler attack surface than "loopback server
  plus bearer token plus proxy," not merely a different-shaped one.
- `tools/check-render-purity.mjs` now scans the *entire* `build/` tree with
  no `build/client/`-only carve-out, because there is no `build/server/` /
  `build/handler.js` sibling left to exclude — the static-renderer
  requirement (ADR 0014's renderer/host split) and the transport
  requirement reinforce the same invariant from two directions.
- Route-only DTO duplication was retired during the migration itself (each
  P5c subrun landed its callers on the owning capability/IPC contract
  rather than a route-shaped type), so there was nothing route-shaped left
  for P5d to separately clean up.

## Alternatives rejected

- **Migrate routes to IPC but keep the local HTTP server for static asset
  serving** — rejected; `app://` reading `build/` directly off disk removes
  the server (and the proxy/token it required) entirely rather than
  narrowing its job, matching D10's explicit list of what must be deleted
  "after the last route migration."
- **A big-bang single-commit transport rewrite** — rejected by the plan's
  own sequencing rule; bounding the migration to four route groups kept
  each PR reviewable and let the transport deletion wait until AC-16's
  route-count-zero precondition was actually, verifiably met.
- **Keep both transports permanently, IPC for new work only** — rejected;
  a permanently dual-transport app keeps paying the two-DTO-shapes and
  two-security-model cost this ADR removes, for no capability neither
  transport could already provide alone.
