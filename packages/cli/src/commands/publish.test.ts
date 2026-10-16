/**
 * Command-level smoke tests for `publish.ts`'s citty dispatch, added for two
 * review findings on the Google Drive publish provider (issue #221):
 *
 *   B1 — `gutterpress publish --provider gdrive --connect --token <key>`
 *   silently ignored `--token` (and GDRIVE_REFRESH_TOKEN / piped stdin) and
 *   just started the interactive browser flow, because the oauth branch of
 *   `--connect` returned before `connectPublishProvider`'s own "this
 *   provider connects through the browser" rejection could ever run. Fixed
 *   by checking the same three paste-attempt signals (--token, the
 *   provider's env var, and piped stdin) *inside* the oauth branch and
 *   failing with the same guidance instead of starting the browser flow —
 *   the no-signal case (the common one) must keep invoking the browser flow
 *   exactly as before.
 *
 *   B2 — `--list` printed every provider's STATIC `info.format` even when a
 *   project's manifest overrides the EFFECTIVE format via
 *   `publish.<id>.format` (today, only gdrive's pdf/html toggle). Fixed by
 *   resolving the effective format with `resolvePublishFormat` (the same
 *   function `runPublish` itself uses) when a project directory's manifest
 *   is available.
 *
 * `connectGoogleDrive` is `spyOn`-stubbed so these tests never open a real
 * browser or talk to Google. `GUTTERPRESS_CONFIG_DIR` is pointed at a fresh
 * temp dir per test so the real credential store on this machine is never
 * touched.
 */
import { describe, test, expect, spyOn, afterEach, beforeEach } from "bun:test";
import { runCommand } from "citty";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as connectGoogleMod from "../lib/publish/connect-google.ts";
import type { ConnectGoogleDriveResult } from "../lib/publish/connect-google.ts";
import publishCommand from "./publish.ts";
import { EXIT_CODES } from "../lib/cli-args.ts";
import { artifactName, resolveOutputDir } from "../lib/output-paths.ts";
import { listPublishProviders } from "../lib/publish/registry.ts";
import { ProcessExitSignal, stubProcessExit } from "../test-helpers/testkit.ts";

let connectGoogleSpy: ReturnType<typeof spyOn> | undefined;
let exitSpy: ReturnType<typeof stubProcessExit> | undefined;
let consoleErrorSpy: ReturnType<typeof spyOn> | undefined;
let consoleLogSpy: ReturnType<typeof spyOn> | undefined;
let tmpConfigDir: string | undefined;
let prevConfigDir: string | undefined;
let prevGdriveEnv: string | undefined;
let prevStdinIsTTY: boolean | undefined;
let hadStdinIsTTY = false;

function stubExit(): void {
  exitSpy = stubProcessExit();
}

function stubConnectGoogleDrive(
  impl: (
    ...args: Parameters<typeof connectGoogleMod.connectGoogleDrive>
  ) => Promise<ConnectGoogleDriveResult>,
): void {
  connectGoogleSpy = spyOn(connectGoogleMod, "connectGoogleDrive").mockImplementation(
    impl as unknown as typeof connectGoogleMod.connectGoogleDrive,
  );
}

beforeEach(async () => {
  // Isolate the credential store from this machine's real one.
  tmpConfigDir = await mkdtemp(path.join(tmpdir(), "gutterpress-publish-cmd-"));
  prevConfigDir = process.env.GUTTERPRESS_CONFIG_DIR;
  process.env.GUTTERPRESS_CONFIG_DIR = tmpConfigDir;

  // Never let a real GDRIVE_REFRESH_TOKEN leaking from the host environment
  // change what a test is exercising.
  prevGdriveEnv = process.env.GDRIVE_REFRESH_TOKEN;
  delete process.env.GDRIVE_REFRESH_TOKEN;

  // Force the "interactive terminal" shape for stdin so `stdinLooksPiped()`
  // deterministically reports false regardless of how this test runner's
  // own stdin happens to be wired up.
  hadStdinIsTTY = Object.prototype.hasOwnProperty.call(process.stdin, "isTTY");
  prevStdinIsTTY = process.stdin.isTTY;
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
});

