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
  import { EditorState, Compartment } from "@codemirror/state";
  import {
    defaultKeymap,
    history,
    historyKeymap,
    indentWithTab,
  } from "@codemirror/commands";
  import { markdown } from "@codemirror/lang-markdown";
  import { languages } from "@codemirror/language-data";
  import {
    syntaxHighlighting,
    defaultHighlightStyle,
    bracketMatching,
  } from "@codemirror/language";

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
    return EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        bracketMatching(),
        markdown({ codeLanguages: languages }),
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

  // Mount the EditorView once the host node exists.
  $effect(() => {
    if (!host || view) return;
    view = new EditorView({ state: buildState(content), parent: host });
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
    void filePath;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === nextDoc) return;
    applyingExternal = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: nextDoc },
    });
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
