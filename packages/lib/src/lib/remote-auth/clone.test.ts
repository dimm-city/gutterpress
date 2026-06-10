/**
 * cloneRepository tests (#15, ADR 0006 D2) — including the SHALLOW-CLONE SPIKE.
 *
 * These tests run against a REAL git smart-HTTP wire-protocol exchange: a tiny
 * in-test `node:http` server implements `git-upload-pack` (ref advertisement +
 * NAK + side-band packfile, with `shallow`/`deepen` support) on top of a local
 * fixture repository, and `cloneRepository` clones from it through
 * isomorphic-git's real node HTTP client. No transport mocking.
 */
import { test, expect } from "bun:test";
import * as fs from "node:fs";
import { mkdtemp, rm, writeFile, readFile, stat } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import git from "isomorphic-git";

import {
  cloneRepository,
  readProjectProvenance,
  provenancePath,
  sanitizeCloneFolderName,
} from "./clone";
import { FileTokenStore, type HostCredential } from "./token-store";
import { detectProjectSource } from "../project-source";
import { providerFor } from "../source-provider";

// ── pkt-line helpers ──────────────────────────────────────────────────────────

function pkt(data: string | Buffer): Buffer {
  const body = typeof data === "string" ? Buffer.from(data) : data;
  return Buffer.concat([
    Buffer.from((body.length + 4).toString(16).padStart(4, "0")),
    body,
  ]);
}
const FLUSH = Buffer.from("0000");

function parsePktLines(body: Buffer): string[] {
  const lines: string[] = [];
  let i = 0;
  while (i + 4 <= body.length) {
    const len = parseInt(body.subarray(i, i + 4).toString(), 16);
    if (len === 0) {
      lines.push("");
      i += 4;
      continue;
    }
    lines.push(body.subarray(i + 4, i + len).toString().replace(/\n$/, ""));
    i += len;
  }
  return lines;
}

// ── Fixture repo + object walking ─────────────────────────────────────────────

async function createFixtureRepo(dir: string): Promise<{ head: string; first: string }> {
  await git.init({ fs, dir, defaultBranch: "main" });
  await writeFile(path.join(dir, "manifest.yaml"), "title: Fixture Book\n");
  await writeFile(path.join(dir, "chapter-01.md"), "# One\n\nFirst draft.\n");
  await git.add({ fs, dir, filepath: "manifest.yaml" });
  await git.add({ fs, dir, filepath: "chapter-01.md" });
  const author = { name: "Fixture", email: "fixture@test.local" };
  const first = await git.commit({ fs, dir, message: "first", author });
  await writeFile(path.join(dir, "chapter-01.md"), "# One\n\nSecond draft.\n");
  await git.add({ fs, dir, filepath: "chapter-01.md" });
  const head = await git.commit({ fs, dir, message: "second", author });
  return { head, first };
}

/** Collect commit+tree+blob oids reachable from `commit`, to `depth` commits. */
async function collectOids(dir: string, commit: string, depth: number): Promise<string[]> {
  const oids = new Set<string>();
  async function walkTree(treeOid: string): Promise<void> {
    if (oids.has(treeOid)) return;
    oids.add(treeOid);
    const { tree } = await git.readTree({ fs, dir, oid: treeOid });
    for (const entry of tree) {
      if (entry.type === "tree") await walkTree(entry.oid);
      else oids.add(entry.oid);
    }
  }
  let current: string | undefined = commit;
  for (let d = 0; d < depth && current; d++) {
    oids.add(current);
    const { commit: c } = await git.readCommit({ fs, dir, oid: current });
    await walkTree(c.tree);
    current = c.parent[0];
  }
  return [...oids];
}

// ── Minimal git smart-HTTP server (upload-pack only) ─────────────────────────

interface GitServer {
  url: string;
  /** Authorization headers the server saw, in order. */
  authHeaders: Array<string | undefined>;
  close(): Promise<void>;
}

