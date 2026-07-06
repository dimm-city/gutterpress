import { test, expect } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileTokenStore } from "../remote-auth/token-store";
import { listPublishProviders, publishProviderFor } from "./registry";
import { runPublish, resolvePublishRequest, manifestKeyFor } from "./run-publish";
import { readPublishSettings, setPublishProviderConfig } from "./manifest-publish";
import type {
  CommandResult,
  CommandRunner,
  PublishDeps,
  PublishRequest,
} from "./types";
import { resolvePublishCredential } from "./types";
import { itchProvider, itchProjectUrl } from "./providers/itch";
import { shopifyProvider, shopifyLegacyId } from "./providers/shopify";
import { drivethrurpgProvider } from "./providers/drivethrurpg";
import { kdpProvider } from "./providers/kdp";
import { azureSwaProvider } from "./providers/azure-swa";
import { butlerBrothChannel, butlerDownloadUrl, ensureButler } from "./butler";

// ── test scaffolding ─────────────────────────────────────────────────────────

interface RecordedCommand {
  cmd: string;
  args: string[];
  env?: Record<string, string | undefined>;
}

function fakeRunner(
  results: Array<Partial<CommandResult>> = [],
): { runner: CommandRunner; calls: RecordedCommand[] } {
  const calls: RecordedCommand[] = [];
  const runner: CommandRunner = async (cmd, args, options) => {
    calls.push({ cmd, args, env: options?.env });
    const next = results.shift() ?? {};
    return { code: 0, stdout: "", stderr: "", ...next };
  };
  return { runner, calls };
}

async function tempProject(manifest: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pmd-publish-"));
  await writeFile(path.join(dir, "manifest.yaml"), manifest, "utf8");
  return dir;
}

async function depsFor(
  dir: string,
  overrides: Partial<PublishDeps> = {},
): Promise<PublishDeps> {
  const store = new FileTokenStore(path.join(dir, ".creds", "credentials.json"));
  return { tokenStore: store, env: {}, configDir: path.join(dir, ".config"), ...overrides };
}

const MANIFEST = `title: Test Book
authors: [Tester]
publish:
  itch:
    target: someone/test-book
  shopify:
    shop: my-store.myshopify.com
`;

async function requestFor(
  dir: string,
  providerId: string,
  deps: PublishDeps,
  artifactPath?: string,
): Promise<PublishRequest> {
  return resolvePublishRequest({ projectDir: dir, providerId, artifactPath }, deps);
}

async function withPdfArtifact(dir: string): Promise<string> {
  const out = path.join(dir, "dist");
  await mkdir(out, { recursive: true });
  const pdf = path.join(out, "book.pdf");
  await writeFile(pdf, "%PDF-1.4 fake");
  return pdf;
}

// ── registry ────────────────────────────────────────────────────────────────

test("registry lists all five providers and resolves by id", () => {
  const ids = listPublishProviders().map((p) => p.id);
  expect(ids).toEqual(["itch", "drivethrurpg", "kdp", "azure-swa", "shopify"]);
  expect(publishProviderFor("itch").info.label).toBe("itch.io");
  expect(() => publishProviderFor("nope")).toThrow(/Unknown publish provider/);
});

test("manifestKeyFor maps provider ids to manifest keys", () => {
  expect(manifestKeyFor("azure-swa")).toBe("azureSwa");
  expect(manifestKeyFor("itch")).toBe("itch");
  expect(() => manifestKeyFor("nope")).toThrow();
});

// ── credential resolution ───────────────────────────────────────────────────

