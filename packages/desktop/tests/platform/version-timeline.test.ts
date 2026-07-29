import { describe, test, expect } from "bun:test";
import {
  versionKind,
  versionLabel,
  versionDescription,
  groupVersionsByDay,
} from "../../src/lib/routes/version-timeline";
import type { SnapshotEntry } from "../../src/lib/api";

function snap(over: Partial<SnapshotEntry> & { timestamp: number }): SnapshotEntry {
  return { id: `id-${over.timestamp}`, message: "note", ...over };
}

describe("versionKind / versionLabel — writer-facing classification from message", () => {
  test("the two sentinel messages map to automatic/created", () => {
    expect(versionKind("Automatic snapshot")).toBe("automatic");
    expect(versionKind("Initial snapshot")).toBe("created");
    expect(versionLabel("Automatic snapshot")).toBe("Automatic version");
    expect(versionLabel("Initial snapshot")).toBe("Project created");
  });

  test("any other message is a manual version saved by the author", () => {
    expect(versionKind("Before rewriting the intro")).toBe("manual");
    expect(versionLabel("Before rewriting the intro")).toBe("Version saved by you");
  });

  test("only manual versions carry a description (the author's own note)", () => {
    expect(versionDescription("Before rewriting the intro")).toBe("Before rewriting the intro");
    expect(versionDescription("Automatic snapshot")).toBeNull();
    expect(versionDescription("Initial snapshot")).toBeNull();
  });

  test("no writer-facing label leaks the words snapshot/commit/git", () => {
    for (const m of ["Automatic snapshot", "Initial snapshot", "hand note"]) {
      expect(versionLabel(m).toLowerCase()).not.toMatch(/snapshot|commit|git/);
    }
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