async function startGitServer(
  repoDir: string,
  opts: { requireAuth?: { username: string; password: string } } = {},
): Promise<GitServer> {
  const authHeaders: Array<string | undefined> = [];
  const expectedAuth = opts.requireAuth
    ? "Basic " +
      Buffer.from(`${opts.requireAuth.username}:${opts.requireAuth.password}`).toString("base64")
    : null;

  const server = http.createServer((req, res) => {
    void (async () => {
      authHeaders.push(req.headers.authorization);
      if (expectedAuth && req.headers.authorization !== expectedAuth) {
        res.writeHead(401, { "WWW-Authenticate": 'Basic realm="git"' });
        res.end("auth required");
        return;
      }
      const head = await git.resolveRef({ fs, dir: repoDir, ref: "HEAD" });
      const branch = (await git.currentBranch({ fs, dir: repoDir })) ?? "main";

      if (req.method === "GET" && req.url?.includes("/info/refs")) {
        res.writeHead(200, {
          "content-type": "application/x-git-upload-pack-advertisement",
        });
        res.end(
          Buffer.concat([
            pkt("# service=git-upload-pack\n"),
            FLUSH,
            pkt(
              `${head} HEAD\0side-band-64k shallow symref=HEAD:refs/heads/${branch} agent=git/test\n`,
            ),
            pkt(`${head} refs/heads/${branch}\n`),
            FLUSH,
          ]),
        );
        return;
      }

      if (req.method === "POST" && req.url?.endsWith("/git-upload-pack")) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const lines = parsePktLines(Buffer.concat(chunks));
        const want = lines
          .find((l) => l.startsWith("want "))!
          .split(" ")[1]!;
        const deepen = lines.find((l) => l.startsWith("deepen "));
        const depth = deepen ? parseInt(deepen.split(" ")[1]!, 10) : Infinity;

        const oids = await collectOids(repoDir, want, depth);
        const { packfile } = await git.packObjects({ fs, dir: repoDir, oids });

        const parts: Buffer[] = [];
        if (deepen) {
          // Shallow section: the boundary commit(s) the client must record in
          // .git/shallow, terminated by a flush-pkt.
          const { commit } = await git.readCommit({ fs, dir: repoDir, oid: want });
          if (commit.parent.length > 0 && depth === 1) {
            parts.push(pkt(`shallow ${want}\n`));
          }
          parts.push(FLUSH);
        }
        parts.push(pkt("NAK\n"));
        // Packfile on side-band channel 1 (we advertised side-band-64k).
        const pack = Buffer.from(packfile!);
        for (let i = 0; i < pack.length; i += 65515) {
          parts.push(
            pkt(Buffer.concat([Buffer.from([0x01]), pack.subarray(i, i + 65515)])),
          );
        }
        parts.push(FLUSH);
        res.writeHead(200, {
          "content-type": "application/x-git-upload-pack-result",
        });
        res.end(Buffer.concat(parts));
        return;
      }

      res.writeHead(404);
      res.end("not found");
    })().catch((e) => {
      res.writeHead(500);
      res.end(String(e));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}/fixture.git`,
    authHeaders,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

const CRED: HostCredential = {
  host: "127.0.0.1",
  kind: "github-app",
  token: "ghu_clone_tok",
  createdAt: 0,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

test("full clone over smart HTTP classifies as local-git-folder and history works", async () => {
  const repoDir = await tempDir("pmd-clone-src-");
  const workDir = await tempDir("pmd-clone-dst-");
  const dest = path.join(workDir, "book");
  let server: GitServer | null = null;
  try {
    await createFixtureRepo(repoDir);
    server = await startGitServer(repoDir);

    const progress: string[] = [];
    const result = await cloneRepository({
      url: server.url,
      dir: dest,
      credential: CRED,
      provenance: { provider: "github", owner: "octocat", repo: "book", installationId: "42" },
      onProgress: (e) => progress.push(e.phase),
    });
    expect(result.projectDir).toBe(dest);
    expect(result.branch).toBe("main");

    // Files materialized.
    expect(await readFile(path.join(dest, "chapter-01.md"), "utf8")).toContain(
      "Second draft",
    );

    // The clone classifies via the EXISTING detector as a git folder w/ remote.
    const source = await detectProjectSource(dest);
    expect(source.type).toBe("local-git-folder");
    if (source.type === "local-git-folder") {
      expect(source.hasRemote).toBe(true);
      expect(source.remoteUrl).toBe(server.url);
      expect(source.branch).toBe("main");
    }

    // Existing source-provider ops work unchanged on the clone.
    const provider = providerFor(source);
    const history = await provider.listHistory(dest);
    expect(history.map((h) => h.message)).toEqual(["second", "first"]);
    await writeFile(path.join(dest, "chapter-02.md"), "# Two\n");
    const snap = await provider.snapshot({ projectDir: dest, message: "Added ch2" });
    expect(snap.id).toMatch(/^[0-9a-f]{40}$/);

    // Provenance sidecar landed inside .git/ (untracked by definition).
    expect((await readProjectProvenance(dest))?.owner).toBe("octocat");
    expect((await stat(provenancePath(dest))).isFile()).toBe(true);

    // Progress events fired.
    expect(progress.length).toBeGreaterThan(0);
  } finally {
    await server?.close();
    await rm(repoDir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  }
}, 20_000);

test("SHALLOW CLONE SPIKE: depth:1 clones; listHistory + snapshot still work but history is truncated", async () => {
  const repoDir = await tempDir("pmd-shallow-src-");
  const workDir = await tempDir("pmd-shallow-dst-");
  const dest = path.join(workDir, "book");
  let server: GitServer | null = null;
  try {
    const { head } = await createFixtureRepo(repoDir);
    server = await startGitServer(repoDir);

    await cloneRepository({ url: server.url, dir: dest, credential: CRED, depth: 1 });

    // .git/shallow records the boundary.
    const shallow = await readFile(path.join(dest, ".git", "shallow"), "utf8");
    expect(shallow.trim()).toBe(head);

    const source = await detectProjectSource(dest);
    expect(source.type).toBe("local-git-folder");

    // SPIKE FINDING (drives the depth default in clone.ts): the provider ops
    // do not crash on a shallow repo, but listHistory SILENTLY truncates at
    // the shallow boundary — the author would see one commit and no hint that
    // more history exists. Hence full clone stays the default until
    // deepen-on-demand exists.
    const provider = providerFor(source);
    const history = await provider.listHistory(dest);
    expect(history.length).toBe(1);
    expect(history[0]!.message).toBe("second");

    await writeFile(path.join(dest, "chapter-02.md"), "# Two\n");
    const snap = await provider.snapshot({ projectDir: dest, message: "Added ch2" });
    expect(snap.id).toMatch(/^[0-9a-f]{40}$/);
    expect((await provider.listHistory(dest)).length).toBe(2);
  } finally {
    await server?.close();
    await rm(repoDir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  }
}, 20_000);

test("transport sends the credential as Basic auth (github-app → x-access-token)", async () => {
  const repoDir = await tempDir("pmd-auth-src-");
  const workDir = await tempDir("pmd-auth-dst-");
  const dest = path.join(workDir, "book");
  let server: GitServer | null = null;
  try {
    await createFixtureRepo(repoDir);
    server = await startGitServer(repoDir, {
      requireAuth: { username: "x-access-token", password: "ghu_clone_tok" },
    });
    await cloneRepository({ url: server.url, dir: dest, credential: CRED });
    expect(await detectProjectSource(dest).then((s) => s.type)).toBe(
      "local-git-folder",
    );
    // At least one authenticated request reached the server.
    expect(server.authHeaders.some((h) => h?.startsWith("Basic "))).toBe(true);
  } finally {
    await server?.close();
    await rm(repoDir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  }
}, 20_000);

test("token embedded in the clone URL is stripped, used for auth, and migrated to the store (D7)", async () => {
  const repoDir = await tempDir("pmd-urlauth-src-");
  const workDir = await tempDir("pmd-urlauth-dst-");
  const dest = path.join(workDir, "book");
  const store = new FileTokenStore(path.join(workDir, "credentials.json"));
  let server: GitServer | null = null;
  try {
    await createFixtureRepo(repoDir);
    server = await startGitServer(repoDir, {
      requireAuth: { username: "alice", password: "s3cret" },
    });
    const u = new URL(server.url);
    const urlWithCred = `http://alice:s3cret@${u.host}${u.pathname}`;

    await cloneRepository({ url: urlWithCred, dir: dest, tokenStore: store });

    // Credential migrated into the store, keyed by host.
    const stored = await store.get(u.hostname);
    expect(stored?.token).toBe("s3cret");
    expect(stored?.username).toBe("alice");

    // The recorded remote URL contains NO credentials.
    const source = await detectProjectSource(dest);
    if (source.type === "local-git-folder") {
      expect(source.remoteUrl).not.toContain("s3cret");
      expect(source.remoteUrl).not.toContain("alice:");
    }
    const gitConfig = await readFile(path.join(dest, ".git", "config"), "utf8");
    expect(gitConfig).not.toContain("s3cret");
  } finally {
    await server?.close();
    await rm(repoDir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  }
}, 20_000);

test("failed clone removes the partially-created directory; a retry then succeeds", async () => {
  const repoDir = await tempDir("pmd-cleanup-src-");
  const workDir = await tempDir("pmd-cleanup-dst-");
  const dest = path.join(workDir, "book");
  let server: GitServer | null = null;
  try {
    await createFixtureRepo(repoDir);
    server = await startGitServer(repoDir, {
      requireAuth: { username: "x-access-token", password: "ghu_clone_tok" },
    });

    // Wrong token → 401 mid-flight → friendly error AND no leftover dir.
    const badCred: HostCredential = { ...CRED, token: "wrong_token" };
    await expect(
      cloneRepository({ url: server.url, dir: dest, credential: badCred }),
    ).rejects.toThrow(/reconnect github/i);
    expect(fs.existsSync(dest)).toBe(false);

    // Retry with the correct credential succeeds into the same path.
    const result = await cloneRepository({ url: server.url, dir: dest, credential: CRED });
    expect(result.projectDir).toBe(dest);
    expect(await readFile(path.join(dest, "chapter-01.md"), "utf8")).toContain(
      "Second draft",
    );
  } finally {
    await server?.close();
    await rm(repoDir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  }
}, 20_000);

test("failed clone into a pre-existing (empty) folder keeps the user's folder", async () => {
  const repoDir = await tempDir("pmd-keepdir-src-");
  const workDir = await tempDir("pmd-keepdir-dst-");
  // workDir itself pre-exists (mkdtemp created it) and is empty.
  let server: GitServer | null = null;
  try {
    await createFixtureRepo(repoDir);
    server = await startGitServer(repoDir, {
      requireAuth: { username: "x-access-token", password: "ghu_clone_tok" },
    });
    const badCred: HostCredential = { ...CRED, token: "wrong_token" };
    await expect(
      cloneRepository({ url: server.url, dir: workDir, credential: badCred }),
    ).rejects.toThrow(/reconnect github/i);
    // The directory existed before the clone — it must NOT be deleted.
    expect(fs.existsSync(workDir)).toBe(true);
  } finally {
    await server?.close();
    await rm(repoDir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  }
}, 20_000);

test("sanitizeCloneFolderName keeps the project dir under the chosen parent", () => {
  const parentDir = path.resolve("/safe/parent");
  for (const input of ["../../../etc", ".hidden", "a/b", "..\\..\\evil", "/abs/path"]) {
    const name = sanitizeCloneFolderName(input);
    // A single path segment — no separators, no leading dots survive.
    expect(name.includes("/")).toBe(false);
    expect(name.includes("\\")).toBe(false);
    expect(name.startsWith(".")).toBe(false);
    const projectDir = path.join(parentDir, name);
    expect(path.resolve(projectDir).startsWith(parentDir + path.sep)).toBe(true);
    expect(path.dirname(path.resolve(projectDir))).toBe(parentDir);
  }
  // Inputs that sanitize to nothing must come back empty (callers reject).
  expect(sanitizeCloneFolderName("...")).toBe("");
  expect(sanitizeCloneFolderName("   ")).toBe("");
});

test("clone into a non-empty folder fails with a friendly message", async () => {
  const workDir = await tempDir("pmd-nonempty-");
  try {
    await writeFile(path.join(workDir, "existing.txt"), "x");
    await expect(
      cloneRepository({ url: "https://example.com/o/r.git", dir: workDir }),
    ).rejects.toThrow(/already has files/i);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("SSH URLs are rejected with author-friendly guidance (ADR 0006 D6)", async () => {
  const workDir = await tempDir("pmd-ssh-");
  try {
    await expect(
      cloneRepository({
        url: "git@github.com:octocat/book.git",
        dir: path.join(workDir, "book"),
      }),
    ).rejects.toThrow(/not a valid web url|https/i);
    await expect(
      cloneRepository({
        url: "ssh://git@github.com/octocat/book.git",
        dir: path.join(workDir, "book"),
      }),
    ).rejects.toThrow(/https/i);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});
