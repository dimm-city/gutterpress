// ──────────────────────────────────────────────────────────────────────────
// recovery-paths.test.ts — unit tests for the pure userData path builders +
// repo-slug sanitizer extracted from electron/main.ts.
//
// Side-effect-free (no electron, no fs), so we exercise the builders directly
// with an arbitrary userDataDir string.
// ──────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  recoveryDir,
  operationLogPath,
  slugifyRepo,
} from "../../electron/recovery-paths.js";

const DIR = "/home/user/.userdata";

describe("recoveryDir", () => {
  test("joins userDataDir/recovery", () => {
    expect(recoveryDir(DIR)).toBe(path.join(DIR, "recovery"));
  });
});

describe("operationLogPath", () => {
  test("joins userDataDir/logs/<slug>.log", () => {
    expect(operationLogPath(DIR, "mybook")).toBe(
      path.join(DIR, "logs", "mybook.log"),
    );
  });

  test("replaces every non [A-Za-z0-9_-] char with '_'", () => {
    expect(operationLogPath(DIR, "a/b .git:x")).toBe(
      path.join(DIR, "logs", "a_b__git_x.log"),
    );
  });

  test("empty slug falls back to literal 'repo'", () => {
    expect(operationLogPath(DIR, "")).toBe(
      path.join(DIR, "logs", "repo.log"),
    );
  });

  test("all-illegal slug falls back to literal 'repo'", () => {
    expect(operationLogPath(DIR, "///")).toBe(
      path.join(DIR, "logs", "repo.log"),
    );
  });
});

describe("slugifyRepo", () => {
  test("sanitizes each illegal char to '_'", () => {
    expect(slugifyRepo("a/b .git:x")).toBe("a_b__git_x");
  });

  test("preserves legal chars (alnum, underscore, hyphen)", () => {
    expect(slugifyRepo("My-Book_01")).toBe("My-Book_01");
  });

  test("empty string falls back to 'repo'", () => {
    expect(slugifyRepo("")).toBe("repo");
  });

  test("all-illegal string falls back to 'repo'", () => {
    expect(slugifyRepo("///")).toBe("repo");
  });
});
