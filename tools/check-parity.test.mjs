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

function contextMenuFixture({ extraDirectItem = "", extraFormatKind = "" } = {}) {
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
