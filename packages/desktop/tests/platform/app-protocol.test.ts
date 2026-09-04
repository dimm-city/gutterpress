/**
 * Tests for electron/app-protocol.ts — the app:// static-asset handler that
 * replaced the adapter-node loopback server + proxy (SFE-P5d; see
 * app-protocol.ts's module header for the security-equivalence statement
 * this file proves).
 *
 * Replaces tests/platform/sveltekit-host.test.ts and
 * sveltekit-host-auth.test.ts (deleted with sveltekit-host.ts) — the bearer
 * token / proxy-request-builder tests those files pinned no longer apply
 * (there is no server left to authenticate a caller to); the equivalent
 * safety property in the new design is path-scoping, covered below.
 */
import { test, expect, afterEach, mock } from "bun:test";
import { electronMock } from "../support/electron-mock";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Same electron-mock convention as the deleted sveltekit-host-auth.test.ts:
// a real protocol.handle so registerAppProtocol's callback can be captured
// and invoked directly, the way Electron itself invokes it per app://
// request.
let capturedAppHandler: ((req: Request) => Promise<Response>) | null = null;
mock.module("electron", () =>
  electronMock({
    protocol: {
      handle: (scheme: string, cb: (req: Request) => Promise<Response>) => {
        if (scheme === "app") capturedAppHandler = cb;
      },
    },
  }),
);

const {
  resolveAssetPath,
  resolveBuildDir,
  looksLikeAssetRequest,
  mimeTypeFor,
  staticBuildLooksValid,
  registerAppProtocol,
} = await import("../../electron/app-protocol");

// ── resolveAssetPath: pure path-scoping (the surviving security boundary) ──

test("resolveAssetPath resolves a plain nested asset path inside buildDir", () => {
  expect(resolveAssetPath("/build", "/_app/immutable/chunks/abc.js")).toBe(
    path.join("/build", "_app", "immutable", "chunks", "abc.js"),
  );
});

test("resolveAssetPath resolves the root path to buildDir itself", () => {
  expect(resolveAssetPath("/build", "/")).toBe(path.resolve("/build"));
});

test("TRAVERSAL REFUSAL: a literal '..' segment is rejected", () => {
  expect(resolveAssetPath("/build", "/../../../etc/passwd")).toBeNull();
});

test("TRAVERSAL REFUSAL: a slash-encoded '..' segment is rejected (bypasses URL-level dot-segment normalization, decoded by us)", () => {
  // `new URL("app://local/foo%2f..%2f..%2fetc%2fpasswd").pathname` is
  // "/foo%2f..%2f..%2fetc%2fpasswd" verbatim — the WHATWG URL parser leaves
  // an encoded slash (%2f) alone rather than treating it as a path
  // separator, so its own dot-segment collapsing never sees the ".."
  // segments this decodes to. resolveAssetPath must still catch it after
  // its own decodeURIComponent.
  expect(resolveAssetPath("/build", "/foo%2f..%2f..%2fetc%2fpasswd")).toBeNull();
});

test("TRAVERSAL REFUSAL: a Windows drive-letter segment is rejected (would otherwise replace buildDir under path.win32.resolve)", () => {
  expect(resolveAssetPath("/build", "/C:/Windows/System32/config")).toBeNull();
});

test("TRAVERSAL REFUSAL: an embedded NUL byte is rejected", () => {
  expect(resolveAssetPath("/build", "/index.html%00.js")).toBeNull();
});

test("resolveAssetPath rejects malformed percent-encoding rather than throwing", () => {
  expect(resolveAssetPath("/build", "/%zz")).toBeNull();
});

// ── resolveAssetPath: the win32 containment-check pin ──────────────────────
//
// Every case above is caught by hasUnsafeSegment (layer 1) alone — none of
// them exercises the final lexical containment check at the end of
// resolveAssetPath. On Windows that containment check is the ONLY thing
// standing between a request and a backslash-shaped traversal: the `app:`
// scheme is registered as WHATWG-"standard" but non-special, so
// `new URL(...)` performs no backslash→slash conversion and no dot-segment
// collapsing on it, and hasUnsafeSegment's own split (on both `/` and `\`)
// only catches a segment that is EXACTLY `..` or contains a colon — it does
// not, and cannot, predict what `path.win32.resolve` will do with a
// decoded string it does not itself resolve. These two tests inject
// `path.win32` (via resolveAssetPath's third parameter) against a win32
// buildDir so this property is provable on any CI runner, not just Windows:
// deleting the containment check makes either one fail.
test("WIN32 CONTAINMENT: a backslash-traversal pathname with no unsafe '/'-segment still resolves outside buildDir and is rejected", () => {
  expect(
    resolveAssetPath(
      "C:\\app\\build",
      "/..\\..\\..\\Users\\me\\.ssh\\id_rsa",
      path.win32,
    ),
  ).toBeNull();
});

test("WIN32 CONTAINMENT: a %5c-encoded backslash-traversal pathname still resolves outside buildDir and is rejected", () => {
  expect(
    resolveAssetPath("C:\\app\\build", "/%5c..%5c..%5cWindows%5cwin.ini", path.win32),
  ).toBeNull();
});

// ── looksLikeAssetRequest / mimeTypeFor ─────────────────────────────────────

test("looksLikeAssetRequest is true for a filename with an extension", () => {
  expect(looksLikeAssetRequest("/_app/immutable/chunks/main.js")).toBe(true);
});

test("looksLikeAssetRequest is false for an extensionless client-side route", () => {
  expect(looksLikeAssetRequest("/settings")).toBe(false);
  expect(looksLikeAssetRequest("/")).toBe(false);
});

