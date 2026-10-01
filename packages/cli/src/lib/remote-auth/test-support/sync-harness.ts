/**
 * Shared harness for the sync-family tests (sync.test.ts, repair.test.ts): a
 * fixture repo served over the in-memory smart-HTTP server, cloned into a
 * fresh client folder.
 */
import * as fs from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";

import { cloneRepository } from "../clone.ts";
import type { HostCredential } from "../token-store.ts";
import { createFixtureRepo, startGitServer, tempDir, type GitServer } from "./git-http-server.ts";

export const SERVER_AUTHOR = { name: "Server", email: "server@test.local" };

export interface Harness {
  serverDir: string;
  server: GitServer;
  projectDir: string;
  /** The credential the clone used, when the server required one. */
  credential?: HostCredential;
  cleanup(): Promise<void>;
}

export async function setupClone(
  opts: { requireAuth?: { username: string; password: string } } = {},
): Promise<Harness> {
  const serverDir = await tempDir("gutterpress-sync-server-");
  await createFixtureRepo(serverDir);
  const server = await startGitServer(serverDir, opts);
  const parent = await tempDir("gutterpress-sync-client-");
  const projectDir = path.join(parent, "project");
  const credential: HostCredential | undefined = opts.requireAuth
    ? {
        host: "127.0.0.1",
        kind: "token",
        token: opts.requireAuth.password,
        username: opts.requireAuth.username,
        createdAt: Date.now(),
      }
    : undefined;
  await cloneRepository({
    url: server.url,
    dir: projectDir,
    ...(credential ? { credential } : {}),
  });
  return {
    serverDir,
    server,
    projectDir,
    ...(credential ? { credential } : {}),
    cleanup: async () => {
      await server.close();
      await rm(serverDir, { recursive: true, force: true });
      await rm(parent, { recursive: true, force: true });
    },
  };
}

/** Commit `files` on the server (null deletes); returns the new tip. */
export async function serverCommit(
  serverDir: string,
  files: Record<string, string | null>,
  message: string,
): Promise<string> {
  for (const [name, content] of Object.entries(files)) {
    if (content === null) {
      await rm(path.join(serverDir, name), { force: true });
      await git.remove({ fs, dir: serverDir, filepath: name });
    } else {
      await writeFile(path.join(serverDir, name), content);
      await git.add({ fs, dir: serverDir, filepath: name });
    }
  }
  return git.commit({ fs, dir: serverDir, message, author: SERVER_AUTHOR });
}
