/**
 * Electron-host credential store (#15, ADR 0006 D3 layer 2).
 *
 * Implements the lib's `TokenStore` contract (shape mirrored locally — the
 * electron main bundle keeps the lib behind a dynamic import) using Electron's
 * `safeStorage`: token values are encrypted with the OS credential vault
 * (DPAPI / Keychain / kwallet/libsecret) and stored as base64 ciphertext in
 * `userData/credentials.json`. Non-secret fields (host, username, label) stay
 * plaintext so the file is debuggable without ever exposing a token.
 *
 * When the OS provides no keyring (some Linux setups), `safeStorage` falls
 * back to its basic obfuscation — still better than plaintext, and the file
 * itself is written `0600`.
 *
 * SECURITY INVARIANT: token values never appear in logs, errors, or IPC
 * responses (remote:getConnection returns a redacted status only).
 */
import { app, safeStorage } from "electron";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** Mirrors the lib's HostCredential (kept local; lib ships behind a dyn import). */
export interface HostCredential {
  host: string;
  kind: "github-oauth" | "token";
  token: string;
  username?: string;
  label?: string;
  createdAt: number;
}

interface StoredEntry {
  host: string;
  kind: "github-oauth" | "token";
  /** base64 ciphertext of the token (safeStorage.encryptString). */
  tokenCipher: string;
  username?: string;
  label?: string;
  createdAt: number;
}

interface StoreFileShape {
  version: 1;
  credentials: Record<string, StoredEntry>;
}

function storePath(): string {
  return path.join(app.getPath("userData"), "credentials.json");
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}

async function readStore(): Promise<StoreFileShape> {
  let raw: string;
  try {
    raw = await readFile(storePath(), "utf8");
  } catch {
    // No readable file yet (first run, or removed) — nothing to preserve.
    return { version: 1, credentials: {} };
  }
  try {
    const parsed = JSON.parse(raw) as StoreFileShape;
    if (parsed && typeof parsed === "object" && parsed.credentials) return parsed;
  } catch {
    /* falls through to preserve-and-reset below */
  }
  // The file exists but isn't valid JSON (or isn't shaped like a store).
  // Preserve it instead of silently resetting to empty — that used to
  // silently disconnect every configured GitHub/Git-server credential (#34).
  await preserveCorruptFile(storePath()).catch(() => {});
  return { version: 1, credentials: {} };
}

async function preserveCorruptFile(target: string): Promise<void> {
  const corruptPath = `${target}.corrupt-${Date.now()}`;
  try {
    await rename(target, corruptPath);
    console.warn(
      `[credential-store] ${target} was invalid; preserved as ${corruptPath} instead of being discarded.`,
    );
  } catch (renameErr) {
    console.warn(
      `[credential-store] ${target} was invalid but could not be preserved (rename failed):`,
      renameErr,
    );
  }
}

async function writeStore(data: StoreFileShape): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  const target = storePath();
  const tmp = `${target}.tmp`;
  // Atomic write (#34): write-then-rename so a crash mid-write can't
  // truncate the real credentials file.
  await writeFile(tmp, JSON.stringify(data, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(tmp, 0o600).catch(() => {});
  await rename(tmp, target);
}

// Serialize read-modify-write cycles.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export const electronTokenStore = {
  get(host: string): Promise<HostCredential | null> {
    return enqueue(async () => {
      const data = await readStore();
      const entry = data.credentials[normalizeHost(host)];
      if (!entry) return null;
      try {
        const token = safeStorage.decryptString(
          Buffer.from(entry.tokenCipher, "base64"),
        );
        return {
          host: entry.host,
          kind: entry.kind,
          token,
          ...(entry.username ? { username: entry.username } : {}),
          ...(entry.label ? { label: entry.label } : {}),
          createdAt: entry.createdAt,
        };
      } catch {
        // Ciphertext from another machine/user profile can't decrypt — treat
        // as disconnected so the UI offers a clean reconnect.
        return null;
      }
    });
  },

  set(host: string, credential: HostCredential): Promise<void> {
    return enqueue(async () => {
      const data = await readStore();
      const tokenCipher = safeStorage
        .encryptString(credential.token)
        .toString("base64");
      data.credentials[normalizeHost(host)] = {
        host: normalizeHost(credential.host),
        kind: credential.kind,
        tokenCipher,
        ...(credential.username ? { username: credential.username } : {}),
        ...(credential.label ? { label: credential.label } : {}),
        createdAt: credential.createdAt,
      };
      await writeStore(data);
    });
  },

  delete(host: string): Promise<void> {
    return enqueue(async () => {
      const data = await readStore();
      delete data.credentials[normalizeHost(host)];
      await writeStore(data);
    });
  },

  list(): Promise<HostCredential[]> {
    return enqueue(async () => {
      const data = await readStore();
      const out: HostCredential[] = [];
      for (const entry of Object.values(data.credentials)) {
        try {
          out.push({
            host: entry.host,
            kind: entry.kind,
            token: safeStorage.decryptString(Buffer.from(entry.tokenCipher, "base64")),
            ...(entry.username ? { username: entry.username } : {}),
            ...(entry.label ? { label: entry.label } : {}),
            createdAt: entry.createdAt,
          });
        } catch {
          /* skip undecryptable entries */
        }
      }
      return out;
    });
  },

  /**
   * Redacted listing for the renderer's "connected servers" UI (#14) — never
   * decrypts and never includes token ciphertext or values.
   */
  listRedacted(): Promise<
    Array<{
      host: string;
      kind: "github-oauth" | "token";
      username?: string;
      label?: string;
      createdAt: number;
    }>
  > {
    return enqueue(async () => {
      const data = await readStore();
      return Object.values(data.credentials).map((entry) => ({
        host: entry.host,
        kind: entry.kind,
        ...(entry.username ? { username: entry.username } : {}),
        ...(entry.label ? { label: entry.label } : {}),
        createdAt: entry.createdAt,
      }));
    });
  },

  /** Redacted connection status for the renderer — NEVER includes the token. */
  status(host: string): Promise<{ connected: boolean; username?: string; label?: string }> {
    return enqueue(async () => {
      const data = await readStore();
      const entry = data.credentials[normalizeHost(host)];
      if (!entry) return { connected: false };
      return {
        connected: true,
        ...(entry.username ? { username: entry.username } : {}),
        ...(entry.label ? { label: entry.label } : {}),
      };
    });
  },
};
