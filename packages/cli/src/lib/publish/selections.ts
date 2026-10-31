/**
 * One person's PRIVATE publishing choices (#35, named-credentials): the state
 * that belongs to them and not to the book, so it stays out of the manifest a
 * team shares.
 *
 * - Per book (keyed by the book's path): that person's own `publish.<id>.*`
 *   values for it — which of their saved accounts the book publishes with
 *   (`credential`), an output folder outside the book (`dir`), and their own
 *   Google Drive folder when the book's is out of their reach (`myFolder*`,
 *   #452). They are
 *   read over the manifest's values, so the manifest stays the team's shared
 *   default (where the book is published). See `savePublishSettings` for which
 *   values land here and which in the manifest.
 * - Global: a default account for a provider across books.
 *
 * NON-SECRET (label references into the credential store and paths, never
 * tokens). Mirrors {@link FileTokenStore}: a `0600` JSON file under a config
 * dir, with serialized read-modify-write. The CLI and the desktop host each
 * construct one with their OWN directory (CLI: {@link defaultConfigDir};
 * desktop: Electron `userData`) — they do not share the file, the same way
 * their credential stores don't. The desktop passes its store to the lib as
 * `PublishDeps.selections`; a front-end may also resolve the global account
 * and pass it as `PublishDeps.credentialAccount`, the fallback when neither
 * the private store nor the manifest names one.
 */
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultConfigDir } from "../remote-auth/token-store.ts";

interface SelectionsShape {
  version: 1;
  /** providerId → account label. */
  global: Record<string, string>;
  /** projectPath → providerId → that person's private `publish.<id>.*` values. */
  projects: Record<string, Record<string, Record<string, string>>>;
}

/** One provider's private values for a book (strings only, as the manifest's are). */
type BookSettings = Record<string, string>;

/** Both levels' explicit selections for a provider (for the UI). */
export interface PublishAccountSelection {
  project?: string;
  global?: string;
}

export class PublishSelectionsStore {
  readonly filePath: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(filePath?: string) {
    this.filePath =
      filePath ?? path.join(defaultConfigDir(), "publish-selections.json");
  }

  private async read(): Promise<SelectionsShape> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<SelectionsShape>;
      if (parsed && typeof parsed === "object") {
        return {
          version: 1,
          global: parsed.global ?? {},
          projects: readProjects(parsed.projects),
        };
      }
    } catch {
      // Missing/corrupt → start empty; selections are re-choosable, never
      // strand the user.
    }
    return { version: 1, global: {}, projects: {} };
  }

  private async write(data: SelectionsShape): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(data, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(this.filePath, 0o600);
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * The effective default account for a provider: the project selection wins
   * over the global one; `undefined` when neither is set (→ the default
   * bare-host credential).
   */
  resolve(providerId: string, projectDir?: string): Promise<string | undefined> {
    return this.enqueue(async () => {
      const data = await this.read();
      const proj = projectDir
        ? data.projects[normalizeProjectKey(projectDir)]?.[providerId]?.credential
        : undefined;
      return (proj && proj.trim()) || data.global[providerId]?.trim() || undefined;
    });
  }

  /** Both explicit selections for a provider — for a UI that shows each level. */
  levels(providerId: string, projectDir?: string): Promise<PublishAccountSelection> {
    return this.enqueue(async () => {
      const data = await this.read();
      const global = data.global[providerId];
      const project = projectDir
        ? data.projects[normalizeProjectKey(projectDir)]?.[providerId]?.credential
        : undefined;
      return {
        ...(project ? { project } : {}),
        ...(global ? { global } : {}),
      };
    });
  }

  /** Set (or clear, with an empty account) the global default for a provider. */
  setGlobal(providerId: string, account: string | null): Promise<void> {
    return this.enqueue(async () => {
      const data = await this.read();
      const a = (account ?? "").trim();
      if (a) data.global[providerId] = a;
      else delete data.global[providerId];
      await this.write(data);
    });
  }

  /** Set (or clear) the saved account one provider uses within one project. */
  setProject(
    projectDir: string,
    providerId: string,
    account: string | null,
  ): Promise<void> {
    return this.setSettings(projectDir, providerId, { credential: account });
  }

  /** Every private value for one book, by provider id (empty when none). */
  settings(projectDir: string): Promise<Record<string, BookSettings>> {
    return this.enqueue(async () => {
      const data = await this.read();
      return data.projects[normalizeProjectKey(projectDir)] ?? {};
    });
  }

  /**
   * Merge `values` into one provider's private values for one book. A value of
   * `null` or `""` clears that key; an emptied provider (and book) entry is
   * removed rather than left dangling. Nothing is written when nothing changes.
   */
  setSettings(
    projectDir: string,
    providerId: string,
    values: Record<string, string | null>,
  ): Promise<void> {
    return this.enqueue(async () => {
      const data = await this.read();
      const key = normalizeProjectKey(projectDir);
      const book = data.projects[key] ?? {};
      const mine = { ...book[providerId] };
      for (const [k, v] of Object.entries(values)) {
        const text = (v ?? "").trim();
        if (text) mine[k] = text;
        else delete mine[k];
      }
      if (JSON.stringify(mine) === JSON.stringify(book[providerId] ?? {})) return;
      if (Object.keys(mine).length > 0) book[providerId] = mine;
      else delete book[providerId];
      if (Object.keys(book).length > 0) data.projects[key] = book;
      else delete data.projects[key];
      await this.write(data);
    });
  }
}

/**
 * The per-book values as this release keeps them. A file 0.11.22 wrote holds
 * one account label per provider (`projects[book][provider] = "studio"`);
 * that label is the book's `credential` here, so it is read as
 * `{ credential: "studio" }` and the next write keeps it in that shape (#483).
 */
function readProjects(projects: unknown): SelectionsShape["projects"] {
  const out: SelectionsShape["projects"] = {};
  if (!projects || typeof projects !== "object") return out;
  for (const [book, providers] of Object.entries(projects as Record<string, unknown>)) {
    if (!providers || typeof providers !== "object") continue;
    const values: Record<string, BookSettings> = {};
    for (const [provider, value] of Object.entries(providers as Record<string, unknown>)) {
      if (typeof value === "string") {
        if (value.trim()) values[provider] = { credential: value };
      } else if (value && typeof value === "object") {
        values[provider] = value as BookSettings;
      }
    }
    if (Object.keys(values).length > 0) out[book] = values;
  }
  return out;
}

/** Trailing-separator-insensitive project key (paths are the identity here). */
function normalizeProjectKey(projectDir: string): string {
  return projectDir.replace(/[\\/]+$/, "");
}
