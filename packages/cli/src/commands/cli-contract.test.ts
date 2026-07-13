/**
 * End-to-end tests for the CLI's positional-argument uniformity (UX finding
 * M46) and exit-code contract (UX finding M47), driven through the actual
 * `print-md` CLI process (built from source with Bun, no compiled binary) —
 * the surface these bugs were observed on. See `EXIT_CODES` in
 * `../lib/cli-args.ts` (re-exported from `../lib/build-error.ts`) for the
 * contract these tests pin: 0 clean / 1 findings / 2 usage / 3 pipeline.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { makeTempDir } from "../test-helpers/testkit.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = path.join(__dirname, "..", "cli.ts");

function runCli(cliArgs: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: ["bun", "run", CLI_ENTRY, ...cliArgs],
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

async function makeProjectDir(manifestYaml?: string): Promise<string> {
  const dir = await makeTempDir("print-md-cli-contract-");
  if (manifestYaml !== undefined) {
    await writeFile(path.join(dir, "manifest.yaml"), manifestYaml, "utf8");
  }
  return dir;
}

// ── M46: uniform optional positional [input-dir] ────────────────────────────

describe("M46: validate/preflight/audit accept a positional project directory", () => {
  test("`print-md validate <dir>` validates the given dir, not cwd", async () => {
    // A manifest with an unknown preset makes resolution fail loudly and
    // distinctly for THIS directory — proof the positional was actually used
    // (validating cwd, which has no such manifest, would behave differently).
    const dir = await makeProjectDir("preset: totally-bogus-preset\n");
    try {
      const { exitCode, stderr } = runCli(["validate", dir]);
      expect(exitCode).toBe(2);
      expect(stderr).toContain("totally-bogus-preset");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("`print-md validate --input <dir>` still works (explicit flag)", async () => {
    const dir = await makeProjectDir("preset: totally-bogus-preset\n");
    try {
      const { exitCode, stderr } = runCli(["validate", "--input", dir]);
      expect(exitCode).toBe(2);
      expect(stderr).toContain("totally-bogus-preset");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("an explicit --input overrides the positional directory", async () => {
    const goodDir = await makeProjectDir(); // no manifest, no error
    const badDir = await makeProjectDir("preset: totally-bogus-preset\n");
    try {
      // Positional points at the bad dir, --input points at the good one —
      // --input must win, so this should NOT error on the bogus preset.
      const { stderr } = runCli(["validate", badDir, "--input", goodDir]);
      expect(stderr).not.toContain("totally-bogus-preset");
    } finally {
      await rm(goodDir, { recursive: true, force: true });
      await rm(badDir, { recursive: true, force: true });
    }
  }, 30000);

  test("`print-md audit <dir>` uses the real citty positional (not a hand-rolled args._ read)", async () => {
    const dir = await makeProjectDir("preset: totally-bogus-preset\n");
    try {
      const { exitCode, stderr } = runCli(["audit", dir]);
      expect(exitCode).toBe(2);
      expect(stderr).toContain("totally-bogus-preset");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("`print-md preflight <dir> --pdf <missing.pdf>` accepts the positional project directory", async () => {
    const dir = await makeProjectDir("preset: totally-bogus-preset\n");
    try {
      const { exitCode, stderr } = runCli([
        "preflight",
        dir,
        "--pdf",
        path.join(dir, "does-not-exist.pdf"),
      ]);
      expect(exitCode).toBe(2);
      expect(stderr).toContain("totally-bogus-preset");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);
});

describe("M46: unexpected extra positionals are a UsageError (exit 2), uniformly", () => {
  test("`print-md build a b` rejects the extra positional", async () => {
    const { exitCode, stderr } = runCli(["build", "a", "b"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("print-md build");
    expect(stderr).toContain("unexpected extra argument");
  }, 30000);

  test("`print-md validate a b` rejects the extra positional", async () => {
    const { exitCode, stderr } = runCli(["validate", "a", "b"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("print-md validate");
  }, 30000);

  test("`print-md audit a b` rejects the extra positional", async () => {
    const { exitCode, stderr } = runCli(["audit", "a", "b"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("print-md audit");
  }, 30000);

  test("`print-md lint a b` rejects the extra positional", async () => {
    const { exitCode, stderr } = runCli(["lint", "a", "b"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("print-md lint");
  }, 30000);

  test("`print-md new Name Extra` rejects the extra positional before touching disk", async () => {
    const dir = await makeTempDir("print-md-cli-contract-new-");
    try {
      const before = fs.readdirSync(dir);
      const { exitCode, stderr } = runCli(["new", "Name", "Extra", "--dir", dir, "--no-git"]);
      expect(exitCode).toBe(2);
      expect(stderr).toContain("print-md new");
      // Nothing was scaffolded — the check ran before any filesystem work.
      expect(fs.readdirSync(dir)).toEqual(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);
});

// ── M47: one exit-code contract ─────────────────────────────────────────────

describe("M47: exit-code contract (0 clean / 1 findings / 2 usage / 3 pipeline)", () => {
  test("`print-md lint` exits 1 (not 2) on CSS findings", async () => {
    const dir = await makeTempDir("print-md-cli-contract-lint-");
    try {
      await mkdir(path.join(dir, "css"), { recursive: true });
      // A remote url() reference is flagged as a hard error by printsafe.ts.
      await writeFile(
        path.join(dir, "css", "print.css"),
        "body { background: url(http://example.com/bg.png); }\n",
        "utf8"
      );
      await writeFile(
        path.join(dir, "manifest.yaml"),
        "preset: dtrpg\nstyles:\n  - css/print.css\n",
        "utf8"
      );
      const { exitCode } = runCli(["lint", dir]);
      expect(exitCode).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("`print-md lint` on clean CSS exits 0", async () => {
    const dir = await makeTempDir("print-md-cli-contract-lint-clean-");
    try {
      await mkdir(path.join(dir, "css"), { recursive: true });
      await writeFile(path.join(dir, "css", "print.css"), "body { color: black; }\n", "utf8");
      await writeFile(
        path.join(dir, "manifest.yaml"),
        "preset: dtrpg\nstyles:\n  - css/print.css\n",
        "utf8"
      );
      const { exitCode } = runCli(["lint", dir]);
      expect(exitCode).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("a bad flag value is a usage error (exit 2), distinct from findings (exit 1)", async () => {
    const { exitCode, stderr } = runCli(["build", ".", "--format", "docx"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Invalid --format value");
  }, 30000);
});

// ── M48: unknown preset errors; book preset is available ───────────────────

describe("M48: unknown preset errors instead of silently falling back to dtrpg", () => {
  test("an unknown preset value is a UsageError naming the known presets", async () => {
    const dir = await makeProjectDir("preset: a4\n");
    try {
      const { exitCode, stderr } = runCli(["validate", dir]);
      expect(exitCode).toBe(2);
      expect(stderr).toContain('"a4"');
      expect(stderr).toContain("dtrpg");
      expect(stderr).toContain("book");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("`preset: book` resolves without error (the new neutral preset is registered)", async () => {
    const dir = await makeProjectDir("preset: book\n");
    try {
      const { exitCode, stderr } = runCli(["validate", dir, "--phase", "pre"]);
      expect(stderr).not.toContain("Unknown preset");
      expect(exitCode).not.toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);
});
