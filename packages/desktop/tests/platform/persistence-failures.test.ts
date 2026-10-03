import { expect, test } from "bun:test";
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
  ).toBe("Your last edit in your book during your previous session may not have been saved.");
});