test("mimeTypeFor maps known extensions and falls back to a safe binary default", () => {
  expect(mimeTypeFor("main.js")).toBe("text/javascript; charset=utf-8");
  expect(mimeTypeFor("app.css")).toBe("text/css; charset=utf-8");
  expect(mimeTypeFor("index.html")).toBe("text/html; charset=utf-8");
  expect(mimeTypeFor("unknown.mystery")).toBe("application/octet-stream");
});

// ── resolveBuildDir: packaged vs dev ────────────────────────────────────────

test("resolveBuildDir (dev) joins hereDir/../../build", () => {
  expect(resolveBuildDir(false, "/app/out/main")).toBe(
    path.join("/app/out/main", "..", "..", "build"),
  );
});

test("resolveBuildDir (packaged) joins resourcesPath/app.asar/build", () => {
  const original = process.resourcesPath;
  (process as unknown as { resourcesPath: string }).resourcesPath = "/opt/Gutterpress/resources";
  try {
    expect(resolveBuildDir(true, "/anything")).toBe(
      path.join("/opt/Gutterpress/resources", "app.asar", "build"),
    );
  } finally {
    if (original === undefined) {
      delete (process as unknown as { resourcesPath?: string }).resourcesPath;
    } else {
      (process as unknown as { resourcesPath: string }).resourcesPath = original;
    }
  }
});

// ── staticBuildLooksValid ────────────────────────────────────────────────

let tmpDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
  tmpDirs = [];
});

async function makeFixtureBuildDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "gp-app-protocol-"));
  tmpDirs.push(dir);
  await writeFile(path.join(dir, "index.html"), "<!doctype html><html><body>shell</body></html>");
  await mkdir(path.join(dir, "_app", "immutable", "chunks"), { recursive: true });
  await writeFile(path.join(dir, "_app", "immutable", "chunks", "main.js"), "console.log('hi');");
  await writeFile(path.join(dir, "favicon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return dir;
}

test("staticBuildLooksValid is true when index.html exists", async () => {
  const dir = await makeFixtureBuildDir();
  expect(staticBuildLooksValid(dir)).toBe(true);
});

test("staticBuildLooksValid is false for a missing/unbuilt directory", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gp-app-protocol-empty-"));
  tmpDirs.push(dir);
  expect(staticBuildLooksValid(dir)).toBe(false);
});

// ── registerAppProtocol: full request pipeline ──────────────────────────────

afterEach(() => {
  capturedAppHandler = null;
});

test("serves an existing asset with its real bytes and correct Content-Type", async () => {
  const dir = await makeFixtureBuildDir();
  registerAppProtocol(dir);
  expect(capturedAppHandler).not.toBeNull();

  const res = await capturedAppHandler!(new Request("app://local/_app/immutable/chunks/main.js"));
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
  expect(await res.text()).toBe("console.log('hi');");
});

test("serves index.html for the root path", async () => {
  const dir = await makeFixtureBuildDir();
  registerAppProtocol(dir);
  const res = await capturedAppHandler!(new Request("app://local/"));
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("shell");
});

test("SPA FALLBACK: an extensionless client-side route with no matching file serves index.html (200), not 404", () => {
  return (async () => {
    const dir = await makeFixtureBuildDir();
    registerAppProtocol(dir);
    const res = await capturedAppHandler!(new Request("app://local/settings"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toContain("shell");
  })();
});

test("a missing asset-shaped path (has an extension) 404s rather than falling back to index.html", async () => {
  const dir = await makeFixtureBuildDir();
  registerAppProtocol(dir);
  const res = await capturedAppHandler!(new Request("app://local/does-not-exist.js"));
  expect(res.status).toBe(404);
});

test("FINDING equivalent to the old #2b repro: app:// rejects a non-'local' host (app://evil/...) with 404", async () => {
  const dir = await makeFixtureBuildDir();
  registerAppProtocol(dir);
  const res = await capturedAppHandler!(new Request("app://evil/index.html"));
  expect(res.status).toBe(404);
});

test("TRAVERSAL REFUSAL through the full app:// pipeline: a slash-encoded '..' request never escapes buildDir", async () => {
  const dir = await makeFixtureBuildDir();
  registerAppProtocol(dir);
  // Encodes the traversal slashes so the WHATWG URL parser's own
  // dot-segment collapsing (which only fires on literal "/"-delimited
  // segments) does not neutralize it before app-protocol.ts ever sees the
  // request — this exercises resolveAssetPath's post-decode segment check
  // end to end, through the real protocol handler, not just the pure
  // function in isolation.
  const res = await capturedAppHandler!(
    new Request("app://local/foo%2f..%2f..%2f..%2f..%2fetc%2fpasswd"),
  );
  expect(res.status).toBe(404);
});

test("TRAVERSAL REFUSAL through the full app:// pipeline: a literal '../' request resolves within buildDir, never the real filesystem root", async () => {
  const dir = await makeFixtureBuildDir();
  registerAppProtocol(dir);
  // The WHATWG URL parser itself collapses this to pathname "/etc/passwd"
  // before app-protocol.ts ever sees it (see the module header). Because
  // resolveAssetPath always treats the pathname as RELATIVE to buildDir, the
  // lookup is for buildDir/etc/passwd — not the real OS /etc/passwd (which
  // does exist on the host running this test, and is never read). buildDir
  // has no such fixture and "passwd" has no extension, so this lands on the
  // ordinary SPA-fallback path (200, index.html shell) — proving the request
  // stayed confined to buildDir rather than proving it 404s (an
  // extensionless not-found path is indistinguishable from a legitimate
  // client-side route, by design — see looksLikeAssetRequest).
  const res = await capturedAppHandler!(new Request("app://local/../../../../etc/passwd"));
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  const body = await res.text();
  expect(body).toContain("shell");
  expect(body).not.toMatch(/root:.*:0:0:/);
});
