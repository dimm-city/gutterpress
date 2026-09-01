import { test, expect } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { FileTokenStore } from "../remote-auth/token-store";
import { artifactName, BOOK_HTML, resolveOutputDir } from "../output-paths";
import { listPublishProviders, publishProviderFor } from "./registry";
import { runPublish, resolvePublishRequest, resolvePublishFormat } from "./run-publish";
import { connectPublishProvider } from "./connect";
import { readPublishSettings, setPublishProviderConfig } from "./manifest-publish";
import type {
  CommandResult,
  CommandRunner,
  PublishDeps,
  PublishRequest,
} from "./types";
import { resolvePublishCredential, publishConnectionStatus } from "./types";
import { itchProvider, itchProjectUrl } from "./providers/itch";
import { shopifyProvider, shopifyLegacyId } from "./providers/shopify";
import { drivethrurpgProvider } from "./providers/drivethrurpg";
import { kdpProvider } from "./providers/kdp";
import { azureSwaProvider } from "./providers/azure-swa";
import { gdriveProvider } from "./providers/gdrive";
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
  const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-publish-"));
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

// Output location is the shared `dist/<title-slug>/` convention
// (output-paths.ts), so the artifact this writes must match whatever title
// the caller's manifest declares — "Test Book" (the shared MANIFEST fixture)
// unless a test's own manifest sets something else.
async function withPdfArtifact(dir: string, title = "Test Book"): Promise<string> {
  const out = resolveOutputDir(dir, title);
  await mkdir(out, { recursive: true });
  const pdf = path.join(out, artifactName(title, "pdf"));
  await writeFile(pdf, "%PDF-1.4 fake");
  return pdf;
}

// ── registry ────────────────────────────────────────────────────────────────

test("registry lists all six providers and resolves by id", () => {
  const ids = listPublishProviders().map((p) => p.id);
  expect(ids).toEqual(["itch", "drivethrurpg", "kdp", "azure-swa", "shopify", "gdrive"]);
  expect(publishProviderFor("itch").info.label).toBe("itch.io");
  expect(() => publishProviderFor("nope")).toThrow(/Unknown publish provider/);
});

