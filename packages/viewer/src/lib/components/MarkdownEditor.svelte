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
    defaultHighlightStyle,
    bracketMatching,
  } from "@codemirror/language";
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
  }: {
    filePath?: string | null;
    content?: string;
    onChange?: (value: string) => void;
  } = $props();

  let host = $state<HTMLDivElement | undefined>(undefined);
  let view: EditorView | null = null;
  // Guards the updateListener so programmatic document swaps (loading a file)
  // don't echo back through onChange and re-trigger a save.
  let applyingExternal = false;

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

  const editableTheme = EditorView.theme(
    {
      "&": {
        height: "100%",
        fontSize: "13px",
        backgroundColor: "var(--app-bg)",
        color: "var(--app-text)",
      },
      ".cm-scroller": {
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        lineHeight: "1.6",
        overflow: "auto",
      },
      ".cm-content": { caretColor: "var(--app-accent, #4ea1ff)" },
      ".cm-gutters": {
        backgroundColor: "var(--app-surface, var(--app-bg))",
        color: "var(--app-text-faint)",
        border: "none",
      },
      ".cm-activeLine": { backgroundColor: "var(--app-control-hover-bg)" },
      ".cm-activeLineGutter": {
        backgroundColor: "var(--app-control-hover-bg)",
      },
      "&.cm-focused": { outline: "none" },
    },
    { dark: true },
  );

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
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        editableTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingExternal) {
            onChange?.(update.state.doc.toString());
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
  $effect(() => {
    if (!host || view) return;
    untrack(() => {
      currentLanguage = languageForPath(filePath);
      appliedPath = filePath;
      view = new EditorView({ state: buildState(content), parent: host });
    });
    return () => {
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
</style>
