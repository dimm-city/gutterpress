# SFE-P3d-parity — The parity gate that must be green before P4

## Why this run exists, and why it runs before P3c

The plan's P3d bundles two different things: a **parity gate** (the five
conditions P4 may not start without) and a **packaged interaction /
accessibility / performance sweep**. Only the first is a precondition for
deletion, and — read literally — none of its five conditions mentions the VS
Code extension:

> 1. All common authoring actions formerly reachable through preview mutation
>    are available in source or rich mode.
> 2. Image/link/layout context-menu source changes have replacement editor
>    commands.
> 3. Real user-guide and plugin-book chapters can be edited without byte drift.
> 4. Preview navigation still works.
> 5. No stakeholder-designated blocker remains.

So this run executes the gate alone, on the desktop surface P3a/P3b delivered,
ahead of P3c. The remaining P3d scope — packaged/E2E scenarios, screen-reader
landmarks, IME, the D13 performance runs, and the untrusted-VS-Code-workspace
scenario — is deferred to **SFE-P3d-sweep**, which lands after P3c. This is a
sequencing split, not a scope reduction: nothing in the five conditions is
waived, and P4 still may not start until this run is green AND the product
owner has answered condition 5.

## Objective

Produce **evidence**, not prose, that every authoring action the preview can
perform today survives its deletion — and make that evidence a standing gate
that fails when a future change breaks it.

## Allowed behavior changes

- New tests and a new parity gate.
- New documentation (`parity-matrix.md`).
- **Production source changes are permitted ONLY to close a parity gap this
  run discovers** — i.e. a preview mutation with no source/rich replacement.
  Such a change is a lane deliverable with its own tests, and the lane must
  name it explicitly as a gap closure, not fold it into "test work".

## Behavior that must remain unchanged

- Nothing is deleted in this run. `InlineEditController`, `CommitEngine`, the
  context menu, and the preview mutation protocol all stay exactly as they
  are — P4 deletes them, and it may only do so *because* this run proved the
  replacements exist. A lane that starts deleting has misread its brief.
- Rendered book/preview/PDF output byte-identical.
- Every existing suite and fitness check.

## Binding decisions

- **G-01/AP-01** — parity is proven by exercising the replacement, never by
  asserting it exists. "There is a `toolbar-actions.ts` entry for bold" is not
  evidence; "invoking the rich-mode bold command on this fixture produces
  exactly these bytes" is.
- **AP-21** — the matrix must be **derived from the code**, not hand-listed.
  A hand-written list rots silently the moment someone adds a preview
  mutation. The completeness check must fail when the code grows an action the
  matrix does not cover.
- **G-12/AP-20** — the gate must be proven able to fail: delete a replacement
  mapping, or add a synthetic preview action, and show the gate goes red.
- **AC-03/AC-04** — byte identity outside explicit edits; explicit edits are
  local. Condition 3 is exactly these two criteria applied to real books
  instead of synthetic corpora.
- **D8** — the preview keeps navigation, selection/copy, open link/image,
  diagnostics, page controls, and source reveal. Condition 4 is about those,
  and the run must show they are **separable** from the mutation surface —
  otherwise P4's deletion cannot be surgical.

## The completeness mechanism — the binding constraint

Condition 1 says "all". A matrix that lists what its author remembered cannot
support that word. So:

1. The set of mutation-capable preview actions is **extracted from the
   source** — `context-menu-controller.svelte.ts`'s item identifiers that
   reach `commit()`, plus `inline-edit-controller.svelte.ts`'s block-edit
   path — by a check that reads the files, not by a literal array in a test.
2. The matrix maps each extracted action to one or more **replacement command
   identifiers** in source or rich mode.
3. The gate fails when an extracted action has no mapping, when a mapping
   names a command that no longer exists, or when a mapped command has no
   behavioral test.
4. An action deliberately NOT carried forward (D8 says the read-only context
   menu keeps navigation-class items; some actions may be judged not worth
   replacing) is recorded with an explicit, reasoned **waiver** naming who
   waived it. A waiver is a visible entry, never a silent omission.

If a lane finds the extraction cannot be made reliable — the identifiers are
not statically recoverable — it **reports that** rather than falling back to a
hand-list and calling it derived.

