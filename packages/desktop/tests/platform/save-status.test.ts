/**
 * The state -> words mapping behind the status bar's one status control, and
 * the "Saved · last version …" line in Book setup → Online copy. Pure, so every
 * situation is asserted here: the text, the shape that carries the tone, and
 * the vocabulary (docs/ux-design-contract.md).
 */
import { describe, expect, test } from "bun:test";
import { bannedTermsIn } from "../../../cli/src/test-helpers/vocabulary";
import { NOTHING_NEW_NOTICE, saveFailureReason, statusLine, versionsLine, type BackupSyncState, type StatusBackup, type StatusLineInput } from "../../src/lib/save-status";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const MIN = 60_000;
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

type Over = Partial<Omit<StatusLineInput, "backup">> & {
  sync?: BackupSyncState;
  message?: string;
  extra?: Partial<StatusBackup>;
};

function input(over: Over = {}): StatusLineInput {
  const { sync, message, extra, ...rest } = over;
  return {
    savePhase: "clean",
    autoSave: true,
    forceSaving: false,
    versionsProblem: null,
    backup: sync ? { state: sync, ...(message ? { message } : {}), ...extra } : null,
    hasRemote: false,
    backingUp: false,
    classified: true,
    now: NOW,
    ...rest,
  };
}

const text = (over?: Over) => statusLine(input(over)).text;
const key = (over?: Over) => statusLine(input(over)).key;

describe("statusLine: saving", () => {
  test("typing is 'Saving…', in flight, and a click does nothing", () => {
    for (const savePhase of ["dirty", "saving"] as const) {
      expect(statusLine(input({ savePhase }))).toMatchObject({ text: "Saving…", icon: "refresh-cw", tone: "pending", click: "none" });
    }
    expect(text({ forceSaving: true })).toBe("Saving…");
  });

  test("with autosave off, unsaved work is 'Unsaved changes', and the click saves", () => {
    expect(statusLine(input({ savePhase: "dirty", autoSave: false }))).toMatchObject({
      text: "Unsaved changes · Ctrl+S to save",
      headline: "Unsaved changes",
      icon: "pen-line",
      tone: "warn",
      click: "action",
      clickAction: "save",
    });
    expect(text({ savePhase: "dirty", autoSave: false, forceSaving: true })).toBe("Saving…");
    expect(text({ savePhase: "dirty", autoSave: false, saveKey: "Cmd+S" })).toBe("Unsaved changes · Cmd+S to save");
  });

  test("a failed save outranks everything, shows the reason and offers Try again", () => {
    const l = statusLine(input({ savePhase: "error", saveError: "The disk is full.", sync: "synced", decide: 2 }));
    expect(l).toMatchObject({ key: "save-failed", text: "Couldn't save", icon: "circle-x", tone: "error", click: "popover" });
    expect(l.detail).toBe("The disk is full.");
    expect(l.primary).toEqual({ id: "save", label: "Try again" });
  });
});

