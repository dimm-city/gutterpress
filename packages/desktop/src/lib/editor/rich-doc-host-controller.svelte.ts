/**
 * RichDocHostController (SFE-P6a) — owns the `DesktopDocumentHost` +
 * D6 projection lifecycle for the desktop's rich-mode editing surface.
 *
 * Extracted from `+page.svelte`'s `richDocHost`/`richProjection`/
 * `richPluginCss` state and its `rebuildRichDocHost`/`disposeRichDocHost`
 * functions (SFE-P3ab Lane A, hardened across SFE-P3e review rounds 1-2 —
 * see below). This is pure document-host plumbing: constructing a fresh
 * `DesktopDocumentHost` per rich-mode file, forwarding its edits into the
 * shared session, and publishing its D6 projection once the (possibly
 * async, host-routed) build resolves. It deliberately does NOT own mode
 * selection (`RichModeController`, this directory's `rich-mode.svelte.ts` —
 * see that file's own "What this controller is NOT" section, which this
 * class respects by staying a strictly separate concern) or any of the
 * command-routing/dialog coordination that reads `host`/`projection` to
 * apply an edit — `+page.svelte` keeps that explicit, cross-feature
 * coordination itself (D4: "Cross-feature coordination stays explicit in
 * the root — no event bus").
 *
 * ## Why publication is deferred until the projection resolves
 *
 * SFE-P3e review round 1 (CONFIRMED finding): an earlier version published
 * `host` synchronously and patched in `projection`/`pluginCss` once the
 * (async, IPC-routed) projection build resolved. Svelte flushes a
 * synchronous assignment — and the `{#key host}` mount it drives — in a
 * microtask, well before the real IPC round trip powering
 * `deps.buildProjection` can return, so the mount always ran on a null
 * projection and took the plain (non-Gutterpress-aware) editor branch, with
 * nothing to correct it later (rich-mode mounts read `projection` once in
 * `onMount`; `$effect` is banned in this SPA). Publishing `host`,
 * `projection`, and `pluginCss` together, only once the build resolves, is
 * what actually reaches the Gutterpress-aware mount; callers show their own
 * "Loading rich editor…" state for the brief gap.
 *
 * ## Why every publish is epoch-guarded
 *
 * SFE-P3e review round 1 (CONFIRMED finding): a rebuild superseded by a
 * later rebuild (a fast file switch) or a `dispose()` (leaving rich mode)
 * before its own async `buildProjection` round trip resolves must never
 * publish over whatever superseded it — publishing late would silently
 * revert the visible document to stale content. `rebuild`/`dispose` both
 * bump a private epoch counter; the async publish checks it immediately
 * before writing `host`/`projection`/`pluginCss`. See
 * `tests/editor/rich-doc-host-controller.test.ts` for the race proof this
 * replaces (formerly a hand-modeled harness against `+page.svelte`'s
 * private closure state, since a large `.svelte` file could not be
 * imported directly — see that test's own history note).
 *
 * ## Why `whenSettled()` exists
 *
 * SFE-P3e review round 2 (CONFIRMED finding): a caller that switches the
 * open file (`EditorFileSession.select`) triggers `rebuild()`
 * SYNCHRONOUSLY, but publishing the rebuilt host is itself async (the
 * paragraph above). A caller that needs the switch to be FULLY settled
 * before proceeding — `+page.svelte`'s `selectEditorFile`, so a rich-mode
 * edit issued immediately after a cross-chapter switch is never silently
 * dropped or applied to the wrong (pre-switch) host — awaits
 * `whenSettled()` after triggering the switch. Every caller that does not
 * care pays nothing extra: `whenSettled()` resolves immediately whenever no
 * rebuild is currently in flight.
 */
import { DesktopDocumentHost } from "$lib/editor-host/desktop-document-host";
import type { GutterpressProjection } from "gutterpress/render";

export interface RichDocHostBuildResult {
  readonly projection: GutterpressProjection;
  readonly editorCss: string | undefined;
}

