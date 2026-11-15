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
import * as buildRunnerMod from "../lib/build-runner.ts";
import * as validationExecMod from "../lib/validation-exec.ts";
import type { ValidationExecutionResult } from "../lib/validation-exec.ts";
import type { ConnectGoogleDriveResult } from "../lib/publish/connect-google.ts";
import publishCommand from "./publish.ts";
import { EXIT_CODES } from "../lib/cli-args.ts";
import { artifactName, resolveOutputDir } from "../lib/output-paths.ts";
import { listPublishProviders } from "../lib/publish/registry.ts";
import { ProcessExitSignal, stubProcessExit } from "../test-helpers/testkit.ts";

let connectGoogleSpy: ReturnType<typeof spyOn> | undefined;
let runBuildSpy: ReturnType<typeof spyOn> | undefined;
let validateSpy: ReturnType<typeof spyOn> | undefined;
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
  // No real browser or checks: the build writes a stand-in PDF where a real
  // one would go, and the checks find nothing.
  runBuildSpy = spyOn(buildRunnerMod, "runBuild").mockImplementation(async (opts) => {
    const out = resolveOutputDir(opts.inputDir, "Test Book");
    await mkdir(out, { recursive: true });
    if (opts.format === "html") return { outDir: out, htmlPath: path.join(out, "book.html"), pdfPath: null, fingerprintPath: null, diagnostics: [] };
    const pdf = path.join(out, artifactName("Test Book", opts.format));
    await writeFile(pdf, "%PDF-1.4 fake");
    const plainPdfPath = path.join(out, artifactName("Test Book", "pdf"));
    if (opts.withPlainPdf) await writeFile(plainPdfPath, "%PDF-1.4 fake");
    return {
      outDir: out,
      htmlPath: null,
      pdfPath: pdf,
      ...(opts.withPlainPdf ? { plainPdfPath } : {}),
      fingerprintPath: null,
      diagnostics: [],
    };
  });
  validateSpy = spyOn(validationExecMod, "executeValidation").mockImplementation(
    async () =>
      ({
        report: { results: [] },
        tools: { missing: [], skippedChecks: [], toolToChecks: new Map() },
      }) as unknown as ValidationExecutionResult,
  );

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
  runBuildSpy?.mockRestore();
  validateSpy?.mockRestore();
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
      targets: [
        {
          id: "pub-demo",
          status: "sent",
          outcome: { kind: "published", url: "https://example.com/pub", detail: "Sent to the demo" },
        },
      ],
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

    const rows = lastJson(consoleLogSpy) as Array<{ id: string; kind: string; experimental?: true }>;
    expect(rows.map((r) => r.id)).toEqual([...listPublishProviders().map((p) => p.id), "pub-demo"]);
    expect(rows.filter((r) => r.experimental).map((r) => r.id)).toEqual(["pub-demo"]);
    expect(rows.at(-1)?.kind).toBe("plugin");
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

