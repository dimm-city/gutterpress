/**
 * Host-keyed credential store for remote Git providers (#15, ADR 0006 D3 L2).
 *
 * Credentials are keyed by REMOTE HOST (e.g. "github.com"), not by project: a
 * credential for a host makes every project whose origin points at that host
 * syncable, including repos cloned externally.
 *
 * The lib NEVER touches OS keychains — host applications inject the
 * implementation (the Electron desktop uses `safeStorage`; see
 * packages/desktop/electron/credential-store.ts). The one concrete
 * implementation here, {@link FileTokenStore}, is the CLI's store: a `0600`
 * JSON file under the user config dir (the `gh` CLI model — encrypted-at-rest
 * is explicitly not required for the CLI per ADR 0006 D3).
 *
 * SECURITY INVARIANT: token values must never be logged or embedded in error
 * messages — mask them at the point of use.
 */
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** An opaque stored credential for one remote host. */
export interface HostCredential {
  /** Remote host the credential authenticates against, e.g. "github.com". */
  host: string;
  /** How the credential was acquired (drives re-auth UX, not transport). */
  kind: "github-oauth" | "token" | "google-oauth";
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

/**
 * THE canonical credential-store key for a remote host — the ONE derivation
 * every writer (GitHub device flow, generic connect, embedded-URL migration)
 * and every reader (diagnose, transport) must share. Historically each site
 * derived its own key (the device flow hardcoded `github.com`, the URL
 * migration dropped `:port`, generic connect kept `www.`), so a credential
 * stored by one flow could be invisible to the lookup of another — the
 * "connected successfully but never syncable" defect class.
 *
 * Accepts a bare hostname ("Git.Example.com"), a host:port pair
 * ("git.example.com:3000"), any URL on the host, or an scp-like SSH address
 * ("git@host:owner/repo.git"). Returns `hostname[:port]` lower-cased with any
 * leading `www.` stripped (so `www.github.com` remotes find the `github.com`
 * device-flow credential). The port is kept ONLY when explicit and
 * non-default — `new URL` already drops :443/:80 for https/http. Returns ""
 * when nothing usable remains.
 */
export function credentialHostKey(hostOrUrl: string): string {
  const trimmed = String(hostOrUrl ?? "").trim();
  if (!trimmed) return "";
  // scp-like SSH (git@host:owner/repo.git) — URL() can't parse it.
  const scp = /^[\w.-]+@([\w.][\w.-]*):/.exec(trimmed);
  if (scp) return stripWww(scp[1]!.toLowerCase());
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (!url.hostname) return "";
    const host = url.port
      ? `${url.hostname}:${url.port}`.toLowerCase()
      : url.hostname.toLowerCase();
    return stripWww(host);
  } catch {
    return "";
  }
}

function stripWww(host: string): string {
  return host.startsWith("www.") && host.length > 4 ? host.slice(4) : host;
}

/**
 * Resolve the Gutterpress user config directory (where the CLI token store
 * lives). There is no pre-existing lib config-dir mechanism to follow (the CLI
 * config cascade is per-project manifest based), so this establishes the
 * standard one: `$GUTTERPRESS_CONFIG_DIR` override → `%APPDATA%/gutterpress` on
 * Windows → `$XDG_CONFIG_HOME/gutterpress` → `~/.config/gutterpress`.
 */
export function defaultConfigDir(): string {
  const override = process.env.GUTTERPRESS_CONFIG_DIR?.trim();
  if (override) return override;
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "gutterpress");
  }
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  return path.join(xdg || path.join(os.homedir(), ".config"), "gutterpress");
}

interface StoredFileShape {
  version: 1;
  credentials: Record<string, HostCredential>;
}

/**
 * The CLI's {@link TokenStore}: a JSON file with `0600` permissions under the
 * user config dir. Plaintext-at-rest by design (the `gh`/`npm` model) — the
 * desktop uses an OS-keychain-backed store instead.
 */
export class FileTokenStore implements TokenStore {
  readonly filePath: string;
  // Serialize writes so concurrent set/delete can't interleave read-modify-write.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.join(defaultConfigDir(), "credentials.json");
  }

  private async read(): Promise<StoredFileShape> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (e) {
      // ENOENT = the store legitimately doesn't exist yet (first run, or after
      // a full disconnect) → empty store. ANY OTHER read error (EACCES/EIO/
      // EMFILE) is TRANSIENT (deep-analysis fix): returning empty here would
      // let a following set()/delete() persist that empty base and silently
      // WIPE every OTHER host's stored credential. Rethrow so a write aborts;
      // get()/list() below tolerate the throw as "temporarily unknown".
      if ((e as NodeJS.ErrnoException)?.code === "ENOENT") {
        return { version: 1, credentials: {} };
      }
      throw e;
    }
    try {
      const parsed = JSON.parse(raw) as StoredFileShape;
      if (parsed && typeof parsed === "object" && parsed.credentials) return parsed;
    } catch {
      // Corrupt JSON: preserve the evidence BEFORE any subsequent set/delete
      // overwrites it (the desktop's credential store fixed this exact silent
      // total-credential-loss as #34 — same pattern here). Best-effort; the
      // store still starts empty so the user can reconnect.
      await writeFile(`${this.filePath}.corrupt`, raw, {
        encoding: "utf8",
        mode: 0o600,
      }).catch(() => {});
    }
    return { version: 1, credentials: {} };
  }

  private async write(data: StoredFileShape): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    // Atomic replace (tmp + rename): a crash mid-write must never leave a
    // half-written credentials.json, because the next read would treat it as
    // corrupt and the next set() would persist an EMPTY store — destroying
    // every stored credential at once (#34-class failure).
    const tmpPath = `${this.filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmpPath, JSON.stringify(data, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tmpPath, this.filePath);
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
      try {
        const data = await this.read();
        return data.credentials[normalizeHost(host)] ?? null;
      } catch {
        // A transient read failure means "unknown" — report not-connected for
        // this call WITHOUT writing anything (unlike set/delete, which must
        // abort rather than persist over an unreadable store).
        return null;
      }
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
      try {
        const data = await this.read();
        return Object.values(data.credentials);
      } catch {
        // Transient read failure → show nothing rather than crash the caller;
        // no write happens, so stored credentials are untouched.
        return [];
      }
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
    // The canonical key derivation — MUST match what diagnose/transport look
    // up for this remote. The old `parsed.hostname` dropped the `:port`, so a
    // credential migrated from `https://tok@host:3000/x.git` was stored under
    // a key (`host`) that no reader (`host:3000`) could ever find — connected
    // once, never syncable again.
    host: credentialHostKey(parsed.toString()),
    kind: "token",
    token,
    ...(username ? { username } : {}),
    createdAt: Date.now(),
  };
  return { cleanUrl: parsed.toString(), credential };
}
