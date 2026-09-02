import {
  createVscodeEditorAdapter,
  type VscodeEditorAdapter,
  type VscodeEditorAdapterOptions,
} from "../vscode-adapter/index.ts";
import type { Diagnostic, EditorDocumentHost } from "../core/index.ts";
import {
  FORK_DEFAULT_THEME_CSS,
  FORK_EDITOR_BASE_CSS,
  FORK_THEME_CLASS_NAME,
} from "./fork-editor-css.ts";

/**
 * SFE-P2a Lane A — the adapter-backed web mount shell.
 *
 * P1a's `mountEditor` rendered a plain `<textarea>` (see this run's report
 * for the full rationale of why that shell existed and what replaces it).
 * This run's job, per its own DETAILS: swap that shell's internals for the
 * REAL `@vscode/markdown-editor` fork surface — `createVscodeEditorAdapter`
 * (`../vscode-adapter/index.ts`, proven against a real browser by P1b's
 * `tests/vscode-adapter/browser.cases.btest.ts` and its siblings, ALL of
 * which stay unmodified and green per this run's "Behavior that must remain
 * unchanged") — while keeping `mountEditor`'s and `EditorMount`'s PUBLIC
 * SHAPE byte-compatible: same signature, same return shape, same diagnostic
 * surfacing, same idempotent/late-notification-proof dispose semantics, same
 * remount cleanliness.
 *
 * What THIS module adds beyond a bare call to `createVscodeEditorAdapter`
 * (the reason `mountEditor` is not simply an alias for it): the fork ships
 * as bare TS/CSS source with no runtime CSS-injection of its own (P1b's own
 * case 7 proved this — the harness/test entries inject `editor.css` +
 * `themes/default.css` themselves, via a `<link>`-tag page shell for the
 * Node-side harness and a client-side `injectCustomStyle` call for the
 * a11y suite's EXTRA sheet). A real host (desktop's rich-editor shell, a
 * VS Code webview) has no equivalent page shell to lean on, so
 * `mountEditor` — the one surface every host mounts through — is the
 * correct, single place to own that responsibility, once: inject the
 * fork's own chrome CSS (`fork-editor-css.ts`, a byte-for-byte, mechanically
 * escaped copy of the fork's `editor.css` + `themes/default.css` — see that
 * file's header for exactly what is and is not included and why), apply its
 * default theme's class name so that CSS actually takes effect, wire
 * `options.onDiagnostic`/`options.readonly` through to the adapter, and
 * return the same `EditorMount` shape.
 *
 * CSS injection is scoped to `container.ownerDocument` (an isolated
 * document/iframe/webview gets its OWN copy, never the host page's) and
 * done freshly PER MOUNT — a plain `<style>` element created before the
 * adapter/view is constructed (so the view's first layout pass already sees
 * the real chrome CSS, not a flash of unstyled content) and removed on
 * `dispose()`. The run spec named a refcounted-per-document alternative
 * (share one `<style>` element across every mount in the same document);
 * per-mount was chosen instead as the smaller design (plan: "prefer the
 * smallest design that fully satisfies the specification") — it needs no
 * shared registry, no refcount bookkeeping, and no cross-mount coupling
 * ("did some OTHER mount already inject this document's CSS, and did IT
 * get disposed first"); dispose stays trivially symmetric with mount. Its
 * cost is duplicated CSS payload (today ~60KB of text) per additional
 * simultaneous mount in the SAME document — currently never more than two
 * in this run's own browser suite (mount.btest.ts) or the fork's own P1b
 * a11y case 7c precedent. If a later run mounts many editors per document
 * routinely, revisit toward the refcounted form; nothing here forecloses it.
 */

