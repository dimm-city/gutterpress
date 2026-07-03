/**
 * Unit tests for the pure per-file resolution PLAN builder (Phase 4c).
 *
 * The builder makes ALL of resolveConflicts's decisions with zero git/fs
 * coupling — blob reads and unique-name picking are injected — so every branch
 * of the decision table is exercised here with plain fakes.
 */
import { describe, expect, test } from "bun:test";

import {
  buildResolutionPlan,
  type ResolutionInput,
  type ResolutionPlanDeps,
} from "./resolution-plan.ts";

const LOCAL = "a".repeat(40);
const REMOTE = "b".repeat(40);

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

/**
 * Build injected deps from a per-oid file table. `files[oid][path]` is the
 * blob bytes for that file in that commit; absence means the file is not in
 * that tree (deleted / never existed).
 */
function makeDeps(
  files: Record<string, Record<string, Uint8Array>>,
  onlineCopyName = (p: string) => `${p} (online copy)`,
): ResolutionPlanDeps & { copyCalls: Array<{ filepath: string; oids: string[] }> } {
  const copyCalls: Array<{ filepath: string; oids: string[] }> = [];
  return {
    copyCalls,
    readBlob: async (oid: string, filepath: string) =>
      files[oid]?.[filepath] ?? null,
    uniqueOnlineCopyPath: async (filepath: string, oids: string[]) => {
      copyCalls.push({ filepath, oids });
      return onlineCopyName(filepath);
    },
  };
}

