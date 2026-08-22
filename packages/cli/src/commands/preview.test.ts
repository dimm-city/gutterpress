import { afterEach, expect, spyOn, test } from "bun:test";
import { runCommand } from "citty";
import * as buildRunnerModule from "../lib/build-runner.ts";
import * as openPathModule from "../lib/open-path.ts";
import * as serverModule from "../server.ts";
import previewCommand, { resolvePort } from "./preview";

let buildSpy: ReturnType<typeof spyOn> | undefined;
let openPathSpy: ReturnType<typeof spyOn> | undefined;
let serverSpy: ReturnType<typeof spyOn> | undefined;
let consoleLogSpy: ReturnType<typeof spyOn> | undefined;
let consoleWarnSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  buildSpy?.mockRestore();
  openPathSpy?.mockRestore();
  serverSpy?.mockRestore();
  consoleLogSpy?.mockRestore();
  consoleWarnSpy?.mockRestore();
  buildSpy = undefined;
  openPathSpy = undefined;
  serverSpy = undefined;
  consoleLogSpy = undefined;
  consoleWarnSpy = undefined;
});

test("resolvePort defaults to 3579 when undefined", () => {
  expect(resolvePort(undefined)).toBe(3579);
});

test("resolvePort rejects an empty explicit value", () => {
  expect(() => resolvePort("")).toThrow("--port requires a value");
});

test("resolvePort passes through normal and maximum Node ports", () => {
  expect(resolvePort("8080")).toBe(8080);
  expect(resolvePort("65535")).toBe(65535);
});

test("resolvePort rejects fractional and out-of-range ports", () => {
  expect(() => resolvePort("1.5")).toThrow("Expected an integer from 0 to 65535");
  expect(() => resolvePort("65536")).toThrow("Expected an integer from 0 to 65535");
});

// Regression test for defect preview-port-zero-falsy:
// --port 0 (OS-assigned free port) must NOT be coerced to the default 3579.
test("resolvePort('0') yields 0, not the default", () => {
  expect(resolvePort("0")).toBe(0);
});

test("resolvePort(0) yields 0", () => {
  expect(resolvePort(0)).toBe(0);
});

test("preview reports its resolved default format before starting the server", async () => {
  const lines: string[] = [];
  consoleLogSpy = spyOn(console, "log").mockImplementation((...args) => {
    lines.push(args.join(" "));
  });
  serverSpy = spyOn(serverModule, "startPreviewServer").mockResolvedValue({
    url: "http://127.0.0.1:3579",
    port: 3579,
    host: "127.0.0.1",
    inputPath: "",
    stop: async () => {},
    restart: async () => {},
    notifySettledWrite: () => {},
  });

  await runCommand(previewCommand, { rawArgs: ["--no-open"] });

  expect(lines[0]).toContain("Format: html");
  expect(serverSpy).toHaveBeenCalledTimes(1);
  expect(serverSpy?.mock.calls[0]?.[0].noWatch).toBe(false);
});

test("preview --no-watch passes noWatch: true to startPreviewServer", async () => {
  consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
  serverSpy = spyOn(serverModule, "startPreviewServer").mockResolvedValue({
    url: "http://127.0.0.1:3579",
    port: 3579,
    host: "127.0.0.1",
    inputPath: "",
    stop: async () => {},
    restart: async () => {},
    notifySettledWrite: () => {},
  });

  await runCommand(previewCommand, { rawArgs: ["--no-watch", "--no-open"] });

  expect(serverSpy).toHaveBeenCalledTimes(1);
  expect(serverSpy?.mock.calls[0]?.[0].noWatch).toBe(true);
});

test("a failed PDF auto-open is nonfatal and reports the saved path", async () => {
  const lines: string[] = [];
  const warnings: string[] = [];
  consoleLogSpy = spyOn(console, "log").mockImplementation((...args) => {
    lines.push(args.join(" "));
  });
  consoleWarnSpy = spyOn(console, "warn").mockImplementation((...args) => {
    warnings.push(args.join(" "));
  });
  buildSpy = spyOn(buildRunnerModule, "runBuild").mockResolvedValue({
    outDir: "/tmp/out",
    htmlPath: "/tmp/out/book.html",
    pdfPath: "/tmp/out/book.pdf",
    fingerprintPath: "/tmp/out/build-fingerprint.json",
    diagnostics: [],
  });
  openPathSpy = spyOn(openPathModule, "openPath").mockRejectedValue(
    new Error("spawn xdg-open ENOENT")
  );

  await runCommand(previewCommand, { rawArgs: [".", "--format", "pdf"] });

  expect(lines[0]).toContain("Format: pdf");
  expect(openPathSpy).toHaveBeenCalledWith("/tmp/out/book.pdf");
  expect(warnings.join("\n")).toContain("Could not open the PDF automatically");
  expect(warnings.join("\n")).toContain("spawn xdg-open ENOENT");
  expect(warnings.join("\n")).toContain("Open it manually: /tmp/out/book.pdf");
});

// `preview --format pdf` builds through the SAME runBuild pipeline as
// `build`, so every build option it accepts has to reach it — `--allow-shrink`
// used to be rejected as an unknown flag (exit 2), which left the engine's
// "pass allowShrink to build anyway" advice unreachable from this command.
test("preview --format pdf maps --allow-shrink onto runBuild", async () => {
  consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
  let captured: { allowShrink?: boolean } | undefined;
  buildSpy = spyOn(buildRunnerModule, "runBuild").mockImplementation(
    (async (opts: { allowShrink?: boolean }) => {
      captured = opts;
      return { outDir: "/tmp/out", htmlPath: null, pdfPath: null, fingerprintPath: null, diagnostics: [] };
    }) as unknown as typeof buildRunnerModule.runBuild
  );

  await runCommand(previewCommand, {
    rawArgs: [".", "--format", "pdf", "--allow-shrink", "--no-open"],
  });

  expect(captured?.allowShrink).toBe(true);
});

test("preview --format pdf leaves allowShrink off by default", async () => {
  consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
  let captured: { allowShrink?: boolean } | undefined;
  buildSpy = spyOn(buildRunnerModule, "runBuild").mockImplementation(
    (async (opts: { allowShrink?: boolean }) => {
      captured = opts;
      return { outDir: "/tmp/out", htmlPath: null, pdfPath: null, fingerprintPath: null, diagnostics: [] };
    }) as unknown as typeof buildRunnerModule.runBuild
  );

  await runCommand(previewCommand, { rawArgs: [".", "--format", "pdf", "--no-open"] });

  expect(captured?.allowShrink).toBe(false);
});