describe("statusLine: where it stands with the online copy", () => {
  const online = { hasRemote: true };

  test("an online copy with no answer yet says it is checking, never a bare 'Saved'", () => {
    expect(statusLine(input(online))).toMatchObject({ key: "checking", text: "Saved here · Checking online…", tone: "pending" });
    expect(text({ ...online, sync: "idle" })).toBe("Saved here · Checking online…");
  });

  test("once the renderer's own check has answered, it stops saying it is checking", () => {
    expect(statusLine(input({ ...online, checked: true }))).toMatchObject({ key: "nothing-new", text: "Saved here · Nothing new online" });
  });

  test("online carries a relative time that follows the clock", () => {
    const at = ago(3 * MIN);
    expect(text({ ...online, sync: "synced", extra: { lastSyncAt: at } })).toBe("Saved here · Saved online 3 minutes ago");
    expect(statusLine(input({ ...online, sync: "synced", extra: { lastSyncAt: at }, now: NOW + 60 * MIN })).text).toBe("Saved here · Saved online 1 hour ago");
    expect(statusLine(input({ ...online, sync: "synced", extra: { lastSyncAt: ago(2 * 60 * MIN) } })).text).toBe("Saved here · Saved online 2 hours ago");
    expect(text({ ...online, sync: "synced", extra: { lastSyncAt: ago(0) } })).toBe("Saved here · Saved online just now");
    expect(text({ ...online, sync: "synced" })).toBe("Saved here · Saved online");
  });

  test("the announcement leaves the time out, so a minute ticking over is not announced", () => {
    const at = (m: number) => statusLine(input({ ...online, sync: "synced", extra: { lastSyncAt: ago(m * MIN) } })).announce;
    expect(at(1)).toBe(at(40));
    expect(at(1)).toBe("Saved here · Saved online");
  });

  test("a local-only answer is marked as still being confirmed in the tooltip", () => {
    const l = statusLine(input({ ...online, sync: "synced", extra: { lastSyncAt: ago(2 * MIN), local: true } }));
    expect(l.text).toBe("Saved here · Saved online 2 minutes ago");
    expect(l.title).toContain("Checking online in the background");
  });

  test("sending, from the host or a manual pass", () => {
    expect(statusLine(input({ ...online, sync: "syncing" }))).toMatchObject({ key: "backing-up", text: "Saved here · Sending…", tone: "pending" });
    expect(text({ ...online, backingUp: true, sync: "synced" })).toBe("Saved here · Sending…");
    expect(text({ ...online, gettingLatest: true })).toBe("Saved here · Getting changes…");
  });

  test("in manual mode the Update button stays while a pass runs (the bar shows it disabled)", () => {
    expect(statusLine(input({ ...online, canSync: true, autoBackup: false, backingUp: true })).button).toEqual({ label: "Update", action: "update" });
    expect(statusLine(input({ ...online, canSync: true, autoBackup: true, backingUp: true })).button).toBeUndefined();
  });

  test("sending outranks the ahead/behind it is about to fix", () => {
    expect(key({ ...online, backingUp: true, sync: "synced", updatesAvailable: true, extra: { ahead: 2 } })).toBe("backing-up");
  });

  test("ahead: a count when the host gave one, a Send button and a Send now action", () => {
    const l = statusLine(input({ ...online, canSync: true, sync: "unsent", extra: { ahead: 3 } }));
    expect(l).toMatchObject({ key: "ahead", text: "Saved here · 3 changes not online yet", icon: "cloud-upload", tone: "warn" });
    expect(l.primary).toEqual({ id: "back-up", label: "Send now" });
    expect(l.button).toEqual({ label: "Send now", action: "back-up" });
    expect(text({ ...online, sync: "synced", extra: { ahead: 1 } })).toBe("Saved here · 1 change not online yet");
    expect(text({ ...online, sync: "unsent" })).toBe("Saved here · Not online yet");
  });

  test("behind: from the check or the host, with a Get the changes action", () => {
    for (const over of [{ updatesAvailable: true, sync: "synced" as const }, { sync: "synced" as const, extra: { behind: true } }]) {
      const l = statusLine(input({ ...online, ...over }));
      expect(l).toMatchObject({ key: "behind", text: "Saved here · New changes online", icon: "cloud-download", tone: "plain" });
      expect(l.primary).toEqual({ id: "get-changes", label: "Get changes" });
      expect(l.button).toEqual({ label: "Get changes", action: "get-changes" });
    }
  });

  test("behind and ahead is one Update", () => {
    const l = statusLine(input({ ...online, updatesAvailable: true, sync: "unsent", extra: { ahead: 2 } }));
    expect(l).toMatchObject({ key: "behind-ahead", text: "Saved here · Changes here and online", headline: "New changes online and on this computer" });
    expect(l.detail).toBe("Update brings in the online changes, then sends yours. If the same passage changed in both places, you'll choose which to keep.");
    expect(l.primary).toEqual({ id: "update", label: "Update" });
    expect(l.button).toEqual({ label: "Update", action: "update" });
  });

  test("offline", () => {
    expect(statusLine(input({ ...online, sync: "offline" }))).toMatchObject({
      key: "offline",
      text: "Saved here · Offline — will send when you're back",
      icon: "cloud-off",
    });
  });

  test("a missing or rejected sign-in asks for one, and the click goes straight to it", () => {
    for (const sync of ["auth", "connect"] as const) {
      expect(statusLine(input({ ...online, sync }))).toMatchObject({
        key: "sign-in",
        text: "Saved here · Sign in to send",
        icon: "key-round",
        tone: "warn",
        click: "action",
        clickAction: "open-backup",
      });
    }
    // No status yet, but the diagnosis already knows a sign-in is missing.
    expect(key({ ...online, remoteNeeds: "sign-in" })).toBe("sign-in");
  });

  test("an online copy that can't be found is its own state", () => {
    expect(statusLine(input({ ...online, sync: "not-found" }))).toMatchObject({ key: "not-found", text: "Saved here · Can't find the online copy" });
  });

  test("the host's 'can't find this online copy' error reads as not found", () => {
    const message = "Gutterpress can't find this online copy. It may have been renamed or deleted, or your account may not have access to it. Check the address, or sign in again.";
    expect(key({ ...online, sync: "error", message })).toBe("not-found");
  });

  test("a paused backup shows the host's own explanation as the tooltip and in the popover", () => {
    const l = statusLine(input({ ...online, sync: "error", message: "The online copy is full." }));
    expect(l).toMatchObject({ key: "paused", text: "Saved here · Sending paused", title: "The online copy is full." });
    expect(l.detail).toContain("The online copy is full.");
    expect(l.primary).toEqual({ id: "open-backup", label: "Open online storage" }); // "full" is not cleared by waiting
  });

  test("an online copy Gutterpress can't send over is said plainly", () => {
    // Claims nothing about what is or isn't online.
    expect(text({ ...online, sync: "local" })).toBe("Saved here · Online copy managed outside Gutterpress");
    expect(text({ ...online, remoteNeeds: "own-tools" })).toBe("Saved here · Online copy managed outside Gutterpress");
  });
});

