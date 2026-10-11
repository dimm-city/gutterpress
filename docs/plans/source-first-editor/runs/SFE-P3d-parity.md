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
| D | `packages/desktop/src/routes/+page.svelte`, `packages/desktop/src/lib/components/EditorToolbar.svelte`, `packages/desktop/src/lib/editor/**`, new tests under `packages/desktop/tests/editor/`, `docs/plans/source-first-editor/parity-matrix.md` (converting the three waiver rows to mapped rows) | Lane A's gate/tool files, other lanes' tests, `packages/editor/src/**`, other packages | Close the three image/link parity gaps condition 2 names |
| E | `packages/desktop/tests/editor/real-book-plugin-*.test.ts`, a test-owned plugin-book fixture under `packages/desktop/tests/` | production source, `examples/**`, other lanes' files | The plugin-book half of condition 3 |
| Integrator | `bun.lock`, wiring, commits | — | Install, verification, commits |

Lane A is the only lane of the first phase permitted to touch production
source, and only to close a gap it has first documented in the matrix.

**Lanes D and E were added after the first phase reported** (spec amended
before either ran, per the run-discipline correction recorded in SFE-P3ab's
review log). Their cause:

- Lane A waived `image-properties`, `image-unwrap` and `link-edit` because no
  command in either surface edits an EXISTING image or link in place — both
  surfaces only ever insert new ones — and the wiring needed to close that sat
  outside Lane A's write boundary. Those three are precisely what condition 2
  names ("Image/link/layout context-menu source changes have replacement
  editor commands"), so a waiver cannot satisfy it. **Lane D closes them**;
  the waiver rows become mapped rows.
- Lane B established that **no example book configures a markdown-it plugin**
  (verified by grepping every `manifest.yaml` under `examples/`), so the
  "plugin-book" half of condition 3 has no corpus. **Lane E supplies one as a
  test-owned fixture** rather than shipping a new example book — condition 3
  is an editing-fidelity claim, not a request for new product surface.

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
- `node tools/check-parity.test.mjs` (self-test — must pass before the gate below is trusted, per G-12/AP-20)
- `bun run check:parity`
- `bun run check:architecture && bun run check:generated-files && bun run check:vendored && bun run knip`

Both `check:parity` lines above are wired into CI (`.github/workflows/ci.yml`,
`build` job, self-test-then-gate pair immediately after `check:architecture`)
— a gate with no CI invocation path is the same as no gate at all (AP-20).

## Parity gate result

<!-- Appended when the run closes: the five conditions, each with its evidence. -->

## Review log

<!-- Appended by the review stage. -->

## Parity gate result — 4 of 5 green, condition 5 awaiting the product owner

| # | Condition | Status | Evidence |
|---|---|---|---|
| 1 | All common authoring actions formerly reachable through preview mutation are available in source or rich mode | **GREEN** | `tools/check-parity.mjs` extracts 13 mutation-capable actions from the live source and requires each to have a mapped, existing, tested replacement: 13 mapped rows, **0 waivers**. Wired into CI as a self-test-then-gate pair. *(Historical: the standing checker was removed one run later by product-owner ruling — SFE-P3e; the behavioral tests and the matrix record remain, and `parity-matrix.md` is now a point-in-time evidence record.)* |
| 2 | Image/link/layout context-menu source changes have replacement editor commands | **GREEN** | The three in-place operations that had no replacement anywhere (`image-properties`, `image-unwrap`, `link-edit`) are now caret-driven commands on **both** surfaces, driven end to end with byte-exact assertions in `parity-caret-token-wrappers.test.ts`. |
| 3 | Real user-guide and plugin-book chapters can be edited without byte drift | **GREEN** | 25 real chapters / 154,366 bytes (user guide, design guide, validation example) plus a 3-chapter test-owned plugin book, all round-tripping through the real `DesktopDocumentHost` / `RichModeController` / `createEditorProjection`; locality via P2a's independent-bound oracle; both assertion families proven able to fail. |
| 4 | Preview navigation still works | **GREEN** | Coverage audit per D8 capability, the two genuine gaps closed (host-command round trips through the real bridge and shell), plus a two-layer separability proof. |
| 5 | No stakeholder-designated blocker remains | **BLOCKER DESIGNATED, then closed by SFE-P3e** | The product owner ruled (2026-08-31) that the rich editor without plugin regions is a failure of the feature itself; SFE-P3e closes it at the root and removes this run's standing-gate machinery per the same ruling. |

### What condition 5 needs from the product owner

Nothing is being waived, and no gap is being carried into P4 — conditions 1–4
are green on their own evidence. Condition 5 asks a person whether anything
they care about is still outstanding. Two facts are worth having in front of
that decision:

1. **The parity work found a real capability loss and closed it.** Before this
   run, no command in either editing surface could change an *existing* image
   or link — both surfaces only ever inserted new ones, and the only in-place
   rewriter was reachable solely from the preview context menu P4 deletes.
   Had P4 run first, authors would have silently lost the ability to edit an
   image's properties or a link's target.
2. **Two limits are recorded, neither of them a parity gap.** The desktop's
   `buildRichProjection` does not yet build a plugin-aware projection
   (`createEditorProjection`'s capability is proven; the desktop's wiring of it
   is not), and `ContextMenuController` still takes `commitEngine` as a
   non-optional dependency and reads `commitEngine.generation` at every menu
   build — P4 removes that coupling itself.

## Review log

### Round 1 — repair (9 CONFIRMED findings)

The review answered this run's own central question empirically rather than by
inspection, and the answer was **yes, the gate could be defeated**:

1. **The gate was not standing** — neither `check:parity` nor its 410-line
   sabotage suite had any CI invocation, under a comment in that same workflow
   reading "a gate that exists but is never invoked is the same as no gate at
   all." Wired in as a self-test-then-gate pair matching its four siblings.
2. **The extraction dropped mutation-capable actions silently in six ordinary
   TypeScript shapes** — method-shorthand `run`, modifier-less helper,
   class-field arrow, module-level function, object spread, bound method
   reference. All six exited 0 with `RULE 3: PASS`; two were not even counted
   in the "scanned N items" line. This was live: `block-edit` mutates through
   `this.deps.openInlineEdit(...)` and was invisible to its own file's
   extraction, reaching the gate only because a different file yielded the
   same id independently. Fixed by RULE 1b (residual call-site accounting —
   every real commit call site must fall inside a recognized method or item
   span, else the gate fails naming the orphan), bare-reference reachability,
   and a constructor-dependency seed over a maintained read-only allowlist.
3. **Fail-open on a regex literal** — one ordinary `/['"]/g` collapsed the
   whole context-menu extraction to zero, and AP-21 liveness was computed on
   the UNION of both files, so `block-edit` kept it non-empty and the gate
   still exited 0. Fixed by per-file liveness plus an unterminated-span
   invariant in the mask builder.
4. **None of the ten replacement commands the matrix named for condition 2 was
   exercised by any test** — the cited suites drove the pure token module, not
   the wrappers, which hold the only logic outside the pure core.
5. **The source-mode staleness guard was a byte compare at fixed offsets with
   no document identity** — a file switch or external reload during the dialog
   could write into the wrong document. Now compares CodeMirror's immutable
   `doc` reference before the byte compare.
6. **The caret-token refusal covered fenced blocks only** — it would rewrite
   real committed book content that markdown-it renders as literal,
   reproduced against `examples/with-design-guide/design-guide/05-layout.md`
   where it rewrote a documentation code sample. Now refuses across inline
   code spans, indented blocks, and blockquoted and list-nested fences, with
   positive controls still resolving.
7. **Load-bearing header comments named four command functions that do not
   exist**, describing an API that was designed away.
8. **Two factual claims in the checker's LIMITATIONS header were false** — the
   template-literal limitation is neither absent from the real file nor
   covered by a fixture.
9. **Condition 3's test titles claimed a rich mount that never occurs** — the
   happy-dom substitution is real and documented, but the titles read broader
   than the evidence.

Verdict after round 1: **approve**, 0 confirmed remaining, 4 advisories (an
over-refusal in two ordinary shapes reported with a "code block" message;
RULE 1b attributing a call site to any commit-reaching method; the
evidence-reference check passing on ANY-of-many; one stale doc comment).

### Gate

PASS — all 17 commands exit 0: install; typecheck (4 workspaces); cli build
(render purity) + test (1913 pass / 60 skip); editor test (3038) +
test:browser (109 across 8 suites) + browser-purity (35 files); desktop test
(5981 pass / 1 skip), check (892 files / 0 errors), lint, build (render
purity, 145 files); `check-parity` self-test + gate (13 extracted, 13 mapped,
0 waivers, 7 rules PASS); architecture (route ratchet 104 == 104);
generated-files (1273 tracked); vendored (26 hashes / 33 files); knip.
