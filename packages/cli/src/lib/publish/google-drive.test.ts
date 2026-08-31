import { test, expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  driveAbout,
  ensureFolder,
  escapeDriveQueryValue,
  findFileInFolder,
  getFolderById,
  listFolders,
  refreshAccessToken,
  resumableUpload,
  RESUMABLE_CHUNK_SIZE,
} from "./google-drive";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

// ── escapeDriveQueryValue ────────────────────────────────────────────────────

test("escapeDriveQueryValue escapes single quotes and backslashes for Drive's q grammar", () => {
  expect(escapeDriveQueryValue("Gutterpress")).toBe("Gutterpress");
  expect(escapeDriveQueryValue("O'Brien's Book")).toBe("O\\'Brien\\'s Book");
  expect(escapeDriveQueryValue("back\\slash")).toBe("back\\\\slash");
  // A name that looks like it could break out of the literal and inject
  // query syntax must come back with every quote escaped, not passed
  // through raw — i.e. every `'` in the input is preceded by a `\` in the
  // output, so a query built as `name='<escaped>'` cannot terminate early.
  const hostile = "x' or trashed=false or name='y";
  const escaped = escapeDriveQueryValue(hostile);
  expect(escaped).toBe("x\\' or trashed=false or name=\\'y");
  expect((escaped.match(/(?<!\\)'/g) ?? []).length).toBe(0); // no un-escaped quote survives
});

// ── refreshAccessToken ───────────────────────────────────────────────────────

test("refreshAccessToken mints a new access token from the refresh token", async () => {
  const requests: Array<{ url: string; body: Record<string, string> }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
    requests.push({ url: u, body });
    return jsonResponse({ access_token: "new-access-token", expires_in: 3599 });
  }) as unknown as typeof fetch;

  const result = await refreshAccessToken(fetchImpl, {
    clientId: "cid",
    clientSecret: "csecret",
    refreshToken: "the-refresh-token",
  });
  expect(result.accessToken).toBe("new-access-token");
  expect(result.expiresIn).toBe(3599);
  expect(requests[0]!.url).toBe("https://oauth2.googleapis.com/token");
  expect(requests[0]!.body.grant_type).toBe("refresh_token");
  expect(requests[0]!.body.refresh_token).toBe("the-refresh-token");
  expect(requests[0]!.body.client_secret).toBe("csecret");
});

test("refreshAccessToken maps invalid_grant to the D4 reconnect message", async () => {
  const fetchImpl = (async () =>
    jsonResponse({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400)) as unknown as typeof fetch;
  await expect(
    refreshAccessToken(fetchImpl, { clientId: "cid", clientSecret: "csecret", refreshToken: "dead-token" }),
  ).rejects.toThrow(/expired or was revoked.*connect google drive again/i);
});

test("refreshAccessToken never echoes the refresh token or client secret in its error", async () => {
  const fetchImpl = (async () => jsonResponse({ error: "invalid_grant" }, 400)) as unknown as typeof fetch;
  try {
    await refreshAccessToken(fetchImpl, {
      clientId: "cid",
      clientSecret: "SUPER-SECRET-VALUE",
      refreshToken: "SENSITIVE-REFRESH-TOKEN",
    });
    throw new Error("expected refreshAccessToken to throw");
  } catch (e) {
    const msg = (e as Error).message;
    expect(msg).not.toContain("SUPER-SECRET-VALUE");
    expect(msg).not.toContain("SENSITIVE-REFRESH-TOKEN");
  }
});

test("refreshAccessToken maps a non-invalid_grant failure to a friendly HTTP error", async () => {
  const fetchImpl = (async () => jsonResponse({ error: "invalid_client" }, 401)) as unknown as typeof fetch;
  await expect(
    refreshAccessToken(fetchImpl, { clientId: "bad", clientSecret: "bad", refreshToken: "rt" }),
  ).rejects.toThrow(/HTTP 401/);
});

// ── driveAbout ───────────────────────────────────────────────────────────────

test("driveAbout reports email and a computed free-bytes quota", async () => {
  const fetchImpl = (async (url: string | URL | Request) => {
    expect(String(url)).toContain("www.googleapis.com/drive/v3/about");
    return jsonResponse({
      user: { emailAddress: "writer@example.com" },
      storageQuota: { limit: "1000", usage: "400" },
    });
  }) as unknown as typeof fetch;
  const about = await driveAbout(fetchImpl, "at");
  expect(about.email).toBe("writer@example.com");
  expect(about.quota).toEqual({ limitBytes: 1000, usageBytes: 400, freeBytes: 600 });
});

test("driveAbout reports unlimited (null) quota for a Workspace account with no cap", async () => {
  const fetchImpl = (async () =>
    jsonResponse({ user: { emailAddress: "w@x.com" }, storageQuota: { usage: "5000" } })) as unknown as typeof fetch;
  const about = await driveAbout(fetchImpl, "at");
  expect(about.quota).toEqual({ limitBytes: null, usageBytes: 5000, freeBytes: null });
});

// ── folders ──────────────────────────────────────────────────────────────────

test("listFolders queries app-visible, non-trashed folders only", async () => {
  let capturedUrl = "";
  const fetchImpl = (async (url: string | URL | Request) => {
    capturedUrl = String(url);
    return jsonResponse({ files: [{ id: "f1", name: "Gutterpress" }] });
  }) as unknown as typeof fetch;
  const folders = await listFolders(fetchImpl, "at");
  expect(folders).toEqual([{ id: "f1", name: "Gutterpress" }]);
  expect(capturedUrl).toContain(encodeURIComponent("application/vnd.google-apps.folder"));
  expect(capturedUrl).toContain(encodeURIComponent("trashed=false"));
});

test("getFolderById returns null for a trashed or missing folder (D5's 'pick again' path)", async () => {
  const fetchImpl = (async () => jsonResponse({}, 404)) as unknown as typeof fetch;
  expect(await getFolderById(fetchImpl, "at", "gone")).toBeNull();

  const trashedFetch = (async () =>
    jsonResponse({ id: "f1", name: "X", trashed: true, mimeType: "application/vnd.google-apps.folder" })) as unknown as typeof fetch;
  expect(await getFolderById(trashedFetch, "at", "f1")).toBeNull();
});

test("getFolderById returns the folder when it exists and isn't trashed", async () => {
  const fetchImpl = (async () =>
    jsonResponse({ id: "f1", name: "My Books", trashed: false, mimeType: "application/vnd.google-apps.folder" })) as unknown as typeof fetch;
  expect(await getFolderById(fetchImpl, "at", "f1")).toEqual({ id: "f1", name: "My Books" });
});

test("ensureFolder finds an existing folder by name before creating one", async () => {
  let createCalled = false;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === "POST" && !u.includes("q=")) {
      createCalled = true;
      return jsonResponse({ id: "new", name: "Gutterpress" });
    }
    return jsonResponse({ files: [{ id: "existing", name: "Gutterpress" }] });
  }) as unknown as typeof fetch;
  const folder = await ensureFolder(fetchImpl, "at", "Gutterpress");
  expect(folder).toEqual({ id: "existing", name: "Gutterpress" });
  expect(createCalled).toBe(false);
});

