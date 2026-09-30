/**
 * The state -> copy mapping behind the status bar's "Where your work is kept"
 * dialog. Pure, so every state combination is asserted here: what each section
 * says, its tone, and which action it offers.
 */
import { describe, expect, test } from "bun:test";
import {
  onlineSection,
  saveStatusCopy,
  savingSection,
  versionsSection,
  type SaveStatusInput,
} from "../../src/lib/save-status";
import type { SyncState } from "../../src/lib/platform/contract";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const DAY = 86_400_000;

function input(over: {
  saving?: Partial<Pick<SaveStatusInput, "savePhase" | "autoSave" | "forceSaving">>;
  versions?: Partial<SaveStatusInput["versions"]>;
  online?: Partial<SaveStatusInput["online"]>;
} = {}): SaveStatusInput {
  return {
    savePhase: "clean",
    autoSave: true,
    forceSaving: false,
    ...over.saving,
    versions: {
      enabled: true,
      automatic: true,
      load: "ready",
      lastVersionAt: NOW - 3 * DAY,
      changedFiles: 0,
      savingVersion: false,
      ...over.versions,
    },
    online: {
      state: "idle",
      canSync: false,
      hasRemote: false,
      automatic: true,
      lastSyncAt: null,
      syncing: false,
      ...over.online,
    },
    now: NOW,
  };
}

const ids = (s: { actions: Array<{ id: string }> }) => s.actions.map((a) => a.id);

describe("saving", () => {
  test("clean + autosave: saved automatically, nothing to do", () => {
    const s = savingSection(input());
    expect(s.status).toBe("Saved on this computer automatically as you type.");
    expect(s.tone).toBe("ok");
    expect(s.actions).toEqual([]);
  });
  test("clean + autosave off: says autosave is off, still all saved", () => {
    const s = savingSection(input({ saving: { autoSave: false } }));
    expect(s.status).toBe("All your changes are saved on this computer.");
    expect(s.detail).toContain("Autosave is off");
    expect(s.tone).toBe("ok");
  });
  test("dirty + autosave on: saving in progress, no button", () => {
    const s = savingSection(input({ saving: { savePhase: "dirty" } }));
    expect(s.status).toBe("Saving…");
    expect(s.tone).toBe("pending");
    expect(s.actions).toEqual([]);
  });
  test("dirty + autosave off: unsaved, with a Save button (never 'Saving…')", () => {
    const s = savingSection(input({ saving: { savePhase: "dirty", autoSave: false } }));
    expect(s.status).toBe("You have changes that aren't saved yet.");
    expect(s.tone).toBe("warn");
    expect(ids(s)).toEqual(["save"]);
  });
  test("dirty + autosave off + a manual save running: saving", () => {
    const s = savingSection(input({ saving: { savePhase: "dirty", autoSave: false, forceSaving: true } }));
    expect(s.status).toBe("Saving…");
    expect(s.actions).toEqual([]);
  });
  test("saving phase: saving", () => {
    expect(savingSection(input({ saving: { savePhase: "saving" } })).status).toBe("Saving…");
  });
  test("error: says so and offers a retry", () => {
    const s = savingSection(input({ saving: { savePhase: "error" } }));
    expect(s.status).toBe("Couldn't save your last change.");
    expect(s.tone).toBe("error");
    expect(ids(s)).toEqual(["save"]);
  });
});

