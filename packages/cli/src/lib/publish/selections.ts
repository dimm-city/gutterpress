/**
 * Project- and global-level default credential selections for publishing (#35,
 * named-credentials).
 *
 * Which SAVED credential (account label) a provider uses is chosen at three
 * precedence levels — book manifest (`publish.<id>.credential`) > project
 * default > global default. The book level lives in the manifest (shared, read
 * by the lib in both front-ends). This store holds the OTHER two levels: it is
 * NON-SECRET selection state (label references into the credential store, never
 * tokens), kept out of the manifest so a default can span multiple books.
 *
 * Mirrors {@link FileTokenStore}: a `0600` JSON file under a config dir, with
 * serialized read-modify-write. The CLI and the desktop host each construct one
 * with their OWN directory (CLI: {@link defaultConfigDir}; desktop: Electron
 * `userData`) — they do not share the file, the same way their credential
 * stores don't. Front-ends resolve the effective project/global account and
 * pass it to the lib as `PublishDeps.credentialAccount`; the lib then lets the
 * book manifest override it.
 */
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultConfigDir } from "../remote-auth/token-store.ts";

interface SelectionsShape {
  version: 1;
  /** providerId → account label. */
  global: Record<string, string>;
  /** projectPath → (providerId → account label). */
  projects: Record<string, Record<string, string>>;
}

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
          projects: parsed.projects ?? {},
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
        ? data.projects[normalizeProjectKey(projectDir)]?.[providerId]
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
        ? data.projects[normalizeProjectKey(projectDir)]?.[providerId]
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

  /** Set (or clear) the default for one provider within one project. */
  setProject(
    projectDir: string,
    providerId: string,
    account: string | null,
  ): Promise<void> {
    return this.enqueue(async () => {
      const data = await this.read();
      const key = normalizeProjectKey(projectDir);
      const a = (account ?? "").trim();
      const bucket = data.projects[key] ?? {};
      if (a) bucket[providerId] = a;
      else delete bucket[providerId];
      if (Object.keys(bucket).length > 0) data.projects[key] = bucket;
      else delete data.projects[key];
      await this.write(data);
    });
  }
}

/** Trailing-separator-insensitive project key (paths are the identity here). */
function normalizeProjectKey(projectDir: string): string {
  return projectDir.replace(/[\\/]+$/, "");
}