test("ensureFolder creates the folder at My Drive root when none matches by name", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(init?.method ?? "GET"));
    if (init?.method === "POST") return jsonResponse({ id: "created", name: "Gutterpress" });
    return jsonResponse({ files: [] });
  }) as unknown as typeof fetch;
  const folder = await ensureFolder(fetchImpl, "at", "Gutterpress");
  expect(folder).toEqual({ id: "created", name: "Gutterpress" });
  expect(calls).toEqual(["GET", "POST"]);
});

// ── findFileInFolder ─────────────────────────────────────────────────────────

test("findFileInFolder quote-escapes a hostile file name in the q query", async () => {
  let capturedUrl = "";
  const fetchImpl = (async (url: string | URL | Request) => {
    capturedUrl = String(url);
    return jsonResponse({ files: [] });
  }) as unknown as typeof fetch;
  const hostile = "book' or '1'='1";
  await findFileInFolder(fetchImpl, "at", "folder-id", hostile);
  const decoded = decodeURIComponent(capturedUrl);
  // The escaped apostrophes must survive, and the raw injection shape must not
  // appear unescaped in the transmitted query.
  expect(decoded).toContain("name='book\\' or \\'1\\'=\\'1'");
});

test("findFileInFolder returns null when nothing matches (create path)", async () => {
  const fetchImpl = (async () => jsonResponse({ files: [] })) as unknown as typeof fetch;
  expect(await findFileInFolder(fetchImpl, "at", "f1", "book.pdf")).toBeNull();
});