describe("versions", () => {
  test("plain folder: history is off, offers to turn it on, nothing else", () => {
    const s = versionsSection(input({ versions: { enabled: false } }));
    expect(s.status).toBe("Version history is off for this folder.");
    expect(ids(s)).toEqual(["enableVersionHistory"]);
    expect(s.note).toBeUndefined();
  });
  test("still loading: 'Checking…', never a guess", () => {
    const s = versionsSection(input({ versions: { load: "loading", lastVersionAt: null, changedFiles: null } }));
    expect(s.status).toBe("Checking…");
    expect(s.tone).toBe("pending");
    expect(s.actions).toEqual([]);
  });
  test("lookup failed: says it could not check; still lets the writer act", () => {
    const s = versionsSection(input({ versions: { load: "error" } }));
    expect(s.status).toBe("Couldn't check your versions just now.");
    expect(ids(s)).toEqual(["saveVersion", "viewVersions"]);
  });
  test("old version + unversioned changes: reconciles 'saved' with 'days old'", () => {
    const s = versionsSection(input({ versions: { changedFiles: 4 } }));
    expect(s.status).toBe("Your last version is from 3 days ago.");
    expect(s.detail).toBe(
      "You've changed 4 files since then. They're saved on this computer, but not in a version yet.",
    );
    expect(s.tone).toBe("info");
    const save = s.actions.find((a) => a.id === "saveVersion")!;
    expect(save.disabled).toBe(false);
    expect(save.primary).toBe(true);
    expect(ids(s)).toEqual(["saveVersion", "viewVersions"]);
  });
  test("singular file", () => {
    const s = versionsSection(input({ versions: { changedFiles: 1 } }));
    expect(s.detail).toContain("changed 1 file since then");
  });
  test("old version but nothing changed since: everything is in it; button disabled", () => {
    const s = versionsSection(input({ versions: { changedFiles: 0 } }));
    expect(s.status).toBe("Your last version is from 3 days ago.");
    expect(s.detail).toBe("Everything you've written is in it.");
    expect(s.tone).toBe("ok");
    expect(s.actions.find((a) => a.id === "saveVersion")!.disabled).toBe(true);
  });
  test("changed-file count unknown: states only the version age", () => {
    const s = versionsSection(input({ versions: { changedFiles: null } }));
    expect(s.status).toBe("Your last version is from 3 days ago.");
    expect(s.detail).toBeUndefined();
    expect(s.actions.find((a) => a.id === "saveVersion")!.disabled).toBe(false);
  });
  test("a very recent version reads 'was made just now', not 'from just now'", () => {
    const s = versionsSection(input({ versions: { lastVersionAt: NOW - 20_000 } }));
    expect(s.status).toBe("Your last version was made just now.");
  });
  test("an old version reads as a date", () => {
    const s = versionsSection(input({ versions: { lastVersionAt: NOW - 60 * DAY } }));
    expect(s.status).toMatch(/^Your last version is from .+\.$/);
    expect(s.status).not.toContain("ago");
  });
  test("no versions yet: says so, counts unversioned files with right grammar", () => {
    const none = versionsSection(input({ versions: { lastVersionAt: null, changedFiles: 0 } }));
    expect(none.status).toBe("No versions yet.");
    expect(none.detail).toBeUndefined();
    const one = versionsSection(input({ versions: { lastVersionAt: null, changedFiles: 1 } }));
    expect(one.detail).toBe("1 file is saved on this computer, but not in a version yet.");
    const many = versionsSection(input({ versions: { lastVersionAt: null, changedFiles: 3 } }));
    expect(many.detail).toBe("3 files are saved on this computer, but not in a version yet.");
  });
  test("a version is being saved: button says so and is disabled", () => {
    const s = versionsSection(input({ versions: { changedFiles: 2, savingVersion: true } }));
    const save = s.actions.find((a) => a.id === "saveVersion")!;
    expect(save.label).toBe("Saving a version…");
    expect(save.disabled).toBe(true);
  });
  test("explains WHEN versions happen automatically, or that they are off", () => {
    expect(versionsSection(input()).note).toContain("after you stop editing for 10 minutes");
    expect(versionsSection(input({ versions: { automatic: false } })).note).toContain("Automatic versions are off");
  });
});

