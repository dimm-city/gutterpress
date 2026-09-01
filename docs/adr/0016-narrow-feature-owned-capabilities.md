# ADR 0016 — Narrow, feature-owned capability modules replace the `Platform` service locator

Date: 2026-09-01 · Status: accepted · Implemented by: SFE-P5b (see also SFE-P6b for the parallel Electron-main-side registrar split)

> **Supersedes, in part:** the (missing) platform-abstraction ADR that
> `CLAUDE.md` §8 and several desktop source comments still cite as
> "ADR 0004" — see ADR 0009's "Note on predecessors" and the deletion
> ledger's SFE-P5a entry for why that record does not exist in this
> repository. This ADR is the current record for that seam.

## Context

`packages/desktop`'s renderer reached every host capability through one
broad service locator: `getPlatform()` returned a `Platform` object
combining a 9-member `PlatformAdapter` (narrow, lib-defined primitives) and
a 22-member `HostServices` (a desktop-only RPC surface), selected between
an `ElectronAdapter` and the dormant `WebAdapter` (deleted separately, ADR
0014). A single `getPlatform()` import gave a caller access to updater
control, GitHub device-flow, sync status, preview/build/export, editor
projection, filesystem primitives, and more — regardless of which one
capability that caller actually needed.

A full member-by-member inventory (this run's own
`docs/plans/source-first-editor/capability-map.md`, D15's required "search
proof, dependency proof, and passing behavior tests" for every deletion
claim) found the locator was also carrying real dead weight: 5 of its 31
members (`saveSnapshot`, `openFolder`, `listDir`, `getSecret`, `setSecret`)
had zero real consumers — every actual caller already reached the same
capability through a different, narrower path (`api.fs.listDir()` directly,
for instance), leaving the locator's own member unused.

## Decision

**`Platform`/`HostServices`/`PlatformAdapter`/`getPlatform()`/
`ElectronAdapter` are deleted, not narrowed in place.** Every real member
was mapped onto one of the bounded contexts plan D10 names (updater; theme;
sync/remote/GitHub; build/preview/export; editor projection; app
lifecycle; files/dialog), and each context that ended up with a real
multi-consumer or real-marshalling reason for a module got one:
`update/updater-capability.ts`, `remote/remote-capability.ts`,
`export/build-preview-capability.ts`,
`app-lifecycle/app-lifecycle-capability.ts`,
`editor-host/editor-projection-capability.ts` — five plain-function
modules, no classes, no injection framework, each importing DTOs it owns
where that created no cycle (two of five did; three deliberately deferred
to `platform/contract.ts`, documented in that file's own header rather than
spread thin for uniformity's sake alone).

**One shared accessor, `platform/bridge.ts`, is the only module allowed to
touch `window.electron`.** It does the Electron-presence check and throws
`DesktopHostRequiredError` off-Electron (ADR 0014's "fail loudly, not
partially" principle applied to every capability, not only theme). Every
capability module calls `bridge()`; nothing else does.

**Pure 1:1 forwarding gets no module at all — it collapses into its sole
consumer.** The design constraint this run applied ("if a capability module
would merely forward calls the way `ElectronAdapter` does today, the
forwarding dies instead") was not treated as a slogan:
`onNativeThemeUpdated` collapsed into `theme.svelte.ts` (its one caller);
`readFile`/`writeFile`/`statFile` collapsed into a narrow, consumer-shaped
`EditorBufferFs` interface `EditorBuffer` declares for itself, satisfied by
passing `api.fs` directly (D4: "consumer-shaped interfaces live with the
consuming domain, not in a global contracts file"). One case
(`buildEditorProjection` → `editor-projection-capability.ts`) deliberately
kept a module despite zero marshalling logic, because its D14 diagnostic
contract types were worth a stable, documented home next to
`desktop-document-host.ts` — recorded as the one deliberate exception, not
silently treated as consistent with the collapse rule.

**Dead members are deleted with search proof, not migrated.** All 5 dead
`HostServices`/`PlatformAdapter` members above were confirmed to have zero
real callers (`grep`-verified against the pre-deletion tree) and removed
outright rather than given a capability-module home nothing would ever
call.

**Electron's own main process gets the parallel split** (SFE-P6b, same
run group): the ~120 `secureHandle` registrations that used to sit inline
in `electron/main.ts` moved into per-context `register*Handlers` functions
colocated with their handler logic (`electron/api/*.ts` and a handful of
bespoke registrars for export/preview/editor-projection/PDF-export/GitHub
device flow) — the renderer-side and main-side halves of ADR 0015's IPC
surface are both organized by bounded context now, not by which file
happened to accrete the registration first.

## Consequences

- A caller's import list states exactly which capability it depends on
  (`import { startPreview } from "$lib/export/build-preview-capability"`,
  not `import { getPlatform }`), so a future audit of "what does this
  component actually touch on the host" is a grep, not a runtime trace.
- Deleting a locator interface with 31 members but migrating only 20 of
  them to modules (4 collapsed into consumers, 5 dead, 1 kept as a type
  field with no wrapper, 1 discriminant gone with the deleted class) is the
  honest count — this ADR does not claim a 1:1 migration where none
  happened; the full accounting is `capability-map.md` §2 and the deletion
  ledger's "`Platform`/`HostServices` methods" row.
- Production LOC for this run alone is near-flat (+49 lines) despite
  deleting a 253-line class and ~180 lines of interface text, because the
  5 new modules carry real doc-comment explanation of the capability cut
  itself — the plan's net-negative requirement (success criterion 22) is
  scoped to the combined P4–P6 phases, not this one subrun in isolation,
  and P5 as a whole remains deeply net-negative once P5a's ~1,900-line PWA
  deletion (ADR 0014) is counted alongside it.
- `getPlatformCapabilities()` (`build-preview-capability.ts`) is the one
  place a capability's *return value* never varies but the *act of calling*
  `bridge()` still matters — it preserves the exact synchronous
  fail-loudly-off-Electron trigger the old `+page.svelte`'s eager
  `$derived` call site depended on, documented as a deliberate
  behavior-preservation decision rather than silently dropped in a naive
  migration (`capability-map.md` §4).

## Alternatives rejected

- **A narrower but still-unified `Platform` object** (trim the dead members,
  keep one locator) — rejected; a locator with 26 members instead of 31 is
  still a locator, and still lets any caller reach any capability through
  one import regardless of need.
- **A dependency-injection container or registry** — rejected by plan
  non-goal ("no generic dependency-injection container, registry, event
  bus") and by D4 ("no service locator in new code," "shared mutable
  registries are prohibited").
- **One capability module per interface member, uniformly** — rejected;
  several members are pure single-consumer forwards with zero marshalling,
  and a module wrapping `api.fs.readFile` with no added behavior is exactly
  the ceremony the collapse rule exists to avoid (see "Decision" above).