describe("statusLine: no online copy", () => {
  test("versions but no online copy", () => {
    expect(text({ sync: "local" })).toBe("Saved here · Not online yet");
    expect(statusLine(input())).toMatchObject({ key: "no-online", icon: "laptop" });
    expect(statusLine(input()).primary).toEqual({ id: "open-backup", label: "Put this book online…" });
  });

  test("a plain folder has no version history, and says how to get it", () => {
    const l = statusLine(input({ noHistory: true }));
    expect(l).toMatchObject({ key: "no-history", text: "Saved here · No version history", icon: "history" });
    expect(l.primary).toEqual({ id: "turn-on-history", label: "Turn on version history" });
  });

  test("before the book is classified, nothing is claimed beyond 'Saved here'", () => {
    expect(statusLine(input({ classified: false }))).toMatchObject({ key: "unknown", text: "Saved here" });
  });
});

describe("statusLine: two takes", () => {
  test("outranks a quiet or noisy online copy, counts passages, and a click opens the list", () => {
    const l = statusLine(input({ hasRemote: true, sync: "synced", decide: 2 }));
    expect(l).toMatchObject({ key: "decide", text: "Saved here · 2 passages to decide", icon: "triangle-alert", tone: "warn", click: "action", clickAction: "open-problems" });
    expect(text({ hasRemote: true, sync: "offline", decide: 1 })).toBe("Saved here · 1 passage to decide");
    // Before the Problems list has loaded the host's count fills in; after, the list is the truth.
    expect(text({ sync: "synced", extra: { decide: 3 }, hasRemote: true })).toBe("Saved here · 3 passages to decide");
    expect(key({ sync: "synced", extra: { decide: 3 }, hasRemote: true, problemsLoaded: true, decide: 0 })).toBe("backed-up");
  });

  test("a failed save and unsaved changes still come first", () => {
    expect(key({ decide: 2, savePhase: "error" })).toBe("save-failed");
    expect(key({ decide: 2, savePhase: "dirty", autoSave: false })).toBe("unsaved");
  });
});

