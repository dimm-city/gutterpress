import { describe, test, expect } from "bun:test";
import { bannedTermsIn } from "../../../cli/src/test-helpers/vocabulary";
import {
  versionKind,
  versionLabel,
  versionDescription,
  groupVersionsByDay,
  collapseAutomaticRuns,
  autoRunSummary,
} from "../../src/lib/routes/version-timeline";
import type { SnapshotEntry } from "../../src/lib/api";

function snap(over: Partial<SnapshotEntry> & { timestamp: number }): SnapshotEntry {
  return { id: `id-${over.timestamp}`, message: "note", ...over };
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

describe("collapseAutomaticRuns — busy days fold into one expandable row", () => {
  const auto = (ts: number, msg = "Automatic version") =>
    snap({ timestamp: ts, message: msg });

  test("2+ consecutive automatic versions become one auto-run row, entries preserved in order", () => {
    const entries = [
      auto(3000, "Automatic version before backing up"),
      auto(2000, "Automatic version"),
      auto(1000),
    ];
    const rows = collapseAutomaticRuns(entries);
    expect(rows.length).toBe(1);
    expect(rows[0]!.kind).toBe("auto-run");
    if (rows[0]!.kind !== "auto-run") throw new Error("unreachable");
    expect(rows[0]!.entries.map((e) => e.timestamp)).toEqual([3000, 2000, 1000]);
  });

  test("a lone automatic version stays an ordinary row", () => {
    const rows = collapseAutomaticRuns([auto(1000)]);
    expect(rows).toEqual([{ kind: "entry", key: "id-1000", entry: auto(1000) }]);
  });

  test("manual and combined rows break a run and are never folded", () => {
    const entries = [
      auto(6000),
      snap({ timestamp: 5000, message: "Before rewriting the intro" }),
      snap({ timestamp: 4000, message: "Combined your changes with the online version" }),
      auto(3000),
      auto(2000),
    ];
    const rows = collapseAutomaticRuns(entries);
    expect(rows.map((r) => r.kind)).toEqual(["entry", "entry", "entry", "auto-run"]);
    if (rows[3]!.kind !== "auto-run") throw new Error("unreachable");
    expect(rows[3]!.entries.length).toBe(2);
  });

  test("a run is keyed by its OLDEST entry, so the key survives newer versions prepending", () => {
    const rows = collapseAutomaticRuns([auto(2000), auto(1000)]);
    const grown = collapseAutomaticRuns([auto(3000), auto(2000), auto(1000)]);
    if (rows[0]!.kind !== "auto-run" || grown[0]!.kind !== "auto-run") throw new Error("unreachable");
    expect(rows[0]!.key).toBe(grown[0]!.key);
    expect(rows[0]!.key).toContain("id-1000");
  });

  test("empty input yields no rows", () => {
    expect(collapseAutomaticRuns([])).toEqual([]);
  });
});

describe("autoRunSummary — the collapsed row's one-line story", () => {
  const at = (ms: number) =>
    new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  test("names the span oldest→newest and the count (entries arrive newest-first)", () => {
    const entries = [
      snap({ timestamp: 4_000_000, message: "Automatic version" }),
      snap({ timestamp: 2_000_000, message: "Automatic version" }),
      snap({ timestamp: 1_000_000, message: "Automatic version" }),
    ];
    expect(autoRunSummary(entries)).toBe(
      `Versions made automatically · ${at(1_000_000)}–${at(4_000_000)} · 3 times`,
    );
  });

  test("a same-minute run shows the time once", () => {
    const entries = [
      snap({ timestamp: 1_000_500, message: "Automatic version" }),
      snap({ timestamp: 1_000_000, message: "Automatic version" }),
    ];
    expect(autoRunSummary(entries)).toBe(`Versions made automatically · ${at(1_000_000)} · 2 times`);
  });

  test("never uses a banned term", () => {
    const entries = [
      snap({ timestamp: 2_000, message: "Snapshot before syncing" }),
      snap({ timestamp: 1_000, message: "Snapshot before syncing" }),
    ];
    expect(bannedTermsIn(autoRunSummary(entries))).toEqual([]);
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
