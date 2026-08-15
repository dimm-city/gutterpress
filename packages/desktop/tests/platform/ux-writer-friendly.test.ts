/**
 * Writer-friendly UX follow-up (maintainer request): saving / previous
 * versions / online copy / crash recovery are presented to non-technical
 * writers as plain-language protection layers, and the TOC panel is a
 * collapsible tree. No component-render harness exists here, so — following the
 * repo convention (ProjectActivityView.test.ts) — these assert on the compiled
 * source text: the new writer-facing strings appear, the jargon-y ones don't,
 * and the interaction wiring is present.
 */
import { expect, test, describe } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("Settings — 'Saving & recovery' group with writer-friendly labels", () => {
  const dialog = read("src/lib/components/SettingsView.svelte");
  test("consolidated group + plain-language controls", () => {
    expect(dialog).toContain("Saving &amp; recovery");
    expect(dialog).toContain("Save edits automatically");
    expect(dialog).toContain("Keep previous versions");
    expect(dialog).toContain("Create a version after I stop editing for");
    expect(dialog).toContain("Keep an online copy up to date");
    expect(dialog).toContain("Recover edits after an unexpected close");
  });
  test("crash recovery is described as a temporary emergency copy, distinct from history", () => {
    expect(dialog).toContain("temporary emergency copy");
    expect(dialog).toContain("separate from your previous versions");
  });
  test("turning off one layer does not imply the others are disabled", () => {
    expect(dialog).toContain("does not affect saving on this computer");
    expect(dialog).toContain("or your previous versions");
  });
  test("old jargon labels are gone", () => {
    expect(dialog).not.toContain("Automatic snapshots");
    expect(dialog).not.toContain("Automatically keep changes in sync");
    expect(dialog).not.toContain(">Git identity<");
  });
});

describe("Previous versions timeline (ProjectActivityView)", () => {
  const view = read("src/lib/components/ProjectActivityView.svelte");
  test("titled 'Previous versions', renders a day-grouped timeline via the helper", () => {
    expect(view).toContain("Previous versions");
    expect(view).toContain("groupVersionsByDay");
    expect(view).toContain("versionLabel(entry.message)");
    expect(view).toContain("day.label");
  });
  test("restore copy states current work is saved as a version first", () => {
    expect(view).toContain("Restore this version");
    expect(view).toContain("We'll save your current work as a version first");
  });
  test("raw log stays behind a Technical details disclosure; no operation-log framing", () => {
    expect(view).toContain("<summary>Technical details</summary>");
    expect(view).not.toContain("Operation log");
    expect(view).not.toContain("No snapshots yet");
  });
});