describe("statusLine: versions that need attention", () => {
  const problem = { message: "Close any other program using the folder." };

  test("outranks the quiet online states, with the host's explanation as the tooltip", () => {
    for (const sync of [undefined, "local", "synced", "unsent"] as const) {
      expect(statusLine(input({ versionsProblem: problem, sync }))).toMatchObject({
        key: "versions-failing",
        text: "Saved here · Versions need attention",
        title: problem.message,
        icon: "triangle-alert",
        tone: "warn",
      });
    }
  });

  test("offers Save a version, and (per the precedence) outranks two takes", () => {
    expect(statusLine(input({ versionsProblem: problem })).primary).toEqual({ id: "save-version", label: "Save a version" });
    expect(key({ versionsProblem: problem, decide: 1 })).toBe("versions-failing");
  });

  test("never hides a sign-in, a pause or a backup in flight", () => {
    const online = { hasRemote: true, versionsProblem: problem };
    expect(text({ ...online, sync: "auth" })).toBe("Saved here · Sign in to send");
    expect(text({ ...online, sync: "error" })).toBe("Saved here · Sending paused");
    expect(text({ ...online, sync: "syncing" })).toBe("Saved here · Sending…");
  });

  test("does not hide a save in flight either", () => {
    expect(text({ versionsProblem: problem, savePhase: "saving" })).toBe("Saving…");
  });
});

describe("statusLine: precedence", () => {
  test("save failed > unsaved > saving > versions > decide > online trouble > behind/ahead > sending", () => {
    const everything: Over = { hasRemote: true, sync: "offline", updatesAvailable: true, decide: 1, versionsProblem: { message: null }, savePhase: "error", autoSave: false };
    expect(key(everything)).toBe("save-failed");
    expect(key({ ...everything, savePhase: "dirty" })).toBe("unsaved");
    expect(key({ ...everything, savePhase: "dirty", autoSave: true })).toBe("saving");
    expect(key({ ...everything, savePhase: "clean", sync: "synced" })).toBe("versions-failing");
    expect(key({ ...everything, savePhase: "clean", versionsProblem: null })).toBe("decide");
    expect(key({ ...everything, savePhase: "clean", versionsProblem: null, decide: 0 })).toBe("offline");
    expect(key({ ...everything, savePhase: "clean", versionsProblem: null, decide: 0, sync: "synced" })).toBe("behind");
  });
});

