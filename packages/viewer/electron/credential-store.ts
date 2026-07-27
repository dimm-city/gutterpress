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
  notices?: {
    linuxBasicTextStorageShown?: boolean;
  };
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
  } catch (err) {
    // Only a genuinely absent file is an empty first-run store. Permission,
    // descriptor, and I/O failures must abort the read-modify-write cycle or a
    // later set() could replace still-existing credentials with a partial file.
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { version: 1, credentials: {} };
    }
    throw err;
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

/** Pure backend classification kept separate so non-Linux behavior is testable. */
export function isLinuxBasicTextStorage(platform: string, backend: string): boolean {
  return platform === "linux" && backend === "basic_text";
}

/** True only for Electron's keyring-less Linux fallback. Host-side only. */
export function usesLinuxBasicTextStorage(): boolean {
  if (process.platform !== "linux") return false;
  try {
    return isLinuxBasicTextStorage(
      process.platform,
      safeStorage.getSelectedStorageBackend(),
    );
  } catch {
    return false;
  }
}

/** Whether the one-time weaker-storage warning still needs to be shown. */
export function shouldShowLinuxBasicTextStorageNotice(): Promise<boolean> {
  if (!usesLinuxBasicTextStorage()) return Promise.resolve(false);
  return enqueue(async () => {
    const data = await readStore();
    return !data.notices?.linuxBasicTextStorageShown;
  });
}

/** Persist the warning only after the native dialog completed successfully. */
export function markLinuxBasicTextStorageNoticeShown(): Promise<void> {
  if (!usesLinuxBasicTextStorage()) return Promise.resolve();
  return enqueue(async () => {
    const data = await readStore();
    if (data.notices?.linuxBasicTextStorageShown) return;
    data.notices = {
      ...data.notices,
      linuxBasicTextStorageShown: true,
    };
    await writeStore(data);
  });
}

// ── Change notifications ─────────────────────────────────────────────────────
// The sync state machine's inputs must not change behind its back: connecting
// or disconnecting a credential changes whether the open project can sync, so
// main.ts subscribes here to re-diagnose + re-emit + kick a sync immediately.
// Without this, a writer who finally connected saw NO status change until the
// next periodic tick (if one was even armed) — the "connect does nothing"
// dead end.
type CredentialChangeListener = (host: string) => void;
const changeListeners = new Set<CredentialChangeListener>();

/** Subscribe to credential set/delete events. Returns an unsubscribe. */
export function onCredentialChange(listener: CredentialChangeListener): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function notifyCredentialChange(host: string): void {
  for (const listener of changeListeners) {
    try {
      listener(host);
    } catch (e) {
      console.warn("[credential-store] change listener failed (non-fatal):", e);
    }
  }
}

// Decrypt failures are expected exactly once per stale entry (keyring backend
// change, restored profile) — warn once per host so the log shows WHY a
// previously-connected project stopped syncing, without spamming every tick.
const decryptWarnedHosts = new Set<string>();
function warnDecryptFailure(host: string, context: string): void {
  if (decryptWarnedHosts.has(host)) return;
  decryptWarnedHosts.add(host);
  console.warn(
    `[credential-store] stored credential for "${host}" could not be decrypted (${context}). ` +
      "The OS keyring likely changed; reconnect to store a fresh credential.",
  );
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
        // as disconnected so the UI offers a clean reconnect. Logged (once per
        // host) so the silent "connected project stopped syncing" mystery has
        // a diagnosable trail; status()/listRedacted() report it too.
        warnDecryptFailure(normalizeHost(host), "get");
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
      // A fresh cipher is readable again — allow future failures to re-warn.
      decryptWarnedHosts.delete(normalizeHost(host));
    }).then(() => notifyCredentialChange(normalizeHost(host)));
  },

  delete(host: string): Promise<void> {
    return enqueue(async () => {
      const data = await readStore();
      delete data.credentials[normalizeHost(host)];
      await writeStore(data);
    }).then(() => notifyCredentialChange(normalizeHost(host)));
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
      /** True when the stored ciphertext can no longer be decrypted (keyring
       *  changed) — the entry LOOKS connected but sync sees no credential.
       *  The UI should present it as "needs reconnecting". */
      unreadable?: boolean;
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
        ...(entryDecrypts(entry) ? {} : { unreadable: true as const }),
      }));
    });
  },

  /**
   * Redacted connection status for the renderer — NEVER includes the token.
   * DECRYPT-VERIFIES the entry: an undecryptable credential (keyring changed)
   * reports `connected: false` + `needsReconnect: true`. It used to report
   * plain "connected" from the plaintext entry while `get()` (what sync
   * actually uses) returned null — the settings panel said "Connected" while
   * the project silently stopped syncing.
   */
  status(host: string): Promise<{
    connected: boolean;
    username?: string;
    label?: string;
    needsReconnect?: boolean;
  }> {
    return enqueue(async () => {
      const data = await readStore();
      const entry = data.credentials[normalizeHost(host)];
      if (!entry) return { connected: false };
      if (!entryDecrypts(entry)) {
        warnDecryptFailure(normalizeHost(host), "status");
        return {
          connected: false,
          needsReconnect: true,
          ...(entry.username ? { username: entry.username } : {}),
          ...(entry.label ? { label: entry.label } : {}),
        };
      }
      return {
        connected: true,
        ...(entry.username ? { username: entry.username } : {}),
        ...(entry.label ? { label: entry.label } : {}),
      };
    });
  },
};

/** True when the entry's ciphertext decrypts with the CURRENT keyring. */
function entryDecrypts(entry: StoredEntry): boolean {
  try {
    safeStorage.decryptString(Buffer.from(entry.tokenCipher, "base64"));
    return true;
  } catch {
    return false;
  }
}
