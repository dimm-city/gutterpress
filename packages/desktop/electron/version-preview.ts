/**
 * version-preview.ts — "Look at this version" (#408): a read-only preview of
 * one past version, shown beside the live preview.
 *
 * The version's files are written to a scratch folder (the lib's
 * `exportVersionTree`, the whole repository tree so a book inside a larger
 * repository still finds its shared stylesheets) and the ordinary preview
 * pipeline renders that folder through a second `startPreviewServer` with
 * watching off — the same pipeline as the live preview, on a copy that
 * nothing writes to. The live book's downloaded extensions are linked in so
 * the copy renders without a download. Nothing in the project changes.
 *
 * One version preview at a time: opening another closes the first, and the
 * project's own open/close closes it too (PreviewOpenController). Calls are
 * serialized like the project preview's, so an open and a close that
 * overlap cannot orphan a server or a folder. Node/lib-side only — reached
 * by the vcs routes through `getHostServices().vcs`.
 */

type LibModule = typeof import("gutterpress");
type Handle = Awaited<ReturnType<LibModule["startPreviewServer"]>>;

export interface VersionPreviewDeps {
  loadLib: () => Promise<LibModule>;
  /** A fresh, empty folder for one version's files. */
  makeExportDir: (id: string) => Promise<string>;
  /** Remove an export folder once its preview is closed (best effort). */
  removeDir: (dir: string) => Promise<void>;
  /** Make the live book's downloaded extensions visible to the copy. */
  linkExtensions: (projectDir: string, inputDir: string) => Promise<void>;
}

export class VersionPreviewHost {
  private current: { id: string; handle: Handle; dir: string } | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: VersionPreviewDeps) {}

  /** The scratch folder and server for version `id`; its URL for an iframe. */
  open(projectDir: string, id: string): Promise<{ url: string }> {
    return this.enqueue(() => this.runOpen(projectDir, id));
  }

  close(): Promise<void> {
    return this.enqueue(() => this.runClose());
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async runOpen(projectDir: string, id: string): Promise<{ url: string }> {
    if (this.current?.id === id) return { url: this.current.handle.url };
    await this.runClose();
    const lib = await this.deps.loadLib();
    const dir = await this.deps.makeExportDir(id);
    try {
      const { inputDir } = await lib.exportVersionTree(projectDir, id, dir);
      await this.deps.linkExtensions(projectDir, inputDir);
      const handle = await lib.startPreviewServer({
        input: inputDir,
        port: 0,
        host: "127.0.0.1",
        noWatch: true,
        openBrowser: false,
        verbose: false,
        debug: false,
        installSignalHandlers: false,
      });
      this.current = { id, handle, dir };
      return { url: handle.url };
    } catch (e) {
      await this.deps.removeDir(dir).catch(() => {});
      throw e;
    }
  }

  private async runClose(): Promise<void> {
    const open = this.current;
    if (!open) return;
    this.current = null;
    await open.handle.stop().catch(() => {});
    await this.deps.removeDir(open.dir).catch(() => {});
  }
}