describe("statusLine: buttons, tooltips and tone shapes", () => {
  test("the bar button shows only when there is something to get or send", () => {
    const base = { hasRemote: true, canSync: true, autoBackup: false } as const;
    expect(statusLine(input({ ...base, sync: "synced", extra: { lastSyncAt: ago(MIN) } })).button).toBeUndefined();
    expect(statusLine(input({ ...base, autoBackup: true, sync: "synced", extra: { lastSyncAt: ago(MIN) } })).button).toBeUndefined();
    expect(statusLine(input({ ...base, checked: true })).button).toBeUndefined();
  });

  test("one name per action: Get changes, Send now, Update only for both", () => {
    const base = { hasRemote: true, canSync: true } as const;
    const behind = statusLine(input({ ...base, updatesAvailable: true, sync: "synced" }));
    const ahead = statusLine(input({ ...base, sync: "unsent" }));
    const both = statusLine(input({ ...base, updatesAvailable: true, sync: "unsent" }));
    expect([behind.button?.label, behind.primary?.label]).toEqual(["Get changes", "Get changes"]);
    expect([ahead.button?.label, ahead.primary?.label]).toEqual(["Send now", "Send now"]);
    expect([both.button?.label, both.primary?.label]).toEqual(["Update", "Update"]);
  });

  test("Send now in the backed-up popover is the quiet button", () => {
    const l = statusLine(input({ hasRemote: true, sync: "synced" }));
    expect(l.primary).toEqual({ id: "back-up", label: "Send now" });
    expect(l.primaryQuiet).toBe(true);
  });

  test("a pause that waiting won't fix sends the author to Online; a transient one offers Try again", () => {
    const full = statusLine(input({ hasRemote: true, sync: "error", message: "The online copy is full." }));
    expect(full.primary).toEqual({ id: "open-backup", label: "Open online storage" });
    const net = statusLine(input({ hasRemote: true, sync: "error", message: "The connection timed out. Try again in a moment." }));
    expect(net.primary).toEqual({ id: "try-again", label: "Try again" });
    expect(net.secondary).toEqual({ id: "open-backup", label: "Open online storage" });
    expect(net.detail).toBe("Sending stopped for now. Your work is safe on this computer.");
    expect(statusLine(input({ hasRemote: true, sync: "error" })).primary?.id).toBe("try-again");
  });

  test("popover headlines are short and never repeat the bar's separators or 'see why'", () => {
    const states: Over[] = [{}, { noHistory: true }, { hasRemote: true }, { hasRemote: true, sync: "synced" }, { hasRemote: true, sync: "offline" }, { hasRemote: true, sync: "error" }, { savePhase: "error" }, { hasRemote: true, updatesAvailable: true, sync: "unsent" }];
    for (const over of states) {
      const l = statusLine(input(over));
      expect(l.headline).not.toContain("see why");
      expect(l.headline).not.toContain("·");
      expect(l.headline.length).toBeLessThan(45);
    }
    expect(statusLine(input({ hasRemote: true, sync: "offline" })).headline).toBe("You're offline");
    expect(statusLine(input({ savePhase: "error" })).headline).toBe("Couldn't save");
    expect(statusLine(input({ hasRemote: true, sync: "synced", extra: { lastSyncAt: ago(0) } })).headline).toBe("Saved online just now");
  });

  test("the checking popover says what was last known", () => {
    expect(statusLine(input({ hasRemote: true, sync: "idle", extra: { lastSyncAt: ago(3 * MIN) } })).detail).toContain("Last sent 3 minutes ago.");
  });

  test("can't find: the host's reason wins over its message; GitHub adds Sign in again", () => {
    const l = statusLine(input({ hasRemote: true, sync: "error", extra: { reason: "not-found", host: "github" }, message: "something else" }));
    expect(l).toMatchObject({ key: "not-found", primary: { id: "open-backup", label: "Check the online link" }, secondary: { id: "open-backup", label: "Sign in again" } });
    expect(l.detail).toContain("may no longer have access");
    const other = statusLine(input({ hasRemote: true, sync: "error", extra: { reason: "not-found" } }));
    expect(other.secondary).toBeUndefined();
    // An error with a different reason, even with matching words, stays a pause.
    expect(key({ hasRemote: true, sync: "error", extra: { reason: "full" }, message: "Gutterpress can't find this online copy." })).toBe("paused");
  });

  test("a tooltip never says 'click for details'; it says what the state means", () => {
    const states: Over[] = [
      {},
      { noHistory: true },
      { hasRemote: true },
      { hasRemote: true, sync: "synced" },
      { hasRemote: true, sync: "unsent" },
      { hasRemote: true, sync: "offline" },
      { hasRemote: true, sync: "auth" },
      { hasRemote: true, sync: "not-found" },
      { hasRemote: true, sync: "error" },
      { hasRemote: true, updatesAvailable: true },
      { savePhase: "dirty", autoSave: false },
      { savePhase: "error" },
      { decide: 2 },
      { versionsProblem: { message: null } },
    ];
    for (const over of states) {
      const l = statusLine(input(over));
      expect(l.title).not.toContain("click for details");
      expect(l.title.length).toBeGreaterThan(20);
    }
  });

  test("every clickable-by-popover state offers a primary action or at least details", () => {
    for (const l of [statusLine(input({ hasRemote: true })), statusLine(input({ hasRemote: true, sync: "synced" }))]) {
      expect(l.click).toBe("popover");
      expect(l.detail.length).toBeGreaterThan(10);
    }
  });
});