export interface RichDocHostControllerDeps {
  /** Build the D6 projection for `content` at `sourceVersion` — the
   *  host-built, plugin-aware projection when a desktop project is open
   *  (SFE-P3e), else the local plugin-less `gutterpress/render` build.
   *  Degrade-and-report diagnostics for a failed/oversized build are the
   *  caller's own concern (reported via toast in `+page.svelte`'s
   *  `buildRichProjection`) — this controller only awaits the result. */
  buildProjection(content: string, sourceVersion: number): Promise<RichDocHostBuildResult>;
  /** Forward every accepted rich-mode edit into the shared editing session
   *  — `rich-mode.svelte.ts`'s header explains why this convergence is
   *  explicit rather than structural. */
  onSnapshotChange(text: string): void;
  /** Called when a document built WITHOUT the book's CSS is rebuilt — worth a log line, since it means the first build was degraded. */
  onDegradedRebuild?(path: string): void;
}

export class RichDocHostController {
  /** The live rich-mode document host, or `null` when no markdown file is
   *  open in rich mode. Published only once its projection has resolved —
   *  see this file's header. */
  host = $state<DesktopDocumentHost | null>(null);
  /** The D6 projection for {@link host}'s document, in lockstep with it. */
  projection = $state<GutterpressProjection | null>(null);
  /** Plugin CSS from the host-built projection (SFE-P3e); `undefined` on
   *  the local (no-project) path. In lockstep with {@link host}. */
  editorCss = $state<string | undefined>(undefined);

  private readonly deps: RichDocHostControllerDeps;
  private unsub: (() => void) | null = null;
  private epoch = 0;
  private pending: Promise<void> | null = null;
  /** What the live host was built from, so a DEGRADED build can be redone. */
  private built: { path: string; content: string } | null = null;

  constructor(deps: RichDocHostControllerDeps) {
    this.deps = deps;
  }

  /** Resolves once any in-flight `rebuild()` has published (or immediately
   *  when none is in flight) — see this file's header ("Why `whenSettled()`
   *  exists"). */
  async whenSettled(): Promise<void> {
    if (this.pending) await this.pending;
  }

  /**
   * (Re)builds the document host for `path`/`content`. `path === null`
   * clears the host entirely (leaving rich mode, or no file open). Every
   * call — including a rebuild superseding a still-in-flight one —
   * supersedes whatever this controller previously published or had
   * pending; see this file's header for the epoch guard this relies on.
   */
  rebuild(path: string | null, content: string): void {
    this.unsub?.();
    this.unsub = null;
    this.epoch += 1;
    const epoch = this.epoch;
    if (!path) {
      this.host = null;
      this.projection = null;
      this.editorCss = undefined;
      this.pending = null;
      return;
    }
    this.built = { path, content };
    const nextHost = new DesktopDocumentHost(content, { documentId: path });
    this.unsub = nextHost.subscribe((snapshot) => this.deps.onSnapshotChange(snapshot.text));
    this.pending = this.deps
      .buildProjection(content, nextHost.getSnapshot().version)
      .then((result) => {
        if (epoch !== this.epoch) return;
        this.projection = result.projection;
        this.editorCss = result.editorCss;
        this.host = nextHost;
      })
      .finally(() => {
        if (epoch === this.epoch) this.pending = null;
      });
  }

  /**
   * Rebuild if the live document was built WITHOUT the project's own CSS.
   *
   * A chapter chosen before its project finished opening gets a projection
   * with no plugins and no book CSS — the document renders, but unstyled and
   * unpaginated, and nothing afterwards asks for it again. It stayed that way
   * for the rest of the session; only switching to another file recovered.
   * The host calls this once the project is genuinely up, and it is a no-op
   * for every document that was built properly in the first place.
   */
  rebuildIfDegraded(): void {
    if (this.editorCss !== undefined || !this.built || this.pending) return;
    this.deps.onDegradedRebuild?.(this.built.path);
    this.rebuild(this.built.path, this.built.content);
  }

  /** Drops the current host entirely (leaving rich mode). Supersedes any
   *  in-flight `rebuild()` the same way a later `rebuild()` call would. */
  dispose(): void {
    this.unsub?.();
    this.unsub = null;
    this.epoch += 1;
    this.host = null;
    this.projection = null;
    this.editorCss = undefined;
    this.pending = null;
    this.built = null;
  }
}