/** Options accepted by `mountEditor`. */
export interface EditorMountOptions {
  /**
   * Called whenever a submitted edit is REJECTED by the host (stale,
   * readonly, or invalid-range) — see `diagnosticForEditRejection` in
   * `../core/diagnostics.ts`, the single place that reason -> category
   * pairing is defined. `mountEditor` never throws on a rejection; this is
   * the only channel a caller has for observing one. Threaded straight
   * through to `createVscodeEditorAdapter`'s own `onDiagnostic`.
   */
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void;

  /**
   * Mounts the editor in readonly mode. `EditorDocumentHost` (D3/D7)
   * deliberately exposes no queryable "is this host readonly" flag — see
   * `VscodeEditorAdapterOptions.readonly`'s own doc comment
   * (`../vscode-adapter/adapter.ts`) for why only the CALLER that
   * constructed `host` can know this, so it is threaded through here rather
   * than guessed. Threaded straight through to the adapter, which
   * proactively sets the model's readonly mode (verified live in
   * `tests/vscode-adapter/input-a11y/input-a11y.btest.ts`'s bonus case: a
   * readonly-mounted editor "ignores typed input entirely — no edit is
   * ever attempted", not merely "attempts and gets rejected"). Defaults to
   * `false`.
   */
  readonly readonly?: boolean;

  /**
   * The fork's `renderCustomBlock` hook (D6/G-11) — must be supplied at
   * `EditorView` CONSTRUCTION time, so it is threaded straight through to
   * `createVscodeEditorAdapter`'s `viewOptions`. `../gutterpress/mount.ts`
   * is the caller; a plain mount leaves it unset and gets the fork's
   * default block views.
   */
  readonly renderCustomBlock?: NonNullable<VscodeEditorAdapterOptions["viewOptions"]>["renderCustomBlock"];

  /** Container grouping hook (fork Patch 3): runs of top-level blocks mounted inside host-described wrapper elements. */
  readonly groupBlocks?: NonNullable<VscodeEditorAdapterOptions["viewOptions"]>["groupBlocks"];

  /**
   * Theme class applied to the editor root. Defaults to the fork's own
   * default theme; `null` applies NO theme, for hosts that supply the
   * document's real typography through `extraCss` (a Gutterpress book's own
   * stylesheets).
   */
  readonly themeClassName?: string | null;

  /** Render the fork's sticky lock/pencil read-only toggle. Defaults to `true`. */
  readonly showReadonlyToggle?: boolean;

  /** Fork Patch 4: decorate a freshly rendered inactive top-level block (markdown-it-attrs trailers, …). */
  readonly decorateInactiveBlock?: NonNullable<VscodeEditorAdapterOptions["viewOptions"]>["decorateInactiveBlock"];

  /** Fork Patch 5: re-layout the mounted document before the editor measures it (pagination). */
  readonly afterDocumentMount?: NonNullable<VscodeEditorAdapterOptions["viewOptions"]>["afterDocumentMount"];

  /**
   * An additional stylesheet, appended to `container.ownerDocument` AFTER
   * the fork's own base + default-theme CSS (so it wins equal-specificity
   * ties against the default theme), scoped and disposed exactly like the
   * base CSS. Preserves the P1b case-7 "custom CSS reaches computed styles"
   * capability (`tests/vscode-adapter/input-a11y/input-a11y.btest.ts`) for
   * callers that go through `mountEditor` instead of the raw adapter —
   * this run's own `tests/web/mount.btest.ts` proves it end-to-end.
   */
  readonly extraCss?: string;
}

/** Handle returned by `mountEditor`. */
export interface EditorMount {
  /**
   * Tears down the mounted adapter (view, controller, both its internal
   * subscriptions) and removes every `<style>` element this mount injected
   * (base fork CSS, and `extraCss` if supplied). Idempotent — calling
   * `dispose()` more than once is a no-op, not a throw, matching P1a's own
   * `EditorMount.dispose()` contract and `VscodeEditorAdapter.dispose()`'s.
   */
  dispose(): void;

