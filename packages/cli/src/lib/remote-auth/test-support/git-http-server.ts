/**
 * Shared TEST helper: a minimal git smart-HTTP server (upload-pack AND
 * receive-pack).
 *
 * Extracted from clone.test.ts so test-access/generic-auth tests reuse the
 * same REAL wire-protocol exchange (ref advertisement + NAK + side-band
 * packfile, with `shallow`/`deepen` support) instead of mocking transports.
 * The receive-pack (push) side was added for the sync tests (#15 D5): it
 * parses the ref-update commands, indexes the received packfile into the
 * fixture repo with `git.indexPack`, moves the refs with `git.writeRef`, and
 * answers with a side-band-wrapped report-status — a REAL in-process push
 * endpoint, no shims.
 *
 * Not exported from the lib's public API and not reachable from src/index.ts —
 * it never ships in dist/.
 */
import * as fs from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import git from "isomorphic-git";
import type httpNode from "isomorphic-git/http/node";

type HttpClient = typeof httpNode;

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

/**
 * isomorphic-git location options: a worktree repo (`dir`) or a bare repo
 * (`gitdir`). Bare support exists so the server can serve a real `--bare`
 * clone (used by the large-repo sync repro scripts).
 */
type RepoLoc = { dir: string } | { gitdir: string };

function repoLocFor(repoDir: string): RepoLoc {
  return fs.existsSync(path.join(repoDir, ".git"))
    ? { dir: repoDir }
    : { gitdir: repoDir };
}

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

/**
 * Collect commit+tree+blob oids reachable from `commit`, to `depth` commits.
 *
 * `stopCommits` (the client's `have` lines) bounds the walk like a real
 * upload-pack: commits the client already has are neither read nor included.
 * `skipTrees` (the root trees of those have-commits) prunes tree recursion so
 * a fetch of message-only commits on a multi-GB repo packs ONLY the new
 * commit objects instead of re-walking the whole project tree.
 */
