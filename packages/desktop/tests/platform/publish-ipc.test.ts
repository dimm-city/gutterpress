/**
 * SFE-P5c3 — publishing's IPC handlers (`electron/api/publish.ts`), ported
 * from the deleted `src/routes/api/publish/**` `+server.ts` route-level
 * suites and the publish half of `route-scoping.test.ts`'s project-scoping
 * table. IPC has no status-code concept (`electron/api/validation.ts`'s
 * header) — every assertion here checks the thrown `Error`'s message text.
 *
 * `publishPreflight` alone needs no `hooks` (it never touched the remote
 * hooks bag) and reaches the REAL lib through the process-cached
 * `electron/api/lib-loader.ts#loadLib` — unmockable per-test, so this suite
 * only exercises its validation/scoping path (the same scope
 * `route-scoping.test.ts` covered for it before this run: the deleted
 * route's own `validate` step also ran before any lib call).
 *
 * SECURITY (D12): the "no token in response" describe block proves
 * `publishConnect` never echoes the raw token it received on a SUCCESS
 * response. Repair round 1 added a second case in the same block for the
 * ERROR path: a transport failure whose message carries a credentialed URL
 * must come back through `handlePublishErrors` with that URL's userinfo
 * redacted, not just logged — the original block covered only success shapes.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { createPickedFilesService } from "../../electron/server-bridge/picked-files";
import { makeHostServices } from "../support/host-services-fake";
import {
  publishConnect,
  publishDisconnect,
  publishListProviders,
  publishPreflight,
  publishProviders,
  publishRun,
  publishSetConfig,
} from "../../electron/api/publish";

const GENERIC_PUBLISH_ERROR = "Publishing could not be completed. See the app log for details.";

function baseServices(overrides: Parameters<typeof makeHostServices>[0] = {}): HostServices {
  return makeHostServices({
    remote: undefined,
    fsGuard: { projectRoots: () => ["/abs/project"], readOnlyRoots: () => [] as string[] },
    ...overrides,
  });
}

afterEach(() => {
  registerHostServices(undefined as unknown as HostServices);
});

const remoteBase = { loadLib: async () => ({}), tokenStore: {} as never, GITHUB_HOST: "github.com" };

// ── Hooks not registered ("host disconnected") ─────────────────────────────

describe("hooks not registered", () => {
  const fns: Array<[string, () => Promise<unknown>]> = [
    ["publishListProviders", () => publishListProviders("/abs/project")],
    ["publishProviders", () => publishProviders()],
    ["publishConnect", () => publishConnect("/abs/project", "itch", "tok", undefined)],
    ["publishDisconnect", () => publishDisconnect("itch", undefined)],
    ["publishSetConfig", () => publishSetConfig("/abs/project", "itch", {})],
    ["publishRun", () => publishRun("/abs/project", "itch", undefined, undefined)],
  ];
  for (const [name, fn] of fns) {
    test(`${name} rejects with "Publish hooks not available"`, async () => {
      registerHostServices(baseServices());
      await expect(fn()).rejects.toThrow("Publish hooks not available");
    });
  }

  test("publishPreflight needs no hooks bag — a missing/relative projectDir still fails on its own validation", async () => {
    registerHostServices(baseServices());
    await expect(publishPreflight("rel/path", [])).rejects.toThrow(
      "publish:preflight requires an absolute path, got: rel/path",
    );
  });
});

// ── Validation outside handlePublishErrors stays literal ──────────────────

describe("validation outside handlePublishErrors stays literal (not genericized)", () => {
  test("publishList: relative projectDir", async () => {
    registerHostServices({ ...baseServices(), remote: { ...remoteBase } as never });
    await expect(publishListProviders("rel/path")).rejects.toThrow(
      "publish:list requires an absolute path, got: rel/path",
    );
  });

  test("publishConnect: projectDir outside the open project", async () => {
    registerHostServices({ ...baseServices(), remote: { ...remoteBase } as never });
    await expect(publishConnect("/somewhere/else", "itch", "tok", undefined)).rejects.toThrow(
      "publish:connect: path is outside the open project",
    );
  });

  test("publishSetConfig: relative projectDir", async () => {
    registerHostServices({ ...baseServices(), remote: { ...remoteBase } as never });
    await expect(publishSetConfig("rel/path", "itch", {})).rejects.toThrow(
      "publish:setConfig requires an absolute path, got: rel/path",
    );
  });

  test("publishRun: relative projectDir", async () => {
    registerHostServices({ ...baseServices(), remote: { ...remoteBase } as never });
    await expect(publishRun("rel/path", "itch", undefined, undefined)).rejects.toThrow(
      "publish:run requires an absolute path, got: rel/path",
    );
  });
});

// ── Validation inside handlePublishErrors is genericized, EXCEPT the
// "not available in this version" message, which the allowlist matches ────

describe("validation inside handlePublishErrors", () => {
  test("publishConnect: missing token is genericized", async () => {
    registerHostServices({ ...baseServices(), remote: { ...remoteBase } as never });
    await expect(publishConnect("/abs/project", "itch", undefined, undefined)).rejects.toThrow(
      GENERIC_PUBLISH_ERROR,
    );
  });

  test("publishDisconnect: missing providerId is genericized", async () => {
    registerHostServices({ ...baseServices(), remote: { ...remoteBase } as never });
    await expect(publishDisconnect(undefined, undefined)).rejects.toThrow(GENERIC_PUBLISH_ERROR);
  });

  test("publishSetConfig: missing values is genericized", async () => {
    registerHostServices({ ...baseServices(), remote: { ...remoteBase } as never });
    await expect(publishSetConfig("/abs/project", "itch", undefined)).rejects.toThrow(GENERIC_PUBLISH_ERROR);
  });

  test("publishRun: missing providerId is genericized", async () => {
    registerHostServices({ ...baseServices(), remote: { ...remoteBase } as never });
    await expect(publishRun("/abs/project", undefined, undefined, undefined)).rejects.toThrow(
      GENERIC_PUBLISH_ERROR,
    );
  });

  test("'Publishing is not available in this version of the lib' passes through verbatim", async () => {
    registerHostServices({ ...baseServices(), remote: { ...remoteBase, loadLib: async () => ({}) } as never });
    await expect(publishProviders()).rejects.toThrow(
      "Publishing is not available in this version of the lib",
    );
  });
});

// ── Success paths ───────────────────────────────────────────────────────────

describe("success paths call the lib with validated args", () => {
  test("publishProviders shapes the lib's provider list into static metadata", async () => {
    registerHostServices({
      ...baseServices(),
      remote: {
        ...remoteBase,
        loadLib: async () => ({
          listPublishProviders: () => [
            {
              id: "itch",
              label: "itch.io",
              kind: "guided" as const,
              format: "html" as const,
              description: "",
              configFields: [],
              credential: { required: true, host: "itch.io", tokenUrl: "https://itch.io/user/settings/api-keys" },
            },
          ],
        }),
      } as never,
    });
    await expect(publishProviders()).resolves.toEqual([
      {
        id: "itch",
        label: "itch.io",
        kind: "guided",
        credentialRequired: true,
        credentialHost: "itch.io",
        tokenUrl: "https://itch.io/user/settings/api-keys",
        hint: null,
      },
    ]);
  });

  test("publishConnect trims the account label and forwards to lib.connectPublishProvider", async () => {
    const calls: unknown[] = [];
    registerHostServices({
      ...baseServices(),
      remote: {
        ...remoteBase,
        loadLib: async () => ({
          connectPublishProvider: async (options: unknown) => {
            calls.push(options);
            return { connected: true, providerId: "itch" };
          },
        }),
      } as never,
    });
    await expect(publishConnect("/abs/project", "itch", "tok", "  alt  ")).resolves.toEqual({
      connected: true,
      providerId: "itch",
    });
    expect(calls).toEqual([{ projectDir: "/abs/project", providerId: "itch", token: "tok", account: "alt" }]);
  });

  test("publishSetConfig strips non-primitive values before writing", async () => {
    const calls: unknown[] = [];
    registerHostServices({
      ...baseServices(),
      remote: {
        ...remoteBase,
        loadLib: async () => ({
          publishProviderFor: (id: string) => ({ info: { id, credential: { host: "itch.io", required: true } } }),
          setPublishProviderConfig: async (dir: string, id: string, values: unknown) => {
            calls.push({ dir, id, values });
            return { [id]: values };
          },
        }),
      } as never,
    });
    await expect(
      publishSetConfig("/abs/project", "itch", { title: "My Book", nested: { bad: true } as never }),
    ).resolves.toEqual({ itch: { title: "My Book" } });
    expect(calls).toEqual([{ dir: "/abs/project", id: "itch", values: { title: "My Book" } }]);
  });

  test("publishRun collects progress lines into a bounded log and returns the lib's outcome", async () => {
    registerHostServices({
      ...baseServices(),
      remote: {
        ...remoteBase,
        loadLib: async () => ({
          runPublish: async (_opts: unknown, deps: { onProgress?: (line: string) => void }) => {
            deps.onProgress?.("uploading…");
            deps.onProgress?.("done");
            return { ok: true, providerId: "itch", issues: [] };
          },
        }),
      } as never,
    });
    const result = (await publishRun("/abs/project", "itch", undefined, undefined)) as { log: string[] };
    expect(result.log).toEqual(["uploading…", "done"]);
  });
});

// ── SECURITY (D12): no token in response ───────────────────────────────────

describe("no token in response", () => {
  test("publishConnect never echoes the raw token", async () => {
    const SECRET = "sk_live_super-secret";
    registerHostServices({
      ...baseServices(),
      remote: {
        ...remoteBase,
        loadLib: async () => ({
          connectPublishProvider: async () => ({ connected: true, providerId: "shopify" }),
        }),
      } as never,
    });
    const result = await publishConnect("/abs/project", "shopify", SECRET, undefined);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  // Repair round 1: the case above only ever covered the SUCCESS response
  // shape. `handlePublishErrors`'s allowlist (PUBLISH_FRIENDLY_ERROR)
  // rethrows a matching message verbatim, and a transport failure can carry
  // the request URL — including credentials — inside that message. This pins
  // the ERROR path: `redactUrlCredentials` must strip URL userinfo from the
  // rethrown message the renderer actually receives, not just the logged copy.
  test("a transport error carrying a credentialed URL is redacted before it reaches the renderer", async () => {
    const SECRET_URL_TOKEN = "sk_live_super-secret";
    registerHostServices({
      ...baseServices(),
      remote: {
        ...remoteBase,
        loadLib: async () => ({
          runPublish: async () => {
            throw new Error(`Couldn't reach https://author:${SECRET_URL_TOKEN}@git.example.com/book.git`);
          },
        }),
      } as never,
    });
    const message = await publishRun("/abs/project", "itch", undefined, undefined).then(
      () => { throw new Error("expected publishRun to reject"); },
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    expect(message).not.toContain(SECRET_URL_TOKEN);
    expect(message).not.toContain("author:");
    expect(message).toContain("Couldn't reach");
    expect(message).toContain("//(redacted)@git.example.com/book.git");
  });
});

// ── publishRun's artifactPath: the upload SOURCE (ported from
// route-scoping.test.ts) ────────────────────────────────────────────────────

describe("publishRun: artifactPath scoping", () => {
  let base: string;
  let bookDir: string;
  let repoRoot: string;
  let outsideDir: string;

  afterEach(async () => {
    if (base) await rm(base, { recursive: true, force: true });
  });

  async function setUp(): Promise<void> {
    base = await mkdtemp(path.join(tmpdir(), "gutterpress-publish-ipc-"));
    repoRoot = path.join(base, "repo");
    bookDir = path.join(repoRoot, "books", "field-guide");
    outsideDir = path.join(base, "elsewhere");
    await mkdir(bookDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
  }

  function publishHost(roots: string[], picked: ReturnType<typeof createPickedFilesService>): void {
    registerHostServices(
      makeHostServices({
        fsGuard: { projectRoots: () => roots, readOnlyRoots: () => [] as string[] },
        pickedFiles: picked,
        remote: {
          ...remoteBase,
          loadLib: async () => ({ runPublish: async () => ({ ok: true, providerId: "itch", issues: [] }) }),
        } as never,
      }),
    );
  }

  test("an artifact inside the project is allowed", async () => {
    await setUp();
    const picked = createPickedFilesService();
    publishHost([bookDir, repoRoot], picked);
    const artifact = path.join(bookDir, "dist", "book.pdf");
    await mkdir(path.dirname(artifact), { recursive: true });
    await writeFile(artifact, "%PDF-1.4", "utf8");
    await expect(publishRun(bookDir, "itch", artifact, undefined)).resolves.not.toBeUndefined();
  });

  test("an out-of-project artifact that was never picked is rejected", async () => {
    await setUp();
    const picked = createPickedFilesService();
    publishHost([bookDir, repoRoot], picked);
    const secret = path.join(outsideDir, "id_rsa");
    await writeFile(secret, "PRIVATE KEY", "utf8");
    await expect(publishRun(bookDir, "itch", secret, undefined)).rejects.toThrow(
      "publish:run: path is outside the open project and was not chosen from a file dialog",
    );
  });

  test("an out-of-project artifact the native picker returned is allowed", async () => {
    await setUp();
    const picked = createPickedFilesService();
    publishHost([bookDir, repoRoot], picked);
    const exported = path.join(outsideDir, "book.pdf");
    await writeFile(exported, "%PDF-1.4", "utf8");
    picked.register([exported]);
    await expect(publishRun(bookDir, "itch", exported, undefined)).resolves.not.toBeUndefined();
  });

  test("a picked artifact survives the dry-run → publish sequence", async () => {
    await setUp();
    const picked = createPickedFilesService();
    publishHost([bookDir, repoRoot], picked);
    const exported = path.join(outsideDir, "book.pdf");
    await writeFile(exported, "%PDF-1.4", "utf8");
    picked.register([exported]);
    await expect(publishRun(bookDir, "itch", exported, true)).resolves.not.toBeUndefined();
    await expect(publishRun(bookDir, "itch", exported, undefined)).resolves.not.toBeUndefined();
  });

  test("a relative artifactPath resolves against the project, as the lib does", async () => {
    await setUp();
    const picked = createPickedFilesService();
    publishHost([bookDir, repoRoot], picked);
    await mkdir(path.join(bookDir, "dist"), { recursive: true });
    await writeFile(path.join(bookDir, "dist", "book.pdf"), "%PDF-1.4", "utf8");
    await expect(publishRun(bookDir, "itch", "dist/book.pdf", undefined)).resolves.not.toBeUndefined();
  });

  test("a relative artifactPath cannot ../ its way out of the project", async () => {
    await setUp();
    const picked = createPickedFilesService();
    publishHost([bookDir], picked); // book-only session — the repo root is outside
    await expect(
      publishRun(bookDir, "itch", path.join("..", "..", "..", "elsewhere", "id_rsa"), undefined),
    ).rejects.toThrow("path is outside the open project");
  });
});