  /**
   * SFE-P3ab (Lane C) — an ADDITIVE member: existing callers built against
   * the pre-P3ab `{ dispose() }` shape are unaffected (structural typing —
   * nothing destructures this out). Straight passthrough to
   * `VscodeEditorAdapter.getSelection()` (`../vscode-adapter/adapter.ts`,
   * whose own doc comment has the full contract) — this wrapper adds CSS
   * injection and option defaulting, not a second selection
   * implementation.
   */
  getSelection(): { readonly from: number; readonly to: number } | undefined;
}

/**
 * Mounts a real `@vscode/markdown-editor` fork surface into `container`,
 * backed by `host`.
 *
 * `container` must be a real, attached-or-detached DOM `Element` with a
 * non-null `ownerDocument` (true of every `Element` a real browser or
 * webview ever hands out) — `mountEditor` creates its `<style>` elements via
 * `container.ownerDocument`, not the `document` global, so CSS injection
 * works correctly inside an iframe or a document other than the host page's
 * own (D7/G-03's later presentation host).
 *
 * Mounting is synchronous: the underlying model holds the host's CURRENT
 * snapshot (`host.getSnapshot()`) before this function returns, matching
 * D2's "opening ... changes zero bytes" — see `createVscodeEditorAdapter`'s
 * own doc comment for the exact mechanism.
 */
export function mountEditor(
  container: Element,
  host: EditorDocumentHost,
  options: EditorMountOptions = {},
): EditorMount {
  const doc = container.ownerDocument;
  if (!doc) {
    // Not a rejection this run's D3/D14 diagnostic taxonomy covers (it is a
    // caller-usage error, not a document/edit-lifecycle event) — every real
    // Element has an ownerDocument, so reaching this is a broken caller, and
    // failing loudly here is more honest than silently no-oping (matches
    // P1a's own guard, unchanged).
    throw new Error("mountEditor: container has no ownerDocument");
  }

  const styleHost = doc.head ?? doc.documentElement;
  if (!styleHost) {
    // Symmetric with the ownerDocument guard above: every real HTML document
    // has at least a document element, so reaching this is also a broken
    // caller/host, not a D14 diagnostic case.
    throw new Error(
      "mountEditor: container's ownerDocument has no <head> or document element to attach editor CSS to",
    );
  }

  // Injected BEFORE the adapter/view is constructed, so the view's first
  // layout pass already sees the real chrome CSS rather than a flash of
  // unstyled content.
  const baseStyleEl = doc.createElement("style");
  baseStyleEl.setAttribute("data-gp-editor-css", "fork-base");
  baseStyleEl.textContent = `${FORK_EDITOR_BASE_CSS}\n${FORK_DEFAULT_THEME_CSS}`;
  styleHost.appendChild(baseStyleEl);

  let extraStyleEl: Element | undefined;
  if (options.extraCss !== undefined) {
    extraStyleEl = doc.createElement("style");
    extraStyleEl.setAttribute("data-gp-editor-css", "extra");
    extraStyleEl.textContent = options.extraCss;
    styleHost.appendChild(extraStyleEl);
  }

  const adapter: VscodeEditorAdapter = createVscodeEditorAdapter(container, host, {
    onDiagnostic: options.onDiagnostic,
    readonly: options.readonly,
    viewOptions: {
      classNames: options.themeClassName === null ? [] : [options.themeClassName ?? FORK_THEME_CLASS_NAME],
      renderCustomBlock: options.renderCustomBlock,
      groupBlocks: options.groupBlocks,
      showReadonlyToggle: options.showReadonlyToggle,
      decorateInactiveBlock: options.decorateInactiveBlock,
      afterDocumentMount: options.afterDocumentMount,
    },
  });

  let disposed = false;

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      adapter.dispose();
      baseStyleEl.remove();
      extraStyleEl?.remove();
    },
    getSelection: (): { readonly from: number; readonly to: number } | undefined => adapter.getSelection(),
  };
}
