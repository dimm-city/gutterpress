/**
 * The state -> words mapping behind the status bar's one status control, and
 * the "Saved · last version …" line in Book setup → Online copy. Pure, so every
 * situation is asserted here: the text, the shape that carries the tone, and
 * the vocabulary (docs/ux-design-contract.md).
 */
import { describe, expect, test } from "bun:test";
import { NOTHING_NEW_NOTICE, statusLine, versionsLine, type StatusLineInput } from "../../src/lib/save-status";
import type { SyncState } from "../../src/lib/platform/contract";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const MIN = 60_000;
const DAY = 86_400_000;

function input(over: Partial<Omit<StatusLineInput, "backup">> & { sync?: SyncState; message?: string } = {}): StatusLineInput {
  const { sync, message, ...rest } = over;
  return {
    savePhase: "clean",
    autoSave: true,
    forceSaving: false,
    versionsProblem: null,
    backup: sync ? { state: sync, ...(message ? { message } : {}) } : null,
    hasRemote: false,
    backingUp: false,
    ...rest,
  };
}

const text = (over?: Parameters<typeof input>[0]) => statusLine(input(over)).text;

describe("statusLine: saving", () => {
  test("typing is 'Saving…', in flight", () => {
    for (const savePhase of ["dirty", "saving"] as const) {
      expect(statusLine(input({ savePhase }))).toMatchObject({ text: "Saving…", icon: "refresh-cw", tone: "pending" });
    }
    expect(text({ forceSaving: true })).toBe("Saving…");
  });

  test("with autosave off, unsaved work is 'Unsaved changes', never 'Saving…'", () => {
    expect(statusLine(input({ savePhase: "dirty", autoSave: false }))).toMatchObject({ text: "Unsaved changes", icon: "pen-line", tone: "warn" });
    expect(text({ savePhase: "dirty", autoSave: false, forceSaving: true })).toBe("Saving…");
  });

  test("a failed save outranks everything, even a quiet online copy", () => {
    expect(statusLine(input({ savePhase: "error", sync: "synced" }))).toMatchObject({ text: "Couldn't save", icon: "circle-x", tone: "error" });
  });
});

describe("statusLine: the online copy", () => {
  test("no online copy", () => {
    expect(text()).toBe("Saved on this computer");
    expect(text({ sync: "local" })).toBe("Saved on this computer");
  });

  test("an online copy whose state isn't known yet claims nothing about it", () => {
    expect(text({ hasRemote: true })).toBe("Saved");
  });

  test("each state has its own line", () => {
    expect(statusLine(input({ sync: "synced" }))).toMatchObject({ text: "Saved · Backed up", icon: "circle-check", tone: "ok" });
    expect(statusLine(input({ sync: "syncing" }))).toMatchObject({ text: "Saved · Backing up…", icon: "refresh-cw", tone: "pending" });
    expect(text({ backingUp: true, sync: "synced" })).toBe("Saved · Backing up…");
    expect(statusLine(input({ sync: "unsent" }))).toMatchObject({ text: "Saved · Not backed up yet", icon: "cloud-upload" });
    expect(text({ sync: "offline" })).toBe("Saved · Offline — backs up when you're back");
    expect(statusLine(input({ sync: "error" }))).toMatchObject({ text: "Saved · Backing up paused", icon: "triangle-alert", tone: "warn" });
  });

  test("a missing or rejected sign-in asks for one", () => {
    for (const sync of ["auth", "connect"] as const) {
      expect(statusLine(input({ sync }))).toMatchObject({ text: "Saved · Sign in to back up", icon: "triangle-alert", tone: "warn" });
    }
  });

  test("a paused backup shows the host's own explanation as the tooltip", () => {
    expect(statusLine(input({ sync: "error", message: "The online copy is full." })).title).toBe("The online copy is full.");
    expect(statusLine(input({ sync: "synced" })).title).toBe("Saved · Backed up — click for details");
  });
});

describe("statusLine: versions that need attention", () => {
  const problem = { message: "Close any other program using the folder." };

  test("outranks the quiet online states, with the host's explanation as the tooltip", () => {
    for (const sync of [undefined, "local", "synced", "unsent"] as const) {
      expect(statusLine(input({ versionsProblem: problem, sync }))).toMatchObject({
        text: "Versions need attention",
        title: problem.message,
        icon: "triangle-alert",
        tone: "warn",
      });
    }
  });

  test("never hides a sign-in, a pause or a backup in flight", () => {
    expect(text({ versionsProblem: problem, sync: "auth" })).toBe("Saved · Sign in to back up");
    expect(text({ versionsProblem: problem, sync: "error" })).toBe("Saved · Backing up paused");
    expect(text({ versionsProblem: problem, sync: "syncing" })).toBe("Saved · Backing up…");
  });

  test("does not hide a save in flight either", () => {
    expect(text({ versionsProblem: problem, savePhase: "saving" })).toBe("Saving…");
  });
});

describe("vocabulary", () => {
  test("every state reads in the product's own words", () => {
    const states: SyncState[] = ["idle", "syncing", "synced", "unsent", "offline", "auth", "error", "local", "connect"];
    const lines = states.flatMap((sync) => [true, false].map((hasRemote) => statusLine(input({ sync, hasRemote })).text));
    lines.push(text({ versionsProblem: { message: null } }), text({ savePhase: "error" }), text({ savePhase: "dirty", autoSave: false }));
    for (const line of lines) {
      expect(line.length).toBeGreaterThan(0);
      expect(line).not.toMatch(/online backup|\bsync|repository|\bremote\b|snapshot|commit|\bpush|\bpull|branch/i);
    }
  });
});

describe("versionsLine: the line about this computer", () => {
  test("names when the last version was made", () => {
    expect(versionsLine({ lastVersionAt: NOW - 10 * MIN, changedFiles: 0, now: NOW })).toBe("Saved · last version 10 mins ago");
    expect(versionsLine({ lastVersionAt: NOW - 3 * DAY, changedFiles: null, now: NOW })).toBe("Saved · last version 3 days ago");
    expect(versionsLine({ lastVersionAt: NOW, changedFiles: 0, now: NOW })).toBe("Saved · last version just now");
  });

  test("says how many files are saved but not in a version yet", () => {
    expect(versionsLine({ lastVersionAt: NOW - DAY, changedFiles: 1, now: NOW })).toBe("Saved · last version 1 day ago · 1 file not in a version yet");
    expect(versionsLine({ lastVersionAt: NOW - DAY, changedFiles: 4, now: NOW })).toBe("Saved · last version 1 day ago · 4 files not in a version yet");
  });

  test("work a crashed attempt may have left is not claimed as safe", () => {
    expect(versionsLine({ lastVersionAt: NOW - DAY, changedFiles: 0, stale: true, now: NOW })).toBe(
      "Saved · last version 1 day ago · some recent work may not be in a version yet",
    );
  });

  test("a book with no versions yet says so", () => {
    expect(versionsLine({ lastVersionAt: null, changedFiles: 0, now: NOW })).toBe("Saved · no versions yet");
  });

  test("never says snapshot, commit or 'saved copy'", () => {
    const all = [versionsLine({ lastVersionAt: NOW, changedFiles: 2, now: NOW }), NOTHING_NEW_NOTICE].join(" ");
    expect(all).not.toMatch(/snapshot|commit|saved copy|restore point/i);
  });
});
