import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileTokenStore } from "../../remote-auth/token-store";
import { resolvePublishRequest } from "../run-publish";
import { publishCredentialKey, type PublishDeps, type PublishRequest } from "../types";
import { gdriveProvider } from "./gdrive";

// requireGoogleClientCredentials() (called by providers/gdrive.ts with no
// explicit override) resolves via GUTTERPRESS_GOOGLE_CLIENT_ID/_SECRET env
// vars — same precedence as resolveGitHubClientId. Set them for every test in
// this file so "not configured" never masks the behavior under test; the
// "not configured" path itself is covered in google-auth.test.ts.
beforeEach(() => {
  process.env.GUTTERPRESS_GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GUTTERPRESS_GOOGLE_CLIENT_SECRET = "test-client-secret";
});
afterEach(() => {
  delete process.env.GUTTERPRESS_GOOGLE_CLIENT_ID;
  delete process.env.GUTTERPRESS_GOOGLE_CLIENT_SECRET;
});

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

async function tempProject(manifest: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-gdrive-provider-"));
  await writeFile(path.join(dir, "manifest.yaml"), manifest, "utf8");
  return dir;
}

async function depsFor(dir: string, overrides: Partial<PublishDeps> = {}): Promise<PublishDeps> {
  const store = new FileTokenStore(path.join(dir, ".creds", "credentials.json"));
  return { tokenStore: store, env: {}, configDir: path.join(dir, ".config"), ...overrides };
}

async function requestFor(
  dir: string,
  deps: PublishDeps,
  artifactPath: string,
): Promise<PublishRequest> {
  return resolvePublishRequest({ projectDir: dir, providerId: "gdrive", artifactPath }, deps);
}

async function fakeArtifact(dir: string, sizeBytes = 4096): Promise<string> {
  const filePath = path.join(dir, "my-book-pdf.pdf");
  await writeFile(filePath, Buffer.alloc(sizeBytes, 1));
  return filePath;
}

interface Script {
  quota?: { limit: number | null; usage: number };
  email?: string;
  folders?: Array<{ id: string; name: string }>;
  existingFile?: { id: string; name: string; webViewLink: string } | null;
  createdFolderId?: string;
  uploadFileResult?: { id: string; name: string; webViewLink: string };
  refreshTokenSeen?: string[];
}

