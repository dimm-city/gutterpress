/**
 * The state -> copy mapping behind the status bar's "Where your work is kept"
 * dialog. Pure, so every state combination is asserted here: what each section
 * says, its tone, and which action it offers.
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  BACKUP_UPLOAD_MINUTES,
  VERSION_QUIET_MINUTES,
  onlineSection,
  saveStatusCopy,
  savingSection,
  summaryLine,
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
      stale: false,
      savingVersion: false,
      problem: false,
      nothingNew: false,
      ...over.versions,
    },
    online: {
      state: "idle",
      canSync: false,
      hasRemote: false,
      automatic: true,
      lastSyncAt: null,
      syncing: false,
      repair: "idle" as const,
      ...over.online,
    },
    now: NOW,
  };
}

const ids = (s: { actions: Array<{ id: string }> }) => s.actions.map((a) => a.id);

describe("constants match the lib", () => {
  test("the quoted cadences equal the host-policy constants", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../../cli/src/lib/host-policy.ts"), "utf8");
    expect(src).toContain(`AUTO_SNAPSHOT_DEFAULT_MINUTES = ${VERSION_QUIET_MINUTES};`);
    expect(src).toContain(`AUTO_SYNC_PUSH_INTERVAL_MINUTES = ${BACKUP_UPLOAD_MINUTES};`);
  });
});

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
  test("dirty + autosave on, and the saving phase: saving, no button", () => {
    for (const savePhase of ["dirty", "saving"] as const) {
      const s = savingSection(input({ saving: { savePhase } }));
      expect(s.status).toBe("Saving…");
      expect(s.tone).toBe("pending");
      expect(s.actions).toEqual([]);
    }
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
  test("error: says so, names the likely cause in plain words, offers a retry", () => {
    const s = savingSection(input({ saving: { savePhase: "error" } }));
    expect(s.status).toBe("Couldn't save your last change.");
    expect(s.detail).toContain("isn't open in another program or set to read-only");
    expect(s.tone).toBe("error");
    expect(ids(s)).toEqual(["save"]);
  });
});

describe("summary line answers 'is my work safe?'", () => {
  test("safe, unsaved, saving and error", () => {
    expect(summaryLine(input())).toEqual({ text: "Your writing is safe on this computer.", tone: "ok" });
    expect(summaryLine(input({ saving: { savePhase: "dirty", autoSave: false } })).tone).toBe("warn");
    expect(summaryLine(input({ saving: { savePhase: "saving" } })).tone).toBe("pending");
    expect(summaryLine(input({ saving: { savePhase: "error" } }))).toEqual({
      text: "Your last change couldn't be saved.",
      tone: "error",
    });
    expect(saveStatusCopy(input()).summary.tone).toBe("ok");
  });
});

describe("versions", () => {
  test("classification not loaded yet: Checking…, never 'plain folder'", () => {
    const s = versionsSection(input({ versions: { enabled: null } }));
    expect(s.status).toBe("Checking…");
    expect(s.tone).toBe("pending");
    expect(s.actions).toEqual([]);
    expect(onlineSection(input({ versions: { enabled: null } })).status).toBe("Checking…");
  });
  test("plain folder: not keeping versions; one button; says it saves a first version now", () => {
    const s = versionsSection(input({ versions: { enabled: false } }));
    expect(s.status).toBe("Your book isn't keeping versions yet.");
    expect(s.detail).toBe("Your edits are saved, but you can't go back to an earlier version.");
    expect(s.note).toBe("This saves a first version of your book now.");
    expect(ids(s)).toEqual(["enableVersionHistory"]);
  });
  test("still loading: 'Checking…', never a guess", () => {
    const s = versionsSection(input({ versions: { load: "loading", lastVersionAt: null, changedFiles: null } }));
    expect(s.status).toBe("Checking…");
    expect(s.actions).toEqual([]);
  });
  test("lookup failed: says it could not check; still lets the writer act", () => {
    const s = versionsSection(input({ versions: { load: "error" } }));
    expect(s.status).toBe("Couldn't check your versions just now.");
    expect(ids(s)).toEqual(["saveVersion", "viewVersions"]);
  });
  test("old version + changed files: reconciles 'saved' with 'days old'", () => {
    const s = versionsSection(input({ versions: { changedFiles: 4 } }));
    expect(s.status).toBe("Your last version is from 3 days ago.");
    expect(s.detail).toBe(
      "You've changed 4 files since then. They're saved on this computer, but not in a version yet. Save a version to be able to come back to how your book is now.",
    );
    expect(s.tone).toBe("action");
    expect(s.actions[0]).toMatchObject({ id: "saveVersion", primary: true, disabled: false });
    expect(ids(s)).toEqual(["saveVersion", "viewVersions"]);
  });
  test("singular file", () => {
    expect(versionsSection(input({ versions: { changedFiles: 1 } })).detail).toContain("changed 1 file since then");
  });
  test("nothing changed: 'in that version'; Save stays offered, but secondary", () => {
    const s = versionsSection(input({ versions: { changedFiles: 0 } }));
    expect(s.detail).toBe("Everything you've written is in that version.");
    expect(s.tone).toBe("ok");
    expect(ids(s)).toEqual(["saveVersion", "viewVersions"]);
    expect(s.actions[0]!.primary).toBeFalsy();
    expect(s.notice).toBeUndefined();
  });
  test("Save pressed on a clean book: a calm notice, not a problem", () => {
    const s = versionsSection(input({ versions: { changedFiles: 0, nothingNew: true } }));
    expect(s.notice).toBe("Nothing new to save — your last version already has everything.");
    expect(s.tone).toBe("ok");
    expect(s.alert).toBeUndefined();
    expect(ids(s)).toEqual(["saveVersion", "viewVersions"]);
    // …and the announcement region hears it too (single role=status).
    const dlg = fs.readFileSync(path.resolve(__dirname, "../../src/lib/components/SaveStatusDialog.svelte"), "utf8");
    expect(dlg).toContain("copy[s.key].notice");
    expect(dlg.match(/<div[^>]*role="status"/g)).toHaveLength(1);
  });
  test("the notice is withdrawn once there are changes to save", () => {
    const s = versionsSection(input({ versions: { changedFiles: 2, nothingNew: true } }));
    expect(s.notice).toBeUndefined();
    expect(s.actions[0]).toMatchObject({ id: "saveVersion", primary: true });
  });
  test("stale staging: a clean-looking tree is NOT reported as fully versioned; Save stays", () => {
    const s = versionsSection(input({ versions: { changedFiles: 0, stale: true } }));
    expect(s.detail).toBe("Some recent work may not be in it yet.");
    expect(s.detail).not.toContain("Everything you've written");
    expect(s.tone).toBe("action");
    expect(s.actions[0]).toMatchObject({ id: "saveVersion", primary: true });
    const none = versionsSection(input({ versions: { lastVersionAt: null, changedFiles: 0, stale: true } }));
    expect(none.detail).toContain("may not be in a version yet");
    expect(ids(none)).toContain("saveVersion");
  });
  test("changed-file count unknown: only the version age; Save stays available", () => {
    const s = versionsSection(input({ versions: { changedFiles: null } }));
    expect(s.status).toBe("Your last version is from 3 days ago.");
    expect(s.detail).toBeUndefined();
    expect(ids(s)).toEqual(["saveVersion", "viewVersions"]);
  });
  test("a very recent version reads 'was made just now'", () => {
    const s = versionsSection(input({ versions: { lastVersionAt: NOW - 20_000 } }));
    expect(s.status).toBe("Your last version was made just now.");
  });
  test("an old version reads as a date", () => {
    const s = versionsSection(input({ versions: { lastVersionAt: NOW - 60 * DAY } }));
    expect(s.status).toMatch(/^Your last version is from .+\.$/);
    expect(s.status).not.toContain("ago");
  });
  test("no versions yet: says so, counts files with right grammar", () => {
    const none = versionsSection(input({ versions: { lastVersionAt: null, changedFiles: 0 } }));
    expect(none.status).toBe("No versions yet.");
    expect(none.detail).toBeUndefined();
    expect(versionsSection(input({ versions: { lastVersionAt: null, changedFiles: 1 } })).detail).toBe(
      "1 file is saved on this computer, but not in a version yet. Save a version to be able to come back to how your book is now.",
    );
    expect(versionsSection(input({ versions: { lastVersionAt: null, changedFiles: 3 } })).detail).toBe(
      "3 files are saved on this computer, but not in a version yet. Save a version to be able to come back to how your book is now.",
    );
  });
  test("a version is being saved: button says so and is disabled", () => {
    const save = versionsSection(input({ versions: { changedFiles: 2, savingVersion: true } })).actions[0]!;
    expect(save.label).toBe("Saving a version…");
    expect(save.disabled).toBe(true);
  });
  test("automatic on: states the real quiet period and never promises 'when you close'", () => {
    const note = versionsSection(input()).note!;
    expect(note).toContain(`after you stop editing for ${VERSION_QUIET_MINUTES} minutes`);
    expect(note).toContain("usually when you close the book");
  });
  test("online backup that uploads also saves a version: the note stays true with automatic versions on OR off", () => {
    const backup = { canSync: true, automatic: true };
    const on = versionsSection(input({ online: backup })).note!;
    const off = versionsSection(input({ versions: { automatic: false }, online: backup })).note!;
    for (const n of [on, off]) expect(n).toContain("Online backup also saves a version each time it uploads.");
    expect(versionsSection(input({ versions: { automatic: false } })).note).not.toContain("Online backup also");
    expect(versionsSection(input({ online: { canSync: true, automatic: false } })).note).not.toContain("Online backup also");
  });
  test("automatic off: names the actual settings switch", () => {
    const note = versionsSection(input({ versions: { automatic: false } })).note!;
    expect(note).toContain("Settings → Saving → Keep previous versions");
  });
  test("failing automatic versions are flagged in THIS section", () => {
    const s = versionsSection(input({ versions: { problem: true } }));
    expect(s.alert).toContain("Automatic versions aren't working right now");
    expect(versionsSection(input()).alert).toBeUndefined();
    // …and do not leak into the online backup section.
    expect(onlineSection(input({ versions: { problem: true } })).status).not.toContain("aren't working");
  });
  test("never says 'restore point'", () => {
    const c = saveStatusCopy(input({ versions: { changedFiles: 2, problem: true } }));
    const all = [c.saving, c.versions, c.online].flatMap((s) => [s.status, s.detail, s.note, s.alert]);
    expect([...all, c.versions.explain].filter((t) => t && /restore point/i.test(t))).toEqual([]);
    expect(c.versions.explain).toBe("A version is a saved copy of your book that you can go back to.");
  });
});

describe("online backup", () => {
  const sync = (state: SyncState, over: Partial<SaveStatusInput["online"]> = {}) =>
    onlineSection(input({ online: { state, ...over } }));

  test("plain folder: needs versions first, no action", () => {
    const s = onlineSection(input({ versions: { enabled: false } }));
    expect(s.status).toBe("Not backed up online.");
    expect(s.detail).toBe("Turn on versions first to use online backup.");
    expect(s.actions).toEqual([]);
  });
  test("no remote (local / idle): not backed up, points to setup", () => {
    for (const state of ["local", "idle"] as const) {
      const s = sync(state);
      expect(s.status).toBe("Not backed up online.");
      expect(s.detail).toBe("This book is only on this computer for now.");
      expect(s.actions[0]).toMatchObject({ id: "openBookConnections", label: "Set up online backup…" });
    }
  });
  test("a remote Gutterpress can't back up to (SSH)", () => {
    for (const state of ["local", "idle"] as const) {
      const s = sync(state, { hasRemote: true });
      expect(s.status).toBe("Not backed up online.");
      expect(s.actions[0]).toMatchObject({ id: "openBookConnections", label: "Online backup details…" });
    }
  });
  test("connect: not signed in, 'Sign in to online backup'", () => {
    const s = sync("connect", { hasRemote: true });
    expect(s.status).toBe("Not signed in to online backup.");
    expect(s.actions[0]).toMatchObject({ id: "connect", label: "Sign in to online backup", primary: true });
    expect(s.tone).toBe("action");
  });
  test("auth: please sign in again", () => {
    const s = sync("auth", { hasRemote: true });
    expect(s.status).toBe("Please sign in again.");
    expect(s.tone).toBe("warn");
    expect(s.actions[0]).toMatchObject({ id: "connect", label: "Sign in again" });
  });
  test("syncing (host or manual): backing up now, no button", () => {
    expect(sync("syncing", { canSync: true }).status).toBe("Backing up now…");
    const manual = sync("synced", { canSync: true, syncing: true });
    expect(manual.status).toBe("Backing up now…");
    // The button stays, disabled and honest, so the dialog is the one home for it.
    expect(manual.actions).toEqual([{ id: "syncNow", label: "Backing up…", disabled: true, primary: false }]);
    expect(sync("syncing", { canSync: true }).actions[0]).toMatchObject({ id: "syncNow", disabled: true });
    // No usable remote: nothing to press.
    expect(sync("syncing", { canSync: false }).actions).toEqual([]);
  });
  test("synced: backed up, honest cadence from the constants, 'Back up now'", () => {
    const s = sync("synced", { canSync: true, lastSyncAt: new Date(NOW - 5 * 60_000).toISOString() });
    expect(s.status).toBe("Your book is backed up online.");
    expect(s.detail).toBe(
      `Checked 5 mins ago. New versions are uploaded about every ${BACKUP_UPLOAD_MINUTES} minutes, and usually when you close the book.`,
    );
    expect(s.tone).toBe("ok");
    expect(s.note).toBe("You can open it on another computer too.");
    expect(s.actions[0]).toMatchObject({ id: "syncNow", label: "Back up now" });
    expect(s.actions[0]!.primary).toBeFalsy();
  });
  test("Back up now is offered exactly where a manual backup can work", () => {
    const can = ["synced", "idle", "offline", "error", "syncing"] as const;
    for (const state of can) {
      expect(ids(sync(state, { canSync: true })), state).toContain("syncNow");
      expect(ids(sync(state, { canSync: false, hasRemote: true })), state).not.toContain("syncNow");
    }
    for (const state of ["auth", "connect", "local"] as const) {
      expect(ids(sync(state, { canSync: true, hasRemote: true })), state).not.toContain("syncNow");
    }
    expect(ids(onlineSection(input({ versions: { enabled: false }, online: { canSync: true } })))).toEqual([]);
  });
  test("Back up now is primary only when it is the suggested fix", () => {
    for (const state of ["offline", "error"] as const) {
      expect(sync(state, { canSync: true, automatic: false }).actions[0]!.primary, state).toBe(true);
      expect(sync(state, { canSync: true, automatic: true }).actions[0]!.primary, state).toBeFalsy();
    }
    expect(sync("idle", { canSync: true, automatic: false }).actions[0]!.primary).toBeFalsy();
  });
  test("synced without a timestamp: no invented time", () => {
    expect(sync("synced", { canSync: true }).detail!.startsWith("New versions are uploaded")).toBe(true);
  });
  test("synced with automatic backup off: no cadence promise; names the switch", () => {
    const s = sync("synced", { canSync: true, automatic: false });
    expect(s.detail).toContain("Settings → Saving → Keep this book backed up online");
    expect(s.detail).not.toContain("uploaded");
  });
  test("offline: automatic on promises a retry; off does not", () => {
    const on = sync("offline", { canSync: true });
    expect(on.status).toBe("You're offline.");
    expect(on.detail).toContain("will try again on its own");
    const off = sync("offline", { canSync: true, automatic: false });
    expect(off.detail).not.toContain("on its own");
    expect(off.detail).toContain("Use Back up now");
    expect(on.actions[0]).toMatchObject({ id: "syncNow", label: "Back up now" });
  });
  test("error: automatic on promises a retry; off does not", () => {
    const on = sync("error", { canSync: true });
    expect(on.status).toBe("The last online backup didn't finish.");
    expect(on.detail).toContain("Gutterpress will try again");
    const off = sync("error", { canSync: true, automatic: false });
    expect(off.detail).not.toContain("will try again");
  });
  test("idle on a book that can back up: ready (auto on) or off (auto off)", () => {
    const on = sync("idle", { canSync: true });
    expect(on.status).toBe("Online backup is on. Your book will be copied online automatically.");
    expect(ids(on)).toEqual(["syncNow"]);
    const off = sync("idle", { canSync: true, automatic: false });
    expect(off.status).toBe("Automatic online backup is off.");
    expect(off.detail).toContain("Settings → Saving → Keep this book backed up online");
  });
  test("the retry button is never offered when the book can't back up", () => {
    expect(ids(sync("error", { canSync: false }))).toEqual([]);
  });
  test("vocabulary: 'online backup', never 'online copy' or 'sync'", () => {
    for (const state of ["idle", "syncing", "synced", "offline", "auth", "error", "local", "connect"] as const) {
      const s = sync(state, { canSync: true, hasRemote: true });
      const text = [s.status, s.detail, s.note, s.explain].join(" ");
      expect(text).not.toMatch(/online copy|\bsync/i);
    }
  });
});

describe("saveStatusCopy", () => {
  test("the headline scenario: saved, last version 3 days ago, 4 files not in a version", () => {
    const c = saveStatusCopy(input({ versions: { changedFiles: 4 } }));
    expect(c.saving.status).toContain("Saved on this computer");
    expect(c.versions.status).toBe("Your last version is from 3 days ago.");
    expect(c.versions.detail).toContain("saved on this computer, but not in a version yet");
  });
  test("every section carries a one-sentence explanation", () => {
    const c = saveStatusCopy(input());
    for (const s of [c.saving, c.versions, c.online]) expect(s.explain.length).toBeGreaterThan(20);
  });
  test("every sync state produces copy (no state falls through empty)", () => {
    const states: SyncState[] = ["idle", "syncing", "synced", "offline", "auth", "error", "local", "connect"];
    for (const state of states) {
      for (const canSync of [true, false]) {
        for (const hasRemote of [true, false]) {
          for (const automatic of [true, false]) {
            const s = onlineSection(input({ online: { state, canSync, hasRemote, automatic } }));
            expect(s.status.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});

describe("wiring (source-level)", () => {
  const root = path.resolve(__dirname, "../..");
  const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
  test("automatic-version failures travel on the status channel with source 'versions', not as a backup error", () => {
    expect(read("electron/main.ts")).toContain('source: "versions"');
    expect(read("src/lib/platform/contract.ts")).toContain('source?: "versions"');
    const pill = read("src/lib/components/SyncStatusPill.svelte");
    expect(pill).toContain('status.source === "versions"');
    const bar = read("src/lib/components/StatusBar.svelte");
    expect(bar).toContain("onVersionsProblem");
    expect(bar).toContain("problem: versionsProblem");
  });
  test("a manual backup's outcome feeds the dialog, is per-book, and refetches; the version warning is per-book and gated", () => {
    const bar = read("src/lib/components/StatusBar.svelte");
    expect(bar).toContain("manualBackup && manualBackup.dir === projectDir");
    expect(bar).toContain("pillStatus.dir === projectDir");
    expect(bar).toContain("versionsProblemDir === projectDir && autoVersions");
    expect(bar).toContain("async function backUpNow()");
    expect(read("src/routes/+page.svelte")).toContain("manualBackup={syncController.lastManual}");
  });
  test("the status bar sequences lookups and refreshes on a slow poll and on backup-state changes", () => {
    const bar = read("src/lib/components/StatusBar.svelte");
    expect(bar).toContain("seq !== factsSeq");
    expect(bar).toContain("15_000");
    expect(bar).toContain("if (changed && summaryOpen) void fetchVersionFacts()");
    expect(bar).toContain("projectDir !== dialogDir");
  });
  test("unknown classification is passed as null, not false", () => {
    expect(read("src/routes/+page.svelte")).toContain(
      "projectSession.projectCapabilities ? !!projectSession.projectCapabilities.canSnapshot : null",
    );
  });
  test("turning on version history keeps dist/ out of the first version", () => {
    expect(read("src/routes/api/vcs/enable-version-history/+server.ts")).toContain(
      "await lib.ensureGitignoreHasDist(body.projectDir)",
    );
  });
  test("the dialog focuses the primary action, uses the shared shell, and one live region", () => {
    const d = read("src/lib/components/SaveStatusDialog.svelte");
    expect(d).toContain('initialFocus: ".dlg-primary:not(:disabled)"');
    expect(d.match(/aria-live/g)?.length).toBe(1);
    expect(d).toContain('role="status"');
    expect(d).not.toContain("small");
    expect(d).toContain("min(560px");
  });
});

describe("repair online backup", () => {
  test("offered only in the error state, and only when a backup could work", () => {
    expect(ids(onlineSection(input({ online: { state: "error", canSync: true } })))).toContain("repair");
    expect(ids(onlineSection(input({ online: { state: "error", canSync: false } })))).not.toContain("repair");
    for (const state of ["synced", "idle", "offline", "auth", "connect", "local"] as const) {
      expect(ids(onlineSection(input({ online: { state, canSync: true, hasRemote: true } })))).not.toContain("repair");
    }
  });

  test("armed: says what it will do, then Repair now (primary) or Cancel", () => {
    const s = onlineSection(input({ online: { state: "error", canSync: true, repair: "armed" } }));
    expect(s.status).toBe("Repair online backup?");
    expect(s.detail).toContain("stay exactly as they are");
    expect(s.detail).toContain("kept aside in the app's data folder, not deleted");
    expect(s.actions.map((a) => [a.id, a.primary ?? false])).toEqual([
      ["repairNow", true],
      ["repairCancel", false],
    ]);
  });

  test("running: no buttons, and it says the files are not touched", () => {
    const s = onlineSection(input({ online: { state: "error", canSync: true, repair: "running" } }));
    expect(s.tone).toBe("pending");
    expect(s.detail).toContain("stay as they are");
    expect(s.actions).toEqual([]);
  });
});