// #452 case 11: the CLI reads the book's Drive folder from the manifest only,
// never writes it (not even on failure), and names a one-run way out.
describe("publish --provider gdrive — the book's folder from the manifest, never written", () => {
  const dirs: string[] = [];
  let fetchSpy: ReturnType<typeof spyOn> | undefined;
  const uploads: string[] = [];

  beforeEach(() => {
    process.env.GDRIVE_REFRESH_TOKEN = "rt";
    process.env.GUTTERPRESS_GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GUTTERPRESS_GOOGLE_CLIENT_SECRET = "test-client-secret";
    uploads.length = 0;
    // This account reaches only its own folder "B1"; any other id is a 404.
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (url.includes("oauth2.googleapis.com/token")) return json({ access_token: "at", expires_in: 3599 });
      if (url.includes("/drive/v3/about")) return json({ storageQuota: { usage: "0" } });
      if (/\/files\/B1\?fields=id,name,trashed,mimeType/.test(url)) {
        return json({ id: "B1", name: "Ben's Books", trashed: false, mimeType: "application/vnd.google-apps.folder" });
      }
      if (/\/files\/[^?]+\?fields=id,name,trashed,mimeType/.test(url)) return json({ error: { code: 404 } }, 404);
      if (url.includes("/drive/v3/files?q=")) return json({ files: [] });
      if (url.includes("uploadType=resumable")) {
        uploads.push(String(init?.body));
        return new Response(null, { status: 200, headers: { Location: "https://upload.test/s" } });
      }
      if (url === "https://upload.test/s") return json({ id: "f", name: "x", webViewLink: "https://drive.google.com/file/d/f/view" });
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch);
  });
  afterEach(async () => {
    fetchSpy?.mockRestore();
    delete process.env.GUTTERPRESS_GOOGLE_CLIENT_ID;
    delete process.env.GUTTERPRESS_GOOGLE_CLIENT_SECRET;
    for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  async function teamBook(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-publish-gdrive-cmd-"));
    dirs.push(dir);
    await writeFile(
      path.join(dir, "manifest.yaml"),
      "title: Test Book\nauthors: [Tester]\npreset: book\npublish:\n  gdrive:\n    folderId: F1\n    folder: Harbor Books\n",
      "utf8",
    );
    return dir;
  }

  function lastJson(spy: ReturnType<typeof spyOn>): {
    ok: boolean;
    targets: Array<{ status: string; failure?: { message: string } }>;
  } {
    const writes = (spy.mock.calls ?? [])
      .map((c: unknown[]) => c[0])
      .filter((s: unknown): s is string => typeof s === "string" && /^\s*\{/.test(s));
    return JSON.parse(writes[writes.length - 1] as string);
  }

  test("an unreachable book folder fails naming it and the one-run flags, and the manifest is unchanged", async () => {
    const dir = await teamBook();
    const before = await readFile(path.join(dir, "manifest.yaml"), "utf8");
    stubExit();
    consoleLogSpy = spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(
      runCommand(publishCommand, { rawArgs: [dir, "--provider", "gdrive", "--json"] }),
    ).rejects.toThrow(new ProcessExitSignal(EXIT_CODES.FINDINGS).message);

    const result = lastJson(consoleLogSpy);
    expect(result.ok).toBe(false);
    expect(result.targets[0]?.status).toBe("failed");
    expect(result.targets[0]?.failure?.message).toContain('the Drive folder "Harbor Books", which this Google account can\'t reach');
    expect(result.targets[0]?.failure?.message).toContain("--folder-id <id> or --folder <name>");
    expect(uploads).toEqual([]);
    expect(await readFile(path.join(dir, "manifest.yaml"), "utf8")).toBe(before);
  });

  test("--folder-id publishes to that folder for this run only", async () => {
    const dir = await teamBook();
    const before = await readFile(path.join(dir, "manifest.yaml"), "utf8");
    consoleLogSpy = spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCommand(publishCommand, {
      rawArgs: [dir, "gdrive", "--folder-id", "B1", "--json"],
    });

    expect(lastJson(consoleLogSpy).ok).toBe(true);
    expect(uploads.map((b) => (JSON.parse(b) as { parents: string[] }).parents)).toEqual([["B1"]]);
    expect(await readFile(path.join(dir, "manifest.yaml"), "utf8")).toBe(before);
  });

  test("--folder-id and --folder are refused for any other provider", async () => {
    const dir = await teamBook();
    stubExit();
    const errors: string[] = [];
    consoleErrorSpy = spyOn(console, "error").mockImplementation((...a) => void errors.push(a.join(" ")));

    await expect(
      runCommand(publishCommand, { rawArgs: [dir, "--provider", "kdp", "--folder", "Mine"] }),
    ).rejects.toThrow(new ProcessExitSignal(EXIT_CODES.USAGE).message);
    expect(errors.join("\n")).toContain("--folder-id and --folder are for the gdrive target.");
  });
});

// ADR 0012: `gutterpress publish` is the terminal's view of the one publish run.
describe("publish — the one run, from the terminal", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  async function book(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-publish-run-cmd-"));
    dirs.push(dir);
    await writeFile(
      path.join(dir, "manifest.yaml"),
      "title: Test Book\nauthors: [Tester]\npreset: book\npublish:\n  drivethrurpg-print:\n  local:\n    dir: out\n",
      "utf8",
    );
    return dir;
  }

  function json(): { ok: boolean; targets: Array<{ id: string; status: string }> } {
    const writes = (consoleLogSpy!.mock.calls ?? [])
      .map((c: unknown[]) => c[0])
      .filter((s: unknown): s is string => typeof s === "string" && /^\s*\{/.test(s));
    return JSON.parse(writes[writes.length - 1] as string);
  }

  const status = () => json().targets.map((t) => `${t.id}:${t.status}`);

  test("with no targets named, every target of the book is made from one build and sent", async () => {
    const dir = await book();
    consoleLogSpy = spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCommand(publishCommand, { rawArgs: [dir, "--json"] });

    expect(status()).toEqual(["drivethrurpg-print:prepared", "local:sent"]);
    expect(runBuildSpy!.mock.calls.map((c: unknown[]) => (c[0] as { format: string }).format)).toEqual(["pdfx"]);
  });

  test("named targets are the only ones published, in either order with the folder", async () => {
    const dir = await book();
    consoleLogSpy = spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCommand(publishCommand, { rawArgs: ["local", dir, "--json"] });

    expect(status()).toEqual(["local:sent"]);
  });

  test("--dry-run makes and checks the files and sends nothing", async () => {
    const dir = await book();
    consoleLogSpy = spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCommand(publishCommand, { rawArgs: [dir, "local", "--dry-run", "--json"] });

    expect(status()).toEqual(["local:checked"]);
    expect(validateSpy).toHaveBeenCalled();
    expect(await readFile(path.join(dir, "out", artifactName("Test Book", "pdf"))).catch(() => null)).toBeNull();
  });

  test("--skip-checks runs no checks", async () => {
    const dir = await book();
    consoleLogSpy = spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCommand(publishCommand, { rawArgs: [dir, "local", "--skip-checks", "--json"] });

    expect(status()).toEqual(["local:sent"]);
    expect(validateSpy).not.toHaveBeenCalled();
  });

  test("a target whose file breaks its rules is held alone, says how to send it anyway, and fails the command", async () => {
    const dir = await book();
    validateSpy!.mockImplementation(
      async (args: { phase?: string }) =>
        ({
          report: {
            results:
              args.phase === "post-build"
                ? [{ checkId: "pdf.print.bleed", severity: "error", message: "No bleed.", target: "drivethrurpg-print" }]
                : [],
          },
          tools: { missing: [], skippedChecks: [], toolToChecks: new Map() },
        }) as unknown as ValidationExecutionResult,
    );
    stubExit();
    const lines: string[] = [];
    consoleLogSpy = spyOn(console, "log").mockImplementation((...a) => void lines.push(a.join(" ")));
    consoleErrorSpy = spyOn(console, "error").mockImplementation((...a) => void lines.push(a.join(" ")));

    await expect(runCommand(publishCommand, { rawArgs: [dir] })).rejects.toThrow(
      new ProcessExitSignal(EXIT_CODES.FINDINGS).message,
    );
    const text = lines.join("\n");
    expect(text).toContain("[pdf.print.bleed] No bleed.");
    expect(text).toContain("gutterpress publish drivethrurpg-print --send-anyway");
    expect(await readFile(path.join(dir, "out", artifactName("Test Book", "pdf")), "utf8")).toBe("%PDF-1.4 fake");

    exitSpy?.mockRestore();
    exitSpy = undefined;
    consoleLogSpy.mockRestore();
    consoleLogSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
    await runCommand(publishCommand, { rawArgs: [dir, "--send-anyway", "--json"] });
    expect(status()).toEqual(["drivethrurpg-print:prepared", "local:sent"]);
  });

  test("--json prints only the result on stdout, even when the build logs", async () => {
    // A real run in a real process: the build's own log lines must not reach stdout.
    const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-publish-json-cmd-"));
    dirs.push(dir);
    await writeFile(
      path.join(dir, "manifest.yaml"),
      "title: Test Book\nauthors: [Tester]\npreset: book\npublish:\n  local:\n    format: html\n    dir: out\n",
    );
    await writeFile(path.join(dir, "chapter.md"), "# Hello\n");
    const run = Bun.spawnSync(["bun", path.join(import.meta.dir, "..", "cli.ts"), "publish", dir, "--dry-run", "--json"], {
      env: { ...process.env, GUTTERPRESS_CONFIG_DIR: tmpConfigDir! },
    });
    const stdout = run.stdout.toString();
    expect(stdout).not.toContain("Build (html)");
    expect(JSON.parse(stdout).targets[0].status).toBe("checked");
  }, 60_000);

  test("a target that passes still shows its check warnings, but not the notes", async () => {
    const dir = await book();
    validateSpy!.mockImplementation(
      async (args: { phase?: string }) =>
        ({
          report: {
            results:
              args.phase === "post-build"
                ? [
                    { checkId: "pdf.print.bleed", severity: "warning", message: "Bleed area appears insufficient.", target: "drivethrurpg-print", data: { page: 3 } },
                    { checkId: "pdf.nav.page-labels", severity: "info", message: "No page labels." },
                  ]
                : [],
          },
          tools: { missing: [], skippedChecks: [], toolToChecks: new Map() },
        }) as unknown as ValidationExecutionResult,
    );
    const lines: string[] = [];
    consoleLogSpy = spyOn(console, "log").mockImplementation((...a) => void lines.push(a.join(" ")));
    const warnSpy = spyOn(console, "warn").mockImplementation((...a) => void lines.push(a.join(" ")));
    try {
      await runCommand(publishCommand, { rawArgs: [dir, "drivethrurpg-print"] });
    } finally {
      warnSpy.mockRestore();
    }
    const text = lines.join("\n");
    expect(text).toContain("[pdf.print.bleed] Bleed area appears insufficient. (page 3)");
    expect(text).not.toContain("No page labels.");
  });

  test("--connect takes the target by name", async () => {
    const dir = await book();
    const lines: string[] = [];
    consoleLogSpy = spyOn(console, "log").mockImplementation((...a) => void lines.push(a.join(" ")));

    await runCommand(publishCommand, { rawArgs: [dir, "--connect", "local"] });

    expect(lines.join("\n")).toContain("A folder on this computer needs no account. Just run: gutterpress publish local");
  });
});
