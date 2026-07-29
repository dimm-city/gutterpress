import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createFileLogger,
  resolveLogger,
  shortOid,
} from "./operation-log.ts";

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "gutterpress-oplog-"));
}

describe("operation-log", () => {
  describe("createFileLogger", () => {
    test("writes timestamped lines to the log file", async () => {
      const dir = await tempDir();
      try {
        const logFile = path.join(dir, "sync.log");
        const logger = createFileLogger(logFile, "sync");
        logger.info("fetch", "fetched remote", { branch: "main" });
        logger.warn("merge", "conflict detected", { files: ["a.md", "b.md"] });

        const content = await readFile(logFile, "utf8");
        const lines = content.trim().split("\n");
        expect(lines.length).toBe(2);
        expect(lines[0]).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        expect(lines[0]).toContain("INFO");
        expect(lines[0]).toContain("sync");
        expect(lines[0]).toContain("step=fetch");
        expect(lines[0]).toContain("branch=main");
        expect(lines[0]).toContain("fetched remote");
        expect(lines[1]).toContain("WARN");
        expect(lines[1]).toContain("files=a.md,b.md");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    test("creates parent directory if it doesn't exist", async () => {
      const dir = await tempDir();
      try {
        const logFile = path.join(dir, "nested", "deep", "sync.log");
        const logger = createFileLogger(logFile, "sync");
        logger.info("test", "writes to nested path");
        const content = await readFile(logFile, "utf8");
        expect(content).toContain("writes to nested path");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    test("appends to existing log file (not truncates)", async () => {
      const dir = await tempDir();
      try {
        const logFile = path.join(dir, "sync.log");
        await writeFile(logFile, "PREEXISTING LINE\n", "utf8");
        const logger = createFileLogger(logFile, "sync");
        logger.info("test", "appended line");
        const content = await readFile(logFile, "utf8");
        expect(content).toContain("PREEXISTING LINE");
        expect(content).toContain("appended line");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    test("respects minLevel (filters out lower levels)", async () => {
      const dir = await tempDir();
      try {
        const logFile = path.join(dir, "sync.log");
        const logger = createFileLogger(logFile, "sync", "warn");
        logger.debug("step1", "debug msg");
        logger.info("step2", "info msg");
        logger.warn("step3", "warn msg");
        logger.error("step4", "error msg");
        const content = await readFile(logFile, "utf8");
        expect(content).not.toContain("debug msg");
        expect(content).not.toContain("info msg");
        expect(content).toContain("warn msg");
        expect(content).toContain("error msg");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    test("swallows write errors silently (never throws)", async () => {
      // Point to a path that can't be written to (a file used as a directory).
      const logger = createFileLogger("/dev/null/impossible/sync.log", "sync");
      expect(() => logger.info("test", "never throws")).not.toThrow();
    });

    test("handles undefined data values gracefully", async () => {
      const dir = await tempDir();
      try {
        const logFile = path.join(dir, "sync.log");
        const logger = createFileLogger(logFile, "sync");
        logger.info("step", "msg", { a: "x", b: undefined, c: 42, d: true });
        const content = await readFile(logFile, "utf8");
        expect(content).toContain("a=x");
        expect(content).not.toContain("b=undefined");
        expect(content).toContain("c=42");
        expect(content).toContain("d=true");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("resolveLogger", () => {
    test("returns a no-op logger when logFile is undefined", async () => {
      const logger = resolveLogger(undefined, "sync");
      // Should not throw and should not create any files.
      expect(() => logger.info("test", "msg")).not.toThrow();
    });

    test("returns a no-op logger when logFile is empty string", async () => {
      const logger = resolveLogger("", "sync");
      expect(() => logger.info("test", "msg")).not.toThrow();
    });

    test("returns a file logger when logFile is set", async () => {
      const dir = await tempDir();
      try {
        const logFile = path.join(dir, "sync.log");
        const logger = resolveLogger(logFile, "recovery");
        logger.info("dispatch", "starting");
        const content = await readFile(logFile, "utf8");
        expect(content).toContain("recovery");
        expect(content).toContain("dispatch");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("shortOid", () => {
    test("shortens a 40-char SHA to 7 chars", () => {
      expect(shortOid("0123456789abcdef0123456789abcdef01234567")).toBe("0123456");
    });

    test("passes through short strings unchanged", () => {
      expect(shortOid("abc")).toBe("abc");
    });
  });
});
