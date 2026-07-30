/**
 * End-to-end tests for the CLI's positional-argument uniformity (UX finding
 * M46) and exit-code contract (UX finding M47), driven through the actual
 * `gutterpress` CLI process (built from source with Bun, no compiled binary) —
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
  const dir = await makeTempDir("gutterpress-cli-contract-");
  if (manifestYaml !== undefined) {
    await writeFile(path.join(dir, "manifest.yaml"), manifestYaml, "utf8");
  }
  return dir;
}

// ── M46: uniform optional positional [input-dir] ────────────────────────────

describe("M46: validate/preflight/audit accept a positional project directory", () => {
  test("`gutterpress validate <dir>` validates the given dir, not cwd", async () => {
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

  test("`gutterpress validate --input <dir>` still works (explicit flag)", async () => {
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

  test("`gutterpress audit <dir>` uses the real citty positional (not a hand-rolled args._ read)", async () => {
    const dir = await makeProjectDir("preset: totally-bogus-preset\n");
    try {
      const { exitCode, stderr } = runCli(["audit", dir]);
      expect(exitCode).toBe(2);
      expect(stderr).toContain("totally-bogus-preset");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("`gutterpress preflight <dir> --pdf <missing.pdf>` accepts the positional project directory", async () => {
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
  test("`gutterpress build a b` rejects the extra positional", async () => {
    const { exitCode, stderr } = runCli(["build", "a", "b"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("gutterpress build");
    expect(stderr).toContain("unexpected extra argument");
  }, 30000);

  test("`gutterpress validate a b` rejects the extra positional", async () => {
    const { exitCode, stderr } = runCli(["validate", "a", "b"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("gutterpress validate");
  }, 30000);

  test("`gutterpress audit a b` rejects the extra positional", async () => {
    const { exitCode, stderr } = runCli(["audit", "a", "b"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("gutterpress audit");
  }, 30000);

  test("`gutterpress lint a b` rejects the extra positional", async () => {
    const { exitCode, stderr } = runCli(["lint", "a", "b"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("gutterpress lint");
  }, 30000);

  test("`gutterpress new Name Extra` rejects the extra positional before touching disk", async () => {
    const dir = await makeTempDir("gutterpress-cli-contract-new-");
    try {
      const before = fs.readdirSync(dir);
      const { exitCode, stderr } = runCli(["new", "Name", "Extra", "--dir", dir, "--no-git"]);
      expect(exitCode).toBe(2);
      expect(stderr).toContain("gutterpress new");
      // Nothing was scaffolded — the check ran before any filesystem work.
      expect(fs.readdirSync(dir)).toEqual(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);
});

// ── M47: one exit-code contract ─────────────────────────────────────────────

describe("M47: exit-code contract (0 clean / 1 findings / 2 usage / 3 pipeline)", () => {
  test("`gutterpress lint` exits 1 (not 2) on CSS findings", async () => {
    const dir = await makeTempDir("gutterpress-cli-contract-lint-");
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

  test("`gutterpress lint` on clean CSS exits 0", async () => {
    const dir = await makeTempDir("gutterpress-cli-contract-lint-clean-");
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

// ── C6/C7: command and option typo handling ──────────────────────────────────

describe("C6: implicit preview only applies to directories or no command", () => {
  test("a typoed command is rejected with a useful suggestion", () => {
    const { exitCode, stderr } = runCli(["biuld"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Unknown command "biuld"');
    expect(stderr).toContain('Did you mean "build"?');
    expect(stderr).not.toContain("Input directory does not exist");
  });

  test("a nonexistent path is rejected as an unknown command", () => {
    const missing = path.join(process.cwd(), "definitely-not-a-gutterpress-directory");
    const { exitCode, stderr } = runCli([missing]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain(`Unknown command "${missing}"`);
  });

  test("an existing directory still uses the path-as-preview convenience", async () => {
    const dir = await makeProjectDir();
    try {
      const { exitCode, stderr } = runCli([dir, "--format", "docx"]);
      expect(exitCode).toBe(2);
      expect(stderr).toContain("Invalid --format value");
      expect(stderr).not.toContain("Unknown command");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("preview flags without a positional still use the normal preview default", () => {
    const { exitCode, stderr } = runCli(["--format", "docx"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Invalid --format value");
    expect(stderr).not.toContain("Unknown command");
  });

  test("a typo after implicit preview flags is still treated as an unknown command", () => {
    const { exitCode, stderr } = runCli(["--format", "html", "biuld"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Unknown command "biuld"');
    expect(stderr).toContain('Did you mean "build"?');
    expect(stderr).not.toContain("Input directory does not exist");
  });
});

describe("C7: every command rejects unknown flags", () => {
  const invocations: Array<[string, string[]]> = [
    ["new", ["new", "My Book"]],
    ["preview", ["preview"]],
    ["build", ["build"]],
    ["publish", ["publish"]],
    ["lint", ["lint"]],
    ["validate", ["validate"]],
    ["audit", ["audit"]],
    ["preflight", ["preflight", "--pdf", "missing.pdf"]],
    ["repair", ["repair"]],
    ["doctor", ["doctor"]],
    ["plugin parent", ["plugin"]],
    ["plugin add", ["plugin", "add", "markdown-it-footnote"]],
  ];

  test.each(invocations)("%s rejects an unknown option with exit 2", (_name, args) => {
    const { exitCode, stderr } = runCli([...args, "--definitely-unknown"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("unknown option --definitely-unknown");
  });

  test("a typoed string flag is reported before its value becomes an extra positional", () => {
    const { exitCode, stderr } = runCli(["build", ".", "--formt", "html"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("unknown option --formt");
    expect(stderr).not.toContain("unexpected extra argument");
  });

  test.each([
    ["root long help", ["--help"]],
    ["root short help", ["-h"]],
    ["root long version", ["--version"]],
    ["root short version", ["-v"]],
    ["command help", ["build", "--help"]],
  ])("standard %s behavior remains successful", (_label, args) => {
    const { exitCode } = runCli(args);
    expect(exitCode).toBe(0);
  });

  test("root help registers the doctor command", () => {
    const { exitCode, stdout } = runCli(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("doctor");
  });
});

describe("strict value-option handling", () => {
  const invocations: Array<[string, string[]]> = [
    ["implicit preview", ["--format"]],
    ["new", ["new", "My Book", "--author"]],
    ["preview", ["preview", "--port"]],
    ["build", ["build", "--title"]],
    ["publish", ["publish", "--provider"]],
    ["lint", ["lint", "--manifest"]],
    ["validate", ["validate", "--input"]],
    ["audit", ["audit", "--only"]],
    ["preflight", ["preflight", "--pdf"]],
  ];

  test.each(invocations)("%s rejects a missing option value with exit 2", (_name, args) => {
    const { exitCode, stderr } = runCli(args);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("requires a value");
    expect(stderr).not.toContain("UsageError:");
  });

  test("an empty --flag=value form is also rejected", () => {
    const { exitCode, stderr } = runCli(["build", "--format="]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("option --format requires a value");
  });

  test("a following option is not consumed as the missing value", () => {
    const { exitCode, stderr } = runCli(["preview", "--format", "--no-open"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("option --format requires a value");
  });

  test("negative numeric tokens remain values for command-specific validation", () => {
    const { exitCode, stderr } = runCli(["preview", "--port", "-1", "--no-open"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --port value: "-1"');
    expect(stderr).not.toContain("option --port requires a value");
  });
});

describe("plugin add usage errors", () => {
  test("an invalid package spec exits 2 instead of reporting a pipeline failure", () => {
    const { exitCode, stderr } = runCli(["plugin", "add", "markdown-it-highlightjs@"]);

    expect(exitCode).toBe(2);
    expect(stderr).toContain("missing a selector");
  });

  test("a nonexistent project target exits 2 and is not created", async () => {
    const parent = await makeTempDir("gutterpress-cli-plugin-target-");
    const missing = path.join(parent, "typoed-project");
    try {
      const { exitCode, stderr } = runCli([
        "plugin",
        "add",
        "markdown-it-highlightjs@4.3.0",
        missing,
      ]);

      expect(exitCode).toBe(2);
      expect(stderr).toContain(`Project directory does not exist: ${missing}`);
      expect(fs.existsSync(missing)).toBe(false);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

describe("parse-time usage errors keep the documented exit code", () => {
  test("bare plugin shows its subcommand help and exits successfully", () => {
    const { exitCode, stdout, stderr } = runCli(["plugin"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Manage project markdown-it plugins");
    expect(stdout).toContain("add");
    expect(stderr).toBe("");
  });

  test.each([
    ["plugin --", ["plugin", "--"]],
    ["plugin -- add", ["plugin", "--", "add"]],
    ["plugin -", ["plugin", "-"]],
  ] as Array<[string, string[]]>)(
    "%s exits 2 instead of falling through to Citty exit 1",
    (_label, args) => {
      const { exitCode, stderr } = runCli(args);
      expect(exitCode).toBe(2);
      expect(stderr).toContain("expected a subcommand before");
      expect(stderr).not.toContain("No command specified");
    },
  );

  test("invalid port input remains usage exit 2", () => {
    const { exitCode, stderr } = runCli([
      "preview",
      "--port",
      "65536",
      "--no-open",
    ]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Expected an integer from 0 to 65535");
  });

  test("an unavailable preview bind host is pipeline exit 3 with actionable guidance", () => {
    const { exitCode, stderr } = runCli([
      "preview",
      "--host",
      "192.0.2.1",
      "--port",
      "0",
      "--no-open",
    ]);
    expect(exitCode).toBe(3);
    expect(stderr).toContain("Could not bind the preview server");
    expect(stderr).toContain("--host");
    expect(stderr).not.toContain("BuildError:");
  }, 30000);

  test.each([
    ["unknown plugin subcommand", ["plugin", "unknown"], "unknown command"],
    ["missing plugin package", ["plugin", "add", "--export", "named"], "PACKAGE"],
    ["missing new project name", ["new", "--no-git"], "NAME"],
    ["missing preflight PDF", ["preflight", "."], "--pdf"],
  ] as Array<[string, string[], string]>)(
    "%s exits 2 without a raw parser error",
    (_label, args, expected) => {
      const { exitCode, stderr } = runCli(args);
      expect(exitCode).toBe(2);
      expect(stderr).toContain(expected);
      expect(stderr).not.toContain("CLIError");
    },
  );

  test("a dash-prefixed string token is preserved as an option value", async () => {
    const dir = await makeTempDir("gutterpress-cli-dash-value-");
    try {
      const { exitCode, stderr } = runCli([
        "new",
        "Dash Value",
        "--preset",
        "book",
        "--author",
        "--draft",
        "--dir",
        dir,
        "--no-git",
      ]);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const manifest = await fs.promises.readFile(
        path.join(dir, "dash-value", "manifest.yaml"),
        "utf8",
      );
      expect(manifest).toContain("--draft");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);
});

describe("explicit manifest public seams", () => {
  test("live HTML preview rejects --manifest instead of silently ignoring it", () => {
    const { exitCode, stderr } = runCli([
      "preview",
      "--manifest",
      "custom.yaml",
      "--no-open",
    ]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("--manifest is only supported by preview --format pdf or pdfx");
  });

  test.each(["normal", "connect"] as const)(
    "publish %s reports a missing explicit manifest as clean usage error",
    async (mode) => {
      const dir = await makeProjectDir();
      try {
        const missing = path.join(dir, "missing.yaml");
        const args = [
          "publish",
          dir,
          "--provider",
          mode === "connect" ? "itch" : "kdp",
          "--manifest",
          missing,
        ];
        if (mode === "connect") args.push("--connect", "--token", "test-token");

        const { exitCode, stderr } = runCli(args);
        expect(exitCode).toBe(2);
        expect(stderr).toContain(`manifest not found: ${missing}`);
        expect(stderr).not.toContain("UsageError:");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30000,
  );

  test.each(["normal", "connect"] as const)(
    "publish %s reports malformed explicit YAML as clean usage error",
    async (mode) => {
      const dir = await makeProjectDir("title: Broken\nsource:\n\tfiles:\n");
      try {
        const manifest = path.join(dir, "manifest.yaml");
        const args = [
          "publish",
          dir,
          "--provider",
          mode === "connect" ? "itch" : "kdp",
          "--manifest",
          manifest,
        ];
        if (mode === "connect") args.push("--connect", "--token", "test-token");

        const { exitCode, stderr } = runCli(args);
        expect(exitCode).toBe(2);
        expect(stderr).toContain(`Invalid YAML in "${manifest}"`);
        expect(stderr).not.toContain("UsageError:");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30000,
  );
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