describe("vocabulary", () => {
  test("every state reads in the product's own words", () => {
    const states: BackupSyncState[] = ["idle", "syncing", "synced", "unsent", "offline", "auth", "error", "local", "connect", "not-found"];
    const lines = states.flatMap((sync) => [true, false].map((hasRemote) => statusLine(input({ sync, hasRemote }))));
    lines.push(
      statusLine(input({ versionsProblem: { message: null } })),
      statusLine(input({ savePhase: "error" })),
      statusLine(input({ savePhase: "dirty", autoSave: false })),
      statusLine(input({ noHistory: true })),
      statusLine(input({ decide: 2 })),
      statusLine(input({ hasRemote: true, updatesAvailable: true, sync: "unsent" })),
      statusLine(input({ hasRemote: true, remoteNeeds: "own-tools" })),
    );
    for (const l of lines) {
      for (const s of [l.text, l.title, l.detail, l.primary?.label ?? ""]) {
        expect(s.length).toBeGreaterThanOrEqual(0);
        expect(bannedTermsIn(s)).toEqual([]);
      }
    }
  });
});

describe("versionsLine: the line about this computer", () => {
  test("names when the last version was made", () => {
    expect(versionsLine({ lastVersionAt: NOW - 10 * MIN, changedFiles: 0, now: NOW })).toBe("Saved · last version 10 minutes ago");
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

  test("never uses a banned term", () => {
    const all = [versionsLine({ lastVersionAt: NOW, changedFiles: 2, now: NOW }), NOTHING_NEW_NOTICE].join(" ");
    expect(bannedTermsIn(all)).toEqual([]);
  });
});

describe("saveFailureReason", () => {
  test("keeps the cause, drops the code and the path", () => {
    const raw = `Save failed: {"status":500,"message":"EACCES: permission denied, open '/home/a/book/ch1.md'"}`;
    const why = saveFailureReason(raw);
    expect(why).toContain("read-only");
    expect(why).not.toContain("EACCES");
    expect(why).not.toContain("/home");
    expect(saveFailureReason("ENOSPC: no space left on device")).toContain("disk is full");
    expect(saveFailureReason("EBUSY")).toContain("Another program");
    expect(saveFailureReason("???")).toContain("couldn't write the file");
  });

  test("always says the work is still in the editor, and uses no banned word", () => {
    for (const raw of ["EACCES", "ENOSPC", "EBUSY", "weird"]) {
      const why = saveFailureReason(raw);
      expect(why).toContain("still in the editor");
      expect(bannedTermsIn(why)).toEqual([]);
    }
  });
});

describe("an unfinished revision switch (#516)", () => {
  test("says saving is paused, in amber, and opens Online", () => {
    const l = statusLine(input({ switchPaused: true, hasRemote: true, sync: "synced" }));
    expect(l.key).toBe("switch-paused");
    expect(l.text).toBe("Saved here · Saving is paused — see Drafts");
    expect(l.tone).toBe("warn");
    expect(l.click).toBe("action");
    expect(l.clickAction).toBe("open-backup");
    expect(bannedTermsIn(l.text + l.title + l.detail)).toEqual([]);
  });

  test("outranks the backup states and the other warnings, but not a failed save", () => {
    const paused = { switchPaused: true, hasRemote: true, versionsProblem: { message: null }, decide: 2, problemsLoaded: true } as const;
    for (const sync of ["offline", "auth", "error", "unsent", "synced"] as const) {
      expect(statusLine(input({ ...paused, sync })).key).toBe("switch-paused");
    }
    expect(statusLine(input({ ...paused, savePhase: "error", sync: "synced" })).key).toBe("save-failed");
  });

  test("is gone once the switch is settled", () => {
    expect(statusLine(input({ switchPaused: false, hasRemote: true, sync: "synced" })).key).toBe("backed-up");
  });
});