test("resolvePublishCredential prefers the CI env var over the store", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pmd-cred-"));
  try {
    const deps = await depsFor(dir);
    await deps.tokenStore.set("itch.io", {
      host: "itch.io",
      kind: "token",
      token: "stored-key",
      createdAt: 1,
    });
    const fromStore = await resolvePublishCredential(itchProvider.info, deps);
    expect(fromStore?.source).toBe("store");
    expect(fromStore?.credential.token).toBe("stored-key");

    const withEnv = await resolvePublishCredential(itchProvider.info, {
      ...deps,
      env: { BUTLER_API_KEY: "env-key" },
    });
    expect(withEnv?.source).toBe("env");
    expect(withEnv?.credential.token).toBe("env-key");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── orchestrator ────────────────────────────────────────────────────────────

test("runPublish fails preflight when the artifact is missing", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const deps = await depsFor(dir);
    const result = await runPublish(
      { projectDir: dir, providerId: "drivethrurpg" },
      deps,
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.id === "publish/artifact-missing")).toBe(true);
    expect(result.outcome).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runPublish --dry-run stops after a passing preflight", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    await withPdfArtifact(dir);
    const deps = await depsFor(dir);
    const result = await runPublish(
      { projectDir: dir, providerId: "drivethrurpg", dryRun: true },
      deps,
    );
    expect(result.ok).toBe(true);
    expect(result.outcome).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runPublish reports missing credentials as a friendly error, not a throw", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    await withPdfArtifact(dir);
    const { runner } = fakeRunner();
    const deps = await depsFor(dir, { runCommand: runner });
    const result = await runPublish({ projectDir: dir, providerId: "itch" }, deps);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No itch\.io API key/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── itch provider ───────────────────────────────────────────────────────────

test("itch upload passes the key via env only, never argv", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    await withPdfArtifact(dir);
    // First call: `which butler` (found); auth `butler status`; then push.
    const { runner, calls } = fakeRunner([
      { stdout: "/usr/bin/butler\n" }, // which (authenticate → ensureButler)
      { code: 0 }, // butler status
      { stdout: "/usr/bin/butler\n" }, // which (upload → ensureButler)
      { code: 0, stdout: "build pushed" }, // butler push
    ]);
    const deps = await depsFor(dir, {
      runCommand: runner,
      env: { BUTLER_API_KEY: "secret-key" },
    });
    const result = await runPublish({ projectDir: dir, providerId: "itch" }, deps);
    expect(result.ok).toBe(true);
    expect(result.outcome?.kind).toBe("published");
    if (result.outcome?.kind === "published") {
      expect(result.outcome.url).toBe("https://someone.itch.io/test-book");
    }

    const push = calls.find((c) => c.args[0] === "push");
    expect(push).toBeDefined();
    expect(push!.args).toContain("someone/test-book:pdf");
    // SECURITY: the key travels via env, never argv.
    expect(push!.args.join(" ")).not.toContain("secret-key");
    expect(push!.env?.BUTLER_API_KEY).toBe("secret-key");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("itch preflight requires a well-formed target", async () => {
  const dir = await tempProject("title: T\nauthors: [A]\n");
  try {
    const deps = await depsFor(dir);
    const req = await requestFor(dir, "itch", deps);
    const issues = await itchProvider.preflight(req);
    expect(issues.some((i) => i.id === "itch/target-missing")).toBe(true);

    const bad = await itchProvider.preflight({
      ...req,
      config: { target: "not a target!" },
    });
    expect(bad.some((i) => i.id === "itch/target-invalid")).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("itchProjectUrl builds the public page URL", () => {
  expect(itchProjectUrl("someone/test-book")).toBe("https://someone.itch.io/test-book");
});

// ── butler acquisition ──────────────────────────────────────────────────────

test("butlerBrothChannel maps platforms; download url shape is stable", () => {
  expect(butlerBrothChannel("linux", "x64")).toBe("linux-amd64");
  expect(butlerBrothChannel("win32", "x64")).toBe("windows-amd64");
  expect(butlerBrothChannel("darwin", "arm64")).toBe("darwin-amd64");
  expect(butlerBrothChannel("linux", "s390x")).toBeNull();
  expect(butlerDownloadUrl("linux-amd64")).toBe(
    "https://broth.itch.ovh/butler/linux-amd64/LATEST/archive/default",
  );
});

test("ensureButler honours BUTLER_PATH and PATH lookup before downloading", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pmd-butler-"));
  try {
    const fakeButler = path.join(dir, "butler");
    await writeFile(fakeButler, "#!/bin/sh\n");
    const deps = await depsFor(dir, { env: { BUTLER_PATH: fakeButler } });
    expect(await ensureButler(deps)).toBe(fakeButler);

    // BUTLER_PATH pointing nowhere is an explicit error, not a fallback.
    const missing = await depsFor(dir, {
      env: { BUTLER_PATH: path.join(dir, "nope") },
    });
    await expect(ensureButler(missing)).rejects.toThrow(/BUTLER_PATH/);

    // PATH lookup: `which butler` succeeding resolves to the bare command.
    const { runner } = fakeRunner([{ code: 0, stdout: "/usr/bin/butler\n" }]);
    const onPath = await depsFor(dir, { env: {}, runCommand: runner });
    expect(await ensureButler(onPath)).toBe("butler");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── guided providers ────────────────────────────────────────────────────────

test("drivethrurpg upload stages a package with the PDF and LISTING.md", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    await withPdfArtifact(dir);
    const deps = await depsFor(dir);
    const result = await runPublish(
      { projectDir: dir, providerId: "drivethrurpg" },
      deps,
    );
    expect(result.ok).toBe(true);
    expect(result.outcome?.kind).toBe("guided");
    if (result.outcome?.kind !== "guided") throw new Error("unreachable");
    const pkg = result.outcome.packageDir;
    expect(pkg).toBe(path.join(dir, "dist", "publish", "drivethrurpg"));
    const listing = await readFile(path.join(pkg, "LISTING.md"), "utf8");
    expect(listing).toContain("Test Book");
    expect(listing).toContain("Tester");
    const pdf = await readFile(path.join(pkg, "book.pdf"), "utf8");
    expect(pdf).toContain("%PDF");
    expect(result.outcome.openUrl).toContain("drivethrurpg.com");
    expect(result.outcome.checklist.length).toBeGreaterThan(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("drivethrurpg opens the existing product page when configured", async () => {
  const dir = await tempProject(
    `title: T\nauthors: [A]\npublish:\n  drivethrurpg:\n    productUrl: https://www.drivethrurpg.com/product/1234\n`,
  );
  try {
    await withPdfArtifact(dir);
    const deps = await depsFor(dir);
    const req = await requestFor(dir, "drivethrurpg", deps);
    const outcome = await drivethrurpgProvider.upload(req);
    if (outcome.kind !== "guided") throw new Error("expected guided");
    expect(outcome.openUrl).toBe("https://www.drivethrurpg.com/product/1234");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("kdp upload stages a package and points at the KDP bookshelf", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    await withPdfArtifact(dir);
    const deps = await depsFor(dir);
    const req = await requestFor(dir, "kdp", deps);
    const outcome = await kdpProvider.upload(req);
    if (outcome.kind !== "guided") throw new Error("expected guided");
    expect(outcome.openUrl).toContain("kdp.amazon.com");
    const listing = await readFile(path.join(outcome.packageDir, "LISTING.md"), "utf8");
    expect(listing).toContain("Cover");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── azure-swa provider ──────────────────────────────────────────────────────

test("azure-swa requires the html format and the swa CLI", async () => {
  const dir = await tempProject("title: T\nauthors: [A]\n");
  try {
    const { runner } = fakeRunner([{ code: 1 }]); // `which swa` fails
    const deps = await depsFor(dir, { runCommand: runner });
    const req = await requestFor(dir, "azure-swa", deps);
    // Force a PDF artifact to check the format guard.
    const issues = await azureSwaProvider.preflight({
      ...req,
      artifact: { path: "/tmp/x.pdf", format: "pdf" },
    });
    expect(issues.some((i) => i.id === "azure-swa/needs-html")).toBe(true);
    expect(issues.some((i) => i.id === "azure-swa/cli-missing")).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("azure-swa deploy passes the token via env and extracts the site URL", async () => {
  const dir = await tempProject("title: T\nauthors: [A]\n");
  try {
    const { runner, calls } = fakeRunner([
      {
        code: 0,
        stdout: "Deployed to https://nice-tree-123.azurestaticapps.net \n",
      },
    ]);
    const deps = await depsFor(dir, {
      runCommand: runner,
      env: { SWA_CLI_DEPLOYMENT_TOKEN: "deploy-tok", SWA_CLI_PATH: "/opt/swa" },
    });
    const req = await requestFor(dir, "azure-swa", deps);
    const outcome = await azureSwaProvider.upload(req);
    if (outcome.kind !== "published") throw new Error("expected published");
    expect(outcome.url).toBe("https://nice-tree-123.azurestaticapps.net");
    const deploy = calls.find((c) => c.args[0] === "deploy");
    expect(deploy!.cmd).toBe("/opt/swa");
    expect(deploy!.args).toContain("--env");
    expect(deploy!.args.join(" ")).not.toContain("deploy-tok");
    expect(deploy!.env?.SWA_CLI_DEPLOYMENT_TOKEN).toBe("deploy-tok");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── shopify provider ────────────────────────────────────────────────────────

function shopifyFetch(
  responses: Array<{ status?: number; body: unknown }>,
): { fetch: typeof globalThis.fetch; requests: Array<{ url: string; init?: RequestInit }> } {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    const next = responses.shift() ?? { body: {} };
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetch: fetchFn, requests };
}

test("shopify upload creates a draft product via GraphQL with the token in a header", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    await withPdfArtifact(dir);
    const { fetch: fetchFn, requests } = shopifyFetch([
      { body: { data: { shop: { name: "My Store" } } } }, // authenticate
      {
        body: {
          data: {
            productCreate: {
              product: {
                id: "gid://shopify/Product/777",
                title: "Test Book",
                onlineStoreUrl: null,
              },
              userErrors: [],
            },
          },
        },
      },
    ]);
    const deps = await depsFor(dir, {
      fetch: fetchFn,
      env: { SHOPIFY_ADMIN_TOKEN: "shpat_secret" },
    });
    const result = await runPublish({ projectDir: dir, providerId: "shopify" }, deps);
    expect(result.ok).toBe(true);
    if (result.outcome?.kind !== "published") throw new Error("expected published");
    expect(result.outcome.url).toBe(
      "https://my-store.myshopify.com/admin/products/777",
    );
    expect(result.outcome.followUp?.length).toBeGreaterThan(1);

    expect(requests[0]!.url).toContain("my-store.myshopify.com/admin/api/");
    const headers = requests[0]!.init?.headers as Record<string, string>;
    expect(headers["X-Shopify-Access-Token"]).toBe("shpat_secret");
    // The mutation body carries the title, not the token.
    expect(String(requests[1]!.init?.body)).toContain("Test Book");
    expect(String(requests[1]!.init?.body)).not.toContain("shpat_secret");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shopify authenticate maps a 401 to friendly guidance", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const { fetch: fetchFn } = shopifyFetch([{ status: 401, body: {} }]);
    const deps = await depsFor(dir, {
      fetch: fetchFn,
      env: { SHOPIFY_ADMIN_TOKEN: "bad" },
    });
    const req = await requestFor(dir, "shopify", deps);
    const auth = await shopifyProvider.authenticate(req);
    expect(auth.ok).toBe(false);
    expect(auth.message).toMatch(/rejected the access token/);
    expect(auth.message).not.toContain("bad");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shopify preflight requires the shop domain; legacy id helper works", async () => {
  const dir = await tempProject("title: T\nauthors: [A]\n");
  try {
    const deps = await depsFor(dir);
    const req = await requestFor(dir, "shopify", deps);
    const issues = await shopifyProvider.preflight(req);
    expect(issues.some((i) => i.id === "shopify/shop-missing")).toBe(true);
    expect(shopifyLegacyId("gid://shopify/Product/123")).toBe("123");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── manifest publish settings round-trip ─────────────────────────────────────

test("setPublishProviderConfig round-trips yaml and preserves other sections", async () => {
  const dir = await tempProject("title: Keep Me\nauthors: [A]\n# a comment\n");
  try {
    let settings = await setPublishProviderConfig(dir, "itch", {
      target: "someone/book",
      channel: "pdf",
    });
    expect(settings.itch).toEqual({ target: "someone/book", channel: "pdf" });

    settings = await setPublishProviderConfig(dir, "shopify", {
      shop: "x.myshopify.com",
    });
    expect(settings.itch?.target).toBe("someone/book");
    expect(settings.shopify?.shop).toBe("x.myshopify.com");

    // Clearing every key removes the section (and eventually `publish:`).
    settings = await setPublishProviderConfig(dir, "shopify", { shop: "" });
    expect(settings.shopify).toBeUndefined();
    settings = await setPublishProviderConfig(dir, "itch", {
      target: "",
      channel: "",
    });
    expect(await readPublishSettings(dir)).toEqual({});

    const raw = await readFile(path.join(dir, "manifest.yaml"), "utf8");
    expect(raw).toContain("title: Keep Me");
    expect(raw).toContain("# a comment");
    expect(raw).not.toContain("publish:");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