test("provider config is read from the manifest under the provider id itself", async () => {
  const dir = await tempProject(
    `title: T\nauthors: [A]\npublish:\n  azure-swa:\n    env: preview\n`,
  );
  try {
    const deps = await depsFor(dir);
    const req = await requestFor(dir, "azure-swa", deps);
    expect(req.config).toEqual({ env: "preview" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("every provider declares its author-editable config fields", () => {
  for (const info of listPublishProviders()) {
    expect(Array.isArray(info.configFields)).toBe(true);
  }
  expect(
    publishProviderFor("shopify").info.configFields.map((f) => f.key),
  ).toContain("apiVersion");
});

// ── effective format resolution (#221 phase 3, D8) ──────────────────────────

test("resolvePublishFormat defaults to info.format for every single-format provider, ignoring any publish.<id>.format value", () => {
  // These providers declare no `formats` array at all — the plan's explicit
  // regression guarantee: a mistake in effective-format computation must not
  // silently change what they resolve to, no matter what a manifest sets.
  for (const provider of [itchProvider, drivethrurpgProvider, kdpProvider, azureSwaProvider, shopifyProvider]) {
    expect(provider.info.formats).toBeUndefined();
    expect(resolvePublishFormat(provider.info, {})).toBe(provider.info.format);
    expect(resolvePublishFormat(provider.info, { format: "html" })).toBe(provider.info.format);
    expect(resolvePublishFormat(provider.info, { format: "pdf" })).toBe(provider.info.format);
    expect(resolvePublishFormat(provider.info, { format: 42 })).toBe(provider.info.format);
  }
});

test("resolvePublishFormat: gdrive defaults to pdf when publish.gdrive.format is unset", () => {
  expect(gdriveProvider.info.formats).toEqual(["pdf", "html"]);
  expect(resolvePublishFormat(gdriveProvider.info, {})).toBe("pdf");
});

test("resolvePublishFormat: gdrive honors a valid publish.gdrive.format", () => {
  expect(resolvePublishFormat(gdriveProvider.info, { format: "html" })).toBe("html");
  expect(resolvePublishFormat(gdriveProvider.info, { format: "pdf" })).toBe("pdf");
});

test("resolvePublishFormat: an invalid/unrecognized publish.gdrive.format is IGNORED, not rejected — falls back to the default", () => {
  expect(resolvePublishFormat(gdriveProvider.info, { format: "epub" })).toBe("pdf");
  expect(resolvePublishFormat(gdriveProvider.info, { format: "  " })).toBe("pdf");
  expect(resolvePublishFormat(gdriveProvider.info, { format: 7 })).toBe("pdf");
  expect(resolvePublishFormat(gdriveProvider.info, {})).toBe("pdf");
});

test("resolvePublishRequest: gdrive with no publish.gdrive.format set resolves the default PDF artifact path", async () => {
  const dir = await tempProject("title: My Book\nauthors: [A]\n");
  try {
    const deps = await depsFor(dir);
    const req = await requestFor(dir, "gdrive", deps);
    expect(req.artifact.format).toBe("pdf");
    expect(req.artifact.path).toBe(
      path.join(resolveOutputDir(dir, "My Book"), artifactName("My Book", "pdf")),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolvePublishRequest: publish.gdrive.format: html switches the default artifact to the export DIRECTORY", async () => {
  const dir = await tempProject(
    "title: My Book\nauthors: [A]\npublish:\n  gdrive:\n    format: html\n",
  );
  try {
    const deps = await depsFor(dir);
    const req = await requestFor(dir, "gdrive", deps);
    expect(req.artifact.format).toBe("html");
    expect(req.artifact.path).toBe(resolveOutputDir(dir, "My Book"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolvePublishRequest: an invalid publish.gdrive.format falls back to the pdf default rather than blocking", async () => {
  const dir = await tempProject(
    "title: My Book\nauthors: [A]\npublish:\n  gdrive:\n    format: epub\n",
  );
  try {
    const deps = await depsFor(dir);
    const req = await requestFor(dir, "gdrive", deps);
    expect(req.artifact.format).toBe("pdf");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── credential resolution ───────────────────────────────────────────────────

test("resolvePublishCredential prefers the CI env var over the store", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-cred-"));
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

test("resolvePublishRequest anchors the default artifact on the MANIFEST's directory, not the project positional", async () => {
  // `--manifest` pointing OUTSIDE the project positional (a manifest shared
  // one level up, say) must resolve the default artifact the same place
  // `resolveBuildContext` (build-runner.ts) resolved the BUILD's output —
  // the manifest's own directory — not the unrelated `projectDir` the CLI
  // positional happened to be. Previously it used `projectDir`, so this
  // divergence made a perfectly-built artifact invisible to publish.
  const projectDir = await mkdtemp(path.join(tmpdir(), "gutterpress-publish-project-"));
  const manifestDir = await mkdtemp(path.join(tmpdir(), "gutterpress-publish-manifest-"));
  try {
    const manifestPath = path.join(manifestDir, "manifest.yaml");
    await writeFile(manifestPath, "title: Elsewhere Book\nauthors: [A]\n", "utf8");
    await withPdfArtifact(manifestDir, "Elsewhere Book");

    const deps = await depsFor(projectDir);
    const req = await resolvePublishRequest(
      { projectDir, providerId: "drivethrurpg", manifestPath },
      deps,
    );
    expect(req.artifact.path).toBe(
      path.join(
        resolveOutputDir(manifestDir, "Elsewhere Book"),
        artifactName("Elsewhere Book", "pdf"),
      ),
    );

    const result = await runPublish(
      { projectDir, providerId: "drivethrurpg", manifestPath, dryRun: true },
      deps,
    );
    expect(result.ok).toBe(true);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
    await rm(manifestDir, { recursive: true, force: true });
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
    // authenticate hits api.itch.io via fetch; upload runs `which` + push.
    const fetchOk = (async () =>
      new Response("{}", { status: 200 })) as unknown as typeof globalThis.fetch;
    const { runner, calls } = fakeRunner([
      { stdout: "/usr/bin/butler\n" }, // which (upload → ensureButler)
      { code: 0, stdout: "build pushed" }, // butler push
    ]);
    const deps = await depsFor(dir, {
      runCommand: runner,
      fetch: fetchOk,
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
  const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-butler-"));
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

test("ensureButler downloads, extracts, and caches the binary when nothing is installed", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-butler-"));
  try {
    const binName = process.platform === "win32" ? "butler.exe" : "butler";
    const archive = zipSync({
      [binName]: strToU8("#!/bin/sh\n"),
      "lib7z.so": strToU8("companion lib"),
    });
    const { runner } = fakeRunner([{ code: 1 }]); // `which butler` misses
    const fetchImpl = (async () => new Response(archive)) as unknown as typeof fetch;
    const deps = await depsFor(dir, { env: {}, runCommand: runner, fetch: fetchImpl });
    const resolved = await ensureButler(deps);
    expect(resolved).toBe(path.join(dir, ".config", "tools", "butler", binName));
    expect(await readFile(resolved, "utf8")).toBe("#!/bin/sh\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ensureButler maps download failures to friendly messages", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-butler-"));
  const failure = async (fetchImpl: typeof fetch): Promise<Error> => {
    const deps = await depsFor(dir, {
      env: {},
      runCommand: fakeRunner([{ code: 1 }]).runner,
      fetch: fetchImpl,
    });
    return ensureButler(deps).then(
      () => {
        throw new Error("expected ensureButler to reject");
      },
      (e) => e as Error,
    );
  };
  try {
    // HTTP status: the already-friendly message is thrown AS-IS, never
    // re-wrapped in the network-failure mapping (exact match on purpose).
    const httpErr = await failure(
      (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch,
    );
    expect(httpErr.message).toBe(
      "Couldn't download butler from itch.io (HTTP 503). " +
        "Check your connection, or install butler manually and set BUTLER_PATH.",
    );

    // Deadline fired (AbortSignal.timeout rejects with a TimeoutError).
    const timeoutErr = await failure((async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    }) as unknown as typeof fetch);
    expect(timeoutErr.message).toBe(
      "Downloading butler from itch.io timed out. " +
        "Check your connection, or install butler manually and set BUTLER_PATH.",
    );

    // Network-level failure: wrapped with the connection hint.
    const netErr = await failure((async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);
    expect(netErr.message).toBe(
      "Couldn't download butler from itch.io (fetch failed). " +
        "Check your connection, or install butler manually and set BUTLER_PATH.",
    );
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
    expect(pkg).toBe(
      path.join(resolveOutputDir(dir, "Test Book"), "publish", "drivethrurpg"),
    );
    const listing = await readFile(path.join(pkg, "LISTING.md"), "utf8");
    expect(listing).toContain("Test Book");
    expect(listing).toContain("Tester");
    const pdf = await readFile(
      path.join(pkg, artifactName("Test Book", "pdf")),
      "utf8",
    );
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
    await withPdfArtifact(dir, "T");
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

// ── network deadlines (shared fetch-timeout policy) ─────────────────────────

/** Stub fetch that fails every call with `error` (network/deadline shapes). */
function fetchThrowing(error: unknown): typeof globalThis.fetch {
  return (async () => {
    throw error;
  }) as unknown as typeof globalThis.fetch;
}

/** What AbortSignal.timeout rejects with when the deadline fires. */
function timeoutError(): DOMException {
  return new DOMException("The operation timed out.", "TimeoutError");
}

test("itch authenticate runs its api.itch.io check under an abortable deadline", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    // Without a signal wired through fetch, a stalled connection has NOTHING
    // to abort it — the publish pipeline would hang forever on this call.
    let seenSignal: unknown;
    const fetchFn = (async (_url: unknown, init?: RequestInit) => {
      seenSignal = init?.signal;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const deps = await depsFor(dir, { fetch: fetchFn, env: { BUTLER_API_KEY: "k" } });
    const req = await requestFor(dir, "itch", deps);
    const auth = await itchProvider.authenticate(req);
    expect(auth.ok).toBe(true);
    expect(seenSignal).toBeInstanceOf(AbortSignal);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("itch authenticate maps a fired deadline and an offline failure to friendly copy", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const authWith = async (fetchFn: typeof globalThis.fetch) => {
      const deps = await depsFor(dir, { fetch: fetchFn, env: { BUTLER_API_KEY: "k" } });
      return itchProvider.authenticate(await requestFor(dir, "itch", deps));
    };

    const timedOut = await authWith(fetchThrowing(timeoutError()));
    expect(timedOut.ok).toBe(false);
    expect(timedOut.message).toBe(
      "itch.io didn't respond in time. Check your connection and try again.",
    );

    const offline = await authWith(fetchThrowing(new TypeError("fetch failed")));
    expect(offline.ok).toBe(false);
    expect(offline.message).toBe(
      "Couldn't reach itch.io. Check your connection and try again.",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shopify GraphQL calls run under an abortable deadline", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const { fetch: fetchFn, requests } = shopifyFetch([
      { body: { data: { shop: { name: "My Store" } } } },
    ]);
    const deps = await depsFor(dir, {
      fetch: fetchFn,
      env: { SHOPIFY_ADMIN_TOKEN: "shpat_secret" },
    });
    const auth = await shopifyProvider.authenticate(await requestFor(dir, "shopify", deps));
    expect(auth.ok).toBe(true);
    expect(requests[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shopify maps a fired deadline and an offline failure to friendly copy", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const authWith = async (fetchFn: typeof globalThis.fetch) => {
      const deps = await depsFor(dir, {
        fetch: fetchFn,
        env: { SHOPIFY_ADMIN_TOKEN: "shpat_secret" },
      });
      return shopifyProvider.authenticate(await requestFor(dir, "shopify", deps));
    };

    const timedOut = await authWith(fetchThrowing(timeoutError()));
    expect(timedOut.ok).toBe(false);
    expect(timedOut.message).toBe(
      "Shopify didn't respond in time. Check your connection and try again.",
    );

    const offline = await authWith(fetchThrowing(new TypeError("fetch failed")));
    expect(offline.ok).toBe(false);
    expect(offline.message).toBe(
      "Couldn't reach Shopify. Check your connection and try again.",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── connect flow ────────────────────────────────────────────────────────────

test("connectPublishProvider verifies the pasted key and only then stores it", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const seen: string[] = [];
    const fetchFn = (async (_url: unknown, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
      seen.push(auth);
      return new Response("{}", {
        status: auth.includes("good-key") ? 200 : 401,
      });
    }) as typeof globalThis.fetch;
    // An exported env key must NOT shadow the paste being verified.
    const deps = await depsFor(dir, {
      fetch: fetchFn,
      env: { BUTLER_API_KEY: "env-key" },
    });
    await deps.tokenStore.set("itch.io", {
      host: "itch.io",
      kind: "token",
      token: "old-working-key",
      createdAt: 1,
    });

    // Bad paste: rejected, and the old credential survives untouched.
    await expect(
      connectPublishProvider(
        { projectDir: dir, providerId: "itch", token: "bad-key" },
        deps,
      ),
    ).rejects.toThrow(/didn't accept the API key/);
    expect((await deps.tokenStore.get("itch.io"))?.token).toBe("old-working-key");
    expect(seen.pop()).toContain("bad-key"); // the paste was verified, not env-key

    // Good paste: verified then persisted.
    const result = await connectPublishProvider(
      { projectDir: dir, providerId: "itch", token: "good-key" },
      deps,
    );
    expect(result.connected).toBe(true);
    expect((await deps.tokenStore.get("itch.io"))?.token).toBe("good-key");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("connectPublishProvider refuses guided providers and empty tokens", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const deps = await depsFor(dir);
    await expect(
      connectPublishProvider({ projectDir: dir, providerId: "kdp", token: "x" }, deps),
    ).rejects.toThrow(/needs no API key/);
    await expect(
      connectPublishProvider({ projectDir: dir, providerId: "itch", token: "  " }, deps),
    ).rejects.toThrow(/Paste an API key/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("connectPublishProvider rejects an oauth provider's pasted token (gdrive) — the old paste path can never store an unverifiable credential", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const deps = await depsFor(dir);
    await expect(
      connectPublishProvider(
        { projectDir: dir, providerId: "gdrive", token: "some-refresh-token" },
        deps,
      ),
    ).rejects.toThrow(/connects through your browser.*--connect/);
    // Nothing was stored.
    expect(await deps.tokenStore.get("gdrive")).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("publishConnectionStatus is the one shared definition of connected", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-status-"));
  try {
    const deps = await depsFor(dir);
    const itch = publishProviderFor("itch").info;
    expect((await publishConnectionStatus(itch, deps)).connected).toBe(false);
    expect(
      (await publishConnectionStatus(itch, { ...deps, env: { BUTLER_API_KEY: "k" } }))
        .source,
    ).toBe("env");
    const kdp = publishProviderFor("kdp").info;
    expect((await publishConnectionStatus(kdp, deps)).connected).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── security gates ──────────────────────────────────────────────────────────

test("shopify never sends the token to a non-myshopify.com host", async () => {
  const dir = await tempProject(
    `title: T\nauthors: [A]\npublish:\n  shopify:\n    shop: attacker.example\n`,
  );
  try {
    let fetched = false;
    const fetchFn = (async () => {
      fetched = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const deps = await depsFor(dir, {
      fetch: fetchFn,
      env: { SHOPIFY_ADMIN_TOKEN: "shpat_secret" },
    });
    const req = await requestFor(dir, "shopify", deps);
    const auth = await shopifyProvider.authenticate(req);
    expect(auth.ok).toBe(false);
    expect(auth.message).toMatch(/myshopify\.com/);
    expect(fetched).toBe(false); // the token never left the process

    const issues = await shopifyProvider.preflight(req);
    expect(issues.some((i) => i.id === "shopify/shop-invalid" && i.severity === "error")).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── html artifact checks ────────────────────────────────────────────────────

test("azure-swa preflight requires book.html and warns about extra dist content", async () => {
  const dir = await tempProject("title: T\nauthors: [A]\n");
  try {
    const out = resolveOutputDir(dir, "T");
    await mkdir(out, { recursive: true });
    const deps = await depsFor(dir, {
      env: { SWA_CLI_DEPLOYMENT_TOKEN: "tok", SWA_CLI_PATH: "/opt/swa" },
    });

    // Empty dir: no book.html → blocking error.
    let result = await runPublish(
      { projectDir: dir, providerId: "azure-swa", dryRun: true },
      deps,
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.id === "publish/html-export-missing")).toBe(true);

    // Export present but the sellable PDF and the build fingerprint sit next
    // to it → warning. Named by convention now (`t-pdf.pdf`, not a fixed
    // `book.pdf`), which is exactly what the extras gate must still catch by
    // scanning for `*.pdf` rather than one hard-coded name.
    await writeFile(path.join(out, BOOK_HTML), "<html></html>");
    await writeFile(path.join(out, artifactName("T", "pdf")), "%PDF");
    await writeFile(path.join(out, "build-fingerprint.json"), "{}");
    result = await runPublish(
      { projectDir: dir, providerId: "azure-swa", dryRun: true },
      deps,
    );
    expect(result.ok).toBe(true);
    const extras = result.issues.find(
      (i) => i.id === "publish/html-dir-extras" && i.severity === "warning",
    );
    expect(extras).toBeDefined();
    expect(extras!.message).toContain(artifactName("T", "pdf"));
    expect(extras!.message).toContain("build-fingerprint.json");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("publish preflight flags a missing manifest title (no 'Document' fallback)", async () => {
  const dir = await tempProject("authors: [A]\n");
  try {
    // No title in the manifest → resolveConfig's "Document" placeholder, so
    // the artifact must sit at THAT slug for resolvePublishRequest to find it
    // (project.title below stays the raw, unplaceholdered "" on purpose).
    await withPdfArtifact(dir, "Document");
    const deps = await depsFor(dir);
    const req = await requestFor(dir, "shopify", deps);
    expect(req.project.title).toBe("");
    const issues = await shopifyProvider.preflight(req);
    expect(issues.some((i) => i.id === "shopify/title-missing")).toBe(true);
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
