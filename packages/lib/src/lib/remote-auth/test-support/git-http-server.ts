/**
 * Shared TEST helper: a minimal git smart-HTTP server (upload-pack only).
 *
 * Extracted from clone.test.ts so test-access/generic-auth tests reuse the
 * same REAL wire-protocol exchange (ref advertisement + NAK + side-band
 * packfile, with `shallow`/`deepen` support) instead of mocking transports.
 *
 * Not exported from the lib's public API and not reachable from src/index.ts —
 * it never ships in dist/.
 */
import * as fs from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import git from "isomorphic-git";

// ── pkt-line helpers ──────────────────────────────────────────────────────────

export function pkt(data: string | Buffer): Buffer {
  const body = typeof data === "string" ? Buffer.from(data) : data;
  return Buffer.concat([
    Buffer.from((body.length + 4).toString(16).padStart(4, "0")),
    body,
  ]);
}
export const FLUSH = Buffer.from("0000");

export function parsePktLines(body: Buffer): string[] {
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

export async function createFixtureRepo(
  dir: string,
): Promise<{ head: string; first: string }> {
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
export async function collectOids(
  dir: string,
  commit: string,
  depth: number,
): Promise<string[]> {
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

export interface GitServer {
  url: string;
  /** Authorization headers the server saw, in order. */
  authHeaders: Array<string | undefined>;
  close(): Promise<void>;
}

export interface GitServerOptions {
  requireAuth?: { username: string; password: string };
  /** Answer every request with 404 (a host with no repo at that path). */
  notFound?: boolean;
}

export async function startGitServer(
  repoDir: string,
  opts: GitServerOptions = {},
): Promise<GitServer> {
  const authHeaders: Array<string | undefined> = [];
  const expectedAuth = opts.requireAuth
    ? "Basic " +
      Buffer.from(
        `${opts.requireAuth.username}:${opts.requireAuth.password}`,
      ).toString("base64")
    : null;

  const server = http.createServer((req, res) => {
    void (async () => {
      authHeaders.push(req.headers.authorization);
      if (opts.notFound) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
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
        const want = lines.find((l) => l.startsWith("want "))!.split(" ")[1]!;
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

export async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}
