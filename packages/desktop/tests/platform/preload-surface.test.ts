import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Round-2 repair (deletion-ledger.md finding: "the channel-surface assertion
// is still un-homed"). `migrated-ipc-routes.test.ts` (deleted in SFE-P5c4)
// carried a test — "preload.ts exposes the fs/dialog/shell/log/app IPC
// channels api.ts no longer carries" — that pinned 19 literal channel names
// from the SFE-P5c1 group only. That test had no replacement: nothing since
// has mechanically checked that every `ipcRenderer.invoke("…")` channel
// preload.ts exposes actually has a `secureHandle("…", …)` registration in
// main.ts, for ANY of the now-120 request/reply channels, not just the 19
// P5c1 ever pinned. This file replaces that narrow, stale assertion with a
// general one that covers the whole bridge surface and stays correct as
// channels are added or removed.
//
// Source-level static analysis (reading the two files as text), matching the
// pattern `file-association-lifecycle.test.ts` already uses for other
// main.ts/preload.ts contract checks — no Electron runtime needed.

const desktopRoot = path.resolve(import.meta.dir, "../..");
const main = readFileSync(path.join(desktopRoot, "electron/main.ts"), "utf8");
const preload = readFileSync(path.join(desktopRoot, "electron/preload.ts"), "utf8");

/** Extracts the literal channel name from every `secureHandle("channel", …)`
 * registration in main.ts. Calls span multiple lines (the channel name is
 * sometimes on its own line after a wrapped argument list), so the pattern
 * tolerates whitespace/newlines between `secureHandle(` and the string
 * literal rather than requiring them on one line. */
function registeredChannels(source: string): Set<string> {
  const channels = new Set<string>();
  const re = /secureHandle\(\s*"([^"]+)"/g;
  for (const m of source.matchAll(re)) channels.add(m[1]!);
  return channels;
}

/** Extracts the literal channel name from every `ipcRenderer.invoke("channel"
 * , …)` call in preload.ts — the request/reply surface only. Push-stream
 * subscriptions go through `ipcRenderer.on`/`forwardPush`, not `invoke`, and
 * are out of scope here (run rule 8 — push streams stay IPC as they are,
 * unrelated to this migration's request/reply channel accounting). */
function invokedChannels(source: string): Set<string> {
  const channels = new Set<string>();
  const re = /ipcRenderer\.invoke\(\s*"([^"]+)"/g;
  for (const m of source.matchAll(re)) channels.add(m[1]!);
  return channels;
}

test("every channel preload.ts invokes has a secureHandle registration in main.ts", () => {
  const invoked = invokedChannels(preload);
  const registered = registeredChannels(main);

  // Sanity floor: fail loudly if either regex stops matching (e.g. the
  // call-site style changes) instead of silently passing on an empty set.
  expect(invoked.size).toBeGreaterThan(100);
  expect(registered.size).toBeGreaterThan(100);

  const missing = [...invoked].filter((c) => !registered.has(c)).sort();
  expect(missing).toEqual([]);
});

test("every secureHandle registration in main.ts has a preload.ts invoke call site", () => {
  const invoked = invokedChannels(preload);
  const registered = registeredChannels(main);

  const orphaned = [...registered].filter((c) => !invoked.has(c)).sort();
  expect(orphaned).toEqual([]);
});
