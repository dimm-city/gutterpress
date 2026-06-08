<script lang="ts">
  /**
   * MarkdownEditor (#38) — a thin CodeMirror 6 wrapper.
   *
   * Renders the markdown source of `filePath` with markdown syntax
   * highlighting and a basic dark theme, emitting `onChange(newContent)` on
   * each user edit. Document switching is handled by reconfiguring the existing
   * EditorView (dispatching a full-document replace) rather than tearing the
   * view down — cheaper and keeps scroll/undo behaviour sane. No print-md
   * extension awareness yet (a follow-on per the issue).
   */
  import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
  import {
    EditorState,
    EditorSelection,
    Compartment,
    type Extension,
  } from "@codemirror/state";
  import {
    defaultKeymap,
    history,
    historyKeymap,
    indentWithTab,
  } from "@codemirror/commands";
  import { markdown } from "@codemirror/lang-markdown";
  import { css } from "@codemirror/lang-css";
  import { languages } from "@codemirror/language-data";
  import {
    syntaxHighlighting,
    HighlightStyle,
    bracketMatching,
  } from "@codemirror/language";
  import { tags as t } from "@lezer/highlight";
  import { linter, lintGutter } from "@codemirror/lint";
  import { autocompletion } from "@codemirror/autocomplete";
  import {
    languageForPath,
    cssDiagnosticsSource,
    pagedMediaCompletionSource,
    type EditorLanguage,
  } from "$lib/editor/css-editor";
  import { untrack } from "svelte";

  let {
    filePath = null,
    content = "",
    onChange,
    onAnchorLine,
  }: {
    filePath?: string | null;
    content?: string;
    onChange?: (value: string) => void;
    /**
     * Editor→preview sync. Fires with the 1-based "anchor" source line: the top
     * visible line on scroll, or the caret line on a deliberate (non-typing)
     * caret move. Debounced via rAF.
     */
    onAnchorLine?: (line: number) => void;
  } = $props();

  let host = $state<HTMLDivElement | undefined>(undefined);
  let view: EditorView | null = null;
  // Guards the updateListener so programmatic document swaps (loading a file)
  // don't echo back through onChange and re-trigger a save.
  let applyingExternal = false;
  // Suppress anchor-line emission until this timestamp — set by revealLine()
  // (preview→editor) so the resulting scroll/selection can't bounce back as an
  // editor→preview event. A timestamp (not a boolean) survives the async scroll
  // event that fires after dispatch returns.
  let suppressEmitUntil = 0;
  let lastEmittedLine = -1;
  let anchorRaf = 0;

  function emitAnchorLine(line: number): void {
    if (!onAnchorLine) return;
    if (Date.now() < suppressEmitUntil) return;
    if (line === lastEmittedLine) return;
    lastEmittedLine = line;
    onAnchorLine(line);
  }

  // Top visible source line = doc line at the top-left of the scroll viewport.
  function topVisibleLine(v: EditorView): number | null {
    const rect = v.scrollDOM.getBoundingClientRect();
    const pos = v.posAtCoords({ x: rect.left + 6, y: rect.top + 6 }, false);
    if (pos == null) return null;
    return v.state.doc.lineAt(pos).number;
  }

  // ── Language / diagnostics / completion compartments (#39) ────────────────
  // The editor is ONE CodeMirror instance whose language + CSS-only extensions
  // are swapped per file via Compartments — no second editor component, no
  // view teardown. CSS files get `@codemirror/lang-css` highlighting, a print-
  // safety lint gutter (reusing the lib's `checkCss`, so it agrees with
  // `print-md validate`), and Paged Media at-rule/property completions. Other
  // file types keep markdown (or plaintext) and carry none of the CSS layers.
  const languageCompartment = new Compartment();
  const cssLintCompartment = new Compartment();
  const cssCompletionCompartment = new Compartment();
  // The language the view is currently configured for. Seeded at mount; the
  // doc-swap effect reconfigures the compartments when it changes.
  let currentLanguage: EditorLanguage = "plain";
  // The filePath the view's document currently belongs to. Used by the doc-swap
  // effect to tell a same-file content reload (preserve caret) from a file
  // switch (reset caret). Seeded at mount alongside the initial document.
  let appliedPath: string | null = null;

  /** Build the language extension for a given resolved language mode. */
  function languageExtension(lang: EditorLanguage): Extension {
    if (lang === "css") return css();
    if (lang === "markdown") return markdown({ codeLanguages: languages });
    return [];
  }

  /** The print-safety lint gutter — active only for CSS docs. */
  function cssLintExtensions(lang: EditorLanguage): Extension {
    if (lang !== "css") return [];
    return [
      lintGutter(),
      linter((cmView) => cssDiagnosticsSource(cmView.state), { delay: 400 }),
    ];
  }

  /** Paged Media completions — active only for CSS docs. */
  function cssCompletionExtensions(lang: EditorLanguage): Extension {
    if (lang !== "css") return [];
    return autocompletion({ override: [pagedMediaCompletionSource] });
  }

  // Theme-aware syntax highlighting. Every colour is a CSS custom property
  // (defined per app theme in the style block below), so the SAME highlight
  // style is legible in both light and dark mode and switches instantly with the
  // app's [data-theme] — no second editor, no rebuild. Replaces CodeMirror's
  // light-tuned defaultHighlightStyle, which rendered as low-contrast mush on the
  // dark background.
  const printmdHighlight = HighlightStyle.define([
    { tag: [t.heading, t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: "var(--cm-heading)", fontWeight: "700" },
    { tag: t.strong, color: "var(--cm-strong)", fontWeight: "700" },
    { tag: t.emphasis, color: "var(--cm-em)", fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: [t.link, t.url], color: "var(--cm-link)", textDecoration: "underline" },
    { tag: t.quote, color: "var(--cm-quote)", fontStyle: "italic" },
    // Markdown structural markers (##, *, -, >, |, ```), kept subtle but visible.
    { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "var(--cm-marker)" },
    { tag: [t.list, t.labelName], color: "var(--cm-marker)" },
    // Inline / fenced code + embedded languages.
    { tag: [t.monospace], color: "var(--cm-code)" },
    { tag: [t.string, t.special(t.string), t.attributeValue], color: "var(--cm-string)" },
    { tag: [t.number, t.atom, t.bool, t.special(t.variableName)], color: "var(--cm-number)" },
    { tag: [t.keyword, t.modifier, t.operatorKeyword], color: "var(--cm-keyword)" },
    { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--cm-comment)", fontStyle: "italic" },
    // Embedded HTML (common in print-md covers/layout blocks) + CSS.
    { tag: [t.tagName, t.angleBracket], color: "var(--cm-tag)" },
    { tag: [t.attributeName], color: "var(--cm-attr)" },
    { tag: [t.propertyName], color: "var(--cm-property)" },
    { tag: [t.className, t.typeName, t.namespace], color: "var(--cm-class)" },
    { tag: [t.variableName, t.definition(t.variableName)], color: "var(--cm-text)" },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--cm-function)" },
    { tag: [t.punctuation, t.separator, t.bracket], color: "var(--cm-punct)" },
    { tag: t.invalid, color: "var(--cm-invalid)" },
  ]);

  const editableTheme = EditorView.theme({
    "&": {
      height: "100%",
      fontSize: "13px",
      backgroundColor: "var(--app-bg)",
      color: "var(--cm-text)",
    },
    ".cm-scroller": {
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      lineHeight: "1.6",
      overflow: "auto",
    },
    ".cm-content": { caretColor: "var(--app-accent, #4ea1ff)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--app-accent, #4ea1ff)" },
    // Selection — explicit in BOTH focused and unfocused states so it reads in
    // light and dark (CodeMirror's built-in selection colour assumes one theme).
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: "var(--cm-selection)" },
    ".cm-gutters": {
      backgroundColor: "var(--cm-gutter-bg)",
      color: "var(--cm-gutter-text)",
      border: "none",
    },
    // Subtle active-line tint — must NOT wash out the text on that line (the old
    // --app-control-hover-bg was far too strong).
    ".cm-activeLine": { backgroundColor: "var(--cm-active-line)" },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--cm-active-line)",
      color: "var(--cm-text)",
    },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
      backgroundColor: "var(--cm-bracket-bg)",
      outline: "1px solid var(--cm-bracket-outline)",
    },
    ".cm-selectionMatch": { backgroundColor: "var(--cm-selection)" },
    "&.cm-focused": { outline: "none" },
  });

  function buildState(doc: string): EditorState {
    const lang = languageForPath(filePath);
    return EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        bracketMatching(),
        languageCompartment.of(languageExtension(lang)),
        cssLintCompartment.of(cssLintExtensions(lang)),
        cssCompletionCompartment.of(cssCompletionExtensions(lang)),
        syntaxHighlighting(printmdHighlight, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        editableTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingExternal) {
            onChange?.(update.state.doc.toString());
          }
          // Editor→preview sync on a DELIBERATE caret move (click / arrow key),
          // not while typing — typing would yank the preview on every keystroke.
          if (onAnchorLine && update.selectionSet && !update.docChanged) {
            emitAnchorLine(
              update.state.doc.lineAt(update.state.selection.main.head).number,
            );
          }
        }),
      ],
    });
  }

  // Mount the EditorView once the host node exists. Only `host` is a tracked
  // dependency — the content/filePath reads are wrapped in untrack(). Otherwise
  // every keystroke (which mutates `content`) re-runs this effect, and its
  // cleanup destroys + recreates the whole EditorView, collapsing the caret to 0
  // and dropping focus ("editor jumps / loses focus while typing"). Subsequent
  // content/file changes are handled by the doc-swap effect below, on the SAME
  // view instance.
  let detachScroll: (() => void) | null = null;
  $effect(() => {
    if (!host || view) return;
    untrack(() => {
      currentLanguage = languageForPath(filePath);
      appliedPath = filePath;
      view = new EditorView({ state: buildState(content), parent: host });
      // Editor→preview scroll sync: emit the top visible line as the user
      // scrolls (rAF-coalesced). Bound to scrollDOM rather than updateListener
      // because pure scrolling doesn't produce editor transactions.
      const v = view;
      const onScroll = () => {
        if (anchorRaf) return;
        anchorRaf = requestAnimationFrame(() => {
          anchorRaf = 0;
          const line = topVisibleLine(v);
          if (line != null) emitAnchorLine(line);
        });
      };
      v.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
      detachScroll = () => v.scrollDOM.removeEventListener("scroll", onScroll);
    });
    return () => {
      if (anchorRaf) cancelAnimationFrame(anchorRaf);
      anchorRaf = 0;
      detachScroll?.();
      detachScroll = null;
      view?.destroy();
      view = null;
    };
  });

  // Swap the document when the selected file (or its loaded content) changes.
  // Keyed on filePath so re-loading the SAME file (e.g. external edit) replaces
  // text only when content actually differs from what's in the view.
  $effect(() => {
    const nextDoc = content;
    // Track filePath so the effect re-runs on file switch even if content
    // happens to match.
    const nextPath = filePath;
    const nextLang = languageForPath(filePath);
    if (!view) return;

    // Switching to a different file is a fresh document: the prior caret/scroll
    // is meaningless against new content, so let the replace reset to the top.
    // Re-applying content for the SAME file (external-edit reload) preserves the
    // caret/scroll so the editor never jumps mid-edit (#38).
    const sameFile = nextPath === appliedPath;
    appliedPath = nextPath;

    // Reconfigure language + CSS-only extensions when switching to a file of a
    // different type (e.g. .md → .css). Compartment.reconfigure swaps the
    // extension without tearing the view down (same instance, new mode).
    if (nextLang !== currentLanguage) {
      currentLanguage = nextLang;
      view.dispatch({
        effects: [
          languageCompartment.reconfigure(languageExtension(nextLang)),
          cssLintCompartment.reconfigure(cssLintExtensions(nextLang)),
          cssCompletionCompartment.reconfigure(cssCompletionExtensions(nextLang)),
        ],
      });
    }

    const current = view.state.doc.toString();
    if (current === nextDoc) return;
    applyingExternal = true;
    if (sameFile) {
      // Same-file content replace (external-edit reload): a naive full-document
      // dispatch collapses the selection to offset 0 and snaps scroll to the top
      // — the editor would "jump" mid-edit. Clamp the existing selection into the
      // new document and keep the viewport anchored to the caret.
      const prevSel = view.state.selection;
      const docLen = nextDoc.length;
      const clampedSel = prevSel.ranges.map((r) =>
        EditorSelection.range(Math.min(r.anchor, docLen), Math.min(r.head, docLen)),
      );
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: nextDoc },
        selection: EditorSelection.create(
          clampedSel,
          Math.min(prevSel.mainIndex, clampedSel.length - 1),
        ),
        effects: EditorView.scrollIntoView(Math.min(prevSel.main.head, docLen)),
        scrollIntoView: false,
      });
    } else {
      // Different file: fresh document, reset caret/scroll to the top.
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: nextDoc },
      });
    }
    applyingExternal = false;
  });

  /** Move keyboard focus into the editor (used when the pane is opened). */
  export function focus(): void {
    view?.focus();
  }

  /**
   * Scroll/move the caret to a 1-based source line (preview→editor sync).
   * Suppresses the cursor-line echo so it doesn't bounce back to the preview.
   */
  export function revealLine(line: number): void {
    if (!view) return;
    const doc = view.state.doc;
    const clamped = Math.max(1, Math.min(line, doc.lines));
    const pos = doc.line(clamped).from;
    // Suppress the echo across the async scroll event the dispatch triggers.
    suppressEmitUntil = Date.now() + 300;
    lastEmittedLine = clamped;
    view.dispatch({
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
  }
</script>

<div class="editor-wrap">
  {#if !filePath}
    <div class="editor-empty">
      <p>Select a file from the list to start editing.</p>
    </div>
  {/if}
  <div class="editor-host" bind:this={host} class:hidden={!filePath}></div>
</div>

<style>
  .editor-wrap {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: var(--app-bg);
  }
  .editor-host {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }
  .editor-host.hidden {
    display: none;
  }
  .editor-empty {
    flex: 1;
    display: grid;
    place-items: center;
    padding: 24px;
    color: var(--app-text-faint);
    font-size: 13px;
    text-align: center;
  }
  .editor-empty p {
    margin: 0;
    max-width: 240px;
    line-height: 1.5;
  }

  /* ── CodeMirror syntax palette (consumed by printmdHighlight + editableTheme) ──
     Tokens flip with the app's [data-theme] so the SAME highlight style is
     legible in both modes. Dark is the default (covers the no-attr first paint);
     light overrides below. Tuned for contrast: markers visible-but-subtle, code
     tokens clearly differentiated, body text high-contrast. */
  :global(:root),
  :global([data-theme="dark"]) {
    --cm-text: #d8dee9;
    --cm-heading: #c8a8ff;
    --cm-strong: #f2f4f8;
    --cm-em: #d8dee9;
    --cm-link: #5cb3ff;
    --cm-quote: #9aa5b1;
    --cm-marker: #8195b5;
    --cm-code: #e6c07b;
    --cm-string: #a8d08d;
    --cm-number: #f0a36b;
    --cm-keyword: #c792ea;
    --cm-comment: #7c8590;
    --cm-tag: #ff8f8f;
    --cm-attr: #ffcb6b;
    --cm-property: #82aaff;
    --cm-class: #ffcb6b;
    --cm-function: #82aaff;
    --cm-punct: #9aa5b1;
    --cm-invalid: #ff6b6b;
    --cm-selection: rgba(92, 179, 255, 0.28);
    --cm-active-line: rgba(255, 255, 255, 0.05);
    --cm-gutter-bg: var(--app-surface, #252526);
    --cm-gutter-text: #6b7280;
    --cm-bracket-bg: rgba(92, 179, 255, 0.18);
    --cm-bracket-outline: rgba(92, 179, 255, 0.5);
  }
  :global([data-theme="light"]) {
    --cm-text: #1f2328;
    --cm-heading: #6639ba;
    --cm-strong: #1f2328;
    --cm-em: #1f2328;
    --cm-link: #0969da;
    --cm-quote: #57606a;
    --cm-marker: #6e7781;
    --cm-code: #953800;
    --cm-string: #0a7d33;
    --cm-number: #953800;
    --cm-keyword: #cf222e;
    --cm-comment: #6e7781;
    --cm-tag: #116329;
    --cm-attr: #0550ae;
    --cm-property: #0550ae;
    --cm-class: #953800;
    --cm-function: #8250df;
    --cm-punct: #57606a;
    --cm-invalid: #cf222e;
    --cm-selection: rgba(9, 105, 218, 0.18);
    --cm-active-line: rgba(27, 31, 36, 0.045);
    --cm-gutter-bg: var(--app-surface, #f6f8fa);
    --cm-gutter-text: #8c959f;
    --cm-bracket-bg: rgba(9, 105, 218, 0.14);
    --cm-bracket-outline: rgba(9, 105, 218, 0.45);
  }
</style>
