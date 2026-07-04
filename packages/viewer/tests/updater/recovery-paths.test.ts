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

  // Behavior-preservation guard: the original main.ts used
  // `repoSlug.replace(/[^a-zA-Z0-9_-]/g, "_") || "repo"`, so a NON-EMPTY
  // all-illegal slug sanitizes to underscores and is NOT replaced by "repo".
  // These pin the true original semantics and fail against the regressed
  // `/[a-zA-Z0-9]/.test(slug) ? slug : "repo"` variant.
  test("non-empty all-illegal slug sanitizes to underscores (not 'repo')", () => {
    expect(operationLogPath(DIR, "///")).toBe(
      path.join(DIR, "logs", "___.log"),
    );
  });

  test("all-separator slug is preserved verbatim (not 'repo')", () => {
    expect(operationLogPath(DIR, "-_-")).toBe(
      path.join(DIR, "logs", "-_-.log"),
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

  // Behavior-preservation guards pinning the original `|| "repo"` semantics:
  // "repo" fires ONLY for an empty result, so a non-empty all-separator/
  // all-illegal input keeps its sanitized form and is NOT rewritten to "repo".
  test("non-empty all-illegal string sanitizes to underscores (not 'repo')", () => {
    expect(slugifyRepo("///")).toBe("___");
  });

  test("all-underscore string is preserved (not 'repo')", () => {
    expect(slugifyRepo("___")).toBe("___");
  });

  test("single hyphen is preserved (not 'repo')", () => {
    expect(slugifyRepo("-")).toBe("-");
  });

  test("mixed separators are preserved (not 'repo')", () => {
    expect(slugifyRepo("-_-")).toBe("-_-");
  });
});