describe("online backup", () => {
  const sync = (state: SyncState, over: Partial<SaveStatusInput["online"]> = {}) =>
    onlineSection(input({ online: { state, ...over } }));

  test("no version history: not set up, needs history first, no action", () => {
    const s = onlineSection(input({ versions: { enabled: false } }));
    expect(s.status).toBe("Not set up.");
    expect(s.detail).toContain("needs version history first");
    expect(s.actions).toEqual([]);
  });
  test("no remote at all (local / idle): not set up, points to connection details", () => {
    for (const state of ["local", "idle"] as const) {
      const s = sync(state);
      expect(s.status).toBe("Not set up.");
      expect(s.detail).toBe("This book is only on this computer for now.");
      expect(ids(s)).toEqual(["openBookConnections"]);
    }
  });
  test("a remote Gutterpress can't sync (SSH): not backing up automatically", () => {
    for (const state of ["local", "idle"] as const) {
      const s = sync(state, { hasRemote: true });
      expect(s.status).toBe("Not backing up automatically.");
      expect(ids(s)).toEqual(["openBookConnections"]);
    }
  });
  test("connect: not connected yet, Connect button", () => {
    const s = sync("connect", { hasRemote: true });
    expect(s.status).toBe("Not connected yet.");
    expect(ids(s)).toEqual(["connect"]);
    expect(s.actions[0]!.label).toBe("Connect");
  });
  test("auth: sign-in needed, Reconnect button", () => {
    const s = sync("auth", { hasRemote: true });
    expect(s.status).toBe("Sign-in needed.");
    expect(s.tone).toBe("warn");
    expect(s.actions[0]).toMatchObject({ id: "connect", label: "Reconnect" });
  });
  test("syncing (host or manual): backing up now, no button", () => {
    expect(sync("syncing", { canSync: true }).status).toBe("Backing up now…");
    const manual = sync("synced", { canSync: true, syncing: true });
    expect(manual.status).toBe("Backing up now…");
    expect(manual.actions).toEqual([]);
  });
  test("synced: on and working, with last-checked time and 'Back up now'", () => {
    const s = sync("synced", { canSync: true, lastSyncAt: new Date(NOW - 5 * 60_000).toISOString() });
    expect(s.status).toBe("On and working.");
    expect(s.detail).toBe("Last checked 5 mins ago. New versions are sent every few minutes.");
    expect(s.tone).toBe("ok");
    expect(s.actions[0]).toMatchObject({ id: "syncNow", label: "Back up now" });
  });
  test("synced without a timestamp: no invented time", () => {
    const s = sync("synced", { canSync: true });
    expect(s.detail).toBe("New versions are sent every few minutes.");
  });
  test("synced with automatic backup off: says so instead of promising", () => {
    const s = sync("synced", { canSync: true, automatic: false });
    expect(s.detail).toContain("Automatic backup is off");
    expect(s.detail).not.toContain("every few minutes");
  });
  test("offline: work is safe, retry offered", () => {
    const s = sync("offline", { canSync: true });
    expect(s.status).toBe("Offline.");
    expect(s.detail).toContain("safe on this computer");
    expect(s.actions[0]).toMatchObject({ id: "syncNow", label: "Try again" });
  });
  test("error: didn't finish, work is safe, retry offered", () => {
    const s = sync("error", { canSync: true });
    expect(s.status).toBe("The last backup didn't finish.");
    expect(s.tone).toBe("warn");
    expect(s.actions[0]).toMatchObject({ id: "syncNow", label: "Try again" });
  });
  test("idle on a book that can sync: ready (auto on) or automatic-off (auto off)", () => {
    const on = sync("idle", { canSync: true });
    expect(on.status).toBe("Ready.");
    expect(ids(on)).toEqual(["syncNow"]);
    const off = sync("idle", { canSync: true, automatic: false });
    expect(off.status).toBe("Automatic backup is off.");
  });
  test("the retry button is never offered when the book can't sync", () => {
    expect(ids(sync("error", { canSync: false }))).toEqual([]);
  });
});

describe("saveStatusCopy", () => {
  test("the headline scenario: saved, last version 3 days ago, 4 files not in a version", () => {
    const c = saveStatusCopy(input({ versions: { changedFiles: 4 } }));
    expect(c.saving.status).toContain("Saved on this computer");
    expect(c.versions.status).toBe("Your last version is from 3 days ago.");
    expect(c.versions.detail).toContain("saved on this computer, but not in a version yet");
  });
  test("every section always carries a one-line explanation", () => {
    const c = saveStatusCopy(input());
    for (const s of [c.saving, c.versions, c.online]) expect(s.explain.length).toBeGreaterThan(20);
    expect(c.versions.explain).toContain("restore point");
  });
  test("every sync state produces copy (no state falls through empty)", () => {
    const states: SyncState[] = ["idle", "syncing", "synced", "offline", "auth", "error", "local", "connect"];
    for (const state of states) {
      for (const canSync of [true, false]) {
        for (const hasRemote of [true, false]) {
          const s = onlineSection(input({ online: { state, canSync, hasRemote } }));
          expect(s.status.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
