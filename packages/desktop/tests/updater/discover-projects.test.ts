// ──────────────────────────────────────────────────────────────────────────
// discover-projects.test.ts — unit tests for the shallow BFS project scan (#27).
//
// scanForProjects is filesystem-injectable, so we drive it with an in-memory
// directory tree (no electron, no real fs).
// ──────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "bun:test";
import {
  scanForProjects,
  DISCOVER_MAX_DEPTH,
  DISCOVER_MAX_RESULTS,
  type ScanDeps,
} from "../../electron/discover-projects.js";

/**
 * Build ScanDeps over a virtual tree.
 * `dirs`: map of dir → child dir names.
 * `manifests`: set of dirs that contain a manifest.yaml.
 */
function makeDeps(
  dirs: Record<string, string[]>,
  manifests: Set<string>,
): ScanDeps {
  return {
    async listDirs(dir: string): Promise<string[]> {
      if (!(dir in dirs)) throw new Error(`ENOENT: ${dir}`);
      return dirs[dir]!;
    },
    async fileExists(filePath: string): Promise<boolean> {
      // filePath = `${dir}/manifest.yaml` — a dir "has a manifest" if listed.
      const dir = filePath.slice(0, filePath.lastIndexOf("/"));
      const name = filePath.slice(filePath.lastIndexOf("/") + 1);
      return name === "manifest.yaml" && manifests.has(dir);
    },
    join: (...segments: string[]) => segments.join("/"),
    basename: (p: string) => p.slice(p.lastIndexOf("/") + 1),
  };
}

describe("scanForProjects", () => {
  test("finds a project nested under a root and titles it by basename", async () => {
    const deps = makeDeps(
      {
        "/root": ["dragon-book", "notes"],
        "/root/dragon-book": [],
        "/root/notes": [],
      },
      new Set(["/root/dragon-book"]),
    );
    const res = await scanForProjects(["/root"], [], deps);
    expect(res).toEqual([{ path: "/root/dragon-book", title: "dragon-book" }]);
  });

  test("detects a manifest on a root directory itself", async () => {
    const deps = makeDeps({ "/proj": [] }, new Set(["/proj"]));
    const res = await scanForProjects(["/proj"], [], deps);
    expect(res).toEqual([{ path: "/proj", title: "proj" }]);
  });

  test("ignores a project that has no manifest.yaml", async () => {
    const deps = makeDeps({ "/legacy": [] }, new Set());

    const res = await scanForProjects(["/legacy"], [], deps);

    expect(res).toEqual([]);
  });

  test("excludes paths already in recents/favorites", async () => {
    const deps = makeDeps(
      { "/root": ["a", "b"], "/root/a": [], "/root/b": [] },
      new Set(["/root/a", "/root/b"]),
    );
    const res = await scanForProjects(["/root"], ["/root/a"], deps);
    expect(res.map((r) => r.path)).toEqual(["/root/b"]);
  });

  test("does not descend past DISCOVER_MAX_DEPTH", async () => {
    // depth 0:/r 1:/r/a 2:/r/a/b 3:/r/a/b/c 4:/r/a/b/c/d (too deep)
    const deps = makeDeps(
      {
        "/r": ["a"],
        "/r/a": ["b"],
        "/r/a/b": ["c"],
        "/r/a/b/c": ["d"],
        "/r/a/b/c/d": [],
      },
      new Set(["/r/a/b/c/d"]),
    );
    expect(DISCOVER_MAX_DEPTH).toBe(3);
    const res = await scanForProjects(["/r"], [], deps);
    // /r/a/b/c/d is at depth 4 — beyond the cap, so not found.
    expect(res).toEqual([]);
  });

  test("finds a project exactly at DISCOVER_MAX_DEPTH", async () => {
    const deps = makeDeps(
      {
        "/r": ["a"],
        "/r/a": ["b"],
        "/r/a/b": ["c"],
        "/r/a/b/c": [],
      },
      new Set(["/r/a/b/c"]),
    );
    const res = await scanForProjects(["/r"], [], deps);
    expect(res.map((r) => r.path)).toEqual(["/r/a/b/c"]);
  });

  test("skips node_modules and dotfolders", async () => {
    const deps = makeDeps(
      {
        "/root": ["node_modules", ".git", "real"],
        "/root/node_modules": ["pkg"],
        "/root/node_modules/pkg": [],
        "/root/.git": [],
        "/root/real": [],
      },
      new Set(["/root/node_modules/pkg", "/root/real"]),
    );
    const res = await scanForProjects(["/root"], [], deps);
    expect(res.map((r) => r.path)).toEqual(["/root/real"]);
  });

  test("tolerates unreadable directories without throwing", async () => {
    const deps = makeDeps(
      { "/root": ["good", "broken"], "/root/good": [] },
      new Set(["/root/good"]),
    );
    // "/root/broken" is not in dirs map → listDirs throws; scan must continue.
    const res = await scanForProjects(["/root"], [], deps);
    expect(res.map((r) => r.path)).toEqual(["/root/good"]);
  });

  test("caps results at DISCOVER_MAX_RESULTS", async () => {
    const children = Array.from({ length: 80 }, (_, i) => `p${i}`);
    const dirs: Record<string, string[]> = { "/root": children };
    const manifests = new Set<string>();
    for (const c of children) {
      dirs[`/root/${c}`] = [];
      manifests.add(`/root/${c}`);
    }
    const res = await scanForProjects(["/root"], [], makeDeps(dirs, manifests));
    expect(res.length).toBe(DISCOVER_MAX_RESULTS);
  });
});
