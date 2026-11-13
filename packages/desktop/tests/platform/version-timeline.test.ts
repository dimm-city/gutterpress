import { describe, test, expect } from "bun:test";
import { bannedTermsIn } from "../../../cli/src/test-helpers/vocabulary";
import {
  versionKind,
  versionLabel,
  versionDescription,
  groupVersionsByDay,
  editingSessions,
  SESSION_GAP_MS,
  sessionTitle,
  timeSpan,
  sessionFiles,
  changedSummary,
  shortHint,
  fileName,
  isNamed,
  matchesVersion,
  pickFile,
  usualAuthor,
  onlineSummary,
} from "../../src/lib/routes/version-timeline";
import type { SnapshotEntry, VersionEntry, VersionFileChange } from "../../src/lib/api";

function snap(over: Partial<SnapshotEntry> & { timestamp: number }): SnapshotEntry {
  return { id: `id-${over.timestamp}`, message: "note", ...over };
}

function change(path: string, hint = "1 paragraph changed", text = true): VersionFileChange {
  return { path, kind: "changed", hint, text };
}

// Every message the app itself records into history — current spellings AND
// superseded ones (existing history keeps old spellings forever, so both are
// part of the string contract the timeline classifies).
const AUTOMATIC_MESSAGES = [
  "Automatic version", // source-provider AUTO_SNAPSHOT_MESSAGE
  "Automatic version before backing up", // sync-messages SYNC_SNAPSHOT_MESSAGE
  "Automatic version before restoring", // RESTORE_BACKUP_MESSAGE
  "Saved before switching revision", // SWITCH_BRANCH_SNAPSHOT_MESSAGE
  "Repaired the online copy", // repair REPAIR_SNAPSHOT_MESSAGE
  "Saved the edit you made while backing up", // sync-messages SYNC_LATE_EDIT_MESSAGE
  "Before deleting chapter-02.md", // fs/delete route (a prefix match)
  "Getting your changes ready to combine with the online copy's changes", // CONVERGE_PREPARE_MESSAGE
  // Superseded spellings:
  "Automatic snapshot",
  "Automatic backup of your work", // SYNC_SNAPSHOT_MESSAGE (0.10.1+)
  "Snapshot before syncing", // SYNC_SNAPSHOT_MESSAGE (pre-0.10.1 history)
  "Saved the edit you made while syncing",
  "Automatic backup before restoring an earlier version",
  "Saved before switching copy",
  "Repaired online backup",
  "Getting your changes ready to combine with the online version",
];
const COMBINED_MESSAGES = [
  "Combined your changes with the online copy's", // CONVERGE_MERGE_MESSAGE
  "Kept both takes of the files that can't be combined", // CONVERGE_RESTORE_MESSAGE
  // Superseded spellings:
  "Combined your changes with the online version",
  "Kept both versions of the files that can't be combined",
];
const CREATED_MESSAGES = [
  "First version", // enable-version-history route
  "Initial snapshot", // enable-version-history route (superseded)
  "Created project", // project-scaffold (new project)
  "Set up as a gutterpress book", // project-scaffold (adopted folder)
];
const ALL_MACHINE_MESSAGES = [...AUTOMATIC_MESSAGES, ...COMBINED_MESSAGES, ...CREATED_MESSAGES];

describe("versionKind / versionLabel — writer-facing classification from message", () => {
  test("every automatic machine message (old and new spellings) is automatic", () => {
    for (const m of AUTOMATIC_MESSAGES) {
      expect(versionKind(m)).toBe("automatic");
      expect(versionLabel(m)).toBe("Automatic version");
    }
  });

  test("the converge commits read as combined-with-the-online-copy", () => {
    for (const m of COMBINED_MESSAGES) {
      expect(versionKind(m)).toBe("combined");
      expect(versionLabel(m)).toBe("Combined with the online copy");
    }
  });

  test("history-start versions read as the first version", () => {
    for (const m of CREATED_MESSAGES) {
      expect(versionKind(m)).toBe("created");
      expect(versionLabel(m)).toBe("First version");
    }
  });

  test("any other message is a manual version saved by the author", () => {
    expect(versionKind("Before rewriting the intro")).toBe("manual");
    expect(versionLabel("Before rewriting the intro")).toBe("Version saved by you");
  });

  test("only manual versions carry a description (the author's own note)", () => {
    expect(versionDescription("Before rewriting the intro")).toBe("Before rewriting the intro");
    for (const m of ALL_MACHINE_MESSAGES) {
      expect(versionDescription(m)).toBeNull();
    }
  });

  test("the save-a-version route's default note is machine copy, not an author note", () => {
    // "Save a version" with no note records "Saved a version" (before 0.11.23,
    // "Saved snapshot") — a manual save (the writer clicked it), but the
    // placeholder is never echoed.
    for (const m of ["Saved a version", "Saved snapshot"]) {
      expect(versionKind(m)).toBe("manual");
      expect(versionDescription(m)).toBeNull();
    }
  });

  test("nothing a writer sees uses a banned term", () => {
    for (const m of [...ALL_MACHINE_MESSAGES, "Saved a version", "Saved snapshot", "hand note"]) {
      const visible = `${versionLabel(m)} ${versionDescription(m) ?? ""}`;
      // "hand note" is the author's own text and may say anything; machine
      // rows must surface only the label.
      if (m !== "hand note") {
        expect(bannedTermsIn(visible)).toEqual([]);
      } else {
        expect(bannedTermsIn(versionLabel(m))).toEqual([]);
      }
    }
  });
});

