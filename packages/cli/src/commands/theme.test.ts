/**
 * Command-level tests for `gutterpress theme` (#235) — arg parsing/dispatch,
 * output shape, and the exit-code contract (M47) for each subcommand.
 *
 * Unlike `new.test.ts` (which stubs `scaffoldProject`), these run against the
 * REAL `theme-manager.ts`/`theme-import.ts` functions and a real temp project
 * directory: `theme.ts` is a thin pass-through plus a small amount of its own
 * logic (id resolution for `apply`, source-type dispatch for `import`, the
 * legacy-forked-theme note for `list`), and that logic is best proven against
 * real behavior rather than a mock that could silently drift from it.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile, readFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCommand } from "citty";

import themeCommand from "./theme.ts";
import { EXIT_CODES } from "../lib/cli-args.ts";
import { stubProcessExit, ProcessExitSignal } from "../test-helpers/testkit.ts";
import { getActiveTheme, getPreviousTheme } from "../lib/theme-manager.ts";

let exitSpy: ReturnType<typeof stubProcessExit> | undefined;
let logSpy: ReturnType<typeof spyOn> | undefined;
let errorSpy: ReturnType<typeof spyOn> | undefined;
let warnSpy: ReturnType<typeof spyOn> | undefined;

function stubExit(): void {
  exitSpy = stubProcessExit();
}

function captureOutput(): void {
  logSpy = spyOn(console, "log").mockImplementation(() => {});
  errorSpy = spyOn(console, "error").mockImplementation(() => {});
  warnSpy = spyOn(console, "warn").mockImplementation(() => {});
}

function joinFirstArgs(spy: ReturnType<typeof spyOn> | undefined): string {
  return (spy?.mock.calls ?? []).map((c: unknown[]) => String(c[0])).join("\n");
}
function logged(): string {
  return joinFirstArgs(logSpy);
}
function errored(): string {
  return joinFirstArgs(errorSpy);
}
function warned(): string {
  return joinFirstArgs(warnSpy);
}

afterEach(() => {
  exitSpy?.mockRestore();
  logSpy?.mockRestore();
  errorSpy?.mockRestore();
  warnSpy?.mockRestore();
  exitSpy = undefined;
  logSpy = undefined;
  errorSpy = undefined;
  warnSpy = undefined;
});

async function tmpProjectDir(prefix = "gutterpress-theme-cmd-"): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

async function writeManifest(dir: string, body: string): Promise<void> {
  await writeFile(path.join(dir, "manifest.yaml"), body, "utf8");
}

const ASSET_THEMES_DIR = path.join(import.meta.dirname, "..", "assets", "themes");

describe("gutterpress theme list", () => {
  test("shows built-ins, marks the active project theme, and lists no project themes on a bare project", async () => {
    captureOutput();
    const dir = await tmpProjectDir();
    try {
      await writeManifest(dir, "title: Test\n");
      await runCommand(themeCommand, { rawArgs: ["list", dir] });
      const out = logged();
      expect(out).toContain("Active theme: none");
      expect(out).toContain("clean-book");
      expect(out).toContain("zine");
      expect(out).toContain("technical-doc");
      expect(out).toContain("Project themes: none yet");
      expect(out).not.toContain("byte-identical");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("marks the active theme with [active] once one is applied", async () => {
    captureOutput();
    const dir = await tmpProjectDir();
    try {
      await writeManifest(dir, "title: Test\n");
      await runCommand(themeCommand, { rawArgs: ["apply", "clean-book", dir] });
      logSpy?.mockClear();

      await runCommand(themeCommand, { rawArgs: ["list", dir] });
      const out = logged();
      expect(out).toContain("Active theme: Clean Book (clean-book)");
      expect(out).toMatch(/clean-book\s+Clean Book[\s\S]*\[active\]/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("flags a pre-#236 project whose styles/book.css is a byte-identical fork of a built-in theme", async () => {
    captureOutput();
    const dir = await tmpProjectDir();
    try {
      await mkdir(path.join(dir, "styles"), { recursive: true });
      await copyFile(
        path.join(ASSET_THEMES_DIR, "clean-book", "theme.css"),
        path.join(dir, "styles", "book.css"),
      );
      await writeManifest(dir, "title: Legacy\nstyles:\n  - styles/book.css\n");

      await runCommand(themeCommand, { rawArgs: ["list", dir] });
      const out = logged();
      expect(out).toContain("Active theme: none");
      expect(out).toContain('byte-identical to the built-in theme "Clean Book" (clean-book)');
      expect(out).toContain("gutterpress theme apply clean-book");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("does not flag a project whose styles/book.css merely happens to be non-empty custom CSS", async () => {
    captureOutput();
    const dir = await tmpProjectDir();
    try {
      await mkdir(path.join(dir, "styles"), { recursive: true });
      await writeFile(path.join(dir, "styles", "book.css"), "body { color: red; }\n", "utf8");
      await writeManifest(dir, "title: Custom\nstyles:\n  - styles/book.css\n");

      await runCommand(themeCommand, { rawArgs: ["list", dir] });
      expect(logged()).not.toContain("byte-identical");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects an unexpected extra positional", async () => {
    stubExit();
    captureOutput();
    await expect(
      runCommand(themeCommand, { rawArgs: ["list", "a", "b"] }),
    ).rejects.toThrow(new RegExp(`process\\.exit\\(${EXIT_CODES.USAGE}\\)`));
    expect(errored()).toContain("theme list");
  });
});

describe("gutterpress theme apply", () => {
  test("applies a built-in theme id, creating the manifest and themes/<id>/theme.css", async () => {
    captureOutput();
    const dir = await tmpProjectDir();
    try {
      await runCommand(themeCommand, { rawArgs: ["apply", "zine", dir] });
      expect(logged()).toContain("Applied theme: Zine (zine)");
      expect(existsSync(path.join(dir, "themes", "zine", "theme.css"))).toBe(true);
      const active = await getActiveTheme(dir);
      expect(active?.id).toBe("zine");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("re-applying an id that is already a CUSTOMIZED project theme reuses it instead of forking a new copy", async () => {
    captureOutput();
    const dir = await tmpProjectDir();
    try {
      await writeManifest(dir, "title: Test\n");
      await runCommand(themeCommand, { rawArgs: ["apply", "clean-book", dir] });
      // Simulate a Design-panel edit to the applied project theme.
      const themeCssPath = path.join(dir, "themes", "clean-book", "theme.css");
      await writeFile(themeCssPath, ":root { --custom-token: hotpink; }\n", "utf8");
      logSpy?.mockClear();

      // Re-running `apply clean-book` through the CLI must resolve to the
      // EXISTING project theme (kind: "project"), not re-fork the built-in —
      // that would either clobber the customization or (per applyTheme's
      // non-destructive M6 guard) silently create "clean-book-2" instead of
      // the idempotent re-apply a user typing the same id again expects.
      await runCommand(themeCommand, { rawArgs: ["apply", "clean-book", dir] });
      expect(logged()).toContain("Applied theme: Clean Book (clean-book)");
      expect(await readFile(themeCssPath, "utf8")).toContain("--custom-token: hotpink");
      expect(existsSync(path.join(dir, "themes", "clean-book-2"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an unknown theme id is a usage error (exit 2) naming the known themes", async () => {
    stubExit();
    captureOutput();
    const dir = await tmpProjectDir();
    try {
      await expect(
        runCommand(themeCommand, { rawArgs: ["apply", "no-such-theme", dir] }),
      ).rejects.toThrow(new RegExp(`process\\.exit\\(${EXIT_CODES.USAGE}\\)`));
      expect(errored()).toContain('unknown theme "no-such-theme"');
      expect(errored()).toContain("clean-book");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // The friendly "missing required positional" message + exit code 2 is
  // produced by cli.ts's preflightRequiredInvocations, which only runs ahead
  // of the real `gutterpress` entrypoint — a bare `runCommand(themeCommand,
  // ...)` bypasses it and hits citty's own raw positional check instead (the
  // same reason `new.test.ts` doesn't test this case either). That contract
  // is covered end-to-end in cli-contract.test.ts.
});

describe("gutterpress theme import", () => {
  test("imports a local theme folder and reports it as not yet active", async () => {
    captureOutput();
    const dir = await tmpProjectDir();
    const srcDir = await tmpProjectDir("gutterpress-theme-src-");
    try {
      await writeFile(path.join(srcDir, "theme.css"), ":root { --x: 1; }\n", "utf8");
      await writeFile(
        path.join(srcDir, "theme.json"),
        JSON.stringify({ name: "Folder Theme" }),
        "utf8",
      );

      await runCommand(themeCommand, { rawArgs: ["import", srcDir, dir] });
      const out = logged();
      expect(out).toContain("Imported theme: Folder Theme");
      expect(out).toContain("Not yet active");
      expect(await getActiveTheme(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(srcDir, { recursive: true, force: true });
    }
  });

  test("imports raw CSS from an http(s) URL", async () => {
    captureOutput();
    const dir = await tmpProjectDir();
    const realFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response(":root { --from-url: 1; }\n", {
          status: 200,
          headers: { "content-type": "text/css" },
        })) as unknown as typeof fetch;

      await runCommand(themeCommand, {
        rawArgs: ["import", "https://example.com/cool.css", dir],
      });
      expect(logged()).toContain("Imported theme:");
    } finally {
      globalThis.fetch = realFetch;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("importing a .css file surfaces theme-import.ts's print-safety warnings", async () => {
    captureOutput();
    const dir = await tmpProjectDir();
    const cssPath = path.join(dir, "risky.css");
    try {
      await writeFile(
        cssPath,
        "body { background: url(http://example.com/bg.png); }\n",
        "utf8",
      );
      await runCommand(themeCommand, { rawArgs: ["import", cssPath, dir] });
      expect(logged()).toContain("Imported theme:");
      expect(warned()).toContain("Warning:");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a nonexistent local source is a usage error naming the resolved path", async () => {
    stubExit();
    captureOutput();
    const dir = await tmpProjectDir();
    try {
      const missing = path.join(dir, "does-not-exist");
      await expect(
        runCommand(themeCommand, { rawArgs: ["import", missing, dir] }),
      ).rejects.toThrow(new RegExp(`process\\.exit\\(${EXIT_CODES.USAGE}\\)`));
      expect(errored()).toContain("source not found");
      expect(errored()).toContain(missing);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an unsupported file extension is a usage error", async () => {
    stubExit();
    captureOutput();
    const dir = await tmpProjectDir();
    try {
      const txtPath = path.join(dir, "notes.txt");
      await writeFile(txtPath, "hello", "utf8");
      await expect(
        runCommand(themeCommand, { rawArgs: ["import", txtPath, dir] }),
      ).rejects.toThrow(new RegExp(`process\\.exit\\(${EXIT_CODES.USAGE}\\)`));
      expect(errored()).toContain("unsupported file type");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("gutterpress theme revert", () => {
  test("reverts to the previously active theme", async () => {
    captureOutput();
    const dir = await tmpProjectDir();
    try {
      await runCommand(themeCommand, { rawArgs: ["apply", "clean-book", dir] });
      await runCommand(themeCommand, { rawArgs: ["apply", "zine", dir] });
      logSpy?.mockClear();

      await runCommand(themeCommand, { rawArgs: ["revert", dir] });
      expect(logged()).toContain("Reverted to theme: Clean Book (clean-book)");
      expect((await getActiveTheme(dir))?.id).toBe("clean-book");
      expect((await getPreviousTheme(dir))?.id).toBe("zine");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("no previous theme is a usage error (exit 2), not a pipeline failure", async () => {
    stubExit();
    captureOutput();
    const dir = await tmpProjectDir();
    try {
      await runCommand(themeCommand, { rawArgs: ["apply", "clean-book", dir] });
      await expect(
        runCommand(themeCommand, { rawArgs: ["revert", dir] }),
      ).rejects.toThrow(new RegExp(`process\\.exit\\(${EXIT_CODES.USAGE}\\)`));
      expect(errored()).toContain("no previous theme to revert to");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("gutterpress theme remove", () => {
  test("removes a project theme and calls out when it was the active one", async () => {
    captureOutput();
    const dir = await tmpProjectDir();
    try {
      await runCommand(themeCommand, { rawArgs: ["apply", "clean-book", dir] });
      logSpy?.mockClear();

      await runCommand(themeCommand, { rawArgs: ["remove", "clean-book", dir] });
      const out = logged();
      expect(out).toContain("Removed theme: Clean Book (clean-book)");
      expect(out).toContain("it was the active theme");
      expect(existsSync(path.join(dir, "themes", "clean-book"))).toBe(false);
      expect(await getActiveTheme(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("removing a non-active project theme does not print the active-theme note", async () => {
    captureOutput();
    const dir = await tmpProjectDir();
    try {
      await runCommand(themeCommand, { rawArgs: ["apply", "clean-book", dir] });
      await runCommand(themeCommand, { rawArgs: ["apply", "zine", dir] });
      logSpy?.mockClear();

      await runCommand(themeCommand, { rawArgs: ["remove", "clean-book", dir] });
      const out = logged();
      expect(out).toContain("Removed theme: Clean Book (clean-book)");
      expect(out).not.toContain("it was the active theme");
      expect((await getActiveTheme(dir))?.id).toBe("zine");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("removing an unknown project theme id is a usage error naming what IS present", async () => {
    stubExit();
    captureOutput();
    const dir = await tmpProjectDir();
    try {
      await runCommand(themeCommand, { rawArgs: ["apply", "clean-book", dir] });
      await expect(
        runCommand(themeCommand, { rawArgs: ["remove", "ghost", dir] }),
      ).rejects.toThrow(new RegExp(`process\\.exit\\(${EXIT_CODES.USAGE}\\)`));
      expect(errored()).toContain('"ghost" is not a theme in this project');
      expect(errored()).toContain("clean-book");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Sanity: ProcessExitSignal is exported and typed the way stubProcessExit's
// consumers expect (guards against a testkit signature drift breaking every
// exit-path test above in a confusing way).
test("ProcessExitSignal carries the exit code", () => {
  const err = new ProcessExitSignal(2);
  expect(err.code).toBe(2);
});