## Behavior table

| Case | Required result | Owner |
|---|---|---|
| Action extraction | The mutation-capable action set is read from `context-menu-controller.svelte.ts` and `inline-edit-controller.svelte.ts`, not hand-listed; a synthetic added action makes the gate fail | A |
| Parity matrix | Every extracted action maps to a replacement command reachable in source mode, rich mode, or both — with the surface named per action | A |
| Replacement behavior | Each mapped replacement is exercised on a fixture and asserted by **exact resulting bytes**, not by "did not throw" | A |
| Waivers | Any action not carried forward has an explicit reasoned waiver naming the decision owner; a waiver with no reason fails the gate | A |
| Gap closure | A preview mutation found with NO replacement is either implemented (with tests) or waived — never left undocumented | A |
| Condition 2 specifics | Image properties, image unwrap, link edit, make-link, marker edit, page-marker edit, block-break before/after, and the four selection formats each have a named, tested replacement | A |
| Real-book no-edit identity | Every chapter of `examples/gutterpress-user-guide` and a plugin-using book round-trips through the document session + rich mount with **zero byte drift** — read, mount, unmount, read back, assert byte-identical | B |
| Real-book explicit edits | A representative edit in each real chapter changes exactly its own range and nothing else, asserted against an independent oracle (the P2a locality oracle, reused, not re-derived) | B |
| Byte-drift liveness | The corpus proves it can fail: a deliberately drifting implementation trips the assertion (a fixture whose bytes are perturbed must be caught) | B |
| Preview navigation | Navigation, selection/copy, open link/image, diagnostics, page controls and source reveal all still work — asserted through the existing preview suites plus whatever they do not already cover | C |
| Mutation separability | The navigation surface is shown to be independent of the mutation surface: with the mutation entry points disabled, navigation still passes — this is what makes P4's deletion surgical rather than hopeful | C |

## Lane ownership (A, B, C in parallel — disjoint)

| Lane | May write | Must not write | Deliverable |
|---|---|---|---|
| A | `docs/plans/source-first-editor/parity-matrix.md`, `tools/check-parity.mjs` + `tools/check-parity.test.mjs`, `packages/desktop/tests/editor/parity-*.test.ts`, root `package.json` (a `check:parity` script only), and — ONLY to close a discovered parity gap — `packages/desktop/src/lib/editor/**` | existing tests, `packages/desktop/src/lib/routes/inline-edit-controller.svelte.ts`, `context-menu-controller.svelte.ts`, `commit-engine.ts`, other packages | The derived parity matrix + the standing gate |
| B | `packages/desktop/tests/editor/real-book-*.test.ts`, `packages/cli/tests/**` only if the corpus genuinely belongs there (say why) | production source, other lanes' files | Real-book byte-drift evidence |
| C | `packages/desktop/tests/preview-*.test.*`, `packages/desktop/tests/editor/preview-navigation-*.test.ts` | production source, other lanes' files | Navigation regression + separability proof |
| Integrator | `bun.lock`, wiring, commits | — | Install, verification, commits |

Lane A is the only lane permitted to touch production source, and only to
close a gap it has first documented in the matrix.

## Review dimensions

- Is the action set genuinely derived, or is there a hand-list wearing a
  derivation's clothes?
- Can the gate pass while a real authoring action has no working replacement?
  Construct the case.
- Are the "exact bytes" assertions actually exact, or do they normalize?
- Does any waiver hide a gap that should have been closed?
- Does the real-book corpus exercise plugin regions, markers, and generated
  content — or only prose?
- Would the separability proof still pass if navigation were quietly broken?

## Gate

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `cd packages/desktop && bun run test && bun run check && bun run lint && bun run build`
- `cd packages/cli && bun run build && bun run test`
- `cd packages/editor && bun run test && bun run test:browser && bun run check:browser-purity`
- `bun run check:parity`
- `bun run check:architecture && bun run check:generated-files && bun run check:vendored && bun run knip`

## Parity gate result

<!-- Appended when the run closes: the five conditions, each with its evidence. -->

## Review log

<!-- Appended by the review stage. -->