/** One fake fetch covering every Drive/oauth endpoint the provider touches. */
function fakeFetch(script: Script = {}) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const body = init?.body !== undefined ? String(init.body) : undefined;
    calls.push({ url: u, method, body });

    if (u.includes("oauth2.googleapis.com/token")) {
      const params = new URLSearchParams(body ?? "");
      script.refreshTokenSeen?.push(params.get("refresh_token") ?? "");
      return jsonResponse({ access_token: "at", expires_in: 3599 });
    }
    if (u.includes("drive/v3/about")) {
      const q = script.quota;
      return jsonResponse({
        user: { emailAddress: script.email ?? "author@example.com" },
        storageQuota: q
          ? { ...(q.limit != null ? { limit: String(q.limit) } : {}), usage: String(q.usage) }
          : { usage: "0" },
      });
    }
    // getFolderById: GET .../files/<id>?fields=...
    const byIdMatch = /\/drive\/v3\/files\/([^?]+)\?fields=id,name,trashed,mimeType/.exec(u);
    if (byIdMatch && method === "GET") {
      const id = decodeURIComponent(byIdMatch[1]!);
      const folder = script.folders?.find((f) => f.id === id);
      if (!folder) return jsonResponse({}, 404);
      return jsonResponse({ id: folder.id, name: folder.name, trashed: false, mimeType: "application/vnd.google-apps.folder" });
    }
    // listFolders: GET .../files?q=mimeType='...folder'...
    if (u.includes("/drive/v3/files?q=") && u.includes("google-apps.folder") && method === "GET") {
      return jsonResponse({ files: script.folders ?? [] });
    }
    // findFileInFolder: GET .../files?q=name='...' and '<folder>' in parents...
    if (u.includes("/drive/v3/files?q=") && method === "GET") {
      return jsonResponse({ files: script.existingFile ? [script.existingFile] : [] });
    }
    // createFolder: POST .../files?fields=id,name
    if (u.endsWith("/drive/v3/files?fields=id,name") && method === "POST") {
      const name = (JSON.parse(body ?? "{}") as { name?: string }).name ?? "folder";
      return jsonResponse({ id: script.createdFolderId ?? "created-folder-id", name });
    }
    // resumable session start
    if (u.includes("uploadType=resumable")) {
      return new Response(null, { status: 200, headers: { Location: "https://upload.example/session" } });
    }
    // chunk PUT
    if (u === "https://upload.example/session" && method === "PUT") {
      return jsonResponse(
        script.uploadFileResult ?? {
          id: "uploaded-file-id",
          name: "my-book-pdf.pdf",
          webViewLink: "https://drive.google.com/file/d/uploaded-file-id/view",
        },
      );
    }
    throw new Error(`unexpected fake-fetch call: ${method} ${u}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const MANIFEST = `title: My Book
authors: [Author]
`;

// ── folder resolution order (folderId → name → create) ──────────────────────

test("upload resolves an explicit folderId directly, without listing or creating", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const artifactPath = await fakeArtifact(dir);
    const deps = await depsFor(dir, {});
    await deps.tokenStore.set("gdrive", { host: "gdrive", kind: "google-oauth", token: "rt", createdAt: 1 });
    const { fetchImpl, calls } = fakeFetch({ folders: [{ id: "folder-123", name: "My Books" }] });
    deps.fetch = fetchImpl;
    const req = await requestFor(dir, deps, artifactPath);
    req.config = { folderId: "folder-123" };

    const outcome = await gdriveProvider.upload(req);
    expect(outcome.kind).toBe("published");
    // No folder LIST or CREATE call — only the direct by-id GET.
    expect(calls.some((c) => c.url.includes("google-apps.folder"))).toBe(false);
    expect(calls.some((c) => /files\/folder-123\?fields=id,name,trashed,mimeType/.test(c.url))).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("upload throws a friendly 'pick the folder again' error when folderId no longer exists, and never starts the upload", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const artifactPath = await fakeArtifact(dir);
    const deps = await depsFor(dir, {});
    await deps.tokenStore.set("gdrive", { host: "gdrive", kind: "google-oauth", token: "rt", createdAt: 1 });
    const { fetchImpl, calls } = fakeFetch({ folders: [] }); // folder-123 not found → 404
    deps.fetch = fetchImpl;
    const req = await requestFor(dir, deps, artifactPath);
    req.config = { folderId: "folder-123" };

    await expect(gdriveProvider.upload(req)).rejects.toThrow(/can't be found.*pick the folder again/i);
    expect(calls.some((c) => c.url.includes("uploadType=resumable"))).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("upload finds an existing app-created folder by name before creating one", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const artifactPath = await fakeArtifact(dir);
    const deps = await depsFor(dir, {});
    await deps.tokenStore.set("gdrive", { host: "gdrive", kind: "google-oauth", token: "rt", createdAt: 1 });
    const { fetchImpl, calls } = fakeFetch({ folders: [{ id: "existing-folder", name: "My Books" }] });
    deps.fetch = fetchImpl;
    const req = await requestFor(dir, deps, artifactPath);
    req.config = { folder: "My Books" };

    await gdriveProvider.upload(req);
    const createCalls = calls.filter((c) => c.url.endsWith("/drive/v3/files?fields=id,name") && c.method === "POST");
    expect(createCalls.length).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("upload creates the default 'Gutterpress' folder when neither folder nor folderId is set", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const artifactPath = await fakeArtifact(dir);
    const deps = await depsFor(dir, {});
    await deps.tokenStore.set("gdrive", { host: "gdrive", kind: "google-oauth", token: "rt", createdAt: 1 });
    const { fetchImpl, calls } = fakeFetch({ folders: [] });
    deps.fetch = fetchImpl;
    const req = await requestFor(dir, deps, artifactPath);
    req.config = {};

    await gdriveProvider.upload(req);
    const createCall = calls.find((c) => c.url.endsWith("/drive/v3/files?fields=id,name") && c.method === "POST");
    expect(createCall).toBeDefined();
    expect(JSON.parse(createCall!.body ?? "{}").name).toBe("Gutterpress");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── update-vs-create ─────────────────────────────────────────────────────────

test("upload UPDATES the existing file in place when one with the same name is found (D6)", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const artifactPath = await fakeArtifact(dir);
    const deps = await depsFor(dir, {});
    await deps.tokenStore.set("gdrive", { host: "gdrive", kind: "google-oauth", token: "rt", createdAt: 1 });
    const { fetchImpl, calls } = fakeFetch({
      folders: [{ id: "f1", name: "Gutterpress" }],
      existingFile: { id: "same-file-id", name: "my-book-pdf.pdf", webViewLink: "https://drive.google.com/file/d/same-file-id/view" },
      uploadFileResult: { id: "same-file-id", name: "my-book-pdf.pdf", webViewLink: "https://drive.google.com/file/d/same-file-id/view" },
    });
    deps.fetch = fetchImpl;
    const req = await requestFor(dir, deps, artifactPath);
    req.config = {};

    const outcome = await gdriveProvider.upload(req);
    if (outcome.kind !== "published") throw new Error("expected published outcome");
    expect(outcome.url).toBe("https://drive.google.com/file/d/same-file-id/view");
    expect(outcome.detail).toContain("updated the existing file");
    const sessionStart = calls.find((c) => c.url.includes("uploadType=resumable"));
    expect(sessionStart!.url).toContain("/files/same-file-id?");
    expect(sessionStart!.method).toBe("PATCH");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("upload CREATES a new file when none with that name exists in the folder", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const artifactPath = await fakeArtifact(dir);
    const deps = await depsFor(dir, {});
    await deps.tokenStore.set("gdrive", { host: "gdrive", kind: "google-oauth", token: "rt", createdAt: 1 });
    const { fetchImpl, calls } = fakeFetch({ folders: [{ id: "f1", name: "Gutterpress" }], existingFile: null });
    deps.fetch = fetchImpl;
    const req = await requestFor(dir, deps, artifactPath);
    req.config = {};

    const outcome = await gdriveProvider.upload(req);
    if (outcome.kind !== "published") throw new Error("expected published outcome");
    expect(outcome.detail).not.toContain("updated the existing file");
    const sessionStart = calls.find((c) => c.url.includes("uploadType=resumable"));
    expect(sessionStart!.method).toBe("POST");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── quota fail-fast ──────────────────────────────────────────────────────────

test("upload fails fast on a full Drive BEFORE any bytes move — no upload session is ever started", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const artifactPath = await fakeArtifact(dir, 5 * 1024 * 1024); // 5 MB artifact
    const deps = await depsFor(dir, {});
    await deps.tokenStore.set("gdrive", { host: "gdrive", kind: "google-oauth", token: "rt", createdAt: 1 });
    const { fetchImpl, calls } = fakeFetch({
      quota: { limit: 1024 * 1024, usage: 1024 * 1024 - 100 }, // only 100 bytes free
      folders: [{ id: "f1", name: "Gutterpress" }],
    });
    deps.fetch = fetchImpl;
    const req = await requestFor(dir, deps, artifactPath);
    req.config = {};

    await expect(gdriveProvider.upload(req)).rejects.toThrow(/Drive is full/i);
    expect(calls.some((c) => c.url.includes("uploadType=resumable"))).toBe(false);
    // Folder resolution (which lists/creates folders) must also not have
    // happened — the quota check runs before ANY further work.
    expect(calls.some((c) => c.url.includes("google-apps.folder"))).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("upload proceeds normally when the artifact fits within the free quota", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const artifactPath = await fakeArtifact(dir, 1024);
    const deps = await depsFor(dir, {});
    await deps.tokenStore.set("gdrive", { host: "gdrive", kind: "google-oauth", token: "rt", createdAt: 1 });
    const { fetchImpl } = fakeFetch({
      quota: { limit: 1024 * 1024 * 1024, usage: 0 },
      folders: [{ id: "f1", name: "Gutterpress" }],
    });
    deps.fetch = fetchImpl;
    const req = await requestFor(dir, deps, artifactPath);
    req.config = {};
    const outcome = await gdriveProvider.upload(req);
    expect(outcome.kind).toBe("published");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unlimited-quota (Workspace) account is never treated as full", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const artifactPath = await fakeArtifact(dir, 10 * 1024 * 1024);
    const deps = await depsFor(dir, {});
    await deps.tokenStore.set("gdrive", { host: "gdrive", kind: "google-oauth", token: "rt", createdAt: 1 });
    const { fetchImpl } = fakeFetch({
      quota: { limit: null, usage: 999_999_999_999 },
      folders: [{ id: "f1", name: "Gutterpress" }],
    });
    deps.fetch = fetchImpl;
    const req = await requestFor(dir, deps, artifactPath);
    req.config = {};
    const outcome = await gdriveProvider.upload(req);
    expect(outcome.kind).toBe("published");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── credential resolution: env override + named accounts ────────────────────

test("GDRIVE_REFRESH_TOKEN env var wins over a stored credential", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const artifactPath = await fakeArtifact(dir);
    const deps = await depsFor(dir, { env: { GDRIVE_REFRESH_TOKEN: "env-refresh-token" } });
    await deps.tokenStore.set("gdrive", { host: "gdrive", kind: "google-oauth", token: "stored-refresh-token", createdAt: 1 });
    const refreshTokenSeen: string[] = [];
    const { fetchImpl } = fakeFetch({ folders: [{ id: "f1", name: "Gutterpress" }], refreshTokenSeen });
    deps.fetch = fetchImpl;
    const req = await requestFor(dir, deps, artifactPath);
    req.config = {};

    const auth = await gdriveProvider.authenticate(req);
    expect(auth.ok).toBe(true);
    expect(auth.source).toBe("env");
    expect(refreshTokenSeen).toContain("env-refresh-token");
    expect(refreshTokenSeen).not.toContain("stored-refresh-token");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("named-account compound key: authenticate resolves the account-specific credential, not the default", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const artifactPath = await fakeArtifact(dir);
    const deps = await depsFor(dir, {});
    await deps.tokenStore.set("gdrive", { host: "gdrive", kind: "google-oauth", token: "default-rt", createdAt: 1 });
    await deps.tokenStore.set(publishCredentialKey("gdrive", "studio"), {
      host: "gdrive",
      kind: "google-oauth",
      token: "studio-rt",
      username: "studio",
      createdAt: 2,
    });
    const refreshTokenSeen: string[] = [];
    const { fetchImpl } = fakeFetch({ folders: [], refreshTokenSeen });
    deps.fetch = fetchImpl;

    const defaultReq = await requestFor(dir, deps, artifactPath);
    defaultReq.config = {};
    await gdriveProvider.authenticate(defaultReq);
    expect(refreshTokenSeen.at(-1)).toBe("default-rt");

    const studioDeps = { ...deps, credentialAccount: "studio" };
    const studioReq = await requestFor(dir, studioDeps, artifactPath);
    studioReq.config = {};
    const studioAuth = await gdriveProvider.authenticate(studioReq);
    expect(studioAuth.ok).toBe(true);
    expect(refreshTokenSeen.at(-1)).toBe("studio-rt");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a selected-but-missing named account is NOT connected (no silent fallback to the default)", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const artifactPath = await fakeArtifact(dir);
    const deps = await depsFor(dir, {});
    await deps.tokenStore.set("gdrive", { host: "gdrive", kind: "google-oauth", token: "default-rt", createdAt: 1 });
    const missingDeps = { ...deps, credentialAccount: "missing" };
    const req = await requestFor(dir, missingDeps, artifactPath);
    req.config = {};
    const auth = await gdriveProvider.authenticate(req);
    expect(auth.ok).toBe(false);
    expect(auth.message).toMatch(/isn't connected/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── authenticate: not-connected / invalid_grant / not-configured ────────────

test("authenticate reports not-connected when nothing is stored and no env var is set", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const artifactPath = await fakeArtifact(dir);
    const deps = await depsFor(dir, {});
    const req = await requestFor(dir, deps, artifactPath);
    req.config = {};
    const auth = await gdriveProvider.authenticate(req);
    expect(auth.ok).toBe(false);
    expect(auth.message).toMatch(/isn't connected/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("authenticate maps invalid_grant to the reconnect message", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const artifactPath = await fakeArtifact(dir);
    const deps = await depsFor(dir, {});
    await deps.tokenStore.set("gdrive", { host: "gdrive", kind: "google-oauth", token: "dead-rt", createdAt: 1 });
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).includes("oauth2.googleapis.com/token")) return jsonResponse({ error: "invalid_grant" }, 400);
      throw new Error("unexpected");
    }) as unknown as typeof fetch;
    deps.fetch = fetchImpl;
    const req = await requestFor(dir, deps, artifactPath);
    req.config = {};
    const auth = await gdriveProvider.authenticate(req);
    expect(auth.ok).toBe(false);
    expect(auth.message).toMatch(/expired or was revoked/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("authenticate fails with the not-configured message when no Google client is set up", async () => {
  delete process.env.GUTTERPRESS_GOOGLE_CLIENT_ID;
  delete process.env.GUTTERPRESS_GOOGLE_CLIENT_SECRET;
  const dir = await tempProject(MANIFEST);
  try {
    const artifactPath = await fakeArtifact(dir);
    const deps = await depsFor(dir, {});
    await deps.tokenStore.set("gdrive", { host: "gdrive", kind: "google-oauth", token: "rt", createdAt: 1 });
    const req = await requestFor(dir, deps, artifactPath);
    req.config = {};
    const auth = await gdriveProvider.authenticate(req);
    expect(auth.ok).toBe(false);
    expect(auth.message).toMatch(/isn't configured on this build/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── destinations (folder picker) ────────────────────────────────────────────

test("listDestinations maps Drive folders to PublishProduct with a Drive folder URL", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const artifactPath = await fakeArtifact(dir);
    const deps = await depsFor(dir, {});
    await deps.tokenStore.set("gdrive", { host: "gdrive", kind: "google-oauth", token: "rt", createdAt: 1 });
    const { fetchImpl } = fakeFetch({ folders: [{ id: "f1", name: "My Books" }] });
    deps.fetch = fetchImpl;
    const req = await requestFor(dir, deps, artifactPath);
    req.config = {};
    const dests = await gdriveProvider.listDestinations!(req);
    expect(dests).toEqual([{ id: "f1", title: "My Books", url: "https://drive.google.com/drive/folders/f1" }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createDestination creates a folder and returns it as a PublishProduct", async () => {
  const dir = await tempProject(MANIFEST);
  try {
    const artifactPath = await fakeArtifact(dir);
    const deps = await depsFor(dir, {});
    await deps.tokenStore.set("gdrive", { host: "gdrive", kind: "google-oauth", token: "rt", createdAt: 1 });
    const { fetchImpl, calls } = fakeFetch({ createdFolderId: "brand-new" });
    deps.fetch = fetchImpl;
    const req = await requestFor(dir, deps, artifactPath);
    req.config = {};
    const product = await gdriveProvider.createDestination!(req, "New Folder Name");
    expect(product).toEqual({ id: "brand-new", title: "New Folder Name", url: "https://drive.google.com/drive/folders/brand-new" });
    const createCall = calls.find((c) => c.method === "POST" && c.url.endsWith("/drive/v3/files?fields=id,name"));
    expect(JSON.parse(createCall!.body ?? "{}").name).toBe("New Folder Name");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── provider metadata ────────────────────────────────────────────────────────

test("gdrive provider declares an oauth connect kind and a folder destination picker", () => {
  expect(gdriveProvider.info.credential.connect).toBe("oauth");
  expect(gdriveProvider.info.credential.required).toBe(true);
  expect(gdriveProvider.info.destinations).toEqual({ label: "Folder", canCreate: true });
  expect(gdriveProvider.info.format).toBe("pdf");
});
