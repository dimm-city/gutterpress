// Unit tests for src/project/discover.ts (SFE-P3c run spec deliverable 1 /
// D9: "A Gutterpress manifest is found from the document's workspace
// folder; absence is a supported, non-error state.").
//
// findGutterpressProject/resolveActiveProjectDir/resolveProjectForCommand
// are all `vscode`-free (see discover.ts's own header) — this suite drives
// them directly with plain strings and disposable temp directories, no
// `mock.module("vscode", ...)` needed.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  findGutterpressProject,
  resolveActiveProjectDir,
  resolveActiveGutterpressProject,
  resolveProjectForCommand,
} from "../../src/project/discover.ts";

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "gp-vscode-discover-"));
  tempDirs.push(dir);
  return dir;
}

function makeProjectDir(): string {
  const dir = makeTempDir();
  writeFileSync(path.join(dir, "manifest.yaml"), "title: Fixture\n", "utf8");
  return dir;
}

beforeEach(() => {
  tempDirs = [];
});

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("findGutterpressProject — D9 project discovery", () => {
  test("a directory with manifest.yaml is a project", () => {
    const dir = makeProjectDir();
    expect(findGutterpressProject(dir)).toEqual({ projectDir: dir });
  });

  test("D9: a plain folder with no manifest is a supported non-error state, not a thrown error", () => {
    const dir = makeTempDir();
    expect(() => findGutterpressProject(dir)).not.toThrow();
    expect(findGutterpressProject(dir)).toBeUndefined();
  });

  test("D9: no workspace folder at all (undefined) is the same non-error state", () => {
    expect(findGutterpressProject(undefined)).toBeUndefined();
  });

  test("a nonexistent directory is also a non-error 'no project' result", () => {
    expect(findGutterpressProject(path.join(tmpdir(), "gp-vscode-discover-does-not-exist"))).toBeUndefined();
  });
});

describe("resolveActiveProjectDir — pure path resolution, no manifest check", () => {
  test("prefers the active editor's own workspace folder", () => {
    const result = resolveActiveProjectDir({
      activeDocumentPath: "/ws/project-a/chapter-01.md",
      workspaceFolderPaths: ["/ws/project-a", "/ws/project-b"],
    });
    expect(result).toBe("/ws/project-a");
  });

  test("falls back to the sole open workspace folder when there is no matching active editor", () => {
    const result = resolveActiveProjectDir({
      activeDocumentPath: undefined,
      workspaceFolderPaths: ["/ws/only-project"],
    });
    expect(result).toBe("/ws/only-project");
  });

  test("an active document OUTSIDE every open folder still falls back to the sole folder", () => {
    const result = resolveActiveProjectDir({
      activeDocumentPath: "/elsewhere/scratch.md",
      workspaceFolderPaths: ["/ws/only-project"],
    });
    expect(result).toBe("/ws/only-project");
  });

  test("ambiguous: no active editor and more than one folder open returns undefined", () => {
    const result = resolveActiveProjectDir({
      activeDocumentPath: undefined,
      workspaceFolderPaths: ["/ws/project-a", "/ws/project-b"],
    });
    expect(result).toBeUndefined();
  });

  test("nothing open at all returns undefined", () => {
    expect(resolveActiveProjectDir({ activeDocumentPath: undefined, workspaceFolderPaths: [] })).toBeUndefined();
  });

  test("a same-prefix sibling folder is NOT treated as a match (path-boundary correctness)", () => {
    // /ws/project vs /ws/project-extra — a naive string-prefix check would
    // wrongly match "/ws/project-extra/x.md" against "/ws/project".
    const result = resolveActiveProjectDir({
      activeDocumentPath: "/ws/project-extra/x.md",
      workspaceFolderPaths: ["/ws/project"],
    });
    // No active-editor match against the one folder, and more than one
    // folder is NOT open here (exactly one), so the sole-folder fallback
    // still applies — this test's real assertion is the NEXT one, which
    // makes the boundary check the deciding factor by adding a second
    // folder so the fallback cannot mask a wrong match.
    expect(result).toBe("/ws/project");
  });

  test("path-boundary correctness, decisive: a same-prefix sibling does not win over the true owner", () => {
    const result = resolveActiveProjectDir({
      activeDocumentPath: "/ws/project-extra/x.md",
      workspaceFolderPaths: ["/ws/project", "/ws/project-extra"],
    });
    expect(result).toBe("/ws/project-extra");
  });
});

describe("resolveActiveGutterpressProject — combines both", () => {
  test("returns the project when the resolved directory has a manifest", () => {
    const dir = makeProjectDir();
    const result = resolveActiveGutterpressProject({ activeDocumentPath: undefined, workspaceFolderPaths: [dir] });
    expect(result).toEqual({ projectDir: dir });
  });

  test("returns undefined when the resolved directory has no manifest", () => {
    const dir = makeTempDir();
    const result = resolveActiveGutterpressProject({ activeDocumentPath: undefined, workspaceFolderPaths: [dir] });
    expect(result).toBeUndefined();
  });
});

describe("resolveProjectForCommand — D14: WHY a miss happened, not just that it happened", () => {
  test("found: true when a project resolves", () => {
    const dir = makeProjectDir();
    const outcome = resolveProjectForCommand({ activeDocumentPath: undefined, workspaceFolderPaths: [dir] });
    expect(outcome).toEqual({ found: true, project: { projectDir: dir } });
  });

  test("reason 'no-workspace' when nothing is open", () => {
    const outcome = resolveProjectForCommand({ activeDocumentPath: undefined, workspaceFolderPaths: [] });
    expect(outcome).toEqual({ found: false, reason: "no-workspace" });
  });

  test("reason 'ambiguous-workspace' when multiple folders are open with no matching active editor", () => {
    const outcome = resolveProjectForCommand({
      activeDocumentPath: undefined,
      workspaceFolderPaths: ["/ws/a", "/ws/b"],
    });
    expect(outcome).toEqual({ found: false, reason: "ambiguous-workspace" });
  });

  test("reason 'no-manifest' when a single resolved folder has no manifest.yaml", () => {
    const dir = makeTempDir();
    const outcome = resolveProjectForCommand({ activeDocumentPath: undefined, workspaceFolderPaths: [dir] });
    expect(outcome).toEqual({ found: false, reason: "no-manifest" });
  });
});
