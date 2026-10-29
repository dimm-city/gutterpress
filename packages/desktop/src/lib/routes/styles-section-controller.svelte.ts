/**
 * StylesSectionController — the single owner of the manifest's `styles:`
 * list in Book setup › Advanced: the stylesheets the book uses, in load order
 * (`used`), and the other `.css` files of the book it could add (`unused`).
 * The verbs are the extension list's: move up/down, Remove, and Add; each
 * rewrites the whole `styles:` list in one write (`setActive`), so a later
 * entry in it wins where two disagree. Remove takes a stylesheet off the list
 * and never touches the file.
 *
 * A book always uses a stylesheet: with `styles:` empty the renderer falls
 * back to `styles/book.css`, else the first `.css` it finds
 * (`resolveActiveStyles`), so the last one listed cannot be removed — the
 * list would show it again. A book with no `.css` at all gets `styles/book.css`
 * from `create`, the design controller's `ensureStylesheet` (what its first
 * design edit does).
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (§8): `ProjectStyle` is a type-only import.
 */

import type { ProjectStyle } from "#lib/platform/dtos.ts";
import { orderAfterMove } from "#lib/components/config/config-helpers.ts";

export interface StylesSectionDeps {
  /** The open project directory (reactive prop), or null when none is open. */
  projectDir: () => string | null;
  /** The book's stylesheets: those in use, in order (`active`), then its other `.css` files. */
  listStyles: (projectDir: string) => Promise<ProjectStyle[]>;
  /** Replace the manifest's `styles:` list (project-relative paths). */
  setActiveStyles: (projectDir: string, paths: string[]) => Promise<unknown>;
  /** Give a book with no stylesheet `styles/book.css`. */
  createStylesheet: () => Promise<unknown>;
  /** After any change: the design settings follow the book's first stylesheet. */
  afterChange?: () => Promise<void>;
}

export class StylesSectionController {
  styles = $state<ProjectStyle[]>([]);
  error = $state<string | null>(null);
  /** An action is in flight. */
  busy = $state(false);
  /** The Book setup header's Saving… / Saved, for this list's writes. */
  saveStatus = $state<"idle" | "saving" | "saved">("idle");

  private readonly deps: StylesSectionDeps;

  constructor(deps: StylesSectionDeps) {
    this.deps = deps;
  }

  /** The stylesheets the book uses, in load order. */
  get used(): ProjectStyle[] {
    return this.styles.filter((s) => s.active);
  }

  /** The book's other `.css` files: what the Add area offers. */
  get unused(): ProjectStyle[] {
    return this.styles.filter((s) => !s.active);
  }

  loadStyles = async (): Promise<void> => {
    const projectDir = this.deps.projectDir();
    if (!projectDir) return;
    try {
      this.styles = await this.deps.listStyles(projectDir);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  };

  /** Move `s` one slot up (-1) or down (+1) in load order. */
  move = (s: ProjectStyle, delta: -1 | 1): Promise<void> => {
    const order = orderAfterMove(this.used.map((x) => x.displayName), s.displayName, delta);
    return order ? this.write(order) : Promise.resolve();
  };

  /** Take `s` off the list; the file stays. Refused for the last one (see above). */
  remove = (s: ProjectStyle): Promise<void> =>
    this.used.length > 1 ? this.write(this.used.filter((x) => x.path !== s.path).map((x) => x.displayName)) : Promise.resolve();

  /** Add one of the book's `.css` files at the end, where it wins. */
  add = (s: ProjectStyle): Promise<void> => this.write([...this.used.map((x) => x.displayName), s.displayName]);

  create = (): Promise<void> => this.run(() => this.deps.createStylesheet());

  private write(paths: string[]): Promise<void> {
    return this.run((dir) => this.deps.setActiveStyles(dir, paths));
  }

  /** Every verb: refuse while busy, run, reload the list and the design settings, surface a failure. */
  private async run(action: (projectDir: string) => Promise<unknown>): Promise<void> {
    const projectDir = this.deps.projectDir();
    if (!projectDir || this.busy) return;
    this.busy = true;
    this.error = null;
    this.saveStatus = "saving";
    try {
      await action(projectDir);
      await this.loadStyles();
      await this.deps.afterChange?.();
      this.saveStatus = "saved";
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.saveStatus = "idle";
    } finally {
      this.busy = false;
    }
  }
}
