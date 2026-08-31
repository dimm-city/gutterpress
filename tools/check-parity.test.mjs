// Test for tools/check-parity.mjs — run with: node tools/check-parity.test.mjs
//
// Follows tools/check-architecture.test.mjs's convention: every case builds a
// disposable temp-dir fixture (never the live repo — check-parity.mjs is
// invoked with --root pointing at the fixture) and asserts the exit code.
// Per SFE-P3d-parity / G-12 / AP-20, every failure class gets a SABOTAGE proof
// (corrupt exactly one thing, show the gate goes red) as well as a clean-tree
// pass, so this file proves the gate can actually fail, not just that it can
// pass — and, specifically for AP-21, that an extraction returning ZERO
// actions is a hard failure, never a silent no-op success.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-parity.mjs");

let failures = 0;
function check(name, actual, expected) {
  if (actual === expected) {
    console.log(`ok - ${name}`);
  } else {
    failures++;
    console.error(`NOT OK - ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function run(root) {
  return spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8" });
}

function withFixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), "check-parity-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── Fixture source bodies ────────────────────────────────────────────────
//
// A minimal but STRUCTURALLY REAL context-menu controller: two commit-
// reaching items (one direct `this.commit(...)` call, one indirect through a
// private helper method — exercising the one-hop call-graph closure), one
// non-mutating item (`go-to-source`, proving selective extraction — it must
// NEVER show up as an action), and a FORMAT_KINDS-shaped `.map()` site
// (proving the shorthand-id array-resolution mechanism on a fixture, not
// just against the live repo).

function contextMenuFixture({
  extraDirectItem = "",
  extraFormatKind = "",
  extraClassMember = "",
  extraModuleLevel = "",
} = {}) {
  return `
export class ContextMenuController {
  private static readonly FORMAT_KINDS = [
    { id: "widget-format-a", label: "A", kind: "a" },
    { id: "widget-format-b", label: "B", kind: "b" },${extraFormatKind}
  ];

  private async commit(a: string, b: string): Promise<void> {
    await this.deps.commitEngine.commitRangePatch({ a, b });
  }

  private helperEdit(): void {
    void this.commit("x", "y");
  }
${extraClassMember}
  private buildFormatItems(): unknown[] {
    return this.constructor.FORMAT_KINDS.map(({ id, label, kind }) => {
      return {
        id,
        label,
        enabled: true,
        run: async () => {
          await this.commit(kind, label);
        },
      };
    });
  }

  private buildItems(): unknown[] {
    return [
      {
        id: "go-to-source",
        label: "Go to source",
        enabled: true,
        run: () => {
          this.deps.goToSource();
        },
      },
      {
        id: "widget-edit",
        label: "Edit widget",
        enabled: true,
        run: async () => {
          await this.commit("a", "b");
        },
      },
      {
        id: "widget-alt",
        label: "Alt edit",
        enabled: true,
        run: () => this.helperEdit(),
      },${extraDirectItem}
      ...this.buildFormatItems(),
    ];
  }
}
${extraModuleLevel}
`;
}

const CLEAN_INLINE_EDIT = `
export class InlineEditController {
  private async commit(text: string): Promise<void> {
    await this.deps.commitEngine.commitRangePatch({ text });
  }
}
`;

const EMPTY_INLINE_EDIT = `
export class InlineEditController {
  private discard(): void {
    // no commit path at all
  }
}
`;

const CLEAN_TOOLBAR_ACTIONS = `
export function applyWidgetEdit(): void {}
`;

const CLEAN_RICH_COMMANDS = `
export function applyRichWidgetEdit(): void {}
`;

const CLEAN_EVIDENCE_TEST = `
import { test } from "bun:test";
test("applyWidgetEdit works", () => {});
test("applyRichWidgetEdit works", () => {});
test("widget-alt helper path works", () => {});
test("widget format items work", () => {});
`;

function cleanMatrix() {
  return `# Fixture parity matrix

### Mapped actions

| Action | Replacement command(s) | Surface(s) | Test evidence |
|---|---|---|---|
| \`widget-edit\` | \`toolbar-actions.ts#applyWidgetEdit\` | source toolbar | \`packages/desktop/tests/editor/parity-widget.test.ts::applyWidgetEdit works\` |
| \`widget-alt\` | \`rich-commands.ts#applyRichWidgetEdit\` | rich toolbar | \`packages/desktop/tests/editor/parity-widget.test.ts::applyRichWidgetEdit works\` |
| \`widget-format-a\` | \`toolbar-actions.ts#applyWidgetEdit\` | source toolbar | \`packages/desktop/tests/editor/parity-widget.test.ts::widget format items work\` |
| \`widget-format-b\` | \`toolbar-actions.ts#applyWidgetEdit\` | source toolbar | \`packages/desktop/tests/editor/parity-widget.test.ts::widget format items work\` |

### Waivers

| Action | Reason | Decision owner |
|---|---|---|
| \`block-edit\` | Free-form block editing waived for this fixture (not exercised by this test). | product owner (pending) |
`;
}

// Builds a minimal, fully clean fixture tree. Every sabotage test starts
// from this and corrupts exactly one thing, so a failure can be attributed
// to the rule under test.
function scaffoldClean(root, overrides = {}) {
  const {
    contextMenu = contextMenuFixture(),
    inlineEdit = CLEAN_INLINE_EDIT,
    toolbarActions = CLEAN_TOOLBAR_ACTIONS,
    richCommands = CLEAN_RICH_COMMANDS,
    evidenceTest = CLEAN_EVIDENCE_TEST,
    matrix = cleanMatrix(),
  } = overrides;

  mkdirSync(join(root, "packages", "desktop", "src", "lib", "routes"), { recursive: true });
  mkdirSync(join(root, "packages", "desktop", "src", "lib", "editor"), { recursive: true });
  mkdirSync(join(root, "packages", "desktop", "tests", "editor"), { recursive: true });
  mkdirSync(join(root, "packages", "editor", "src", "core"), { recursive: true });
  mkdirSync(join(root, "docs", "plans", "source-first-editor"), { recursive: true });

  writeFileSync(join(root, "packages", "desktop", "src", "lib", "routes", "context-menu-controller.svelte.ts"), contextMenu);
  writeFileSync(join(root, "packages", "desktop", "src", "lib", "routes", "inline-edit-controller.svelte.ts"), inlineEdit);
  writeFileSync(join(root, "packages", "desktop", "src", "lib", "editor", "toolbar-actions.ts"), toolbarActions);
  writeFileSync(join(root, "packages", "desktop", "src", "lib", "editor", "rich-commands.ts"), richCommands);
  writeFileSync(join(root, "packages", "editor", "src", "core", "commands.ts"), "export type Placeholder = never;\n");
  writeFileSync(join(root, "packages", "desktop", "tests", "editor", "parity-widget.test.ts"), evidenceTest);
  writeFileSync(join(root, "docs", "plans", "source-first-editor", "parity-matrix.md"), matrix);
}

// --- Clean pass ---------------------------------------------------------

withFixture((root) => {
  scaffoldClean(root);
  const r = run(root);
  check("clean fixture exits 0", r.status, 0);
  check("clean fixture reports 5 extracted actions (2 direct/indirect + 2 FORMAT_KINDS + block-edit)", r.stdout.includes("extracted 5 mutation-capable action id(s)"), true);
  check(
    "clean fixture never extracts the non-mutating go-to-source item",
    !r.stdout.includes('"go-to-source"') && !r.stderr.includes('"go-to-source"'),
    true,
  );
});

// --- RULE 1 / AP-21: empty extraction is a hard FAIL, not a silent pass ---

withFixture((root) => {
  scaffoldClean(root, {
    contextMenu: `
export class ContextMenuController {
  private buildItems(): unknown[] {
    return [
      {
        id: "go-to-source",
        label: "Go to source",
        enabled: true,
        run: () => { this.deps.goToSource(); },
      },
    ];
  }
}
`,
    inlineEdit: EMPTY_INLINE_EDIT,
    matrix: "# Fixture parity matrix\n\n### Mapped actions\n\n| Action | Replacement command(s) | Surface(s) | Test evidence |\n|---|---|---|---|\n\n### Waivers\n\n| Action | Reason | Decision owner |\n|---|---|---|\n",
  });
  const r = run(root);
  check("zero commit-reaching actions fails the gate (AP-21 liveness), not a silent pass", r.status, 1);
  check("liveness failure names AP-21", r.stderr.includes("AP-21") || r.stdout.includes("AP-21"), true);
  check("liveness failure is reported under RULE 1", r.stdout.includes("RULE 1 [extraction]: FAIL"), true);
});

// --- Missing source files: usage/internal error (exit 2) -----------------

withFixture((root) => {
  scaffoldClean(root);
  rmSync(join(root, "packages", "desktop", "src", "lib", "routes", "context-menu-controller.svelte.ts"));
  check("missing context-menu-controller.svelte.ts exits 2 (usage/internal error)", run(root).status, 2);
});

withFixture((root) => {
  scaffoldClean(root);
  rmSync(join(root, "docs", "plans", "source-first-editor", "parity-matrix.md"));
  check("missing parity-matrix.md exits 2 (usage/internal error)", run(root).status, 2);
});

// --- SABOTAGE: a NEW mutation-capable action with no matrix row ----------

withFixture((root) => {
  scaffoldClean(root, {
    contextMenu: contextMenuFixture({
      extraDirectItem: `
      {
        id: "widget-brand-new",
        label: "Brand new mutation",
        enabled: true,
        run: async () => {
          await this.commit("new", "value");
        },
      },`,
    }),
    // matrix intentionally UNCHANGED — the new action has no row.
  });
  const r = run(root);
  check("a new commit-reaching item with no matrix row fails the gate", r.status, 1);
  check("failure names the unmapped action", r.stderr.includes("widget-brand-new"), true);
  check("failure is reported under RULE 3", r.stdout.includes("RULE 3 [coverage]: FAIL"), true);
});

// --- SABOTAGE: FORMAT_KINDS array grows a THIRD entry, matrix untouched --
// This is the exact real-world mechanism (rich-commands' FORMAT_KINDS-style
// shorthand-id `.map()` site) — proving a config-array addition, not just a
// new literal-id item, makes the gate fail with zero changes to the checker.

withFixture((root) => {
  scaffoldClean(root, {
    contextMenu: contextMenuFixture({
      extraFormatKind: '\n    { id: "widget-format-c", label: "C", kind: "c" },',
    }),
    // matrix still only maps widget-format-a/b.
  });
  const r = run(root);
  check("a third FORMAT_KINDS-shaped array entry with no matrix row fails the gate", r.status, 1);
  check("failure names the newly-derived array entry's id", r.stderr.includes("widget-format-c"), true);
});

// --- SABOTAGE: mapping names a command that no longer exists --------------

withFixture((root) => {
  scaffoldClean(root, {
    matrix: cleanMatrix().replace("toolbar-actions.ts#applyWidgetEdit`", "toolbar-actions.ts#applyDeletedCommand`"),
  });
  const r = run(root);
  check("a replacement naming a deleted command fails the gate", r.status, 1);
  check("failure is reported under RULE 5", r.stdout.includes("RULE 5 [command-existence]: FAIL"), true);
  check("failure names the missing identifier", r.stderr.includes("applyDeletedCommand"), true);
});

withFixture((root) => {
  scaffoldClean(root, {
    matrix: cleanMatrix().replace("rich-commands.ts#applyRichWidgetEdit`", "not-a-known-file.ts#whatever`"),
  });
  const r = run(root);
  check("a replacement naming an unknown source file fails the gate", r.status, 1);
  check("failure names the unknown file", r.stderr.includes("not-a-known-file.ts"), true);
});

// Sanity: a command name that exists only inside a COMMENT (not real code)
// must NOT satisfy the existence check.
withFixture((root) => {
  scaffoldClean(root, {
    toolbarActions: `
// applyWidgetEdit used to live here but was removed; see applyWidgetEdit in git history.
export function applyWidgetEditRenamed(): void {}
`,
  });
  const r = run(root);
  check("a command name mentioned only in a comment does not satisfy existence", r.status, 1);
});

// --- SABOTAGE: mapped command has no behavioral test ----------------------

withFixture((root) => {
  scaffoldClean(root, {
    matrix: cleanMatrix().replace(
      "| `widget-edit` | `toolbar-actions.ts#applyWidgetEdit` | source toolbar | `packages/desktop/tests/editor/parity-widget.test.ts::applyWidgetEdit works` |",
      "| `widget-edit` | `toolbar-actions.ts#applyWidgetEdit` | source toolbar | |",
    ),
  });
  const r = run(root);
  check("a mapped row with no test evidence fails the gate", r.status, 1);
  check("failure is reported under RULE 6", r.stdout.includes("RULE 6 [test-evidence]: FAIL"), true);
});

withFixture((root) => {
  scaffoldClean(root, {
    matrix: cleanMatrix().replace("applyWidgetEdit works`", "a test that was never written`"),
  });
  const r = run(root);
  check("a test evidence citation that does not resolve to a real test fails the gate", r.status, 1);
  check("failure names the unresolved citation", r.stderr.includes("a test that was never written"), true);
});

withFixture((root) => {
  scaffoldClean(root, {
    // Evidence cites a real file but a FABRICATED test title — proves the
    // checker actually greps for the literal title, not just file existence.
    matrix: cleanMatrix().replace(
      "packages/desktop/tests/editor/parity-widget.test.ts::applyWidgetEdit works",
      "packages/desktop/tests/editor/parity-widget.test.ts::this title was never written",
    ),
  });
  const r = run(root);
  check("a fabricated test title in a real file fails the gate", r.status, 1);
});

// --- SABOTAGE: cited test exists but never references the row's OWN
// replacement identifier — G-01/AP-01 (SFE-P3d-parity repair round 1,
// CONFIRMED finding): a matrix row can cite a real test in a real file, and
// that test can still prove only the PURE CORE underneath the named
// replacement, never the replacement itself. `evidenceExists` alone cannot
// catch this (the title is real); `evidenceReferencesReplacement` can.

withFixture((root) => {
  scaffoldClean(root, {
    // The evidence file no longer mentions "applyRichWidgetEdit" ANYWHERE —
    // simulating a test file that imports/exercises only a shared pure
    // module the real replacement wraps, never the replacement itself.
    evidenceTest: `
import { test } from "bun:test";
test("applyWidgetEdit works", () => {});
test("widget-alt helper path works", () => {});
test("widget format items work", () => {});
`,
    matrix: cleanMatrix().replace(
      "packages/desktop/tests/editor/parity-widget.test.ts::applyRichWidgetEdit works",
      "packages/desktop/tests/editor/parity-widget.test.ts::widget-alt helper path works",
    ),
  });
  const r = run(root);
  check("a cited test that exists but never references its row's own replacement identifier fails the gate", r.status, 1);
  check("failure is reported under RULE 6", r.stdout.includes("RULE 6 [test-evidence]: FAIL"), true);
  check("failure names the un-referenced replacement identifier", r.stderr.includes("applyRichWidgetEdit"), true);
});

// --- SABOTAGE: waiver with no reason / no owner ---------------------------

withFixture((root) => {
  scaffoldClean(root, {
    matrix: cleanMatrix().replace(
      "| `block-edit` | Free-form block editing waived for this fixture (not exercised by this test). | product owner (pending) |",
      "| `block-edit` | | product owner (pending) |",
    ),
  });
  const r = run(root);
  check("a waiver with an empty reason fails the gate", r.status, 1);
  check("failure is reported under RULE 4", r.stdout.includes("RULE 4 [waiver-completeness]: FAIL"), true);
});

withFixture((root) => {
  scaffoldClean(root, {
    matrix: cleanMatrix().replace(
      "| `block-edit` | Free-form block editing waived for this fixture (not exercised by this test). | product owner (pending) |",
      "| `block-edit` | Free-form block editing waived for this fixture (not exercised by this test). | |",
    ),
  });
  const r = run(root);
  check("a waiver with an empty owner fails the gate", r.status, 1);
});

// --- SABOTAGE: an action listed in BOTH tables ----------------------------

withFixture((root) => {
  scaffoldClean(root, {
    matrix:
      cleanMatrix() +
      "\n| `widget-edit` | Duplicated into the waivers table by mistake. | product owner (pending) |\n",
  });
  const r = run(root);
  check("an action present in both mapped and waivers tables fails the gate", r.status, 1);
  check("failure names it double-covered", r.stderr.includes("DOUBLE-COVERED"), true);
});

// --- SABOTAGE: six ordinary TypeScript shapes that used to silently drop a
// real commit-reaching action with the gate exiting 0 (SFE-P3d-parity repair
// round 1, CONFIRMED finding). Each adds ONE extra item reaching the commit
// path through a shape the item/method scanning in extractContextMenuActions
// does not itself recognize, WITHOUT adding a matrix row — before the repair
// every one of these exited 0 silently. Now residual call-site accounting
// (RULE 1b) must catch five of them as a loud, named failure; the sixth
// (bound method reference) is fixed at the primary extraction level (the
// widened `this.<name>` reachability test) and must be a normal RULE 3
// unmapped-action failure instead. ----------------------------------------

withFixture((root) => {
  // Shape A: method-shorthand `run() {...}` — not `run: () => {...}`.
  scaffoldClean(root, {
    contextMenu: contextMenuFixture({
      extraDirectItem: `
      {
        id: "widget-shape-a",
        label: "Method-shorthand run",
        enabled: true,
        async run() {
          await this.commit("shapeA1", "shapeA2");
        },
      },`,
    }),
  });
  const r = run(root);
  check("shape A (method-shorthand run) is not silently dropped: gate fails", r.status, 1);
  check("shape A failure is reported under RULE 1b (residual orphan call site)", r.stdout.includes("RULE 1b [residual-calls]: FAIL"), true);
  check("shape A failure names an orphan call site", r.stderr.includes("ORPHAN CALL SITE"), true);
});

withFixture((root) => {
  // Shape B: a helper method reaching commit with NO access modifier —
  // findMethodBodies requires private/public/protected.
  scaffoldClean(root, {
    contextMenu: contextMenuFixture({
      extraClassMember: `
  helperEditNoModifier(): void {
    void this.commit("shapeB1", "shapeB2");
  }
`,
      extraDirectItem: `
      {
        id: "widget-shape-b",
        label: "Modifier-less helper",
        enabled: true,
        run: () => this.helperEditNoModifier(),
      },`,
    }),
  });
  const r = run(root);
  check("shape B (modifier-less helper method) is not silently dropped: gate fails", r.status, 1);
  check("shape B failure is reported under RULE 1b", r.stdout.includes("RULE 1b [residual-calls]: FAIL"), true);
});

withFixture((root) => {
  // Shape C: a class-field arrow property — sigRe requires `IDENT(`, not
  // `IDENT = `.
  scaffoldClean(root, {
    contextMenu: contextMenuFixture({
      extraClassMember: `
  private dangerArrow = async (): Promise<void> => {
    await this.commit("shapeC1", "shapeC2");
  };
`,
      extraDirectItem: `
      {
        id: "widget-shape-c",
        label: "Class-field arrow",
        enabled: true,
        run: () => this.dangerArrow(),
      },`,
    }),
  });
  const r = run(root);
  check("shape C (class-field arrow property) is not silently dropped: gate fails", r.status, 1);
  check("shape C failure is reported under RULE 1b", r.stdout.includes("RULE 1b [residual-calls]: FAIL"), true);
});

withFixture((root) => {
  // Shape D: a module-level free function reached from `run`, calling
  // commitRangePatch directly (no `this.<method>(` for the call-graph walk
  // to find at all).
  scaffoldClean(root, {
    contextMenu: contextMenuFixture({
      extraModuleLevel: `
function dangerModuleHelper(controller: ContextMenuController): void {
  (controller as unknown as { deps: { commitEngine: { commitRangePatch: (p: unknown) => void } } })
    .deps.commitEngine.commitRangePatch({ a: "shapeD1", b: "shapeD2" });
}
`,
      extraDirectItem: `
      {
        id: "widget-shape-d",
        label: "Module-level free function",
        enabled: true,
        run: () => dangerModuleHelper(this),
      },`,
    }),
  });
  const r = run(root);
  check("shape D (module-level free function) is not silently dropped: gate fails", r.status, 1);
  check("shape D failure is reported under RULE 1b", r.stdout.includes("RULE 1b [residual-calls]: FAIL"), true);
});

withFixture((root) => {
  // Shape E: an object-spread-built item — `id` supplied by the spread, not
  // present at the item literal's own depth, so findItemLiterals's
  // `id && run` requirement never registers the item at all.
  scaffoldClean(root, {
    contextMenu: contextMenuFixture({
      extraClassMember: `
  private static readonly SHAPE_E_BASE = { id: "widget-shape-e", label: "Spread-built", enabled: true };
`,
      extraDirectItem: `
      {
        ...ContextMenuController.SHAPE_E_BASE,
        run: async () => {
          await this.commit("shapeE1", "shapeE2");
        },
      },`,
    }),
  });
  const r = run(root);
  check("shape E (object-spread-built item) is not silently dropped: gate fails", r.status, 1);
  check("shape E failure is reported under RULE 1b", r.stdout.includes("RULE 1b [residual-calls]: FAIL"), true);
});

withFixture((root) => {
  // Shape F: a bound method reference (`run: this.helperBound.bind(this)`)
  // — the OLD reach test required `this\.<name>\(`, a direct call, and
  // missed the bare reference. Fixed at the PRIMARY extraction level (the
  // widened `this.<name>` test), so this one gets a real action id and a
  // normal RULE 3 unmapped-action failure — RULE 1b must stay green because
  // helperBound's own body is a recognized (privately-modified) method,
  // correctly attributing its call site regardless.
  scaffoldClean(root, {
    contextMenu: contextMenuFixture({
      extraClassMember: `
  private helperBound(): void {
    void this.commit("shapeF1", "shapeF2");
  }
`,
      extraDirectItem: `
      {
        id: "widget-shape-f",
        label: "Bound method reference",
        enabled: true,
        run: this.helperBound.bind(this),
      },`,
    }),
    // matrix intentionally UNCHANGED — the new action has no row.
  });
  const r = run(root);
  check("shape F (bound method reference) is properly extracted, not silently dropped", r.status, 1);
  check("shape F is reported as an unmapped action under RULE 3 (real extraction, not just a residual failure)", r.stderr.includes("widget-shape-f"), true);
  check("shape F's underlying call site is still correctly attributed (RULE 1b stays green)", r.stdout.includes("RULE 1b [residual-calls]: PASS"), true);
});

// --- SABOTAGE: a mutation reached only through an unrecognized constructor-
// dependency callback (`this.deps.<name>(...)`) — mirrors the LIVE
// `block-edit` / `this.deps.openInlineEdit(...)` case in
// context-menu-controller.svelte.ts. Before the repair this was invisible to
// extraction entirely (no method-name call graph can see a DI callback); now
// any dependency call outside READ_ONLY_DEPENDENCY_METHODS is treated as
// commit-reaching by default. --------------------------------------------

withFixture((root) => {
  scaffoldClean(root, {
    contextMenu: contextMenuFixture({
      extraDirectItem: `
      {
        id: "widget-shape-dep",
        label: "Constructor dependency mutation",
        enabled: true,
        run: () => {
          this.deps.someUnknownMutatingDependency("depArg1", "depArg2");
        },
      },`,
    }),
    // matrix intentionally UNCHANGED — the new action has no row.
  });
  const r = run(root);
  check("a mutation reached only through an unrecognized constructor-dependency call is extracted, not invisible", r.status, 1);
  check("the dependency-reached action is reported as unmapped under RULE 3", r.stderr.includes("widget-shape-dep"), true);
});

// --- SABOTAGE: fail-open regex literal with an unpaired quote inside a
// character class (`/['"]/`) collapses buildMask()'s naive string handling
// into a phantom string that swallows the rest of the file — SFE-P3d-parity
// repair round 1 (CONFIRMED finding). Before the repair this exited 0 with
// "scanned 0 context-menu item literal(s)" because AP-21 liveness was
// computed on the UNION of both files' extracted actions and inline-edit's
// unaffected `block-edit` masked the collapse. -----------------------------

withFixture((root) => {
  scaffoldClean(root, {
    contextMenu:
      `const APOS_OR_QUOTE = /['"]/g;\n` +
      contextMenuFixture({
        extraDirectItem: `
      {
        id: "widget-regex-victim-1",
        label: "Victim 1",
        enabled: true,
        run: async () => { await this.commit("r1", "r2"); },
      },
      {
        id: "widget-regex-victim-2",
        label: "Victim 2",
        enabled: true,
        run: async () => { await this.commit("r3", "r4"); },
      },`,
      }),
  });
  const r = run(root);
  check("a regex literal with an unpaired quote does not silently collapse extraction to a green gate", r.status !== 0, true);
  check(
    "the mask-integrity failure is reported (unterminated string), not a silent PASS",
    r.stderr.includes("unterminated"),
    true,
  );
});

// --- SABOTAGE: per-file AP-21 liveness — a TOTAL collapse of ONE file's
// extraction must fail even while the OTHER file still contributes actions
// (the union-based check this replaces could never go red on either file
// alone, since `block-edit` is independently extracted from BOTH files).

withFixture((root) => {
  scaffoldClean(root, {
    contextMenu: `
export class ContextMenuController {
  private buildItems(): unknown[] {
    return [
      {
        id: "go-to-source",
        label: "Go to source",
        enabled: true,
        run: () => { this.deps.goToSource(); },
      },
    ];
  }
}
`,
    // inlineEdit left CLEAN — it still yields a real, extractable block-edit
    // action, which is exactly what let the OLD union check pass silently.
  });
  const r = run(root);
  check(
    "a total collapse of context-menu extraction fails the gate even though inline-edit still yields block-edit (per-file liveness)",
    r.status,
    1,
  );
  check(
    "the failure specifically names context-menu-controller.svelte.ts's own liveness",
    r.stdout.includes("context-menu-controller.svelte.ts extraction yielded"),
    true,
  );
});

withFixture((root) => {
  scaffoldClean(root, {
    // commit() with NO access modifier — findMethodBodies never sees it, so
    // inline-edit extraction yields zero methods and zero actions.
    inlineEdit: `
export class InlineEditController {
  async commit(text: string): Promise<void> {
    await this.deps.commitEngine.commitRangePatch({ text });
  }
}
`,
    // contextMenu left CLEAN — it still yields real, extractable actions.
  });
  const r = run(root);
  check(
    "a total collapse of inline-edit extraction (modifier-less commit) fails the gate even though context-menu still yields actions (per-file liveness)",
    r.status,
    1,
  );
  check(
    "the failure specifically names inline-edit-controller.svelte.ts's own liveness",
    r.stdout.includes("inline-edit-controller.svelte.ts extraction yielded"),
    true,
  );
});

// --- Positive: a code-bearing, INTERPOLATED template literal inside a
// commit-reaching item's `run` closure does not defeat extraction — mirrors
// the LIVE template literal at context-menu-controller.svelte.ts:793
// (SFE-P3d-parity repair round 1, CONFIRMED finding: the header used to
// falsely claim no such literal existed in the real file and that this case
// was fixture-covered; neither was true before this repair).

withFixture((root) => {
  scaffoldClean(root, {
    contextMenu: contextMenuFixture({
      extraDirectItem: `
      {
        id: "widget-template-literal",
        label: "Template literal in run",
        enabled: true,
        run: async () => {
          const note = \`This selection already contains \${"formatting"} noted\`;
          await this.commit("t1", "t2");
        },
      },`,
    }),
    matrix:
      cleanMatrix() +
      "\n| `widget-template-literal` | `toolbar-actions.ts#applyWidgetEdit` | source toolbar | `packages/desktop/tests/editor/parity-widget.test.ts::applyWidgetEdit works` |\n",
  });
  const r = run(root);
  check("a code-bearing interpolated template literal in a commit-reaching item's run closure does not defeat extraction", r.status, 0);
  check("the template-literal item is extracted and mapped (RULE 3 passes)", r.stdout.includes("RULE 3 [coverage]: PASS"), true);
});

// --- Positive: stale matrix rows (action id no longer extracted) WARN, not FAIL ---

withFixture((root) => {
  scaffoldClean(root, {
    matrix: cleanMatrix() + "\n| `widget-long-gone` | This action was removed upstream. | product owner (pending) |\n",
  });
  const r = run(root);
  check("a stale waiver row (action no longer extracted) does not fail the gate", r.status, 0);
  check("stale row is reported as a WARN", r.stdout.includes("WARN"), true);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall tests passed");