export async function collectOids(
  repo: RepoLoc,
  commit: string,
  depth: number,
  opts: { stopCommits?: Set<string>; skipTrees?: Set<string> } = {},
): Promise<string[]> {
  const stopCommits = opts.stopCommits ?? new Set<string>();
  const skipTrees = opts.skipTrees ?? new Set<string>();
  const oids = new Set<string>();
  async function walkTree(treeOid: string): Promise<void> {
    if (oids.has(treeOid) || skipTrees.has(treeOid)) return;
    oids.add(treeOid);
    const { tree } = await git.readTree({ fs, ...repo, oid: treeOid });
    for (const entry of tree) {
      if (entry.type === "tree") await walkTree(entry.oid);
      else oids.add(entry.oid);
    }
  }
  // BFS over ALL parents (merge commits have two) up to `depth` generations.
  let frontier: string[] = [commit];
  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const oid of frontier) {
      if (oids.has(oid) || stopCommits.has(oid)) continue;
      oids.add(oid);
      const { commit: c } = await git.readCommit({ fs, ...repo, oid });
      await walkTree(c.tree);
      next.push(...c.parent);
    }
    frontier = next;
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

  const repo = repoLocFor(repoDir);

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
      const head = await git.resolveRef({ fs, ...repo, ref: "HEAD" });
      const branch = (await git.currentBranch({ fs, ...repo })) ?? "main";

      if (
        req.method === "GET" &&
        req.url?.includes("/info/refs") &&
        req.url.includes("service=git-receive-pack")
      ) {
        // Push ref advertisement. side-band-64k is REQUIRED in the cap list:
        // isomorphic-git's push parses the report-status through a side-band
        // demux, so a plain (non-side-band) response would parse as empty.
        res.writeHead(200, {
          "content-type": "application/x-git-receive-pack-advertisement",
        });
        res.end(
          Buffer.concat([
            pkt("# service=git-receive-pack\n"),
            FLUSH,
            pkt(
              `${head} refs/heads/${branch}\0report-status side-band-64k agent=git/test\n`,
            ),
            FLUSH,
          ]),
        );
        return;
      }

      if (req.method === "POST" && req.url?.endsWith("/git-receive-pack")) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const { commands, packfile } = parseReceivePackRequest(
          Buffer.concat(chunks),
        );
        const refReport = await applyPush(repoDir, commands, packfile);
        // report-status payload (itself pkt-line encoded), wrapped on
        // side-band channel 1.
        const payload = Buffer.concat([
          pkt("unpack ok\n"),
          ...refReport.map((line) => pkt(line)),
          FLUSH,
        ]);
        res.writeHead(200, {
          "content-type": "application/x-git-receive-pack-result",
        });
        res.end(
          Buffer.concat([
            pkt(Buffer.concat([Buffer.from([0x01]), payload])),
            FLUSH,
          ]),
        );
        return;
      }

      if (req.method === "GET" && req.url?.includes("/info/refs")) {
        // Advertise EVERY refs/heads/* ref like a real upload-pack (the
        // fetch-abort rollback tests need a multi-branch advertisement so an
        // aborted singleBranch:false fetch can dangle several tracking refs).
        const branchLines: Buffer[] = [];
        for (const name of await git.listBranches({ fs, ...repo })) {
          const oid = await git.resolveRef({ fs, ...repo, ref: `refs/heads/${name}` });
          branchLines.push(pkt(`${oid} refs/heads/${name}\n`));
        }
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
            ...branchLines,
            FLUSH,
          ]),
        );
        return;
      }

      if (req.method === "POST" && req.url?.endsWith("/git-upload-pack")) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const lines = parsePktLines(Buffer.concat(chunks));
        const wants = lines
          .filter((l) => l.startsWith("want "))
          .map((l) => l.split(" ")[1]!);
        const want = wants[0]!;
        const deepen = lines.find((l) => l.startsWith("deepen "));
        const depth = deepen ? parseInt(deepen.split(" ")[1]!, 10) : Infinity;

        // Honor the client's `have` lines like a real upload-pack: stop the
        // commit walk at commits the client already has, and prune their root
        // trees so the pack carries only what the client is missing. (The
        // pack may reference objects the client has — that is exactly what a
        // real fetch pack does.)
        const stopCommits = new Set(
          lines
            .filter((l) => l.startsWith("have "))
            .map((l) => l.split(" ")[1]!),
        );
        const skipTrees = new Set<string>();
        for (const haveOid of stopCommits) {
          try {
            const { commit } = await git.readCommit({ fs, ...repo, oid: haveOid });
            skipTrees.add(commit.tree);
          } catch {
            // Unknown have — ignore it (a real server does the same).
          }
        }

        const oidSet = new Set<string>();
        for (const w of wants) {
          for (const oid of await collectOids(repo, w, depth, { stopCommits, skipTrees })) {
            oidSet.add(oid);
          }
        }
        const oids = [...oidSet];
        const { packfile } = await git.packObjects({ fs, ...repo, oids });

        const parts: Buffer[] = [];
        if (deepen) {
          // Shallow section: the boundary commit(s) the client must record in
          // .git/shallow, terminated by a flush-pkt.
          const { commit } = await git.readCommit({ fs, ...repo, oid: want });
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

/**
 * An http client that delivers the git-upload-pack response but ERRORS the
 * body instead of completing it — the shape a defaultGitHttp idle-timeout trip
 * takes mid-pack. isomorphic-git 1.38.4 updates refs/remotes/<remote>/* from
 * the ref advertisement BEFORE the packfile is collected/persisted, so this
 * reproduces "refs moved, objects never landed" deterministically (the R15
 * dangling-tracking-ref failure). Shared by the transport and recovery tests.
 */
export function packDroppingClient(inner: HttpClient): HttpClient {
  return {
    async request(options) {
      const res = await inner.request(options);
      if (!options.url.endsWith("/git-upload-pack")) return res;
      const source = (res.body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
      const body: AsyncIterableIterator<Uint8Array> = {
        async next() {
          const step = await source.next();
          if (step.done) {
            throw new Error(
              "Git network operation timed out after 60s (the remote stopped sending data); couldn't reach the remote (ETIMEDOUT).",
            );
          }
          return step;
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
      return { ...res, body };
    },
  };
}

// ── receive-pack (push) support ───────────────────────────────────────────────

const ZERO_OID = "0".repeat(40);

/**
 * Binary-safe pkt-line command parser for a receive-pack request body:
 * returns the `<old> <new> <ref>` commands and the byte offset where the raw
 * packfile starts (right after the flush-pkt).
 */
export function parseReceivePackRequest(body: Buffer): {
  commands: Array<{ oldOid: string; newOid: string; ref: string }>;
  packfile: Buffer;
} {
  const commands: Array<{ oldOid: string; newOid: string; ref: string }> = [];
  let i = 0;
  while (i + 4 <= body.length) {
    const len = parseInt(body.subarray(i, i + 4).toString(), 16);
    if (len === 0) {
      i += 4; // flush-pkt — everything after it is the packfile
      break;
    }
    const line = body
      .subarray(i + 4, i + len)
      .toString()
      .replace(/\n$/, "");
    // Strip the capability list after NUL on the first command line.
    const clean = line.split("\0")[0]!;
    const [oldOid, newOid, ...refParts] = clean.split(" ");
    if (oldOid && newOid && refParts.length > 0) {
      commands.push({ oldOid, newOid, ref: refParts.join(" ") });
    }
    i += len;
  }
  return { commands, packfile: body.subarray(i) };
}

let pushCounter = 0;

/**
 * Apply a pushed packfile + ref updates to the fixture repo. Mirrors what a
 * real receive-pack does: index the pack into the object store, then move the
 * refs. Returns the per-ref report lines for report-status.
 */
async function applyPush(
  repoDir: string,
  commands: Array<{ oldOid: string; newOid: string; ref: string }>,
  packfile: Buffer,
): Promise<string[]> {
  const repo = repoLocFor(repoDir);
  const gitdir = "gitdir" in repo ? repo.gitdir : path.join(repo.dir, ".git");
  // A push always carries a pack (possibly with zero objects — 32 bytes of
  // header + trailer). Index anything non-trivial so the new objects resolve.
  if (packfile.length > 0) {
    const name = `pack-push-${Date.now()}-${pushCounter++}.pack`;
    const abs = path.join(gitdir, "objects", "pack", name);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, packfile);
    await git.indexPack({
      fs,
      dir: repoDir,
      gitdir,
      filepath: path.relative(repoDir, abs),
    });
  }
  const report: string[] = [];
  for (const cmd of commands) {
    // Like a real receive-pack, reject stale updates: a non-zero oldOid that
    // doesn't match the ref's CURRENT value means someone else moved the ref
    // since the client's advertisement — report non-fast-forward and do NOT
    // touch the ref. (Exercised by the sync race tests.)
    let current: string | null = null;
    try {
      current = await git.resolveRef({ fs, ...repo, ref: cmd.ref });
    } catch {
      current = null;
    }
    if (cmd.oldOid !== ZERO_OID && cmd.oldOid !== current) {
      report.push(`ng ${cmd.ref} non-fast-forward\n`);
      continue;
    }
    if (cmd.newOid === ZERO_OID) {
      await git.deleteRef({ fs, ...repo, ref: cmd.ref });
    } else {
      await git.writeRef({
        fs,
        ...repo,
        ref: cmd.ref,
        value: cmd.newOid,
        force: true,
      });
    }
    report.push(`ok ${cmd.ref}\n`);
  }
  return report;
}
