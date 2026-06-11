/**
 * TEST helper process: an in-process git smart-HTTP server serving a
 * MULTI-BOOK fixture repository, for the viewer's Windows sync e2e test
 * (sync-history.pw.mjs).
 *
 * Run with bun (the imported lib test-support is TypeScript):
 *
 *   bun tests/integration/sync-fixture-server.ts
 *
 * Prints one JSON "ready" line on stdout:
 *   { ready: true, url, authUrl, authHost, authUser, authToken, repoDir }
 *
 * then answers line-delimited JSON commands on stdin (one JSON reply per
 * command, matched by `id`):
 *   { id, cmd: "advance", path, content, message? }  → commit server-side
 *   { id, cmd: "tip" }                               → current HEAD sha
 *   { id, cmd: "show", path }                        → file content at HEAD
 *   { id, cmd: "stop" }                              → close servers and exit
 *
 * The wire-protocol implementation is the lib's shared test-support server —
 * single-sourced, never duplicated here (it ships nothing to dist/).
 */
import * as fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import readline from "node:readline";

// isomorphic-git is a dependency of packages/lib (NOT of the viewer) and bun's
// isolated install does not hoist it — resolve it exactly the way the lib
// itself would, so this works under any node_modules layout.
const requireFromLib = createRequire(
  new URL("../../../lib/package.json", import.meta.url),
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const git = requireFromLib("isomorphic-git") as typeof import("isomorphic-git").default;

import {
  startGitServer,
  tempDir,
} from "../../../lib/src/lib/remote-auth/test-support/git-http-server.ts";

const AUTHOR = { name: "Remote Author", email: "remote@test.local" };
const AUTH_USER = "book";
const AUTH_TOKEN = "sekrit-test-token";

function out(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

// ── Multi-book fixture repo: two books in subfolders (ADR 0006 D2) ──────────
const repoDir = await tempDir("pmd-sync-fixture-");
await git.init({ fs, dir: repoDir, defaultBranch: "main" });

const files: Record<string, string> = {
  "README.md": "# Fixture multi-book repository\n",
  "books/alpha/manifest.yaml": [
    'title: "Alpha Book"',
    "authors:",
    '  - "print-md tests"',
    "source:",
    "  files:",
    "    - 01-intro.md",
    "    - 02-body.md",
    "",
  ].join("\n"),
  "books/alpha/01-intro.md":
    "# Alpha Intro {#ch-intro}\n\nFirst version of the intro.\n",
  "books/alpha/02-body.md":
    "# Alpha Body {#ch-body}\n\nFirst version of the body.\n",
  "books/beta/manifest.yaml": [
    'title: "Beta Book"',
    "authors:",
    '  - "print-md tests"',
    "source:",
    "  files:",
    "    - 01-only.md",
    "",
  ].join("\n"),
  "books/beta/01-only.md": "# Beta Only {#ch-beta}\n\nBeta content.\n",
};
for (const [rel, content] of Object.entries(files)) {
  const abs = path.join(repoDir, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content);
  await git.add({ fs, dir: repoDir, filepath: rel });
}
await git.commit({ fs, dir: repoDir, message: "first version", author: AUTHOR });

// Two servers over the SAME repo: the main (unauthenticated) one the app
// clones from / syncs with, and an authed one used to exercise the viewer's
// safeStorage credential store (connectGenericHost → DPAPI on Windows).
const server = await startGitServer(repoDir);
const authServer = await startGitServer(repoDir, {
  requireAuth: { username: AUTH_USER, password: AUTH_TOKEN },
});

out({
  ready: true,
  url: server.url,
  authUrl: authServer.url,
  authHost: new URL(authServer.url).host,
  authUser: AUTH_USER,
  authToken: AUTH_TOKEN,
  repoDir,
});

const rl = readline.createInterface({ input: process.stdin });
for await (const line of rl) {
  let req: {
    id?: number;
    cmd?: string;
    path?: string;
    content?: string;
    message?: string;
  };
  try {
    req = JSON.parse(line);
  } catch {
    continue;
  }
  try {
    if (req.cmd === "advance") {
      // The app's pushes move refs/heads/main UNDER this worktree repo, so
      // the worktree/index are stale after a push. Force-checkout to the
      // current head first — otherwise the commit below would be built from
      // the stale index and silently REVERT pushed changes.
      await git.checkout({ fs, dir: repoDir, ref: "main", force: true });
      const abs = path.join(repoDir, req.path!);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, req.content ?? "");
      await git.add({ fs, dir: repoDir, filepath: req.path! });
      const head = await git.commit({
        fs,
        dir: repoDir,
        message: req.message ?? "remote update",
        author: AUTHOR,
      });
      out({ id: req.id, ok: true, head });
    } else if (req.cmd === "tip") {
      const head = await git.resolveRef({ fs, dir: repoDir, ref: "HEAD" });
      out({ id: req.id, ok: true, head });
    } else if (req.cmd === "show") {
      const head = await git.resolveRef({ fs, dir: repoDir, ref: "HEAD" });
      const { blob } = await git.readBlob({
        fs,
        dir: repoDir,
        oid: head,
        filepath: req.path!,
      });
      out({ id: req.id, ok: true, content: Buffer.from(blob).toString("utf8") });
    } else if (req.cmd === "stop") {
      await server.close();
      await authServer.close();
      out({ id: req.id, ok: true });
      process.exit(0);
    } else {
      out({ id: req.id, ok: false, error: `unknown cmd: ${req.cmd}` });
    }
  } catch (e) {
    out({ id: req.id, ok: false, error: String(e) });
  }
}
