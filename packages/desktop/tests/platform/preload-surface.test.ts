import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Round-2 repair (deletion-ledger.md finding: "the channel-surface assertion
// is still un-homed"). `migrated-ipc-routes.test.ts` (deleted in SFE-P5c4)
// carried a test — "preload.ts exposes the fs/dialog/shell/log/app IPC
// channels api.ts no longer carries" — that pinned 19 literal channel names
// from the SFE-P5c1 group only. That test had no replacement: nothing since
// has mechanically checked that every `ipcRenderer.invoke("…")` channel
// preload.ts exposes actually has a `secureHandle("…", …)` registration
// somewhere under electron/, for ANY of the now-120 request/reply channels,
// not just the 19 P5c1 ever pinned. This file replaces that narrow, stale
// assertion with a general one that covers the whole bridge surface and
// stays correct as channels are added or removed.
//
// SFE-P6b moved the `secureHandle(...)` registrations themselves out of
// main.ts into per-context registrars (electron/api/*.ts and a few thin
// siblings — electron/github-device-flow-registrar.ts,
// electron/pdf-export.ts, electron/preview/controller.ts,
// electron/export/controller.ts, electron/editor-projection.ts). The first
// two tests below therefore scan every `.ts` file under electron/ (excluding
// electron/server-bridge/secure-handle.ts, the generic wrapper whose own
// declaration doesn't register a channel) rather than main.ts alone, so a
// `secureHandle("…")` literal is found regardless of which registrar module
// it lives in.
//
// That move also opened a NEW gap those two tests cannot see (SFE-P6 round-1
// repair): a literal existing in source no longer implies the channel
// registers at boot, because a `register*Handlers` function now has to be
// CALLED from main.ts to run its `secureHandle(...)` calls at all. A
// registrar that is defined but never composed (e.g. a call site accidentally
// dropped during a refactor) still contributes every one of its literals to
// the first two tests' "registered" set, so they would keep passing while
// those channels silently stop registering. The third test below closes that
// gap: every declared `register*Handlers` function must appear as a call in
// electron/main.ts.
//
// Source-level static analysis (reading files as text), matching the
// pattern `file-association-lifecycle.test.ts` already uses for other
// main.ts/preload.ts contract checks — no Electron runtime needed.

const desktopRoot = path.resolve(import.meta.dir, "../..");
const electronRoot = path.join(desktopRoot, "electron");
const preload = readFileSync(path.join(desktopRoot, "electron/preload.ts"), "utf8");
const mainTs = readFileSync(path.join(electronRoot, "main.ts"), "utf8");

/** Every `.ts` file under electron/, concatenated — the full surface where a
 *  `secureHandle("channel", …)` registration could live post-SFE-P6b. */
function readElectronSourceTree(dir: string): string {
  let combined = "";
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      combined += readElectronSourceTree(full);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      combined += readFileSync(full, "utf8");
    }
  }
  return combined;
}

const electronSource = readElectronSourceTree(electronRoot);

/** Extracts the literal channel name from every `secureHandle("channel", …)`
 * registration across the electron/ tree. Calls span multiple lines (the
 * channel name is sometimes on its own line after a wrapped argument list),
 * so the pattern tolerates whitespace/newlines between `secureHandle(` and
 * the string literal rather than requiring them on one line. */
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

/** Extracts every `export function register*Handlers` symbol name declared
 * anywhere under electron/ — the per-context registrar functions SFE-P6b
 * moved the `secureHandle(...)` calls into (electron/api/*.ts and the thin
 * siblings named in the header comment above). */
function declaredRegistrars(source: string): Set<string> {
  const names = new Set<string>();
  const re = /export function (register\w*Handlers)\s*\(/g;
  for (const m of source.matchAll(re)) names.add(m[1]!);
  return names;
}

test("every channel preload.ts invokes has a secureHandle registration under electron/", () => {
  const invoked = invokedChannels(preload);
  const registered = registeredChannels(electronSource);

  // Sanity floor: fail loudly if either regex stops matching (e.g. the
  // call-site style changes) instead of silently passing on an empty set.
  expect(invoked.size).toBeGreaterThan(100);
  expect(registered.size).toBeGreaterThan(100);

  const missing = [...invoked].filter((c) => !registered.has(c)).sort();
  expect(missing).toEqual([]);
});

test("every secureHandle registration under electron/ has a preload.ts invoke call site", () => {
  const invoked = invokedChannels(preload);
  const registered = registeredChannels(electronSource);

  const orphaned = [...registered].filter((c) => !invoked.has(c)).sort();
  expect(orphaned).toEqual([]);
});

// SFE-P6 round-1 repair: the two tests above prove a `secureHandle("…")`
// literal is REACHABLE from preload.ts's channel list — but since SFE-P6b
// moved those calls off main.ts's module scope into per-context
// `register*Handlers(secureHandle)` function bodies, a literal existing in
// source no longer implies the channel actually registers at boot. A
// registrar that main.ts never calls still has every one of its
// `secureHandle("…")` literals counted above, so commenting out (say)
// `registerThemeHandlers(secureHandle);` in main.ts would silently stop 11
// channels from registering while both tests above kept passing. This third
// assertion closes that gap at the source level: every declared
// `register*Handlers` function must appear as a call in electron/main.ts.
test("every declared register*Handlers registrar is actually called from electron/main.ts", () => {
  const declared = declaredRegistrars(electronSource);

  // Sanity floor, matching the pattern above: fail loudly if the regex stops
  // matching instead of silently passing on an empty set.
  expect(declared.size).toBeGreaterThan(20);

  const uncalled = [...declared]
    .filter((name) => !new RegExp(`\\b${name}\\s*\\(`).test(mainTs))
    .sort();
  expect(uncalled).toEqual([]);
});
