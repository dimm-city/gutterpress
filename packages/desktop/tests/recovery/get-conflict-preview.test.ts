/**
 * Tests for the getConflictPreviewImpl host handler.
 *
 * Exercises the REAL `getConflictPreviewImpl` export from electron/recovery-bridge.ts
 * so tests cover the shipped code, not a reimplemented copy.
 *
 * Verifies:
 * 1. Returns {mine, theirs, kind, isBinary:false} for a text file
 * 2. Returns {isBinary:true, mine:'', theirs:''} for image/font extensions
 * 3. Rejects path traversal attempts (../ in path)
 * 4. Returns empty string for theirs when sidecar is absent
 * 5. Returns empty string for mine when the working-tree file is missing
 * 6. Handles nested paths within projectDir (no traversal)
 */

import { describe, test, expect } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getConflictPreviewImpl } from "../../electron/recovery-bridge";
import type { ConflictKind } from "../../electron/recovery-bridge";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal `onlineCopyPath` stub.
 * The real lib appends a sidecar suffix alongside the file; here we put the
 * sidecar next to the working-tree file with a ".online" suffix so we can
 * write it with `writeFile` in tests.
 */
function onlineCopyPath(absPath: string): string {
  return absPath + ".online";
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getConflictPreviewImpl (real implementation)", () => {
  let tmpDir: string;

  const setup = async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "gutterpress-preview-"));
    return tmpDir;
  };

  const teardown = async () => {
    await rm(tmpDir, { recursive: true, force: true });
  };

  test("returns mine+theirs text for a markdown file (both-edited)", async () => {
    const dir = await setup();
    try {
      await writeFile(path.join(dir, "ch01.md"), "# Chapter 1\nMy version.", "utf-8");
      await writeFile(path.join(dir, "ch01.md.online"), "# Chapter 1\nTheir version.", "utf-8");

      const result = await getConflictPreviewImpl(dir, "ch01.md", "both-edited", onlineCopyPath);

      expect(result.isBinary).toBe(false);
      expect(result.mine).toBe("# Chapter 1\nMy version.");
      expect(result.theirs).toBe("# Chapter 1\nTheir version.");
      expect(result.kind).toBe("both-edited");
    } finally {
      await teardown();
    }
  });

  test("returns isBinary:true with empty strings for .png", async () => {
    const dir = await setup();
    try {
      const result = await getConflictPreviewImpl(dir, "assets/hero.png", "both-edited", onlineCopyPath);

      expect(result.isBinary).toBe(true);
      expect(result.mine).toBe("");
      expect(result.theirs).toBe("");
    } finally {
      await teardown();
    }
  });

  test("returns isBinary:true for font files (.ttf, .woff2, .otf)", async () => {
    const dir = await setup();
    try {
      for (const ext of [".ttf", ".woff2", ".otf"] as const) {
        const result = await getConflictPreviewImpl(
          dir,
          `fonts/body${ext}`,
          "both-edited",
          onlineCopyPath,
        );
        expect(result.isBinary).toBe(true);
      }
    } finally {
      await teardown();
    }
  });

  test("rejects path traversal with ../ in relativePath", async () => {
    const dir = await setup();
    try {
      await expect(
        getConflictPreviewImpl(dir, "../../../etc/passwd", "both-edited", onlineCopyPath),
      ).rejects.toThrow("Path traversal rejected");
    } finally {
      await teardown();
    }
  });

  test("returns empty theirs when online sidecar does not exist", async () => {
    const dir = await setup();
    try {
      await writeFile(path.join(dir, "chapter.md"), "My local content", "utf-8");
      // No .online sidecar — getConflictPreviewImpl should handle the missing file gracefully

      const result = await getConflictPreviewImpl(
        dir,
        "chapter.md",
        "you-deleted" as ConflictKind,
        onlineCopyPath,
      );

      expect(result.isBinary).toBe(false);
      expect(result.mine).toBe("My local content");
      expect(result.theirs).toBe("");
    } finally {
      await teardown();
    }
  });

  test("returns empty mine when working-tree file is missing (online-deleted kind)", async () => {
    const dir = await setup();
    try {
      // Write only the sidecar, no working-tree file
      await writeFile(path.join(dir, "chapter.md.online"), "Online content", "utf-8");

      const result = await getConflictPreviewImpl(
        dir,
        "chapter.md",
        "online-deleted" as ConflictKind,
        onlineCopyPath,
      );

      expect(result.isBinary).toBe(false);
      expect(result.mine).toBe("");
      expect(result.theirs).toBe("Online content");
    } finally {
      await teardown();
    }
  });

  test("nested path within projectDir is accepted (no traversal)", async () => {
    const dir = await setup();
    try {
      await mkdir(path.join(dir, "chapters"), { recursive: true });
      await writeFile(path.join(dir, "chapters", "ch01.md"), "mine", "utf-8");
      await writeFile(path.join(dir, "chapters", "ch01.md.online"), "theirs", "utf-8");

      const result = await getConflictPreviewImpl(
        dir,
        "chapters/ch01.md",
        "both-edited",
        onlineCopyPath,
      );

      expect(result.isBinary).toBe(false);
      expect(result.mine).toBe("mine");
      expect(result.theirs).toBe("theirs");
    } finally {
      await teardown();
    }
  });

  test("oversized mine file gets truncated with '… [truncated]' suffix", async () => {
    const dir = await setup();
    try {
      // Write a file larger than the 256 KB cap
      const big = "A".repeat(256 * 1024 + 100);
      await writeFile(path.join(dir, "big.md"), big, "utf-8");

      const result = await getConflictPreviewImpl(dir, "big.md", "both-edited", onlineCopyPath);

      expect(result.isBinary).toBe(false);
      expect(result.mine.endsWith("\n… [truncated]")).toBe(true);
      // theirs is empty because there is no sidecar
      expect(result.theirs).toBe("");
    } finally {
      await teardown();
    }
  });
});