describe("Status bar — one calm state opening a 3-row protection summary", () => {
  const status = read("src/lib/components/StatusBar.svelte");
  test("default label is 'All work saved'", () => {
    expect(status).toContain('return "All work saved"');
    expect(status).not.toContain('return "All changes saved"');
  });
  test("summary shows local save, previous versions, and online copy separately", () => {
    expect(status).toContain("On this computer");
    expect(status).toContain("Previous versions");
    expect(status).toContain("Online copy");
  });
  test("a manual 'Save a version now' action is offered", () => {
    expect(status).toContain("Save a version now");
    expect(status).toContain("onSaveVersion");
  });
  test("the online-copy row reflects the LIVE sync state, not just the capability flag (#1)", () => {
    const pill = read("src/lib/components/SyncStatusPill.svelte");
    // StatusBar derives the row from the live state surfaced by the pill,
    // so a syncing/up-to-date project never wrongly reads "not set up".
    expect(status).toContain("liveSyncState");
    expect(status).toContain("onSyncState={(s) => (liveSyncState = s)}");
    expect(status).not.toContain('canSync ? "Kept up to date in the background" : "Not set up for this project"');
    // The pill surfaces every transition upward.
    expect(pill).toContain("onSyncState?.(status.state)");
  });
  test("a configured-but-unsynced remote is NOT reported as local-only (#1)", () => {
    const page = read("src/routes/+page.svelte");
    const session = read("src/lib/routes/project-session-controller.svelte.ts");
    // The status bar takes a hasRemote signal and only says "Kept on this
    // computer" when there is genuinely no remote; a project WITH a remote that
    // Gutterpress just isn't auto-syncing (SSH / uncredentialed HTTPS) reads
    // "Not syncing automatically" instead.
    expect(status).toContain("hasRemote");
    expect(status).toContain('return hasRemote ? "Not syncing automatically" : "Kept on this computer"');
    // hasRemote flows from the project source classification, through the
    // session controller, to the status bar.
    expect(session).toContain("projectHasRemote");
    expect(session).toContain("result.source.hasRemote");
    expect(page).toContain("hasRemote={projectSession.projectHasRemote}");
  });
  test("the 'connect' state directs the writer to the connect flow (never a dead end)", () => {
    const pill = read("src/lib/components/SyncStatusPill.svelte");
    const page = read("src/routes/+page.svelte");
    // Pill: actionable copy + click routes to the same connect/reconnect flow
    // as "auth" — an HTTPS remote Gutterpress isn't connected to is ONE step from
    // syncing, not a "kept on this computer" dead end.
    expect(pill).toContain('case "connect":');
    expect(pill).toContain("Connect to keep an online copy");
    expect(pill).toContain('syncState === "auth" || syncState === "connect"');
    // Status summary: the row pairs honest copy with a one-click action.
    expect(status).toContain('case "connect":');
    expect(status).toContain("Not connected yet");
    expect(status).toContain("Connect to sync online");
    expect(status).toContain("onConnectOnline");
    expect(page).toContain("onConnectOnline={onSyncReconnect}");
  });
  test("the pill seeds itself from the host's retained status (no lost one-shot emits)", () => {
    const pill = read("src/lib/components/SyncStatusPill.svelte");
    // "sync:status" is fire-and-forget; a subscription that lands after the
    // project-open emit used to strand the pill blank/stale forever.
    expect(pill).toContain("api.sync");
    expect(pill).toContain(".getStatus(projectDir)");
    // A live push wins over the (older) seed.
    expect(pill).toContain("receivedLive");
  });
  test("the at-open diagnosis is keyed to the dir currentDir is assigned (race fixed)", () => {
    const lifecycle = read("src/lib/routes/project-lifecycle-controller.svelte.ts");
    // refreshSyncDiag fires AFTER `this.currentDir = targetDir` with the SAME
    // targetDir — the old classify()-time call was deterministically discarded
    // by the SyncController's stale-guard on every open.
    const assignIdx = lifecycle.indexOf("this.currentDir = targetDir;");
    const refreshIdx = lifecycle.indexOf("d.refreshSyncDiag(targetDir);");
    expect(assignIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeGreaterThan(assignIdx);
    // And classify() no longer fires it at all.
    const session = read("src/lib/routes/project-session-controller.svelte.ts");
    expect(session).not.toContain("deps.refreshSyncDiag(");
  });
});

describe("Failure & conflict copy reassures that local work is safe", () => {
  test("sync failure keeps a calm, reassuring message", () => {
    const ctrl = read("src/lib/routes/sync-controller.svelte.ts");
    expect(ctrl).toContain("Your work is saved on this computer");
  });
  test("image clash copy is calm and jargon-free ('changed in two places', never 'conflict')", () => {
    const dlg = read("src/lib/components/ImageClashPicker.svelte");
    expect(dlg).toContain("The same picture changed in two places");
    expect(dlg).toContain("nothing is lost");
    expect(dlg).not.toContain("merge conflict");
  });
  test("the sync pill uses 'Previous versions available', not 'Version history on'", () => {
    const pill = read("src/lib/components/SyncStatusPill.svelte");
    expect(pill).toContain("Previous versions available");
    expect(pill).not.toContain("Version history on");
  });
});

describe("Table of contents — collapsible tree matching the Files panel", () => {
  const left = read("src/lib/components/LeftPanel.svelte");
  test("renders an accessible tree with expanded-state + level semantics", () => {
    expect(left).toContain('role="tree"');
    expect(left).toContain('role="treeitem"');
    expect(left).toContain("aria-expanded={hasChildren ? isOpen : undefined}");
    expect(left).toContain("aria-level={depth}");
  });
  test("derives the hierarchy from the flat outline and reveals the active branch", () => {
    expect(left).toContain("buildTocTree(outline)");
    expect(left).toContain("ancestorKeysForActive(outline, activeOutlineIndex)");
  });
  test("expansion is a separate control from navigation (chevron button ≠ label button)", () => {
    // A dedicated disclosure button toggles; the label button selects.
    expect(left).toContain("onclick={() => toggleToc(node.key)}");
    expect(left).toContain("onclick={() => selectToc(node)}");
    // Keyboard expand/collapse is wired independently of navigation.
    expect(left).toContain("onkeydown={(e) => onTocKeydown(e, node)}");
  });

  test("selecting a section also expands it (navigate + reveal children)", () => {
    // selectToc adds the node to the expanded set before navigating.
    expect(left).toContain("function selectToc(node: TocNode)");
    expect(left).toContain("onJumpToOutline?.(node.entry)");
  });

  test("disclosure control has a Files-panel-sized visible target", () => {
    expect(left).toContain('size={18}');
    expect(left).toContain('width: 28px');
    expect(left).toContain('min-height: 28px');
  });
});
