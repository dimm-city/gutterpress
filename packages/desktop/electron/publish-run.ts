/**
 * The app's side of the one publish run (ADR 0012 §5). The lib's `publishBook`
 * does the work, the same run the terminal's `gutterpress publish` does; this
 * gives it Electron's own Chromium, forwards its progress to the window, lets
 * the person stop it, and lets it write outside the book only to a folder a
 * native dialog just returned (the renderer can never name one).
 */
import type {
  EngineBrowser,
  PublishBookResult,
  PublishProgress,
  PublishSelectionsStore,
  TokenStore,
} from "gutterpress";

import type { PublishRunArgs } from "../src/lib/platform/shared-types";

type LibModule = typeof import("gutterpress");

export type { PublishRunArgs };

export interface PublishRunnerDeps {
  loadLib: () => Promise<LibModule>;
  engineBrowser: () => Promise<EngineBrowser>;
  tokenStore: TokenStore;
  selections: () => Promise<PublishSelectionsStore>;
  identity: () => Promise<{ authorName?: string; authorEmail?: string }>;
  sendProgress: (progress: PublishProgress) => void;
  isWithinProject: (absPath: string) => Promise<boolean>;
  /** The native folder dialog, opened at `defaultPath`; null when closed. */
  pickFolder: (defaultPath: string) => Promise<string | null>;
  /** Lets "Show in folder" open a path outside the book. */
  registerPickedPath: (absPath: string) => void;
  log: { event: (line: string) => void; error: (line: string) => void };
}

const canceled = (): PublishBookResult => ({
  ok: false,
  failure: { code: "CANCELED", message: "" },
  files: [],
  targets: [],
  sourceFindings: [],
  diagnostics: [],
});

export class PublishRunner {
  private active: { abort: AbortController; browsers: EngineBrowser[] } | null = null;

  constructor(private readonly deps: PublishRunnerDeps) {}

  async run(args: PublishRunArgs): Promise<PublishBookResult> {
    if (this.active) throw new Error("The app is already publishing a book.");
    if (!(await this.deps.isWithinProject(args.projectDir))) throw new Error("That book is not open in the app.");
    const run = { abort: new AbortController(), browsers: [] as EngineBrowser[] };
    this.active = run;
    try {
      const lib = await this.deps.loadLib();
      const publishDeps = { tokenStore: this.deps.tokenStore, selections: await this.deps.selections() };

      let runSettings: Record<string, Record<string, string>> | undefined;
      if (args.targets.includes("local")) {
        const req = await lib.resolvePublishRequest({ projectDir: args.projectDir, providerId: "local" }, publishDeps);
        let dir = lib.localPublishDir(req);
        if (!(await this.deps.isWithinProject(dir))) {
          const picked = await this.deps.pickFolder(dir);
          if (!picked) return canceled();
          dir = picked;
          runSettings = { local: { dir } };
        }
        this.deps.registerPickedPath(dir);
      }

      this.deps.log.event(`[publish] ${args.targets.join(", ")} started`);
      const result = await lib.publishBook(
        {
          projectDir: args.projectDir,
          targets: args.targets,
          ...(args.checkOnly ? { checkOnly: true } : {}),
          ...(args.skipChecks ? { skipChecks: true } : {}),
          ...(args.sendAnyway ? { sendAnyway: args.sendAnyway } : {}),
          ...(args.allowShrink ? { allowShrink: true } : {}),
          ...(runSettings ? { runSettings } : {}),
          engineBrowser: async () => {
            const browser = await this.deps.engineBrowser();
            run.browsers.push(browser);
            return browser;
          },
          onProgress: (p) => this.deps.sendProgress(p),
          signal: run.abort.signal,
        },
        { ...publishDeps, identity: await this.deps.identity() },
      );

      for (const file of result.files) this.deps.registerPickedPath(file.path);
      for (const t of result.targets) {
        if (t.outcome?.kind === "guided") this.deps.registerPickedPath(t.outcome.packageDir);
        const f = t.failure;
        const why = f ? ` (${f.code}) ${f.message}${f.detail ? ` ${f.detail}` : ""}` : "";
        (f ? this.deps.log.error : this.deps.log.event)(`[publish] ${t.id}: ${t.status}${why}`);
      }
      if (result.failure) {
        const f = result.failure;
        this.deps.log.error(`[publish] stopped (${f.code}) ${f.message}${f.detail ? ` ${f.detail}` : ""}`);
      }
      return result;
    } finally {
      this.active = null;
    }
  }

  /** Stop the run: abort it and close the windows it renders in. */
  cancel(): { canceled: boolean } {
    const run = this.active;
    if (!run) return { canceled: false };
    run.abort.abort();
    for (const browser of run.browsers) void browser.close();
    return { canceled: true };
  }
}