describe("buildResolutionPlan", () => {
  test("both-edited, choice 'mine' → driver mine + binary fix, no copies", async () => {
    const deps = makeDeps({
      [LOCAL]: { "a.md": bytes("mine") },
      [REMOTE]: { "a.md": bytes("theirs") },
    });
    const resolutions: ResolutionInput[] = [{ path: "a.md", choice: "mine" }];
    const plan = await buildResolutionPlan(resolutions, LOCAL, REMOTE, deps);

    expect(plan.driverChoice.get("a.md")).toBe("mine");
    expect(plan.postBinaryFixes).toEqual([{ path: "a.md", content: bytes("mine") }]);
    expect(plan.preWrites).toEqual([]);
    expect(plan.preDeletes).toEqual([]);
    expect(plan.postWrites).toEqual([]);
    expect(plan.postDeletes).toEqual([]);
    expect(deps.copyCalls).toEqual([]);
  });

  test("both-edited, choice 'theirs' → driver theirs + binary fix from theirs", async () => {
    const deps = makeDeps({
      [LOCAL]: { "a.md": bytes("mine") },
      [REMOTE]: { "a.md": bytes("theirs") },
    });
    const plan = await buildResolutionPlan(
      [{ path: "a.md", choice: "theirs" }],
      LOCAL,
      REMOTE,
      deps,
    );

    expect(plan.driverChoice.get("a.md")).toBe("theirs");
    expect(plan.postBinaryFixes).toEqual([{ path: "a.md", content: bytes("theirs") }]);
    expect(plan.preWrites).toEqual([]);
    expect(deps.copyCalls).toEqual([]);
  });

  test("both-edited, choice 'both' → driver mine, keep-mine binary fix, online copy pre-write", async () => {
    const deps = makeDeps({
      [LOCAL]: { "a.md": bytes("mine") },
      [REMOTE]: { "a.md": bytes("theirs") },
    });
    const plan = await buildResolutionPlan(
      [{ path: "a.md", choice: "both" }],
      LOCAL,
      REMOTE,
      deps,
    );

    expect(plan.driverChoice.get("a.md")).toBe("mine");
    expect(plan.postBinaryFixes).toEqual([{ path: "a.md", content: bytes("mine") }]);
    expect(plan.preWrites).toEqual([
      { path: "a.md (online copy)", content: bytes("theirs") },
    ]);
    // uniqueOnlineCopyPath is asked with BOTH tips so a pre-existing copy in
    // either tree is skipped.
    expect(deps.copyCalls).toEqual([{ filepath: "a.md", oids: [LOCAL, REMOTE] }]);
  });

  test("you-deleted (mine absent, theirs present), choice 'mine' → equalize then re-delete", async () => {
    const deps = makeDeps({
      [LOCAL]: {},
      [REMOTE]: { "gone.md": bytes("online") },
    });
    const plan = await buildResolutionPlan(
      [{ path: "gone.md", choice: "mine" }],
      LOCAL,
      REMOTE,
      deps,
    );

    expect(plan.preWrites).toEqual([{ path: "gone.md", content: bytes("online") }]);
    expect(plan.postDeletes).toEqual(["gone.md"]);
    expect(plan.driverChoice.size).toBe(0);
    expect(plan.postBinaryFixes).toEqual([]);
  });

  test("you-deleted, choice 'theirs' → equalize, keep it (no post-delete)", async () => {
    const deps = makeDeps({
      [LOCAL]: {},
      [REMOTE]: { "gone.md": bytes("online") },
    });
    const plan = await buildResolutionPlan(
      [{ path: "gone.md", choice: "theirs" }],
      LOCAL,
      REMOTE,
      deps,
    );

    expect(plan.preWrites).toEqual([{ path: "gone.md", content: bytes("online") }]);
    expect(plan.postDeletes).toEqual([]);
  });

  test("online-deleted (mine present, theirs absent), choice 'mine' → pre-delete then restore", async () => {
    const deps = makeDeps({
      [LOCAL]: { "keep.md": bytes("local") },
      [REMOTE]: {},
    });
    const plan = await buildResolutionPlan(
      [{ path: "keep.md", choice: "mine" }],
      LOCAL,
      REMOTE,
      deps,
    );

    expect(plan.preDeletes).toEqual(["keep.md"]);
    expect(plan.postWrites).toEqual([{ path: "keep.md", content: bytes("local") }]);
  });

  test("online-deleted, choice 'both' → pre-delete then restore (choice !== theirs)", async () => {
    const deps = makeDeps({
      [LOCAL]: { "keep.md": bytes("local") },
      [REMOTE]: {},
    });
    const plan = await buildResolutionPlan(
      [{ path: "keep.md", choice: "both" }],
      LOCAL,
      REMOTE,
      deps,
    );

    expect(plan.preDeletes).toEqual(["keep.md"]);
    expect(plan.postWrites).toEqual([{ path: "keep.md", content: bytes("local") }]);
  });

  test("online-deleted, choice 'theirs' → pre-delete, accept deletion (no restore)", async () => {
    const deps = makeDeps({
      [LOCAL]: { "keep.md": bytes("local") },
      [REMOTE]: {},
    });
    const plan = await buildResolutionPlan(
      [{ path: "keep.md", choice: "theirs" }],
      LOCAL,
      REMOTE,
      deps,
    );

    expect(plan.preDeletes).toEqual(["keep.md"]);
    expect(plan.postWrites).toEqual([]);
  });

  test("neither side has the file → no-op", async () => {
    const deps = makeDeps({ [LOCAL]: {}, [REMOTE]: {} });
    const plan = await buildResolutionPlan(
      [{ path: "ghost.md", choice: "mine" }],
      LOCAL,
      REMOTE,
      deps,
    );

    expect(plan.driverChoice.size).toBe(0);
    expect(plan.preWrites).toEqual([]);
    expect(plan.preDeletes).toEqual([]);
    expect(plan.postWrites).toEqual([]);
    expect(plan.postDeletes).toEqual([]);
    expect(plan.postBinaryFixes).toEqual([]);
  });

  test("multiple resolutions accumulate across all buckets", async () => {
    const deps = makeDeps({
      [LOCAL]: {
        "both.md": bytes("mine"),
        "keep.md": bytes("local"),
      },
      [REMOTE]: {
        "both.md": bytes("theirs"),
        "gone.md": bytes("online"),
      },
    });
    const resolutions: ResolutionInput[] = [
      { path: "both.md", choice: "both" },
      { path: "gone.md", choice: "mine" },
      { path: "keep.md", choice: "mine" },
    ];
    const plan = await buildResolutionPlan(resolutions, LOCAL, REMOTE, deps);

    expect(plan.driverChoice.get("both.md")).toBe("mine");
    expect(plan.preWrites).toEqual([
      { path: "both.md (online copy)", content: bytes("theirs") },
      { path: "gone.md", content: bytes("online") },
    ]);
    expect(plan.preDeletes).toEqual(["keep.md"]);
    expect(plan.postWrites).toEqual([{ path: "keep.md", content: bytes("local") }]);
    expect(plan.postDeletes).toEqual(["gone.md"]);
    expect(plan.postBinaryFixes).toEqual([{ path: "both.md", content: bytes("mine") }]);
  });
});
