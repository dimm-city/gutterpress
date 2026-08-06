import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PersistenceFailureNotifier,
  createLastFlushFailure,
  formatLastFlushFailureNotice,
} from "../../src/lib/persistence-failures";

test("ignored persistence failures notify once at the third failure without toast storms", () => {
  const notifier = new PersistenceFailureNotifier();
  let notices = 0;
  const notify = () => {
    notices += 1;
    return true;
  };

  notifier.recordFailure(notify);
  notifier.recordFailure(notify);
  expect(notices).toBe(0);
  notifier.recordFailure(notify);
  expect(notices).toBe(1);
  for (let i = 0; i < 20; i++) notifier.recordFailure(notify);
  expect(notices).toBe(1);
});

test("a threshold reached before the toast surface exists retries without duplicating a shown notice", () => {
  const notifier = new PersistenceFailureNotifier();
  let ready = false;
  let notices = 0;
  const notify = () => {
    if (!ready) return false;
    notices += 1;
    return true;
  };

  notifier.recordFailure(notify);
  notifier.recordFailure(notify);
  notifier.recordFailure(notify);
  expect(notices).toBe(0);
  ready = true;
  notifier.recordFailure(notify);
  notifier.recordFailure(notify);
  expect(notices).toBe(1);
});

test("flush marker and notice carry concise project and date context", () => {
  const marker = createLastFlushFailure(
    "C:\\Writers\\Field Guide",
    new Date("2026-07-26T14:30:00.000Z"),
  );
  expect(marker).toEqual({
    projectDir: "C:\\Writers\\Field Guide",
    failedAt: "2026-07-26T14:30:00.000Z",
  });
  expect(formatLastFlushFailureNotice(marker, () => "Jul 26, 2026, 2:30 PM")).toBe(
    "Your last edit in Field Guide on Jul 26, 2026, 2:30 PM may not have been saved.",
  );
});

test("notice degrades safely when project or date context is unavailable", () => {
  expect(
    formatLastFlushFailureNotice(
      { failedAt: "not-a-date" },
      () => "must not run",
    ),
  ).toBe("Your last edit in your project during your previous session may not have been saved.");
});

test("the page routes every destructive buffer transition and close through the failure-aware flush", () => {
  const page = readFileSync(
    path.resolve(import.meta.dir, "../../src/routes/+page.svelte"),
    "utf8",
  );

  expect(page).not.toMatch(/\.flush\(\)\.catch\(\(\) => \{\}\)/);
  expect(page).toContain("flushBuffer: () => flushEditorBuffer()"); // project close/switch lifecycle
  expect(page).toContain("onFlushBeforeClose(() => flushEditorBuffer(false))");
  expect(page).toContain("return flushEditorBuffer();"); // tree rename/delete

  // Switching chapters and switching the mobile Markdown/CSS tab used to be
  // destructive too — each replaced the ONE editor document, so each had to
  // flush first or drop an edit still inside the autosave window. Neither
  // replaces anything now: every open file keeps its own buffer and its own
  // pending save, so there is no transition left for a missing flush to lose.
  expect(page).not.toContain("flushEditorBuffer(buf)");

  const fileTree = readFileSync(
    path.resolve(import.meta.dir, "../../src/lib/components/FileTree.svelte"),
    "utf8",
  );
  expect(fileTree).toContain("(await onBeforeRename?.(oldPath)) === false");
  expect(fileTree).toContain("(await onBeforeDelete?.(entry.path)) === false");
});
