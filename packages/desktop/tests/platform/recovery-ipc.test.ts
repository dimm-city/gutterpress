/**
 * IPC-handler tests for `electron/api/recovery.ts` (SFE-P5c4 — migrated off
 * `src/routes/api/recovery/{write,clear,list}/+server.ts`, deleted). Same
 * `RecoveryHooks` bag, same "hooks not registered" fail-closed check run
 * BEFORE validation (matching the deleted routes' `defineRoute({ hooks,
 * validate, call })` order — same discipline `vcs-ipc.test.ts` pins).
 */
import { afterEach, expect, test } from "bun:test";
import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { recoveryWrite, recoveryClear, recoveryList } from "../../electron/api/recovery";

async function messageOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

afterEach(() => {
  registerHostServices(undefined as unknown as HostServices);
});

// ── host-disconnected: recovery hooks not registered ───────────────────────

test("recovery:write rejects when recovery hooks are not registered, even with a valid absolute path", async () => {
  registerHostServices(makeHostServices({ recovery: undefined }));
  const message = await messageOf(recoveryWrite("/proj/ch.md", "text", 1));
  expect(message).toBe("Recovery hooks not registered");
});

test("recovery:clear rejects when recovery hooks are not registered", async () => {
  registerHostServices(makeHostServices({ recovery: undefined }));
  const message = await messageOf(recoveryClear("/proj/ch.md"));
  expect(message).toBe("Recovery hooks not registered");
});

test("recovery:list rejects when recovery hooks are not registered", async () => {
  registerHostServices(makeHostServices({ recovery: undefined }));
  const message = await messageOf(recoveryList("/proj"));
  expect(message).toBe("Recovery hooks not registered");
});

// D7: a listing failure must not look like an empty store — the hooks bag's
// own list() throwing propagates as a rejection, never a silent `[]`.
test("recovery:list propagates a real store-read failure as a rejection, not an empty array", async () => {
  registerHostServices(
    makeHostServices({
      recovery: {
        write: async () => ({ ok: true }),
        clear: async () => ({ ok: true }),
        list: async () => {
          throw new Error("disk read failed");
        },
      },
    }),
  );
  const message = await messageOf(recoveryList("/proj"));
  expect(message).toBe("disk read failed");
});

// ── path-invalid: a non-absolute path is rejected before the hooks bag runs ──

test("recovery:write rejects a non-absolute filePath", async () => {
  registerHostServices(makeHostServices());
  const message = await messageOf(recoveryWrite("relative/ch.md", "text", 1));
  expect(message).toBe("recovery:write requires an absolute path, got: relative/ch.md");
});

test("recovery:clear rejects a non-absolute filePath", async () => {
  registerHostServices(makeHostServices());
  const message = await messageOf(recoveryClear("relative/ch.md"));
  expect(message).toBe("recovery:clear requires an absolute path, got: relative/ch.md");
});

test("recovery:list rejects a non-absolute projectDir", async () => {
  registerHostServices(makeHostServices());
  const message = await messageOf(recoveryList("relative/proj"));
  expect(message).toBe("recovery:list requires an absolute path, got: relative/proj");
});

// ── field validation ────────────────────────────────────────────────────────

test("recovery:write rejects a missing content field", async () => {
  registerHostServices(makeHostServices());
  const message = await messageOf(recoveryWrite("/proj/ch.md", undefined, 1));
  expect(message).toBe("content is required");
});

test("recovery:write rejects a non-numeric baseMtimeMs", async () => {
  registerHostServices(makeHostServices());
  const message = await messageOf(recoveryWrite("/proj/ch.md", "text", "not-a-number"));
  expect(message).toBe("baseMtimeMs must be a number");
});

// ── success path ─────────────────────────────────────────────────────────

test("recovery:write calls hooks.write with the validated arguments", async () => {
  const calls: unknown[] = [];
  registerHostServices(
    makeHostServices({
      recovery: {
        write: async (filePath, content, baseMtimeMs) => {
          calls.push([filePath, content, baseMtimeMs]);
          return { ok: true };
        },
        clear: async () => ({ ok: true }),
        list: async () => [],
      },
    }),
  );
  expect(await recoveryWrite("/proj/ch.md", "hello", 42)).toEqual({ ok: true });
  expect(calls).toEqual([["/proj/ch.md", "hello", 42]]);
});

test("recovery:list returns hooks.list's entries newest first, untouched", async () => {
  const entries = [{ filePath: "/proj/a.md", recoveryPath: "/rec/a.md", savedAt: 2, baseMtimeMs: 1 }];
  registerHostServices(
    makeHostServices({
      recovery: { write: async () => ({ ok: true }), clear: async () => ({ ok: true }), list: async () => entries },
    }),
  );
  expect(await recoveryList("/proj")).toEqual(entries);
});
