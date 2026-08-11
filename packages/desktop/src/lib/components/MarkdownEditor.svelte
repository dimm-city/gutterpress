<script lang="ts">
  /**
   * MarkdownEditor (#38) — a thin CodeMirror 6 wrapper.
   *
   * Renders the markdown source of `filePath` with markdown syntax
   * highlighting and a basic dark theme, emitting `onChange(newContent)` on
   * each user edit. No Gutterpress extension awareness yet (a follow-on per the
   * issue).
   *
   * ## Two document shapes
   *
   * `switchBook(sections)` opens the WHOLE BOOK as one continuous document —
   * every chapter concatenated in manifest `source.files` order, with the
   * boundaries carried as mapped positions in `bookField` (see
   * `$lib/editor/book-field.ts`) rather than as separator text. Scrolling runs
   * from the first line of the book to the last without stopping at a file's
   * end, and `(chapter, line) ↔ document line` — the only thing editor↔preview
   * sync ever needed — is a table lookup, which is what let the cross-chapter
   * open/poll/retry machinery be deleted outright.
   *
   * `switchFile(path, content)` opens ONE file, exactly as this component
   * always did. That is the shape for stylesheets and for markdown that isn't
   * part of the book. Both shapes share the one `EditorView`, the one state
   * cache, and every export below; the book document is simply the case where
   * `bookField` holds a segment table.
   *
   * Edits are reported per FILE either way: `onChange` for a single-file
   * document, `onSectionChange(path, text)` for the book (one call per chapter
   * an edit actually touched — normally one, two when a paste or a delete
   * spans a boundary).
   *
   * ONE EditorView for the component's lifetime (UX review M8). The exported
   * `switchFile(path, content)` swaps the open document via `view.setState(...)`
   * with a freshly built or cache-restored `EditorState` — it never tears the
   * view down. The outgoing file's live state (doc, selection, undo history) is
   * stashed in `stateCache` (`$lib/editor/editor-state-cache.ts`, a bounded
   * LRU) keyed by its file path, along with its scroll offset; switching back
   * to a recently open file restores all three instead of starting cold. This
   * used to be exactly what this header claimed and the code didn't do: the
   * parent wrapped this component in `{#key editorFilePath}`, which destroyed
   * and rebuilt the whole view (discarding undo/selection/scroll) on every
   * switch. That wrapper is gone; this file now does what it always said it did.
   *
   * Neither the initial file switch nor a same-file external content change
   * (an auto-reload while this file stays open) is driven by watching the
   * `filePath`/`content` props reactively — this repo bans `$effect` (see
   * eslint.config.js), so the parent calls exported imperative methods
   * instead: `switchFile()` when it changes which file is open, and
   * `updateContent()` for the #H1 same-file auto-reload path. Reading
   * `content` reactively here would also fire on every keystroke's
   * onChange→buffer round trip, fighting the user's own typing — so the
   * explicit-call design is the right one independent of the lint rule.
   */
  import { EditorView, keymap, highlightActiveLine } from "@codemirror/view";
  import {
    EditorState,
    EditorSelection,
    Compartment,
    Transaction,
    type Extension,
  } from "@codemirror/state";
  import { EditorStateCache } from "$lib/editor/editor-state-cache";
  import {
    bookField,
    bookFieldInit,
    bookLayout,
    bookLineNumbers,
    repairCollapsedSegments,
    segmentAtPos,
    setBookLayout,
  } from "$lib/editor/book-field";
  import {
    bookLayoutsEqual,
    buildBookDoc,
    globalLineFor,
    localLineFor,
    normalizeEditorText,
    segmentEnd,
    segmentIndexForPath,
    touchedSegments,
    unpad,
    withSegmentReplaced,
    type BookLayout,
    type BookSection,
  } from "$lib/editor/book-layout";
  import {
    defaultKeymap,
    history,
    historyKeymap,
    indentWithTab,
  } from "@codemirror/commands";
  import {
    applyBold,
    applyItalic,
    applyStrikethrough,
    applyInlineCode,
    applyLink,
    applyBlockquote,
    applyUnorderedList,
    applyOrderedList,
    applyHeading,
    applyHr,
    applyPageBreak,
    applyTable,
    applyImage,
    applyLayoutBlock,
  } from "$lib/editor/toolbar-actions";
  import type { ToolbarAction, ToolbarPayload } from "$lib/components/EditorToolbar.svelte";
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
  import { markerCompletionSource } from "$lib/editor/marker-completions";
  import { onMount } from "svelte";

  let {
    filePath = null,
    content = "",
    onChange,
    onSectionChange,
    onActiveSection,
    onSave,
    onAnchorLine,
  }: {
    filePath?: string | null;
    content?: string;
    onChange?: (value: string) => void;
    /**
     * Book-document edit. Fires once per chapter file an edit actually touched,
     * with that file's full new content (the synthetic padding newline already
     * stripped, so it is byte-for-byte what belongs on disk).
     */
    onSectionChange?: (path: string, text: string) => void;
    /**
     * The caret moved into a different chapter of the book document. This is
     * what "which file is open" means once the whole book is one document — the
     * status bar, the file-tree highlight, and the conflict banner follow it.
     */
    onActiveSection?: (path: string) => void;
    onSave?: () => void;
    /**
     * Editor→preview sync. Fires with the 1-based "anchor" source line: the top
     * visible line on scroll, or the caret line on a deliberate (non-typing)
     * caret move. Debounced via rAF. `chapter` names the file that line belongs
     * to in a book document, and is null for a single-file document.
     */
    onAnchorLine?: (
      line: number,
      origin: "scroll" | "caret",
      chapter: string | null,
    ) => void;
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

  /**
   * `line` is always a DOCUMENT line; the chapter-local line the preview speaks
   * is resolved from the segment table here, so every caller upstream (scroll
   * handler, caret listener) stays in one coordinate system.
   */
  function emitAnchorLine(line: number, origin: "scroll" | "caret"): void {
    if (!onAnchorLine || !view) return;
    if (Date.now() < suppressEmitUntil) return;
    if (line === lastEmittedLine) return;
    lastEmittedLine = line;
    const layout = bookLayout(view.state);
    if (!layout) {
      onAnchorLine(line, origin, null);
      return;
    }
    const local = localLineFor(layout, line);
    if (local) onAnchorLine(local.line, origin, local.chapter);
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
  // `Gutterpress validate`), and Paged Media at-rule/property completions. Other
  // file types keep markdown (or plaintext) and carry none of the CSS layers.
  const languageCompartment = new Compartment();
  const cssLintCompartment = new Compartment();
  const cssCompletionCompartment = new Compartment();
  const markdownCompletionCompartment = new Compartment();
  // The language the view is currently configured for. Seeded at mount;
  // updated by switchFile() when a file switch changes it. Each `buildState()`
  // call bakes the resolved language into the new/restored EditorState via
  // these same Compartment instances, so a `setState()` swap always carries
  // the right language/lint/completion config with it.
  let currentLanguage: EditorLanguage = "plain";
  // The filePath the view's document currently belongs to. Used by
  // switchFile() to no-op a call that doesn't actually change the open file.
  // Seeded at mount alongside the initial document. In a book document this is
  // BOOK_KEY — the document belongs to many files at once, and which one is
  // "open" is answered by the caret (see onActiveSection), not by this.
  let appliedPath: string | null = null;
  /**
   * State-cache key for the book document. Not a real path, and deliberately
   * unrepresentable as one, so it can never collide with a file the author
   * opens standalone.
   */
  const BOOK_KEY = " book";
  /** The active section's path, so a caret move only reports real changes. */
  let activeSectionPath: string | null = null;
  // Per-file EditorState + scroll cache (UX review M8) — see the header
  // comment. Lives for the component's lifetime, not reset on file switch.
  const stateCache = new EditorStateCache<{
    state: EditorState;
    scrollTop: number;
    scrollLeft: number;
  }>(20);

  /**
   * One chapter's bytes, sliced straight out of the CodeMirror `Text`. Never
   * materialise the whole book as a string to do this — that would allocate the
   * entire document on every keystroke.
   */
  function sectionTextAt(state: EditorState, layout: BookLayout, index: number): string {
    const segment = layout.segments[index]!;
    const raw = state.doc.sliceString(segment.from, segmentEnd(state.doc.length, layout, index));
    return unpad(raw, segment.padded);
  }

  /**
   * Report the book edit as per-file content, one call per chapter the change
   * actually touched.
   *
   * `touchedSegments` owns which chapters those are (and why the changed span
   * has to be widened) — it is pure, and unit-tested in book-layout.test.ts.
   */
  function emitChangedSections(
    changes: { iterChangedRanges: (f: (a: number, b: number, c: number, d: number) => void) => void },
    state: EditorState,
    layout: BookLayout,
  ): void {
    if (!onSectionChange) return;
    let min = Infinity;
    let max = -Infinity;
    changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      if (fromB < min) min = fromB;
      if (toB > max) max = toB;
    });
    if (min === Infinity) return;
    const touched = touchedSegments(layout, min, max);
    if (!touched) return;
    for (let i = touched.first; i <= touched.last; i++) {
      onSectionChange(layout.segments[i]!.path, sectionTextAt(state, layout, i));
    }
  }

  /**
   * Give a chapter its line back when an edit collapsed it to nothing (see
   * `repairCollapsedSegments`). Dispatched from a microtask because CodeMirror
   * forbids re-entrant dispatch from inside an update, and outside the undo
   * history so it never costs the author an extra undo press.
   */
  function repairCollapsed(state: EditorState): void {
    const repair = repairCollapsedSegments(state);
    if (!repair) return;
    queueMicrotask(() => {
      if (!view) return;
      view.dispatch({
        changes: repair.insertAt.map((pos) => ({ from: pos, insert: "\n" })),
        effects: setBookLayout.of(repair.layout),
        annotations: Transaction.addToHistory.of(false),
      });
    });
  }

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

  /** Core `@marker` completions (UX M26) — active only for markdown docs. */
  function markdownCompletionExtensions(lang: EditorLanguage): Extension {
    if (lang !== "markdown") return [];
    return autocompletion({ override: [markerCompletionSource] });
  }

  // Theme-aware syntax highlighting. Every colour is a CSS custom property
  // (defined per app theme in the style block below), so the SAME highlight
  // style is legible in both light and dark mode and switches instantly with the
  // app's [data-theme] — no second editor, no rebuild. Replaces CodeMirror's
  // light-tuned defaultHighlightStyle, which rendered as low-contrast mush on the
  // dark background.
  const gutterpressHighlight = HighlightStyle.define([
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
    // Embedded HTML (common in Gutterpress covers/layout blocks) + CSS.
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
        "var(--app-font-mono)",
      lineHeight: "1.6",
      overflow: "auto",
    },
    ".cm-content": { caretColor: "var(--app-accent)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--app-accent)" },
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
    // Chapter divider in the book document (book-field.ts's block widget). The
    // author scrolls through one continuous manuscript; this is the only thing
    // telling them where one file ends and the next begins, so it has to read
    // as structure without competing with the prose.
    ".cm-chapter-header": {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      margin: "22px 0 4px",
      paddingRight: "12px",
      fontFamily: "system-ui, sans-serif",
      fontSize: "10px",
      fontWeight: "600",
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: "var(--cm-chapter-label)",
      userSelect: "none",
    },
    ".cm-chapter-header:first-child": { marginTop: "4px" },
    ".cm-chapter-header::after": {
      content: '""',
      flex: "1 1 auto",
      height: "1px",
      background: "var(--cm-chapter-rule)",
    },
  });

  // `forPath` is passed explicitly rather than read off the `filePath` prop:
  // `switchFile()` must resolve the language for the file it was just told
  // to switch TO, not risk racing however/whenever Svelte propagates the
  // prop update through to this read.
  function buildState(
    doc: string,
    forPath: string | null,
    layout: BookLayout | null = null,
  ): EditorState {
    // A book document is markdown by construction — it has many paths and no
    // single one to resolve a language from.
    const lang = layout ? "markdown" : languageForPath(forPath);
    return EditorState.create({
      doc: normalizeEditorText(doc),
      extensions: [
        bookFieldInit(layout),
        bookLineNumbers(),
        history(),
        highlightActiveLine(),
        bracketMatching(),
        languageCompartment.of(languageExtension(lang)),
        cssLintCompartment.of(cssLintExtensions(lang)),
        cssCompletionCompartment.of(cssCompletionExtensions(lang)),
        markdownCompletionCompartment.of(markdownCompletionExtensions(lang)),
         syntaxHighlighting(gutterpressHighlight, { fallback: true }),
        keymap.of([
          { key: "Mod-s", run: () => { onSave?.(); return true; } },
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
          // Editor toolbar keyboard shortcuts (#31)
          { key: "Ctrl-b", mac: "Cmd-b", run: (v) => { applyBold(v); return true; } },
          { key: "Ctrl-i", mac: "Cmd-i", run: (v) => { applyItalic(v); return true; } },
          { key: "Ctrl-k", mac: "Cmd-k", run: (v) => { applyLink(v); return true; } },
        ]),
        editableTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          const layout = bookLayout(update.state);
          if (update.docChanged && !applyingExternal) {
            if (layout) {
              emitChangedSections(update.changes, update.state, layout);
              repairCollapsed(update.state);
            } else {
              onChange?.(update.state.doc.toString());
            }
          }
          // Which chapter the author is IN follows the caret — that is what
          // "the open file" means once the whole book is one document.
          if (layout && (update.selectionSet || update.docChanged)) {
            const segment = segmentAtPos(update.state, update.state.selection.main.head);
            if (segment && segment.path !== activeSectionPath) {
              activeSectionPath = segment.path;
              onActiveSection?.(segment.path);
            }
          }
          // Editor→preview sync on a DELIBERATE caret move (click / arrow key),
          // not while typing — typing would yank the preview on every keystroke.
          if (onAnchorLine && update.selectionSet && !update.docChanged) {
            emitAnchorLine(
              update.state.doc.lineAt(update.state.selection.main.head).number,
              "caret",
            );
          }
        }),
      ],
    });
  }

  // Mount the EditorView ONCE when the host node exists. It lives for the
  // component's lifetime; file switches are handled by the exported
  // switchFile() below, called explicitly by the parent, never by tearing
  // this view down.
  let detachScroll: (() => void) | null = null;
  onMount(() => {
    if (!host) return;
    currentLanguage = languageForPath(filePath);
    appliedPath = filePath;
    activeSectionPath = filePath;
    view = new EditorView({ state: buildState(content, filePath), parent: host });
    // Editor→preview scroll sync: emit the top visible line as the user
    // scrolls (rAF-coalesced). Bound to scrollDOM rather than updateListener
    // because pure scrolling doesn't produce editor transactions.
    const v = view;
    const onScroll = () => {
      if (anchorRaf) return;
      anchorRaf = requestAnimationFrame(() => {
        anchorRaf = 0;
        const line = topVisibleLine(v);
        if (line != null) emitAnchorLine(line, "scroll");
      });
    };
    v.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    detachScroll = () => v.scrollDOM.removeEventListener("scroll", onScroll);
    return () => {
      if (anchorRaf) cancelAnimationFrame(anchorRaf);
      anchorRaf = 0;
      detachScroll?.();
      detachScroll = null;
      view?.destroy();
      view = null;
    };
  });

  /**
   * Switch the live view to `newPath`/`newContent` without destroying it
   * (UX review M8). Stashes the outgoing file's state + scroll into
   * `stateCache`, then either restores a cached state for `newPath` (when its
   * cached doc still matches the incoming content — i.e. nothing changed on
   * disk while the author was away) or builds a fresh one (first visit, or a
   * stale cache entry invalidated by an external change).
   *
   * Called EXPLICITLY by the parent whenever it changes which file is open
   * (chapter navigation, crash-recovery restore) — not driven by a reactive
   * `$effect` on the `filePath`/`content` props. This repo bans `$effect`
   * (see eslint.config.js's `no-restricted-syntax` rule); it is also the
   * right call here regardless: a prop-watching effect that read `content`
   * would need to ignore every keystroke's onChange→buffer round trip
   * (which updates `content` for the SAME file) to avoid fighting the user's
   * own typing, and `filePath` changes are already always the direct result
   * of a caller-known action, never an incidental re-render — so an explicit
   * call is both simpler and matches this file's existing imperative-export
   * pattern (`updateContent`, `revealLine`, `insertSnippet`, …).
   */
  export function switchFile(newPath: string | null, newContent: string): void {
    if (!view || newPath === appliedPath) return;
    stashCurrent();
    appliedPath = newPath;
    activeSectionPath = newPath;
    currentLanguage = languageForPath(newPath);
    if (newPath == null) return; // nothing open — template hides the host
    const doc = normalizeEditorText(newContent);
    restoreOrBuild(newPath, doc, () => buildState(doc, newPath));
  }

  /**
   * Open the WHOLE BOOK as one continuous document (see this component's
   * header). `sections` must already be in the book's own chapter order — that
   * order IS the document.
   *
   * Like {@link switchFile} this reconfigures the one live view rather than
   * rebuilding it, and it restores the book's cached state (undo history,
   * selection, scroll) when the freshly-built document matches what was cached
   * — so bouncing out to a stylesheet and back lands the author exactly where
   * they were.
   */
  export function switchBook(sections: BookSection[]): void {
    if (!view) return;
    const { doc, layout } = buildBookDoc(sections);
    // Already showing exactly this book: do nothing. The parent pushes the
    // document on every chapter navigation and after every folder-change
    // rebuild, and a `setState` that swapped a document for an identical one
    // would still tear down and rebuild the view — losing the author's scroll
    // position on a plain click in the file tree, and racing the reveal that
    // click is about to issue.
    if (appliedPath === BOOK_KEY && sameBook(layout) && view.state.doc.toString() === doc) {
      return;
    }
    stashCurrent();
    appliedPath = BOOK_KEY;
    currentLanguage = "markdown";
    restoreOrBuild(BOOK_KEY, doc, () => buildState(doc, null, layout), layout);
    activeSectionPath = sections[0]?.path ?? null;
  }

  /** Whether the live document already holds exactly these chapters, in order. */
  function sameBook(next: BookLayout): boolean {
    const current = view ? bookLayout(view.state) : null;
    return bookLayoutsEqual(current, next);
  }

  /** Stash the outgoing document's state + scroll under its cache key. */
  function stashCurrent(): void {
    if (!view || !appliedPath) return;
    stateCache.set(appliedPath, {
      state: view.state,
      scrollTop: view.scrollDOM.scrollTop,
      scrollLeft: view.scrollDOM.scrollLeft,
    });
  }

  /**
   * Restore `key`'s cached state when its document still matches `expectedDoc`
   * — i.e. nothing changed underneath while the author was away — otherwise
   * build fresh. A stale cached doc must never resurrect over fresh content.
   */
  function restoreOrBuild(
    key: string,
    expectedDoc: string,
    build: () => EditorState,
    expectedLayout?: BookLayout,
  ): void {
    if (!view) return;
    const cached = stateCache.get(key);
    let nextState: EditorState;
    let scrollTop = 0;
    let scrollLeft = 0;
    const cachedLayoutMatches =
      expectedLayout === undefined ||
      (cached ? bookLayoutsEqual(bookLayout(cached.state), expectedLayout) : false);
    if (cached && cached.state.doc.toString() === expectedDoc && cachedLayoutMatches) {
      nextState = cached.state;
      scrollTop = cached.scrollTop;
      scrollLeft = cached.scrollLeft;
    } else {
      stateCache.delete(key);
      nextState = build();
    }
    // A document swap moves the viewport; that is not the author scrolling, so
    // don't let it drive the preview.
    suppressEmitUntil = Date.now() + 300;
    lastEmittedLine = -1;
    view.setState(nextState);
    if (scrollTop === 0 && scrollLeft === 0) return;
    // Only a genuine RESTORE defers to a frame. A freshly-built document is
    // already at the origin, and scheduling a redundant scroll write would
    // clobber a reveal the caller issues right after this returns (opening a
    // chapter from the file tree does exactly that).
    const v = view;
    requestAnimationFrame(() => {
      v.scrollDOM.scrollTop = scrollTop;
      v.scrollDOM.scrollLeft = scrollLeft;
    });
  }

  /**
   * Replace ONE chapter's text inside the book document — the external-reload
   * path (`EditorBuffer.onContentReplaced`) for a file that isn't the one under
   * the caret. Returns false when this isn't a book document or doesn't hold
   * `path`, so the caller can fall back to {@link updateContent}.
   *
   * The new boundary table is supplied explicitly rather than mapped: replacing
   * a segment deletes its whole range, and every `assoc` collapses the next
   * segment's boundary onto the deletion start.
   */
  export function spliceSection(path: string, nextContent: string): boolean {
    if (!view) return false;
    const layout = bookLayout(view.state);
    if (!layout) return false;
    const index = segmentIndexForPath(layout, path);
    if (index < 0) return false;
    const segment = layout.segments[index]!;
    const end = segmentEnd(view.state.doc.length, layout, index);
    const content = normalizeEditorText(nextContent);
    const padded = !content.endsWith("\n");
    const text = padded ? `${content}\n` : content;
    const textMatches = view.state.doc.sliceString(segment.from, end) === text;
    if (textMatches && segment.padded === padded) return true;
    applyingExternal = true;
    try {
      view.dispatch({
        changes: textMatches ? undefined : { from: segment.from, to: end, insert: text },
        effects: setBookLayout.of(
          withSegmentReplaced(layout, index, end - segment.from, text.length, padded),
        ),
        scrollIntoView: false,
      });
    } finally {
      applyingExternal = false;
    }
    return true;
  }

  /**
   * Apply an externally-updated content for the currently-open file (e.g. an
   * external editor saved the same file). Preserves caret and scroll position
   * so the editor never jumps mid-edit. Called by the parent when the file
   * content changes without a file switch (same filePath, different content).
   */
  export function updateContent(nextDoc: string): void {
    if (!view) return;
    nextDoc = normalizeEditorText(nextDoc);
    const current = view.state.doc.toString();
    if (current === nextDoc) return;
    applyingExternal = true;
    // Same-file content replace: clamp existing selection into the new document
    // and keep the viewport anchored to the caret.
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
    applyingExternal = false;
  }

  /** Move keyboard focus into the editor (used when the pane is opened). */
  export function focus(): void {
    view?.focus();
  }

  /**
   * Whether this view's current document actually holds `path` — the book
   * document holds every chapter at once, a single-file document holds one.
   *
   * The commit engine (inline-editing plan §4.7 Step 4) asks the EDITOR this
   * rather than inferring it from `buffer.filePath`, since a mounted editor can
   * be showing something else entirely than whatever the buffer most recently
   * loaded (e.g. mid-switch). Backed by real, private, internal state updated
   * synchronously inside `switchFile()`/`switchBook()`/`onMount` above.
   */
  export function hasFile(path: string): boolean {
    if (!view) return false;
    const layout = bookLayout(view.state);
    if (layout) return segmentIndexForPath(layout, path) >= 0;
    return appliedPath === path;
  }

  /**
   * Apply a `[from, to)` character-range edit to `path` as a single undoable
   * transaction (inline-editing plan §4.7 Step 4 / commit-engine.ts). This is
   * the ONLY way the commit engine mutates a file that has a live CodeMirror
   * view mounted on it — the edit lands through `view.dispatch`, so it shares
   * this view's undo history exactly like a toolbar action
   * (`runToolbarAction` above) or a typed keystroke.
   *
   * `from`/`to` are offsets into THAT FILE, not into the document: the engine
   * resolves them against the chapter's own content, so in a book document they
   * are rebased onto the chapter's segment here. A no-op when no view is
   * mounted or the document doesn't hold `path` (the caller is expected to have
   * checked {@link hasFile} first).
   */
  export function applyRangeEditIn(
    path: string,
    from: number,
    to: number,
    insert: string,
  ): void {
    if (!view) return;
    const layout = bookLayout(view.state);
    if (!layout) {
      if (appliedPath !== path) return;
      view.dispatch({ changes: { from, to, insert } });
      return;
    }
    const index = segmentIndexForPath(layout, path);
    if (index < 0) return;
    const base = layout.segments[index]!.from;
    const end = segmentEnd(view.state.doc.length, layout, index);
    if (base + to > end) return; // range doesn't fit the chapter — refuse, never spill
    view.dispatch({ changes: { from: base + from, to: base + to, insert } });
  }

  /** Current selection text (empty string when there is no selection) (#29). */
  export function getSelectionText(): string {
    if (!view) return "";
    const { from, to } = view.state.selection.main;
    return view.state.sliceDoc(from, to);
  }

  /**
   * Insert a snippet at the cursor, replacing any selection (#29). The caret is
   * placed at the end of the inserted text. The view is focused first so the
   * transaction lands in the right place.
   */
  export function insertSnippet(text: string): void {
    if (!view) return;
    view.focus();
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
  }

  /**
   * Execute a toolbar formatting action on the live editor (#31).
   * Called by the parent page via the editorRef binding. The editor is
   * focused before dispatch so the transaction lands in the right view.
   */
  export function runToolbarAction(
    action: ToolbarAction,
    payload?: ToolbarPayload,
  ): void {
    if (!view) return;
    view.focus();
    switch (action) {
      case "bold":           applyBold(view); break;
      case "italic":         applyItalic(view); break;
      case "strikethrough":  applyStrikethrough(view); break;
      case "code":           applyInlineCode(view); break;
      case "link":           applyLink(view); break;
      case "blockquote":     applyBlockquote(view); break;
      case "ul":             applyUnorderedList(view); break;
      case "ol":             applyOrderedList(view); break;
      case "heading": {
        const lvl = (payload as { level: 1 | 2 | 3 | 4 } | undefined)?.level ?? 2;
        applyHeading(view, lvl);
        break;
      }
      case "hr":             applyHr(view); break;
      case "page-break":     applyPageBreak(view); break;
      case "table": {
        const cols = (payload as { cols: number } | undefined)?.cols ?? 3;
        applyTable(view, cols);
        break;
      }
      case "image": {
        const img = payload as { src: string; alt: string; width?: string; position?: string; size?: string } | undefined;
        if (img) applyImage(view, img.src, img.alt, img.width, img.position, img.size);
        break;
      }
      case "layout-block": {
        const block = payload as { kind: Parameters<typeof applyLayoutBlock>[1] } | undefined;
        if (block) applyLayoutBlock(view, block.kind);
        break;
      }
    }
  }

  /**
   * Scroll/move the caret to a 1-based source line (preview→editor sync).
   * Suppresses the cursor-line echo so it doesn't bounce back to the preview.
   *
   * `line` is CHAPTER-LOCAL — the coordinate the preview speaks — and `chapter`
   * says which file it belongs to. In a book document that resolves to a
   * document line through the segment table; in a single-file document
   * `chapter` is ignored and the line is used as-is. There is no file to open,
   * no load to wait for, and nothing to retry: the target line is already in
   * the document, so this is the WHOLE of preview→editor follow now.
   */
  export function revealLine(line: number, chapter?: string | null): void {
    if (!view) return;
    const doc = view.state.doc;
    const layout = bookLayout(view.state);
    let target = line;
    if (layout) {
      if (!chapter) return;
      const global = globalLineFor(layout, chapter, line);
      if (global == null) return; // a chapter this book doesn't (any longer) build from
      target = global;
    } else if (chapter) {
      // A chapter-local line means nothing to a single-file document. Revealing
      // it anyway would scroll whatever IS open — a stylesheet, say — to that
      // line number, which is simply the wrong document. The caller is expected
      // to put the book back on screen first (see `+page.svelte`'s
      // `revealInEditor`).
      return;
    }
    const clamped = Math.max(1, Math.min(target, doc.lines));
    const pos = doc.line(clamped).from;
    // Suppress the echo across the async scroll event the dispatch triggers.
    suppressEmitUntil = Date.now() + 300;
    lastEmittedLine = clamped;
    // y:'start' (not 'center'): the preview emits its TOP-visible block
    // (sourceLineChanged) and editor→preview scroll sync anchors the resolved
    // block to the preview's top — anchoring the revealed line to the editor's
    // top keeps both panes agreeing on the same anchor point. Centering here
    // gave a constant ~half-viewport disagreement (QA finding RC1-5).
    view.dispatch({
      effects: EditorView.scrollIntoView(pos, { y: "start" }),
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
<!-- Toolbar portals are rendered by the parent via EditorToolbar.svelte placed
     ABOVE this component in the editor-pane section. The runToolbarAction()
     export is the coupling point. -->

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
    color: var(--app-text-muted);
    font-size: 13px;
    text-align: center;
  }
  .editor-empty p {
    margin: 0;
    max-width: 240px;
    line-height: 1.5;
  }

  /* ── CodeMirror syntax palette (consumed by gutterpressHighlight + editableTheme) ──
     Component-private tokens (this file is their only consumer — theme.css's
     admission rule keeps them out of the global palette). Each is defined ONCE
     with light-dark(); the values flip with the app theme because theme.css
     sets `color-scheme` from [data-theme]. Scoped to .editor-wrap — no
     :global, no :root leakage; CodeMirror mounts inside .editor-host, and CM6
     tooltips default to the editor's own DOM, so every consumer resolves the
     tokens. Tuned for contrast: markers visible-but-subtle, code tokens
     clearly differentiated, body text high-contrast. */
  .editor-wrap {
    --cm-text: light-dark(#1f2328, #d8dee9);
    --cm-heading: light-dark(#6639ba, #c8a8ff);
    --cm-strong: light-dark(#1f2328, #f2f4f8);
    --cm-em: light-dark(#1f2328, #d8dee9);
    --cm-link: light-dark(#0969da, #5cb3ff);
    --cm-quote: light-dark(#57606a, #9aa5b1);
    --cm-marker: light-dark(#6e7781, #8195b5);
    --cm-code: light-dark(#953800, #f0cf94);
    --cm-string: light-dark(#0a7d33, #b6dc9c);
    --cm-number: light-dark(#953800, #ffb88a);
    --cm-keyword: light-dark(#cf222e, #c792ea);
    --cm-comment: light-dark(#6e7781, #7c8590);
    --cm-tag: light-dark(#116329, #ff8f8f);
    --cm-attr: light-dark(#0550ae, #ffcb6b);
    --cm-property: light-dark(#0550ae, #82aaff);
    --cm-class: light-dark(#953800, #ffcb6b);
    --cm-function: light-dark(#8250df, #82aaff);
    --cm-punct: light-dark(#57606a, #9aa5b1);
    --cm-invalid: light-dark(#cf222e, #ff6b6b);
    --cm-selection: light-dark(rgba(9, 105, 218, 0.18), rgba(92, 179, 255, 0.28));
    --cm-active-line: light-dark(rgba(27, 31, 36, 0.045), rgba(255, 255, 255, 0.05));
    --cm-chapter-label: light-dark(#6e7781, #8195b5);
    --cm-chapter-rule: light-dark(rgba(27, 31, 36, 0.12), rgba(255, 255, 255, 0.12));
    --cm-gutter-bg: var(--app-surface);
    --cm-gutter-text: light-dark(#8c959f, #6b7280);
    --cm-bracket-bg: light-dark(rgba(9, 105, 218, 0.14), rgba(92, 179, 255, 0.18));
    --cm-bracket-outline: light-dark(rgba(9, 105, 218, 0.45), rgba(92, 179, 255, 0.5));
  }
</style>