describe("editingSessions — automatic saves fold into editing sessions", () => {
  const MIN = 60_000;
  const auto = (ts: number, msg = "Automatic version") => snap({ timestamp: ts, message: msg });

  test("2+ consecutive automatic versions become one session, versions kept in order", () => {
    const entries = [auto(3 * MIN, "Automatic version before backing up"), auto(2 * MIN), auto(MIN)];
    const rows = editingSessions(entries);
    expect(rows.length).toBe(1);
    if (rows[0]!.kind !== "session") throw new Error("unreachable");
    expect(rows[0]!.entries.map((e) => e.timestamp)).toEqual([3 * MIN, 2 * MIN, MIN]);
  });

  test("a lone automatic version stays a row of its own", () => {
    expect(editingSessions([auto(MIN)])).toEqual([{ kind: "version", key: `id-${MIN}`, entry: auto(MIN) }]);
  });

  test("a named version is a landmark: it ends a session and is never folded", () => {
    const entries = [
      auto(6 * MIN),
      snap({ timestamp: 5 * MIN, message: "Before rewriting the intro" }),
      snap({ timestamp: 4 * MIN, message: "Combined your changes with the online version" }),
      auto(3 * MIN),
      auto(2 * MIN),
    ];
    const rows = editingSessions(entries);
    expect(rows.map((r) => r.kind)).toEqual(["version", "version", "version", "session"]);
  });

  test("a pause of an hour or more starts a new session", () => {
    const entries = [auto(200 * MIN), auto(197 * MIN), auto(197 * MIN - SESSION_GAP_MS), auto(190 * MIN - SESSION_GAP_MS)];
    const rows = editingSessions(entries);
    expect(rows.map((r) => (r.kind === "session" ? r.entries.length : 1))).toEqual([2, 2]);
  });

  test("a session is keyed by its OLDEST version, so the key (and whether it is open) survives newer saves", () => {
    const [before] = editingSessions([auto(2 * MIN), auto(MIN)]);
    const [after] = editingSessions([auto(3 * MIN), auto(2 * MIN), auto(MIN)]);
    expect(before!.key).toBe(after!.key);
    expect(before!.key).toContain(`id-${MIN}`);
  });

  test("empty input yields no rows", () => {
    expect(editingSessions([])).toEqual([]);
  });
});

describe("a session's row copy", () => {
  test('"Editing · N automatic saves", in plain words', () => {
    expect(sessionTitle(14)).toBe("Editing · 14 automatic saves");
    expect(bannedTermsIn(sessionTitle(3))).toEqual([]);
  });

  test("the span runs oldest to newest, its AM/PM said once when both ends share it", () => {
    const at = (h: number, m: number) => new Date(2026, 10, 12, h, m).getTime();
    const span = timeSpan([snap({ timestamp: at(16, 52) }), snap({ timestamp: at(16, 49) })]);
    const end = new Date(at(16, 52)).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    expect(span.endsWith(`–${end}`)).toBe(true);
    expect(span.startsWith("4:49") || span.startsWith("16:49")).toBe(true);
    expect(span.split(/AM|PM/).length).toBeLessThanOrEqual(2);
  });

  test("a same-minute session shows the time once", () => {
    const t = new Date(2026, 10, 12, 9, 5).getTime();
    expect(timeSpan([snap({ timestamp: t + 500 }), snap({ timestamp: t })])).not.toContain("–");
  });

  test("the files it touched, each named once, without folders, '+N' past four", () => {
    const c = (...paths: string[]) => ({ files: paths.map((p) => change(p)), more: 0 });
    expect(sessionFiles([c("ch05.md"), undefined, c("ch19.md", "ch05.md")])).toBe("ch05.md, ch19.md");
    expect(sessionFiles([c("a.md", "b.md", "c.md"), c("d.md", "themes/book.css", "f.md")])).toBe("a.md, b.md, c.md, d.md +2");
    expect(sessionFiles([undefined, undefined])).toBe("");
  });
});

describe("a version row's changed files", () => {
  test("one file says how much: 'ch14.md · 1 paragraph'", () => {
    expect(changedSummary({ files: [change("ch14.md", "1 paragraph changed")], more: 0 })).toBe("ch14.md · 1 paragraph");
    expect(changedSummary({ files: [change("images/plate.png", "replaced")], more: 0 })).toBe("plate.png · replaced");
  });

  test("several are named, '+N' past four and for the ones not listed", () => {
    expect(changedSummary({ files: [change("ch03.md"), change("ch04.md")], more: 0 })).toBe("ch03.md, ch04.md");
    expect(changedSummary({ files: [change("ch03.md")], more: 9 })).toBe("ch03.md +9");
    expect(changedSummary({ files: [], more: 0 })).toBe("No changes");
  });

  test("hints drop the 'changed' every one says", () => {
    expect(shortHint("3 paragraphs changed")).toBe("3 paragraphs");
    expect(shortHint("replaced")).toBe("replaced");
    expect(fileName("themes/book.css")).toBe("book.css");
  });
});

