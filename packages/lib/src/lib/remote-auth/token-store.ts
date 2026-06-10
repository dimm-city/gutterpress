/**
 * Host-keyed credential store for remote Git providers (#15, ADR 0006 D3 L2).
 *
 * Credentials are keyed by REMOTE HOST (e.g. "github.com"), not by project: a
 * credential for a host makes every project whose origin points at that host
 * syncable, including repos cloned externally.
 *
 * The lib NEVER touches OS keychains — host applications inject the
 * implementation (the Electron viewer uses `safeStorage`; see
 * packages/viewer/electron/credential-store.ts). The one concrete
 * implementation here, {@link FileTokenStore}, is the CLI's store: a `0600`
 * JSON file under the user config dir (the `gh` CLI model — encrypted-at-rest
 * is explicitly not required for the CLI per ADR 0006 D3).
 *
 * SECURITY INVARIANT: token values must never be logged or embedded in error
 * messages. Use {@link redactCredential} for any diagnostics.
 */
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** An opaque stored credential for one remote host. */
export interface HostCredential {
  /** Remote host the credential authenticates against, e.g. "github.com". */
  host: string;
  /** How the credential was acquired (drives re-auth UX, not transport). */
  kind: "github-app" | "token";
  /** The secret token value. NEVER log this. */
  token: string;
  /** Login/username associated with the token, when known. */
  username?: string;
  /** Optional human label ("GitHub — @octocat"). */
  label?: string;
  /** Epoch ms the credential was stored. */
  createdAt: number;
}

/**
 * Host-keyed credential vault contract (ADR 0006 D3 layer 2). Implementations
 * are provided by the HOST APP (Electron safeStorage, CLI 0600 file); the lib
 * only consumes this interface.
 */
export interface TokenStore {
  get(host: string): Promise<HostCredential | null>;
  set(host: string, credential: HostCredential): Promise<void>;
  delete(host: string): Promise<void>;
  /** All stored credentials (used by "connected accounts" UIs). */
  list(): Promise<HostCredential[]>;
}

/** A credential with the token value masked — safe for logs/diagnostics. */
export function redactCredential(
  cred: HostCredential,
): Omit<HostCredential, "token"> & { token: string } {
  return { ...cred, token: "•••redacted•••" };
}

/**
 * Resolve the print-md user config directory (where the CLI token store
 * lives). There is no pre-existing lib config-dir mechanism to follow (the CLI
 * config cascade is per-project manifest based), so this establishes the
 * standard one: `$PRINT_MD_CONFIG_DIR` override → `%APPDATA%/print-md` on
 * Windows → `$XDG_CONFIG_HOME/print-md` → `~/.config/print-md`.
 */
export function defaultConfigDir(): string {
  const override = process.env.PRINT_MD_CONFIG_DIR?.trim();
  if (override) return override;
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "print-md");
  }
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  return path.join(xdg || path.join(os.homedir(), ".config"), "print-md");
}

interface StoredFileShape {
  version: 1;
  credentials: Record<string, HostCredential>;
}

/**
 * The CLI's {@link TokenStore}: a JSON file with `0600` permissions under the
 * user config dir. Plaintext-at-rest by design (the `gh`/`npm` model) — the
 * viewer uses an OS-keychain-backed store instead.
 */
export class FileTokenStore implements TokenStore {
  readonly filePath: string;
  // Serialize writes so concurrent set/delete can't interleave read-modify-write.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.join(defaultConfigDir(), "credentials.json");
  }

  private async read(): Promise<StoredFileShape> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as StoredFileShape;
      if (parsed && typeof parsed === "object" && parsed.credentials) return parsed;
    } catch {
      // Missing or corrupt file → start empty. Corruption must not strand the
      // user; reconnecting re-creates the entry.
    }
    return { version: 1, credentials: {} };
  }

  private async write(data: StoredFileShape): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(data, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    // writeFile's mode only applies on creation — enforce on every write so a
    // pre-existing looser file is tightened.
    await chmod(this.filePath, 0o600);
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  get(host: string): Promise<HostCredential | null> {
    return this.enqueue(async () => {
      const data = await this.read();
      return data.credentials[normalizeHost(host)] ?? null;
    });
  }

  set(host: string, credential: HostCredential): Promise<void> {
    return this.enqueue(async () => {
      const data = await this.read();
      data.credentials[normalizeHost(host)] = credential;
      await this.write(data);
    });
  }

  delete(host: string): Promise<void> {
    return this.enqueue(async () => {
      const data = await this.read();
      delete data.credentials[normalizeHost(host)];
      await this.write(data);
    });
  }

  list(): Promise<HostCredential[]> {
    return this.enqueue(async () => {
      const data = await this.read();
      return Object.values(data.credentials);
    });
  }
}

/** Lower-case the host so "GitHub.com" and "github.com" share one entry. */
function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}

// ── Embedded-credential URL migration (ADR 0006 D7) ──────────────────────────

/** Result of {@link extractUrlCredential}. */
export interface UrlCredentialExtraction {
  /** The URL with any userinfo (user:token@) stripped. */
  cleanUrl: string;
  /** Credential recovered from the URL's userinfo, if any. */
  credential?: HostCredential;
}

/**
 * Detect a token embedded in a remote URL (`https://user:tok@host/…` — common
 * in the wild), returning the sanitized URL plus the recovered credential so
 * callers can migrate it into the {@link TokenStore}. The token value must
 * never be echoed into logs or diagnostics — only the clean URL is safe to
 * display. Non-HTTP(S) or unparseable URLs pass through unchanged.
 */
export function extractUrlCredential(url: string): UrlCredentialExtraction {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { cleanUrl: url };
  }
  if (!/^https?:$/.test(parsed.protocol)) return { cleanUrl: url };
  if (!parsed.username && !parsed.password) return { cleanUrl: url };

  // GitHub-style `https://TOKEN@host/...` puts the token in the username slot;
  // `user:token@host` puts it in the password slot.
  const token = parsed.password
    ? decodeURIComponent(parsed.password)
    : decodeURIComponent(parsed.username);
  const username = parsed.password ? decodeURIComponent(parsed.username) : undefined;
  parsed.username = "";
  parsed.password = "";
  const credential: HostCredential = {
    host: parsed.hostname.toLowerCase(),
    kind: "token",
    token,
    ...(username ? { username } : {}),
    createdAt: Date.now(),
  };
  return { cleanUrl: parsed.toString(), credential };
}

/**
 * Migrate any credential embedded in `url` into `store` (only when the store
 * has no existing credential for that host — a stored credential is fresher
 * than one fossilized in a clone URL) and return the sanitized URL.
 */
export async function migrateUrlCredential(
  url: string,
  store: TokenStore,
): Promise<string> {
  const { cleanUrl, credential } = extractUrlCredential(url);
  if (credential && !(await store.get(credential.host))) {
    await store.set(credential.host, credential);
  }
  return cleanUrl;
}