afterEach(async () => {
  connectGoogleSpy?.mockRestore();
  exitSpy?.mockRestore();
  consoleErrorSpy?.mockRestore();
  consoleLogSpy?.mockRestore();
  connectGoogleSpy = undefined;
  exitSpy = undefined;
  consoleErrorSpy = undefined;
  consoleLogSpy = undefined;

  if (prevConfigDir === undefined) delete process.env.GUTTERPRESS_CONFIG_DIR;
  else process.env.GUTTERPRESS_CONFIG_DIR = prevConfigDir;
  if (prevGdriveEnv === undefined) delete process.env.GDRIVE_REFRESH_TOKEN;
  else process.env.GDRIVE_REFRESH_TOKEN = prevGdriveEnv;
  if (hadStdinIsTTY) {
    Object.defineProperty(process.stdin, "isTTY", { value: prevStdinIsTTY, configurable: true });
  } else {
    // @ts-expect-error — restoring an absent own-property back to absent.
    delete process.stdin.isTTY;
  }

  if (tmpConfigDir) await rm(tmpConfigDir, { recursive: true, force: true }).catch(() => {});
  tmpConfigDir = undefined;
});

describe("publish --connect (gdrive, oauth) — B1: --token/env/stdin must not silently start the browser flow", () => {
  test("--connect --token <x> --provider gdrive exits with a usage error and never invokes the browser flow", async () => {
    stubExit();
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
    stubConnectGoogleDrive(async () => {
      throw new Error("connectGoogleDrive should not have been called");
    });

    const secret = "super-secret-refresh-token-value";
    let caught: unknown;
    try {
      await runCommand(publishCommand, {
        rawArgs: ["--provider", "gdrive", "--connect", "--token", secret],
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ProcessExitSignal);
    expect((caught as ProcessExitSignal).code).toBe(EXIT_CODES.USAGE);
    expect(connectGoogleSpy).not.toHaveBeenCalled();

    // The rejection must explain WHY, and must never echo the pasted token.
    const loggedText = (consoleErrorSpy?.mock.calls ?? [])
      .map((c: unknown[]) => c.join(" "))
      .join("\n");
    expect(loggedText).toMatch(/browser/i);
    expect(loggedText).not.toContain(secret);
  });

  test("--connect --provider gdrive with GDRIVE_REFRESH_TOKEN set (no --token) is also rejected, not silently started", async () => {
    stubExit();
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
    stubConnectGoogleDrive(async () => {
      throw new Error("connectGoogleDrive should not have been called");
    });
    process.env.GDRIVE_REFRESH_TOKEN = "another-secret-value";

    let caught: unknown;
    try {
      await runCommand(publishCommand, { rawArgs: ["--provider", "gdrive", "--connect"] });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ProcessExitSignal);
    expect((caught as ProcessExitSignal).code).toBe(EXIT_CODES.USAGE);
    expect(connectGoogleSpy).not.toHaveBeenCalled();
  });

  test("--connect --provider gdrive with no --token/env/stdin still invokes the browser flow exactly as before", async () => {
    stubExit();
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    let capturedAccount: string | undefined;
    stubConnectGoogleDrive(async (options) => {
      capturedAccount = (options as { account?: string }).account;
      return { connected: true, email: "writer@example.com" };
    });

    await runCommand(publishCommand, { rawArgs: ["--provider", "gdrive", "--connect"] });

    expect(connectGoogleSpy).toHaveBeenCalledTimes(1);
    expect(capturedAccount).toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe("publish --list — B2: effective format resolution", () => {
  async function tempProjectWithGdriveFormat(format: string): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-publish-list-"));
    await writeFile(
      path.join(dir, "manifest.yaml"),
      `title: Test Book\nauthors: [Tester]\npublish:\n  gdrive:\n    format: ${format}\n`,
      "utf8",
    );
    return dir;
  }

  test("shows the manifest's effective gdrive format (html) instead of the provider's static default (pdf)", async () => {
    const dir = await tempProjectWithGdriveFormat("html");
    try {
      consoleLogSpy = spyOn(process.stdout, "write").mockImplementation(() => true);

      await runCommand(publishCommand, { rawArgs: [dir, "--list", "--json"] });

      const jsonCalls = (consoleLogSpy.mock.calls ?? [])
        .map((c: unknown[]) => c[0])
        .filter((s: unknown): s is string => typeof s === "string" && s.trim().startsWith("["));
      expect(jsonCalls.length).toBeGreaterThan(0);
      const rows = JSON.parse(jsonCalls[jsonCalls.length - 1] as string) as Array<{
        id: string;
        format: string;
      }>;
      const gdriveRow = rows.find((r) => r.id === "gdrive");
      expect(gdriveRow?.format).toBe("html");
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("providers with no `formats` array are unaffected by manifest resolution (byte-identical static format)", async () => {
    const dir = await tempProjectWithGdriveFormat("html");
    try {
      consoleLogSpy = spyOn(process.stdout, "write").mockImplementation(() => true);

      await runCommand(publishCommand, { rawArgs: [dir, "--list", "--json"] });

      const jsonCalls = (consoleLogSpy.mock.calls ?? [])
        .map((c: unknown[]) => c[0])
        .filter((s: unknown): s is string => typeof s === "string" && s.trim().startsWith("["));
      const rows = JSON.parse(jsonCalls[jsonCalls.length - 1] as string) as Array<{
        id: string;
        format: string;
      }>;
      const itchRow = rows.find((r) => r.id === "itch");
      expect(itchRow?.format).toBe("pdf");
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("with no project manifest available, gdrive still falls back to its static default (pdf)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-publish-list-empty-"));
    try {
      consoleLogSpy = spyOn(process.stdout, "write").mockImplementation(() => true);

      await runCommand(publishCommand, { rawArgs: [dir, "--list", "--json"] });

      const jsonCalls = (consoleLogSpy.mock.calls ?? [])
        .map((c: unknown[]) => c[0])
        .filter((s: unknown): s is string => typeof s === "string" && s.trim().startsWith("["));
      const rows = JSON.parse(jsonCalls[jsonCalls.length - 1] as string) as Array<{
        id: string;
        format: string;
      }>;
      const gdriveRow = rows.find((r) => r.id === "gdrive");
      expect(gdriveRow?.format).toBe("pdf");
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

// EXPERIMENTAL (#381): a book's publishing plugin is a `--provider` like any
// built-in. The fixture is a local-folder publisher plus a built PDF at the
// conventional output path.
describe("publish via a publishing plugin (experimental, #381)", () => {
  const RECORDING = `
import { writeFile } from "node:fs/promises";
import path from "node:path";
export async function publish(outputDir, context) {
  await writeFile(path.join(context.project.dir, "received.json"), JSON.stringify({ outputDir, settings: context.settings }));
  return { url: "https://example.com/pub", detail: "Sent to the demo" };
}
`;
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  async function pluginBook(entry = RECORDING): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-publish-plugin-cmd-"));
    dirs.push(dir);
    await mkdir(path.join(dir, "pub"), { recursive: true });
    await writeFile(
      path.join(dir, "pub", "package.json"),
      JSON.stringify({ name: "pub-demo", description: "Demo destination", type: "module", main: "index.js", gutterpress: { publish: true } }),
    );
    await writeFile(path.join(dir, "pub", "index.js"), entry);
    await writeFile(
      path.join(dir, "manifest.yaml"),
      "title: Test Book\nauthors: [Tester]\nextensions:\n  - ./pub\npublish:\n  pub-demo:\n    dest: somewhere\n",
      "utf8",
    );
    const out = resolveOutputDir(dir, "Test Book");
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, artifactName("Test Book", "pdf")), "%PDF-1.4 fake");
    return dir;
  }

  function lastJson(spy: ReturnType<typeof spyOn>): unknown {
    const writes = (spy.mock.calls ?? [])
      .map((c: unknown[]) => c[0])
      .filter((s: unknown): s is string => typeof s === "string" && /^\s*[[{]/.test(s));
    return JSON.parse(writes[writes.length - 1] as string);
  }

  test("--provider <package-name> publishes through the plugin", async () => {
    const dir = await pluginBook();
    consoleLogSpy = spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCommand(publishCommand, { rawArgs: [dir, "--provider", "pub-demo", "--json"] });

    expect(lastJson(consoleLogSpy)).toMatchObject({
      ok: true,
      providerId: "pub-demo",
      outcome: { kind: "published", url: "https://example.com/pub", detail: "Sent to the demo" },
    });
    expect(JSON.parse(await readFile(path.join(dir, "received.json"), "utf8"))).toMatchObject({
      settings: { dest: "somewhere" },
    });
  });

  test("a plugin that throws exits with the findings code and names the plugin", async () => {
    const dir = await pluginBook('export async function publish() { throw new Error("quota exceeded"); }\n');
    stubExit();
    const errors: string[] = [];
    consoleErrorSpy = spyOn(console, "error").mockImplementation((...a) => void errors.push(a.join(" ")));
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});

    await expect(runCommand(publishCommand, { rawArgs: [dir, "--provider", "pub-demo"] })).rejects.toThrow(
      new ProcessExitSignal(EXIT_CODES.FINDINGS).message,
    );
    expect(errors.join("\n")).toContain('Publishing plugin "pub-demo": quota exceeded');
  });

  test("--list shows the plugin after the built-ins, marked experimental", async () => {
    const dir = await pluginBook();
    consoleLogSpy = spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCommand(publishCommand, { rawArgs: [dir, "--list", "--json"] });

    const rows = lastJson(consoleLogSpy) as Array<{ id: string; experimental?: true }>;
    expect(rows.map((r) => r.id)).toEqual([...listPublishProviders().map((p) => p.id), "pub-demo"]);
    expect(rows.filter((r) => r.experimental).map((r) => r.id)).toEqual(["pub-demo"]);
  });

  test("--list (text) shows `experimental` in the status column", async () => {
    const dir = await pluginBook();
    const lines: string[] = [];
    consoleLogSpy = spyOn(console, "log").mockImplementation((...a) => void lines.push(a.join(" ")));

    await runCommand(publishCommand, { rawArgs: [dir, "--list"] });

    expect(lines.find((l) => l.includes("pub-demo"))).toMatch(/pub-demo\s.*\sexperimental$/);
  });

  test("an unknown id still exits with a usage error, naming the book's destinations", async () => {
    const dir = await pluginBook();
    stubExit();
    const errors: string[] = [];
    consoleErrorSpy = spyOn(console, "error").mockImplementation((...a) => void errors.push(a.join(" ")));

    await expect(runCommand(publishCommand, { rawArgs: [dir, "--provider", "nope"] })).rejects.toThrow(
      new ProcessExitSignal(EXIT_CODES.USAGE).message,
    );
    expect(errors.join("\n")).toMatch(/Unknown publish provider "nope"\. Available: .*gdrive, pub-demo\./);
  });

  test("--connect on a plugin explains that it manages its own credentials", async () => {
    const dir = await pluginBook();
    const lines: string[] = [];
    consoleLogSpy = spyOn(console, "log").mockImplementation((...a) => void lines.push(a.join(" ")));

    await runCommand(publishCommand, { rawArgs: [dir, "--provider", "pub-demo", "--connect"] });

    expect(lines.join("\n")).toContain("pub-demo is a publishing plugin — it manages its own credentials");
  });
});
