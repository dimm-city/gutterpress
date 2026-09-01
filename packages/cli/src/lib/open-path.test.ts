import { test, expect } from "bun:test";
import { buildOpenPathSpawnSpec } from "./open-path";

// A1: cmd.exe's own parser treats the first unescaped "&" as a command
// separator. Node's default Windows argv quoting (libuv) only quotes an
// argument containing a space/tab/quote — a percent-encoded OAuth URL has
// none of those but DOES contain unescaped "&" between query params, so it
// would be passed unquoted and get truncated by cmd.exe at the first "&".
// These tests exercise the pure spec-building function so the win32 branch
// is verifiable on this (Linux) sandbox without actually spawning anything.

const OAUTH_URL =
  "https://accounts.google.com/o/oauth2/v2/auth?client_id=abc&redirect_uri=http://127.0.0.1:54321&response_type=code&scope=drive.file&state=xyz";

test("win32: quotes the start window-title placeholder and the target URL, and disables Node's own argv quoting", () => {
  const spec = buildOpenPathSpawnSpec(OAUTH_URL, "win32");
  expect(spec.cmd).toBe("cmd");
  expect(spec.args).toEqual(["/c", "start", '""', `"${OAUTH_URL}"`]);
  expect(spec.options.windowsVerbatimArguments).toBe(true);
  expect(spec.options.detached).toBe(true);
  expect(spec.options.stdio).toBe("ignore");
});

test("win32: quoting is applied even for a plain path with no special characters", () => {
  const spec = buildOpenPathSpawnSpec("C:\\Users\\writer\\book.pdf", "win32");
  expect(spec.args).toEqual(["/c", "start", '""', '"C:\\Users\\writer\\book.pdf"']);
  expect(spec.options.windowsVerbatimArguments).toBe(true);
});

test("darwin branch is unchanged: spawns 'open' directly with the bare path, no windowsVerbatimArguments", () => {
  const spec = buildOpenPathSpawnSpec(OAUTH_URL, "darwin");
  expect(spec.cmd).toBe("open");
  expect(spec.args).toEqual([OAUTH_URL]);
  expect(spec.options).toEqual({ detached: true, stdio: "ignore" });
  expect((spec.options as { windowsVerbatimArguments?: boolean }).windowsVerbatimArguments).toBeUndefined();
});

test("default (linux/other) branch is unchanged: spawns 'xdg-open' directly with the bare path", () => {
  const spec = buildOpenPathSpawnSpec(OAUTH_URL, "linux");
  expect(spec.cmd).toBe("xdg-open");
  expect(spec.args).toEqual([OAUTH_URL]);
  expect(spec.options).toEqual({ detached: true, stdio: "ignore" });
  expect((spec.options as { windowsVerbatimArguments?: boolean }).windowsVerbatimArguments).toBeUndefined();
});