test("findFileInFolder returns the match when found (update path, D6)", async () => {
  const fetchImpl = (async () =>
    jsonResponse({ files: [{ id: "file1", name: "book.pdf", webViewLink: "https://drive.google.com/file/d/file1/view" }] })) as unknown as typeof fetch;
  const found = await findFileInFolder(fetchImpl, "at", "f1", "book.pdf");
  expect(found?.id).toBe("file1");
});

// ── resumableUpload ──────────────────────────────────────────────────────────

async function tempFile(sizeBytes: number): Promise<{ dir: string; filePath: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-gdrive-"));
  const filePath = path.join(dir, "book.pdf");
  const buf = Buffer.alloc(sizeBytes);
  // Distinguishable content so a chunking bug (wrong offset) is detectable
  // if we ever add a byte-for-byte reconstruction assertion.
  for (let i = 0; i < buf.length; i++) buf[i] = i % 256;
  await writeFile(filePath, buf);
  return { dir, filePath };
}

test("resumableUpload creates a new file (POST, no fileId) and sends parents on the create", async () => {
  const { dir, filePath } = await tempFile(1024);
  try {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      requests.push({ url: u, method, body: init?.body });
      if (u.includes("uploadType=resumable")) {
        expect(method).toBe("POST");
        return new Response(null, { status: 200, headers: { Location: "https://upload.example/session-1" } });
      }
      if (u === "https://upload.example/session-1") {
        return jsonResponse({ id: "new-file", name: "book.pdf", webViewLink: "https://drive.google.com/file/d/new-file/view" }, 200);
      }
      throw new Error(`unexpected ${u}`);
    }) as unknown as typeof fetch;

    const file = await resumableUpload(fetchImpl, "at", {
      name: "book.pdf",
      parentFolderId: "folder-1",
      filePath,
      totalBytes: 1024,
    });
    expect(file.id).toBe("new-file");
    const start = requests[0]!;
    expect(String(start.body)).toContain('"parents":["folder-1"]');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resumableUpload updates an existing file in place (PATCH, fileId set)", async () => {
  const { dir, filePath } = await tempFile(2048);
  try {
    let sawPatch = false;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("uploadType=resumable")) {
        sawPatch = init?.method === "PATCH";
        expect(u).toContain("/files/existing-id");
        return new Response(null, { status: 200, headers: { Location: "https://upload.example/session-2" } });
      }
      return jsonResponse({ id: "existing-id", name: "book.pdf" });
    }) as unknown as typeof fetch;
    const file = await resumableUpload(fetchImpl, "at", {
      fileId: "existing-id",
      name: "book.pdf",
      filePath,
      totalBytes: 2048,
    });
    expect(sawPatch).toBe(true);
    expect(file.id).toBe("existing-id");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resumableUpload follows a simulated 308 + Range resume across multiple chunks", async () => {
  const totalBytes = RESUMABLE_CHUNK_SIZE * 2 + 100; // forces 3 chunks at the real chunk size
  // Use a small override chunk size so the test doesn't need to write tens of
  // MB — the resume LOGIC is what's under test, not the real chunk size.
  const chunkSize = 300;
  const total = chunkSize * 3; // exactly 3 chunks
  const { dir, filePath } = await tempFile(total);
  try {
    const puts: Array<{ range: string }> = [];
    let sessionStarted = false;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("uploadType=resumable")) {
        sessionStarted = true;
        return new Response(null, { status: 200, headers: { Location: "https://upload.example/session-3" } });
      }
      if (u === "https://upload.example/session-3" && init?.method === "PUT") {
        const range = String((init.headers as Record<string, string>)["Content-Range"]);
        puts.push({ range });
        // First two chunks: simulate Drive returning 308 with a Range header
        // confirming receipt (the resume path). Last chunk: 200 + the file.
        if (puts.length < 3) {
          const end = Number(range.split(" ")[1]!.split("-")[1]!.split("/")[0]);
          return new Response(null, { status: 308, headers: { Range: `bytes=0-${end}` } });
        }
        return jsonResponse({ id: "f", name: "book.pdf", webViewLink: "https://drive.google.com/file/d/f/view" });
      }
      throw new Error(`unexpected ${u} ${init?.method}`);
    }) as unknown as typeof fetch;

    const progressCalls: Array<[number, number]> = [];
    const file = await resumableUpload(fetchImpl, "at", {
      name: "book.pdf",
      parentFolderId: "f1",
      filePath,
      totalBytes: total,
      chunkSize,
      onProgress: (uploaded, tot) => progressCalls.push([uploaded, tot]),
    });

    expect(sessionStarted).toBe(true);
    expect(puts.length).toBe(3); // 3 chunks: two 308-resumed, one final 200
    expect(file.id).toBe("f");
    expect(progressCalls.at(-1)).toEqual([total, total]);
    // Each successive PUT started exactly where the previous 308 said to
    // resume from (offset monotonically increases by chunkSize).
    expect(puts[0]!.range).toContain(`bytes 0-${chunkSize - 1}/${total}`);
    expect(puts[1]!.range).toContain(`bytes ${chunkSize}-${chunkSize * 2 - 1}/${total}`);
    expect(puts[2]!.range).toContain(`bytes ${chunkSize * 2}-${total - 1}/${total}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resumableUpload retries a chunk on 5xx up to the retry limit, honoring Retry-After, then succeeds", async () => {
  const chunkSize = 500;
  const total = chunkSize; // one chunk only, so retry behavior is isolated
  const { dir, filePath } = await tempFile(total);
  try {
    let attempts = 0;
    const sleeps: number[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("uploadType=resumable")) {
        return new Response(null, { status: 200, headers: { Location: "https://upload.example/session-4" } });
      }
      if (init?.method === "PUT") {
        attempts++;
        if (attempts === 1) return new Response("busy", { status: 503, headers: { "Retry-After": "1" } });
        if (attempts === 2) return new Response("rate limited", { status: 429 });
        return jsonResponse({ id: "f", name: "book.pdf" });
      }
      throw new Error("unexpected");
    }) as unknown as typeof fetch;

    const file = await resumableUpload(fetchImpl, "at", {
      name: "book.pdf",
      parentFolderId: "f1",
      filePath,
      totalBytes: total,
      chunkSize,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(file.id).toBe("f");
    expect(attempts).toBe(3);
    // First retry honors Retry-After (1s = 1000ms); second is exponential backoff.
    expect(sleeps[0]).toBe(1000);
    expect(sleeps.length).toBe(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resumableUpload gives up after exceeding the retry limit and throws a friendly error", async () => {
  const chunkSize = 200;
  const total = chunkSize;
  const { dir, filePath } = await tempFile(total);
  try {
    let attempts = 0;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("uploadType=resumable")) {
        return new Response(null, { status: 200, headers: { Location: "https://upload.example/session-5" } });
      }
      attempts++;
      return new Response("server error", { status: 500 });
    }) as unknown as typeof fetch;

    await expect(
      resumableUpload(fetchImpl, "at", {
        name: "book.pdf",
        parentFolderId: "f1",
        filePath,
        totalBytes: total,
        chunkSize,
        maxRetriesPerChunk: 2,
        sleepImpl: async () => {},
      }),
    ).rejects.toThrow(/HTTP 500/);
    expect(attempts).toBe(3); // 1 initial + 2 retries
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resumableUpload never loads the whole file into memory — chunks are sized to chunkSize, not totalBytes", async () => {
  // A cheap proxy for "reads incrementally": each observed PUT body length is
  // bounded by chunkSize, even though the source file is many times larger.
  const chunkSize = 1000;
  const total = chunkSize * 5;
  const { dir, filePath } = await tempFile(total);
  try {
    const bodyLengths: number[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("uploadType=resumable")) {
        return new Response(null, { status: 200, headers: { Location: "https://upload.example/session-6" } });
      }
      const body = init?.body as Buffer;
      bodyLengths.push(body.length);
      if (bodyLengths.length < 5) {
        return new Response(null, { status: 308, headers: { Range: `bytes=0-${bodyLengths.length * chunkSize - 1}` } });
      }
      return jsonResponse({ id: "f", name: "book.pdf" });
    }) as unknown as typeof fetch;

    await resumableUpload(fetchImpl, "at", {
      name: "book.pdf",
      parentFolderId: "f1",
      filePath,
      totalBytes: total,
      chunkSize,
    });
    expect(bodyLengths.every((len) => len <= chunkSize)).toBe(true);
    expect(bodyLengths.length).toBe(5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
