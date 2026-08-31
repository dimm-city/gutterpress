/**
 * rich-mode-commit-integration.test.ts (SFE-P3ab review round 1 repair).
 *
 * Proves a CONFIRMED review finding's fix end-to-end: "Rich mode is a
 * second, never-refreshed document owner — preview commits are silently
 * reverted by the next rich command."
 *
 * Before the fix, `+page.svelte`'s `CommitEngine` construction reported
 * `editorHasFile` as permanently `false` while rich mode was active
 * (`editorRef` — the CodeMirror binding — is always `null` in rich mode),
 * so `commitRangePatch` always fell through to `buf.edit(...)` directly.
 * `EditorBuffer.edit()` does not fire `onContentReplaced` (that callback is
 * reserved for EXTERNAL replacements), so the mounted rich host
 * (`richDocHost`) never learned about the commit and kept showing the
 * pre-commit text. The next rich-mode command then read that STALE
 * snapshot, applied its own edit on top of it, and pushed the combined
 * stale-plus-new text back through `richDocHost.subscribe ->
 * onEditorChange -> buffer.edit(...)` — silently REVERTING the commit.
 *
 * The fix makes `editorHasFile`/`applyRangeEdit` surface-aware: while rich
 * mode is the live surface for the target file, the commit routes through
 * `richDocHost.applyEdit` (the SAME seam every other rich-mode command
 * uses), whose own `subscribe` forwards the accepted edit into
 * `buffer.edit(...)` — so the buffer and the rich host can never diverge.
 *
 * This test wires `CommitEngine` + a REAL `DesktopDocumentHost` the exact
 * same way `+page.svelte` now does (see that file's `commitEngine`
 * construction and `rebuildRichDocHost`), then proves the out-of-band
 * commit survives a subsequent rich-mode command.
 */
import { describe, expect, test } from "bun:test";
import {
  CommitEngine,
  type CommitEngineBuffer,
  type CommitEngineDeps,
  type CommitPatch,
} from "../../src/lib/editor/commit-engine";
import { DesktopDocumentHost } from "../../src/lib/editor-host/desktop-document-host";
import { applyRichCommand } from "../../src/lib/editor/rich-commands";

/** A minimal `CommitEngineBuffer` standing in for `EditorBuffer` — the
 *  commit engine only needs this narrow surface (see its own
 *  `CommitEngineBuffer` interface). */
class FakeBuffer implements CommitEngineBuffer {
  filePath: string;
  content: string;
  diskContent: string;
  phase: "clean" | "dirty" | "saving" | "error" = "clean";
  externalChange: unknown | null = null;
  hasPendingSave = false;

  constructor(filePath: string, content: string) {
    this.filePath = filePath;
    this.content = content;
    this.diskContent = content;
  }

  async reconcileExternalChange(): Promise<void> {}
  async flush(): Promise<void> {
    this.diskContent = this.content;
  }
  edit(text: string): void {
    this.content = text;
  }
}

describe("preview commit while rich mode is the live surface (SFE-P3ab review round 1, CONFIRMED finding)", () => {
  test("an out-of-band commit-engine write reaches richDocHost, and a subsequent rich command builds on it instead of reverting it", async () => {
    const path = "/proj/ch1.md";
    const initial = "a\nline two\nc\n";
    const buf = new FakeBuffer(path, initial);

    // The rich mount's document host — a REAL DesktopDocumentHost, not a
    // fake, so this proves the actual `applyEdit`/`subscribe` contract.
    const richDocHost = new DesktopDocumentHost(initial, { documentId: path });
    // Mirrors `+page.svelte`'s `rebuildRichDocHost`: every accepted
    // richDocHost edit forwards into the buffer.
    richDocHost.subscribe((snapshot) => buf.edit(snapshot.text));

    // Mirrors `+page.svelte`'s `CommitEngine` construction while
    // `richSurfaceActive` is true: route through `richDocHost.applyEdit`,
    // never `buf.edit` directly.
    const deps: CommitEngineDeps = {
      currentDir: () => "/proj",
      rendering: () => false,
      buffer: () => buf,
      selectEditorFile: async () => true,
      editorHasFile: (p) => p === path,
      applyRangeEdit: (p, from, to, insert) => {
        if (p !== path) return;
        richDocHost.applyEdit({ from, to, insert, expectedVersion: richDocHost.getSnapshot().version });
      },
    };
    const engine = new CommitEngine(deps);

    // A preview-originated commit (e.g. an inline-edit or context-menu
    // action) — identical patch shape to commit-engine.test.ts's own
    // default fixture.
    const patch: CommitPatch = {
      chapter: "ch1.md",
      range: [1, 2],
      expected: "line two\n",
      replacement: "line TWO\n",
      expectedGeneration: 0,
    };
    const outcome = await engine.commitRangePatch(patch);
    expect(outcome.ok).toBe(true);

    const committed = "a\nline TWO\nc\n";
    // The buffer sees the commit (this much was already true before the
    // fix — the bug was specifically that richDocHost did NOT).
    expect(buf.content).toBe(committed);
    // THE LOAD-BEARING ASSERTION: richDocHost saw it too. Before the fix,
    // richDocHost stayed at its PRE-commit snapshot ("a\nline two\nc\n")
    // here, because the commit bypassed it entirely.
    expect(richDocHost.getSnapshot().text).toBe(committed);
    expect(richDocHost.getSnapshot().version).toBe(1);

    // Now apply an ORDINARY rich-mode command on top of the committed
    // text — Bold on the word "line" inside "line TWO".
    const wordStart = committed.indexOf("line TWO");
    const richOutcome = applyRichCommand(
      richDocHost,
      { kind: "toggle-bold" },
      { from: wordStart, to: wordStart + "line".length },
    );
    expect(richOutcome.ok).toBe(true);

    // The out-of-band commit SURVIVES: the rich command built on top of
    // "TWO", not on top of a silently-reverted "two". Before the fix, this
    // command would have read richDocHost's STALE pre-commit snapshot,
    // reformatted "line two" instead, and pushed that whole stale-plus-bold
    // result back through `subscribe -> buffer.edit`, discarding the
    // preview's "TWO" commit entirely.
    if (richOutcome.ok) {
      expect(richOutcome.snapshot.text).toContain("TWO");
      expect(richOutcome.snapshot.text).not.toContain("line two\n");
    }
    // ...and the buffer — which only ever hears about edits through
    // richDocHost's own subscribe forwarding — agrees.
    expect(buf.content).toContain("TWO");
    expect(buf.content).not.toContain("line two\n");
  });
});
