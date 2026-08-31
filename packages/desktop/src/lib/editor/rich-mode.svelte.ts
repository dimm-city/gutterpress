/**
 * RichModeController (SFE-P3ab, Lane A) — owns which EDITING surface
 * (CodeMirror source, or the shared rich editor) is selected for the
 * document currently open in the desktop editor pane, and enforces that
 * exactly one of them is ever mounted at a time.
 *
 * ## D7/D8 — the "one editing surface" invariant, ASSERTED not assumed
 *
 * `+page.svelte`'s own `{#if mode === "rich"}…{:else}…{/if}` template
 * already makes the two surfaces structurally exclusive — Svelte destroys
 * the old branch before creating the new one, so under NORMAL rendering
 * only one can ever exist in the DOM. That is an ASSUMPTION about how the
 * template happens to be written, not a checked invariant. {@link
 * RichModeController.registerMount}/{@link RichModeController.registerUnmount}
 * turn it into one: every real surface's mount/dispose lifecycle (or, in
 * this file's own unit tests, a synthetic stand-in for that lifecycle)
 * reports itself here, and `registerMount` THROWS if a different surface is
 * already registered live — the review dimension this run names explicitly
 * ("Can both surfaces ever be mounted simultaneously?") gets a loud failure
 * instead of a silent one.
 *
 * Preview (D8's third surface) is NOT part of this invariant — it is a
 * read-only pane that may be visible alongside either editing surface; only
 * source vs. rich are mutually exclusive.
 *
 * ## Undo epoch (D7)
 *
 * "Switching modes establishes an explicit undo epoch ... must never alter
 * source." Concretely, for 0.11.0: CodeMirror's own `history()` extension
 * and the shared rich editor's host-delegated undo (`@vscode/markdown-editor`
 * fork) are two INDEPENDENT undo stacks — D7 is explicit that source and
 * rich "share source and persistence but not an undo stack." There is
 * nothing to merge, hand off, or migrate between them. "Establishing a new
 * undo epoch" therefore means exactly this: the surface becoming active
 * starts with an EMPTY undo history of its own (CodeMirror gets a fresh
 * `EditorState`/`history()` on `switchFile`; a freshly mounted rich editor
 * gets a fresh `EditorModel` with no undo history yet). This controller
 * performs no undo-stack bookkeeping itself — it never touches document
 * text, so it cannot alter source, which is a structural guarantee rather
 * than a runtime check (`rich-mode.test.ts` proves it by asserting a host's
 * `getSnapshot().text` is byte-identical immediately before and after a
 * `switchTo` call). {@link RichModeController.epoch} exists purely as a
 * COUNTER callers can key a remount or a "this is a fresh epoch" assertion
 * off (e.g. a `{#key controller.epoch}` block, or a test).
 *
 * ## What this controller is NOT
 *
 * It holds no reference to an `EditorDocumentHost`, a projection, or any
 * document content. Both surfaces read/write through the SAME host
 * instance their caller hands them; this controller only tracks WHICH
 * surface is selected and WHICH one is currently live in the DOM. Session
 * sharing (dirty state, autosave, recovery, external-change banner, file
 * switching) is therefore automatic: there is exactly one document host in
 * the whole system, never one per surface.
 */

export type EditorSurface = "source" | "rich";

export class RichModeController {
  /**
   * The surface SELECTED for the current document. Reactive — read
   * directly in templates/`$derived`. Defaults to `"source"` (rich mode is
   * off by default this run).
   */
  mode = $state<EditorSurface>("source");

  /**
   * Bumped by {@link switchTo} and {@link onFileSwitch}. See this file's
   * header ("Undo epoch") for exactly what incrementing this means and
   * does not mean.
   */
  epoch = $state(0);

  /**
   * The surface currently REGISTERED as mounted in the DOM, or `null` when
   * neither is. See this file's header ("the one editing surface
   * invariant").
   */
  mountedSurface = $state<EditorSurface | null>(null);

  constructor(options: { initialSurface?: EditorSurface } = {}) {
    this.mode = options.initialSurface ?? "source";
  }

  /**
   * Selects `next` as the active surface for the current document. A no-op
   * (no epoch bump) when `next` already equals {@link mode} — switching to
   * the surface that is already active is not a switch.
   */
  switchTo(next: EditorSurface): void {
    if (next === this.mode) return;
    this.mode = next;
    this.epoch += 1;
  }

  /**
   * Called when the OPEN DOCUMENT changes identity (a file switch), not
   * when the surface changes. D7: "File switches ... are not undoable into
   * the prior file" — a fresh undo boundary applies regardless of which
   * surface stays mounted, so this always bumps {@link epoch}. `mode` is
   * left as-is by default: opening a different file does not, on its own,
   * force the author back to source — pass `nextSurface` to override.
   */
  onFileSwitch(nextSurface: EditorSurface = this.mode): void {
    this.mode = nextSurface;
    this.epoch += 1;
  }

  /**
   * Registers `surface` as the live mounted DOM surface. Throws if a
   * DIFFERENT surface is already registered — see this file's header.
   * Registering the SAME surface twice (a defensive double-call) is a
   * harmless no-op: it is not evidence of two surfaces being mounted
   * simultaneously.
   */
  registerMount(surface: EditorSurface): void {
    if (this.mountedSurface !== null && this.mountedSurface !== surface) {
      throw new Error(
        `RichModeController: "${surface}" tried to mount while "${this.mountedSurface}" is still mounted — only one editing surface may be mounted at a time (D7).`,
      );
    }
    this.mountedSurface = surface;
  }

  /**
   * Unregisters `surface`. A no-op when `surface` is not the currently
   * registered surface — an already-superseded dispose racing in after a
   * newer mount has taken over must not clobber that newer registration.
   */
  registerUnmount(surface: EditorSurface): void {
    if (this.mountedSurface === surface) this.mountedSurface = null;
  }
}

export function createRichModeController(options?: {
  initialSurface?: EditorSurface;
}): RichModeController {
  return new RichModeController(options);
}

/**
 * Svelte action wiring a DOM node's mount/dispose lifecycle to {@link
 * RichModeController.registerMount}/{@link RichModeController.registerUnmount}
 * — the production half of the "asserted, not assumed" invariant (this
 * file's header). `+page.svelte` attaches this to a `display:contents`
 * wrapper around each surface's real branch (`RichEditor`, `MarkdownEditor`)
 * instead of threading mount/dispose callback props through either
 * component — `MarkdownEditor.svelte` is another lane's file and gains no
 * new props here, and `RichEditor.svelte` stays a plain DOM-lifecycle
 * component with no awareness of the controller that happens to be
 * tracking it (composition lives in `+page.svelte`, not in either surface).
 */
export function trackSurfaceMount(
  node: Element,
  params: { controller: RichModeController; surface: EditorSurface },
): { destroy(): void } {
  params.controller.registerMount(params.surface);
  return {
    destroy(): void {
      params.controller.registerUnmount(params.surface);
    },
  };
}
