/**
 * Unit tests for electron/credential-store.ts (ARCH review #34).
 *
 * credential-store.ts talks to `node:fs/promises` directly (not
 * dependency-injected like prefs-store.ts/settings-store.ts), so these tests
 * use a REAL temp directory as `app.getPath("userData")` and drive the store
 * through its public `electronTokenStore` API — verifying end-to-end that:
 *   - a credential set/get round-trips (and the token never appears in
 *     plaintext on disk — safeStorage "encrypts" it),
 *   - writes are atomic: no `.tmp` file is left behind after a successful
 *     write,
 *   - a corrupt `credentials.json` is preserved as `<path>.corrupt-<ts>`
 *     instead of silently resetting to empty (which used to silently
 *     disconnect every stored Git/GitHub credential).
 *
 * `electron`'s real package throws outside an actual Electron process (see
 * tests/updater/electron-updater.test.ts's note on the same hazard), so it is
 * mocked before the dynamic import below — with the SAME superset of keys as
 * every other electron-mocking suite in this run (see the NOTE there).
 */
import { test, expect, mock } from "bun:test";
import { electronMock } from "../support/electron-mock";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let currentUserDataDir = "";

// NOTE: `bun test --isolate` does not fully sandbox `mock.module("electron", …)`
// registrations between files that all touch the "electron" specifier — other
// electron-mocking suites in this run (tests/updater/electron-updater.test.ts,
// tests/platform/pdf-export.test.ts, tests/platform/sveltekit-host.test.ts)
// can end up "winning" the shared registration for this specifier. So every
// such suite mocks the SAME superset of keys every electron/*.ts production
// module statically imports from "electron" (app.getPath, protocol,
// BrowserWindow, safeStorage) — whichever file's registration is actually
// live, every other suite's named imports still resolve. Keep this superset
// in sync with any new `from "electron"` import added to electron/*.ts.
//
// `app.getPath` reads a mutable module-level variable (`currentUserDataDir`)
// so each test can point it at its own fresh temp dir even though the mock
// factory itself only runs once.
mock.module("electron", () =>
  // getPath reads a mutable module-level var so each test points it at its own
  // fresh temp dir even though the factory runs once. safeStorage's reversible
  // fake "encryption" (shared) proves the store's read/write/round-trip plumbing
  // without depending on a real OS keyring.
  electronMock({ app: { getPath: () => currentUserDataDir } }),
);

const { electronTokenStore } = await import("../../electron/credential-store");

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "print-md-credstore-"));
  currentUserDataDir = dir;
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const STORE_FILE = "credentials.json";

test("set() then get() round-trips a credential", async () => {
  await withTempDir(async () => {
    await electronTokenStore.set("github.com", {
      host: "github.com",
      kind: "token",
      token: "secret-abc-123",
      username: "octocat",
      createdAt: 1000,
    });

    const got = await electronTokenStore.get("github.com");
    expect(got?.token).toBe("secret-abc-123");
    expect(got?.username).toBe("octocat");
  });
});

test("the token never appears in plaintext on disk", async () => {
  await withTempDir(async (dir) => {
    await electronTokenStore.set("github.com", {
      host: "github.com",
      kind: "token",
      token: "super-secret-value",
      createdAt: 1000,
    });
    const raw = await readFile(path.join(dir, STORE_FILE), "utf8");
    expect(raw).not.toContain("super-secret-value");
  });
});

test("host is normalized (case/whitespace-insensitive) across set/get/delete", async () => {
  await withTempDir(async () => {
    await electronTokenStore.set(" GitHub.com ", {
      host: "GitHub.com",
      kind: "token",
      token: "t1",
      createdAt: 1,
    });
    expect((await electronTokenStore.get("github.com"))?.token).toBe("t1");
    await electronTokenStore.delete("GITHUB.COM");
    expect(await electronTokenStore.get("github.com")).toBeNull();
  });
});

test("listRedacted never includes the token value or ciphertext", async () => {
  await withTempDir(async () => {
    await electronTokenStore.set("example.com", {
      host: "example.com",
      kind: "token",
      token: "should-not-leak",
      label: "My server",
      createdAt: 5,
    });
    const redacted = await electronTokenStore.listRedacted();
    const json = JSON.stringify(redacted);
    expect(json).not.toContain("should-not-leak");
    expect(redacted).toEqual([
      { host: "example.com", kind: "token", label: "My server", createdAt: 5 },
    ]);
  });
});

// ── Atomic write (#34) ──────────────────────────────────────────────────────

test("writeStore is atomic: no <file>.tmp is left behind after a successful set()", async () => {
  await withTempDir(async (dir) => {
    await electronTokenStore.set("github.com", {
      host: "github.com",
      kind: "token",
      token: "t",
      createdAt: 1,
    });
    const entries = await readdir(dir);
    expect(entries).toContain(STORE_FILE);
    expect(entries.some((f) => f.startsWith(`${STORE_FILE}.tmp`))).toBe(false);
  });
});

// ── Corrupt-file preservation (#34) ─────────────────────────────────────────

test("a corrupt credentials.json is preserved as <path>.corrupt-<ts>, not silently discarded", async () => {
  await withTempDir(async (dir) => {
    const storePath = path.join(dir, STORE_FILE);
    await writeFile(storePath, "{ not valid json ]", "utf8");

    // Reading through the store must not throw, and must not lose the
    // original corrupt content — it gets preserved for inspection instead of
    // silently disconnecting every stored credential.
    const list = await electronTokenStore.list();
    expect(list).toEqual([]);

    const entries = await readdir(dir);
    const corrupt = entries.find((f) => f.startsWith(`${STORE_FILE}.corrupt-`));
    expect(corrupt).toBeDefined();
    const preserved = await readFile(path.join(dir, corrupt!), "utf8");
    expect(preserved).toBe("{ not valid json ]");
  });
});

test("after a corrupt read, a subsequent set() recreates a valid store (recovery, not data loss on top of data loss)", async () => {
  await withTempDir(async (dir) => {
    const storePath = path.join(dir, STORE_FILE);
    await writeFile(storePath, "not even an object", "utf8");

    await electronTokenStore.set("github.com", {
      host: "github.com",
      kind: "token",
      token: "recovered-token",
      createdAt: 2,
    });

    const got = await electronTokenStore.get("github.com");
    expect(got?.token).toBe("recovered-token");

    const entries = await readdir(dir);
    expect(entries.filter((f) => f.startsWith(`${STORE_FILE}.corrupt-`))).toHaveLength(1);
  });
});
