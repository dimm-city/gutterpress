import { mountEditor, type EditorMount } from "../../../src/web/mount.ts";
import { MemoryDocumentHost } from "../../../src/core/index.ts";

/**
 * SFE-P3f, Lane A — D13 measurement-pass regression guard.
 *
 * MECHANISM ASSERTED (full evidence in this run's `p3d-sweep-audit.md`
 * "## Lane E (P3f)" section and `PATCHES.md`'s new hunk): before this
 * patch, `EditorView._publishMeasurements` (`dist/index.js`) called
 * `Pe.measure()` for EVERY mounted top-level block on EVERY render,
 * regardless of how much of the document actually changed —
 * `Pe.measure()` walks every text leaf in a block and calls
 * `document.createRange()` once per leaf (`mo()`'s `forEachTextLeaf`
 * callback). That made `document.createRange()` call count scale with
 * total document size per keystroke: O(document), not O(changed). The
 * patch skips that walk for a block whose view-node identity (and
 * `className`) the fork's own renderer already reused unchanged, so
 * `document.createRange()` should now be called only for the block(s) an
 * ordinary keystroke actually touches, regardless of how large the rest of
 * the mounted document is.
 *
 * This entry monkey-patches the GLOBAL `document.createRange` to count
 * calls, entirely from the test side — no production hook was added to
 * `dist/index.js` for this (that would be scope creep beyond the patch
 * itself); the fork already calls `document.createRange()` as an ordinary
 * global browser API, so intercepting it here observes the real mechanism
 * without touching a single vendored line for the counting itself.
 */

export interface MeasurementGuardDriver {
  mount(text: string): void;
  dispose(): void;
  getRangeCallCount(): number;
  resetRangeCallCount(): void;
  readonly containerSelector: string;
}

declare global {
  interface Window {
    // Distinct from every other browser test entry's global — see
    // support/entry.ts's own comment on why this must be unique (every
    // entry's `declare global` merges into one TypeScript program).
    __gpMeasurementGuard: MeasurementGuardDriver;
    __gpReady?: boolean;
  }
}

const CONTAINER_ID = "gp-measurement-guard-container";

let mountHandle: EditorMount | undefined;
let rangeCalls = 0;
const originalCreateRange = document.createRange.bind(document);
document.createRange = function gpCountingCreateRange(): Range {
  rangeCalls++;
  return originalCreateRange();
};

function mount(text: string): void {
  mountHandle?.dispose();
  document.getElementById(CONTAINER_ID)?.remove();

  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  document.body.appendChild(container);

  const host = new MemoryDocumentHost({ text, version: 0 });
  mountHandle = mountEditor(container, host, {});
}

window.__gpMeasurementGuard = {
  mount,
  dispose(): void {
    mountHandle?.dispose();
    mountHandle = undefined;
    document.getElementById(CONTAINER_ID)?.remove();
  },
  getRangeCallCount: (): number => rangeCalls,
  resetRangeCallCount: (): void => {
    rangeCalls = 0;
  },
  containerSelector: `#${CONTAINER_ID}`,
};
window.__gpReady = true;