describe("finding a version", () => {
  const v = (message: string, backedUp: boolean | null = null): VersionEntry => ({ ...snap({ timestamp: 1, message }), backedUp });

  test("Named keeps the versions the author saved; Not online yet the ones only here", () => {
    expect(isNamed("Before cutting chapter 12")).toBe(true);
    expect(isNamed("Automatic version")).toBe(false);
    expect(matchesVersion(v("Before cutting chapter 12"), "named", "")).toBe(true);
    expect(matchesVersion(v("Automatic version"), "named", "")).toBe(false);
    expect(matchesVersion(v("Automatic version", false), "local", "")).toBe(true);
    expect(matchesVersion(v("Automatic version", true), "local", "")).toBe(false);
    expect(matchesVersion(v("Automatic version", null), "local", "")).toBe(false);
  });

  test("the search matches a note or title, any case", () => {
    expect(matchesVersion(v("Sent to printer for a proof"), "all", "PRINTER")).toBe(true);
    expect(matchesVersion(v("Automatic snapshot"), "all", "automatic version")).toBe(true);
    expect(matchesVersion(v("Sent to printer"), "all", "ch07")).toBe(false);
  });

  test("it matches a changed file only once that version's changes have loaded", () => {
    const entry = v("Automatic version");
    expect(matchesVersion(entry, "all", "ch07")).toBe(false);
    expect(matchesVersion(entry, "all", "ch07", { files: [change("text/ch07.md")], more: 0 })).toBe(true);
    expect(matchesVersion(entry, "named", "ch07", { files: [change("text/ch07.md")], more: 0 })).toBe(false);
  });
});

describe("pickFile — the file a version opens to", () => {
  const files = [change("images/plate.png", "replaced", false), change("ch05.md"), change("ch19.md")];

  test("the file the author had open, when this version changed it too", () => {
    expect(pickFile(files, "ch19.md")).toBe("ch19.md");
  });

  test("else its first text file, else its first file, else nothing", () => {
    expect(pickFile(files, "ch01.md")).toBe("ch05.md");
    expect(pickFile(files, null)).toBe("ch05.md");
    expect(pickFile([change("a.png", "added", false)], null)).toBe("a.png");
    expect(pickFile([], "ch05.md")).toBeNull();
  });
});

describe("authors and the online banner", () => {
  test("the usual author is the one most versions carry", () => {
    const by = (author?: string) => snap({ timestamp: 1, author });
    expect(usualAuthor([by("Ada"), by("Grace"), by("Ada"), by()])).toBe("Ada");
    expect(usualAuthor([by(), by()])).toBeNull();
  });

  test("the banner says how many and from whom", () => {
    const from = (author?: string) => snap({ timestamp: 1, author });
    expect(onlineSummary([from("Grace"), from("Grace")])).toBe("2 versions from Grace aren't on this computer yet");
    expect(onlineSummary([from("Grace")])).toBe("1 version from Grace isn't on this computer yet");
    expect(onlineSummary([from("Grace"), from("Bo"), from("Ada")])).toBe("3 versions from Grace, Bo and Ada aren't on this computer yet");
    expect(onlineSummary([from(), from()])).toBe("2 versions aren't on this computer yet");
  });
});

describe("groupVersionsByDay — chronological day buckets", () => {
  const DAY = 86_400_000;
  const now = 1_700_000_000_000; // fixed "now" so Today/Yesterday are deterministic

  test("consecutive same-day entries share one bucket, order preserved", () => {
    const entries = [
      snap({ timestamp: now - 1000 }),
      snap({ timestamp: now - 2000 }),
      snap({ timestamp: now - DAY - 1000 }),
    ];
    const days = groupVersionsByDay(entries, now);
    expect(days.length).toBe(2);
    expect(days[0].label).toBe("Today");
    expect(days[0].entries.map((e) => e.timestamp)).toEqual([now - 1000, now - 2000]);
    expect(days[1].label).toBe("Yesterday");
    expect(days[1].entries.length).toBe(1);
  });

  test("day keys are stable and unique per calendar day", () => {
    const days = groupVersionsByDay([snap({ timestamp: now }), snap({ timestamp: now - 2 * DAY })], now);
    expect(days.length).toBe(2);
    expect(new Set(days.map((d) => d.key)).size).toBe(2);
  });

  test("older days get a written date label, not Today/Yesterday", () => {
    const days = groupVersionsByDay([snap({ timestamp: now - 5 * DAY })], now);
    expect(days[0].label).not.toBe("Today");
    expect(days[0].label).not.toBe("Yesterday");
    expect(days[0].label.length).toBeGreaterThan(0);
  });

  test("empty input yields no day buckets", () => {
    expect(groupVersionsByDay([], now)).toEqual([]);
  });
});
