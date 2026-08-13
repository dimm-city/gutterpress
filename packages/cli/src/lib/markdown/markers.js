/**
 * Gutterpress layout markers — the `@page`/`@section`/`@chapter` authoring
 * surface, and the CSS the DOM it emits requires (`MARKER_CSS`).
 *
 * OWNERSHIP: this is Gutterpress code. It began as an inlined copy of the
 * standalone `markdown-it-paged` package (itlackey/markdown-it-paged) and was
 * absorbed at 0.10.0, because the copy had stopped being that package: it had
 * grown to 812 lines against upstream's 433 — a 635-line divergence — was
 * never consumed from npm (no dependency, ever), and carried four feature
 * clusters upstream has none of, all of them Gutterpress-specific:
 *
 *   - `data-source-range` threading for the desktop editor (ADR 0009)
 *   - `data-chapter-label` propagation and `.chapter-opener` injection
 *   - `env.__colSplitDepth` per-render state
 *   - the emitted-class contract the viewer and preview depend on
 *
 * Keeping the third-party label had a real cost: it argued against cleaning
 * up comments that describe a removed engine, and it made the ownership
 * boundary for the `gp-*` vocabulary ambiguous. CLAUDE.md's constitution
 * already names these markers "the product's authoring surface — permanent".
 *
 * The upstream package remains its own project; Gutterpress no longer tracks
 * it. Do not re-converge: `data-source-range` is editor plumbing that has no
 * business in a general-purpose markdown-it plugin.
 *
 * Emitted classes use the `gp-` prefix, matching the rest of the product's
 * vocabulary (`gutterpress-css.ts`). This module owns the STRUCTURAL DOM
 * (`.page`, `.spread`, `.section`, `.chapter`, `.gp-page-break`,
 * `.gp-column-break`, `.gp-continued`) and the minimal CSS that DOM needs;
 * `gutterpress-css.ts` owns the author UTILITY vocabulary (`.gp-pin`,
 * `.gp-bleed`, sizes, spacing, depth). Both are Gutterpress; the split is by
 * role, not by owner.
 *
 * Markers:
 *   @chapter [class ...] [key=value ...] [#id] [.class...]
 *   @spread [name|class ...] [key=value ...] [#id] [.class...]
 *   @page   [name|class ...] [key=value ...] [#id] [.class...]
 *   @section [name|class ...] [key=value ...] [#id] [.class...]
 *   @continue
 *   @end-section
 *   @page-break
 *   @column-break
 *
 * Output:
 *   chapter    -> <div class="chapter ..." ...>
 *   spread     -> <div class="spread ..." data-spread="name" ...>
 *   page       -> <div class="page ..." data-page="name" ...>
 *   section    -> <div class="section ..." data-section="name" data-region="..." ...>
 *   continue   -> closes current @section and opens a new matching continuation section
 *   end-section -> closes nearest open @section (no-op if none open)
 *   page-break -> <div class="gp-page-break" aria-hidden="true"></div>
 *   column-break -> <div class="gp-column-break" aria-hidden="true"></div>
 *
 * Opt-in:
 *   If no markers are present, plugin does nothing.
 *
 * Validation:
 *   Warnings are pushed into env.layoutWarnings: Array<{ line, type, message, marker? }>
 *
 * Source line threading (token.meta.line):
 *   Every layout_*_open token (chapter/spread/page/section, including the
 *   section opened by @continue) and both standalone break tokens
 *   (layout_page_break / layout_column_break) carry `token.meta.line`, the
 *   1-based marker line that produced them. This is consumed by the
 *   node-free `source-range.ts` core rule (registered in renderer.ts) to
 *   emit `data-source-range` on these wrappers. token.map is deliberately
 *   left null on all of these tokens — see the inline comments at each
 *   `t.meta = …` assignment site and ADR 0009: setting `map` would make
 *   markdown-it-source-map stamp `data-source-line` onto these wrapper divs
 *   too, which breaks preview scroll-sync (topVisibleSourceEl()'s
 *   strictly-greater rect tie-break resolves to the wrapper instead of the
 *   visible paragraph). Consumers must treat `token.meta.line` as possibly
 *   non-finite (e.g. a malformed/mis-nested marker) and reject rather than
 *   coerce.
 */

/**
 * Strip one layer of markdown-it-attrs braces from a marker token, so
 * `@section {.two-column}` means the same thing as `@section .two-column`.
 *
 * WHY: markdown-it-attrs' `{.class}` form is what authors type everywhere
 * else in a document, and plugin-defined markers (e.g. the dimm-city
 * plugin's `@skill {.continued}`) accept it. Core markers did not, and a
 * braces token silently degraded into the marker's NAME instead: the class
 * vanished, no warning was emitted, and the element rendered with only its
 * structural class. That shipped a real defect — a field-guide chapter's
 * `@section {.two-column}` produced a bare `.section` for two days, so the
 * content never got its columns AND picked up the book's default section
 * chrome. Accepting both spellings removes the trap; it cannot break an
 * existing document, because a token starting with `{` had no meaning here
 * before.
 *
 * Applied per token, so the multi-class form works too: the tokenizer has
 * already split `{.a .b}` into `{.a` and `.b}`, and stripping the brace off
 * each end yields `.a` and `.b`. A token that is nothing but a brace is
 * left alone rather than reduced to an empty string.
 */
function unwrapAttrBraces(token) {
  if (typeof token !== 'string') return token;
  let t = token.trim();
  if (t.startsWith('{')) t = t.slice(1).trim();
  if (t.endsWith('}')) t = t.slice(0, -1).trim();
  return t || token;
}

function isBareToken(token) {
  return token && !token.includes('=') && !token.startsWith('.') && !token.startsWith('#');
}

/** The marker kinds this module understands. Also the near-miss dictionary. */
const KNOWN_KINDS = [
  'chapter',
  'spread',
  'page',
  'section',
  'continue',
  'page-break',
  'column-break',
  'end-section',
];

/**
 * A plain-word marker argument that can serve as a name or a class: it must
 * look like a CSS-usable identifier. Anything else (`=x`, `"x`, `(x)`, a
 * stray `→`) is a token the parser has no meaning for — it currently ends up
 * verbatim in the element's class list, which is never what the author meant.
 */
const BARE_TOKEN_RE = /^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/;

/** Levenshtein distance — used only for "did you mean @section?" suggestions. */
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Nearest known marker kind to `word`, or null when nothing is close enough.
 *
 * HEURISTIC (deliberately tight — see unknownMarkerScan): only an edit
 * distance of 0 (a case-only mismatch, e.g. `@Section`) or 1 (`@sections`,
 * `@secton`) counts. Distance 2 was measured against the real DC plugin
 * marker vocabulary and produced a false positive (`@tape` → `@page`), so a
 * plugin-defined marker this parser never sees must not be flagged.
 */
function nearestKind(word) {
  const w = word.toLowerCase();
  if (w.length < 3) return null;
  for (const kind of KNOWN_KINDS) {
    if (editDistance(w, kind) <= 1) return kind;
  }
  return null;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseMarkerLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('@')) return null;

  // Tokenize respecting simple quotes: key="a b"
  const tokens = [];
  let buf = '';
  let quote = null;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (quote) {
      if (ch === quote) quote = null;
      else buf += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (buf) tokens.push(buf);
      buf = '';
      continue;
    }

    buf += ch;
  }

  if (buf) tokens.push(buf);

  // Accept the markdown-it-attrs `{...}` spelling on every marker argument —
  // see unwrapAttrBraces. The head token is left untouched; only arguments
  // can carry attrs.
  for (let i = 1; i < tokens.length; i++) tokens[i] = unwrapAttrBraces(tokens[i]);

  const head = tokens[0]; // "@chapter" | "@spread" | "@page" | "@section" | "@continue" | "@end-section" | "@page-break" | "@column-break"
  const kind = head.slice(1);

  if (!KNOWN_KINDS.includes(kind)) return null;

  if (kind === 'page-break' || kind === 'column-break' || kind === 'end-section' || kind === 'continue') {
    return { kind, name: null, attrs: {} };
  }

  const body = tokens.slice(1);
  const hasExplicitAttrsOrShorthand = body.some(
    (token) => token.includes('=') || token.startsWith('.') || token.startsWith('#')
  );
  const bareTokens = body.filter(isBareToken);

  let name = null;
  let nameIndex = -1;
  const firstBareTokenIndex = body.findIndex((token) => isBareToken(token));

  // All marker kinds (including @chapter) accept an optional bare name as the
  // first non-attribute token. For @chapter the name is a human label like
  // "C.01" that consumer plugins (e.g. dimm-city-plugin) use to generate
  // chapter badges. The name is exposed on the rendered element via
  // `data-<kind>-label` (e.g. data-chapter-label="C.01").
  if (hasExplicitAttrsOrShorthand && bareTokens.length) {
    name = bareTokens[0];
    nameIndex = firstBareTokenIndex;
  } else if (bareTokens.length === 1) {
    name = bareTokens[0];
    nameIndex = firstBareTokenIndex;
  }

  const attrs = {};
  const classes = [];
  let sawExplicitAttr = false;
  let hasAmbiguousBareToken = false;
  /** Tokens the grammar has no meaning for (reported, not dropped). */
  const unknownTokens = [];

  // Classification pass. Every argument must be one of the four forms the
  // grammar defines; anything else silently ends up verbatim in the class
  // list, which is the defect class this reports (a `@section {.two-column}`
  // whose class vanished cost two days). Behaviour is unchanged — the token
  // still lands where it always did — but the author is now told.
  for (const t of body) {
    if (t.startsWith('.') || t.startsWith('#')) {
      if (!BARE_TOKEN_RE.test(t.slice(1).trim())) unknownTokens.push(t);
      continue;
    }
    if (t.indexOf('=') > 0) continue;
    if (!BARE_TOKEN_RE.test(t)) unknownTokens.push(t);
  }

  for (let idx = 0; idx < body.length; idx++) {
    if (idx === nameIndex) {
      if (sawExplicitAttr && isBareToken(body[idx])) hasAmbiguousBareToken = true;
      continue;
    }

    const t = body[idx];

    if (t.startsWith('.')) {
      const c = t.slice(1).trim();
      if (c) classes.push(c);
      continue;
    }

    if (t.startsWith('#')) {
      const id = t.slice(1).trim();
      if (id) attrs.id = id;
      continue;
    }

    const eq = t.indexOf('=');
    if (eq > 0) {
      sawExplicitAttr = true;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim();
      if (!key) continue;

      if (key === 'class') {
        val
          .split(/[,\s]+/)
          .filter(Boolean)
          .forEach((c) => classes.push(c));
      } else {
        attrs[key] = val;
      }
      continue;
    }

    if (sawExplicitAttr && isBareToken(t)) hasAmbiguousBareToken = true;
    classes.push(t);
  }

  if (classes.length) attrs.class = classes.join(' ');

  // The warning itself is emitted by markerBlock AFTER the silent check —
  // this parser is also invoked by markdown-it's silent paragraph-terminator
  // probes, so warning from here would push duplicates onto env.
  const marker = { kind, name, attrs };
  if (hasAmbiguousBareToken) marker.__ambiguousBareToken = true;
  if (unknownTokens.length) marker.__unknownTokens = unknownTokens;
  // A marker has exactly one name slot. A second plain word is either
  // demoted to a class (when something already claimed the name) or — the
  // nastier case — costs the marker its name entirely, because the parser
  // refuses to guess which word was meant. Both were silent.
  // Suppressed when __ambiguousBareToken or an unrecognized token already
  // fired: same confusion, and the more specific warning is the useful one
  // (a garbled line must not produce three overlapping complaints).
  if (bareTokens.length > 1 && !hasAmbiguousBareToken && !unknownTokens.length) {
    marker.__extraBareTokens = { tokens: bareTokens, named: name !== null };
  }
  return marker;
}

function warn(env, line, type, message, marker) {
  if (!env.layoutWarnings) env.layoutWarnings = [];
  env.layoutWarnings.push({ line, type, message, marker });
}

function addClasses(token, baseClass, extraClass) {
  const cls = [];
  if (baseClass) cls.push(baseClass);
  if (extraClass) cls.push(extraClass);
  const merged = cls.join(' ').trim();
  if (merged) token.attrSet('class', merged);
}

function attachDataAttrs(token, kind, name, attrs) {
  if (name) {
    if (kind === 'chapter') token.attrSet('data-chapter-label', name);
    if (kind === 'spread') token.attrSet('data-spread', name);
    if (kind === 'page') token.attrSet('data-page', name);
    if (kind === 'section') token.attrSet('data-section', name);
  }

  if (attrs.template) token.attrSet('data-template', attrs.template);
  if (attrs.region) token.attrSet('data-region', attrs.region);
  if (attrs.id) token.attrSet('id', attrs.id);

  for (const [k, v] of Object.entries(attrs)) {
    if (!v) continue;
    if (k === 'class' || k === 'id' || k === 'template' || k === 'region') continue;
    token.attrSet(`data-${k}`, v);
  }
}

export default function plugin(md, pluginOptions = {}) {
  const options = {
    // `implicitPage` was removed 2026-08-12 — see the @section branch below.
    preferPagesInSpreads: false,
    ...pluginOptions,
  };

  function markerBlock(state, startLine, endLine, silent) {
    const pos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const line = state.src.slice(pos, max);

    const parsed = parseMarkerLine(line);
    if (!parsed) return false;
    if (silent) return true;

    state.env.__layoutMarkersUsed = true;

    const token = state.push('layout_marker', '', 0);
    token.meta = parsed;
    token.meta.__line = startLine + 1; // 1-based line number

    if (parsed.__ambiguousBareToken) {
      delete parsed.__ambiguousBareToken;
      warn(
        state.env,
        startLine + 1,
        'ambiguous_marker_token',
        'A bare marker token after a key=value attribute is being interpreted as the marker name (or an extra class). Use comma-separated classes (class=a,b) or .class shorthand instead.',
        parsed
      );
    }

    if (parsed.__unknownTokens) {
      const unknown = parsed.__unknownTokens;
      delete parsed.__unknownTokens;
      for (const t of unknown) {
        warn(
          state.env,
          startLine + 1,
          'unrecognized_marker_token',
          `@${parsed.kind}: "${t}" is not something a marker understands, so it was kept verbatim as a class name. Write a class as .my-class (or {.my-class}), an id as #my-id, and anything else as key=value.`,
          parsed
        );
      }
    }

    if (parsed.__extraBareTokens) {
      const { tokens, named } = parsed.__extraBareTokens;
      delete parsed.__extraBareTokens;
      const list = tokens.map((t) => `"${t}"`).join(', ');
      warn(
        state.env,
        startLine + 1,
        'extra_bare_marker_token',
        named
          ? `@${parsed.kind}: only the first plain word (${list.split(', ')[0]}) is used as the name; the rest (${tokens
              .slice(1)
              .map((t) => `"${t}"`)
              .join(', ')}) became class names instead. Quote a name that contains spaces ("${tokens.join(
              ' '
            )}"), or write classes as .${tokens.slice(1).join(' .')}.`
          : `@${parsed.kind}: ${list} are several plain words, but a marker has only one name slot — so NONE of them was used as the name and they all became class names instead. Quote a name that contains spaces ("${tokens.join(
              ' '
            )}"), or write classes as .${tokens.join(' .')}.`,
        parsed
      );
    }

    state.line = startLine + 1;
    return true;
  }

  md.block.ruler.before('paragraph', 'layout_marker', markerBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });

  // Innermost-first close order for layout scopes. Scopes nest
  // chapter → spread → page → section in well-formed documents, and every
  // close cascade (including the EOF drain) closes kinds in this fixed
  // order. Mis-ordered documents can open a scope while a "more inner" kind
  // is still open (e.g. @page before @chapter); closing by kind rank — not
  // by push order — is what keeps those documents rendering exactly as the
  // hand-ordered close helpers historically did.
  const SCOPE_CLOSE_ORDER = ['section', 'page', 'spread', 'chapter'];

  /**
   * Report `@word` lines that look like a mistyped marker.
   *
   * WHERE it looks: only at text that survived block parsing as ordinary
   * paragraph content — i.e. nothing claimed it. Fenced code (`@page {` in a
   * CSS example) and every marker a plugin defines are therefore invisible
   * to it... except that user plugins register on `md.core.ruler.push`, which
   * runs AFTER this rule, so their markers ARE still paragraphs here. That is
   * why the suggestion filter has to be tight rather than "any unknown @word".
   *
   * HEURISTIC, and what it will not catch / could get wrong:
   *   - only fires in a document that already uses core markers
   *     (`__layoutMarkersUsed`), so a file whose ONLY marker is the typo is
   *     silent;
   *   - only fires when the word is within one edit of a known kind, so
   *     `@twocolumn` is silent but `@sections` / `@secton` / `@Section` are
   *     caught;
   *   - it CAN misfire on a plugin- or prose-authored `@word` that happens to
   *     sit one edit from a core kind (e.g. a plugin marker named `@pages`);
   *     the real DC plugin vocabulary was measured and has none at distance
   *     ≤ 1 (`@tape` is 2 from `@page`, which is why the threshold is 1).
   *   - an email or handle cannot match: the word must run to whitespace or
   *     end-of-line, so `@foo.com` / `@user.name` stop at the dot and fail.
   */
  function scanForMistypedMarkers(state) {
    for (let tokenIndex = 0; tokenIndex < state.tokens.length; tokenIndex++) {
      const tok = state.tokens[tokenIndex];
      // A genuine unclaimed marker-like line is an inline token whose parent
      // block is a paragraph. Headings/list items/quotes can legitimately
      // document `@chapter` or discuss it as prose; scanning every inline
      // token made the user guide warn about its own marker headings.
      if (tok.type !== 'inline' || !tok.map) continue;
      const opener = state.tokens[tokenIndex - 1];
      if (!opener || opener.type !== 'paragraph_open') continue;
      const lines = tok.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const m = /^@([A-Za-z][A-Za-z0-9-]*)(?=\s|$)/.exec(lines[i].trim());
        if (!m) continue;
        // Exact known spellings survived only because this text is not acting
        // as a standalone marker (for example prose/code documentation).
        // `nearestKind()` intentionally returns distance 0 for CASE-only
        // mistakes, so exclude exact lower-case kinds before asking it.
        if (KNOWN_KINDS.includes(m[1])) continue;
        const suggestion = nearestKind(m[1]);
        if (!suggestion) continue;
        warn(
          state.env,
          tok.map[0] + i + 1,
          'unknown_marker',
          `"@${m[1]}" is not a marker Gutterpress knows, so this line was left as ordinary text. Did you mean "@${suggestion}"? (marker names are lower-case).`,
          null
        );
      }
    }
  }

  md.core.ruler.after('block', 'layout_transform', function (state) {
    if (!state.env.__layoutMarkersUsed) return;

    scanForMistypedMarkers(state);

    const out = [];
    setDepth(state.env, 0);

    /**
     * @typedef {'chapter'|'spread'|'page'|'section'} ScopeKind
     */
    /**
     * One open layout scope. At most one frame per kind is open at a time.
     *
     * @typedef {Object} Frame
     * @property {ScopeKind} kind
     * @property {string} [label]
     *   chapter: label propagated to every child @page as
     *   data-chapter-label. This lets CSS reach the chapter label from any
     *   descendant page via attr(data-chapter-label) — e.g. to render a
     *   chapter-opener badge on the page where the content actually lives,
     *   rather than on the chapter wrapper (which a fragmenting engine may split into
     *   an empty leading sheet).
     * @property {string} [counterClass]
     *   chapter: counter class inherited by child @page directives. When an
     *   @chapter declares ch="N" (or a .chapter-N class), every @page opened
     *   within that chapter automatically gets the same .chapter-N class.
     *   This lets CSS rules like `.page.chapter-3 { counter-reset: chapter 3 }`
     *   in a book's page rules match every page in the chapter: the class
     *   has to be on every page wrapper, not only the chapter's.
     *   Authors don't hand-apply .chapter-N anywhere.
     * @property {boolean} [openerEmitted]
     *   chapter: whether the one-time .chapter-opener element has been
     *   injected yet (it belongs to the FIRST @page of the chapter only).
     * @property {boolean} [noPagesYet]
     *   spread: no @page has opened since this spread started (drives the
     *   spread_without_pages warning).
     * @property {boolean} [sawAnyPage]
     *   spread: at least one @page opened inside this spread (suppresses the
     *   spread_eof_close warning).
     * @property {{name: string|null, attrs: Object}} [meta]
     *   section: name/attrs snapshot that @continue clones for the
     *   continuation section.
     */

    /**
     * Explicit stack of open scope frames. open() pushes; close(kind) drains
     * every kind nested inside `kind` (innermost first, per
     * SCOPE_CLOSE_ORDER) and then `kind` itself, emitting the close tokens —
     * and is a no-op when `kind` isn't open, which makes every close
     * idempotent. For well-formed nesting this is plain LIFO; for
     * mis-ordered documents the rank order preserves the historical
     * emission exactly.
     */
    const stack = {
      /** @type {Frame[]} */
      frames: [],

      /** @param {ScopeKind} kind @returns {Frame|null} */
      get(kind) {
        return this.frames.find((f) => f.kind === kind) || null;
      },

      /** @param {ScopeKind} kind */
      has(kind) {
        return this.frames.some((f) => f.kind === kind);
      },

      /**
       * Push a frame and emit its open token.
       * @param {Frame} frame
       * @param {import('markdown-it/lib/token')} openToken
       */
      open(frame, openToken) {
        out.push(openToken);
        this.frames.push(frame);
      },

      /** Pop the frame of `kind` (wherever it sits) and emit its close token. */
      _pop(kind) {
        const at = this.frames.findIndex((f) => f.kind === kind);
        if (at === -1) return;
        this.frames.splice(at, 1);
        out.push(new state.Token(`layout_${kind}_close`, 'div', -1));
      },

      /**
       * Close `kind` and everything nested inside it, innermost first.
       * No-op when `kind` isn't open — inner scopes are NOT drained in that
       * case (e.g. closing 'page' while only a section is open leaves the
       * section alone), matching the historical close helpers.
       * @param {ScopeKind} kind
       */
      close(kind) {
        if (!this.has(kind)) return;
        for (const inner of SCOPE_CLOSE_ORDER) {
          if (inner === kind) break;
          this._pop(inner);
        }
        this._pop(kind);
      },

      /** The EOF drain: close every open scope, innermost kind first. */
      closeAll() {
        for (const kind of SCOPE_CLOSE_ORDER) this._pop(kind);
      },
    };

    function openChapter(meta) {
      const t = new state.Token('layout_chapter_open', 'div', 1);
      // Thread the 1-based marker line onto token.meta for the source-range
      // annotation rule (source-range.ts) to consume. Do NOT set token.map
      // here: markdown-it-source-map would then stamp data-source-line onto
      // this wrapper div, and topVisibleSourceEl()'s strictly-greater rect
      // tie-break in preview-interface.js would resolve scroll-sync to this
      // marker's line instead of the paragraph actually on screen, on every
      // page of a multi-page chapter (the wrapper is cloned per page). See
      // ADR 0009.
      t.meta = { line: meta.__line };
      const classes = meta.attrs?.class || '';
      addClasses(t, 'chapter', classes);
      // Pass meta.name so attachDataAttrs emits `data-chapter-label="<name>"`
      // (e.g. data-chapter-label="C.01"). Consumer plugins use this to render
      // the chapter's badge / opener UI; standard markdown-it-paged treats it
      // as opaque metadata.
      attachDataAttrs(t, 'chapter', meta.name, meta.attrs || {});
      // Resolve chapter counter class: explicit `.chapter-N` in the class
      // list takes priority over the `ch="N"` attribute.
      const explicit = (classes.match(/(?:^|\s)(chapter-\d+)(?=\s|$)/) || [])[1] || '';
      const fromAttr = meta.attrs?.ch ? `chapter-${meta.attrs.ch}` : '';
      stack.open(
        {
          kind: 'chapter',
          label: meta.name || '',
          counterClass: explicit || fromAttr,
          openerEmitted: false,
        },
        t
      );
    }

    function openSpread(meta) {
      const t = new state.Token('layout_spread_open', 'div', 1);
      // See the do-not-use-token.map comment in openChapter above (ADR 0009)
      // — applies identically here.
      t.meta = { line: meta.__line };
      addClasses(t, 'spread', meta.attrs && meta.attrs.class ? meta.attrs.class : '');
      attachDataAttrs(t, 'spread', meta.name, meta.attrs || {});
      stack.open({ kind: 'spread', noPagesYet: true, sawAnyPage: false }, t);
    }

    function openPage(meta) {
      const chapter = stack.get('chapter');
      const t = new state.Token('layout_page_open', 'div', 1);
      // See the do-not-use-token.map comment in openChapter above (ADR 0009)
      // — applies identically here.
      t.meta = { line: meta.__line };
      const explicit = (meta.attrs && meta.attrs.class) ? meta.attrs.class : '';
      // Auto-inherit the open chapter's counter class so .page.chapter-N
      // selectors in page-rules.css match every page in the chapter without
      // the author repeating .chapter-N on every @page directive.
      const counterClass = chapter ? chapter.counterClass : '';
      const tokens = explicit ? explicit.split(/\s+/) : [];
      const merged = (counterClass && !tokens.includes(counterClass))
        ? (explicit ? `${explicit} ${counterClass}` : counterClass)
        : explicit;
      addClasses(t, 'page', merged);
      attachDataAttrs(t, 'page', meta.name, meta.attrs || {});
      // Propagate the chapter label so CSS can target the chapter-opener
      // page via attribute selector (a fragmenting engine may split the
      // chapter wrapper into an empty leading sheet, but the child page stays
      // with its content).
      const label = chapter ? chapter.label : '';
      if (label) t.attrSet('data-chapter-label', label);
      stack.open({ kind: 'page' }, t);

      // Inject a structural chapter-opener element as the page's first
      // child when the chapter has a label AND this is the first @page in
      // that chapter. The element carries the chapter label as both its
      // text content and a data attribute, so projects style it however
      // they like:
      //
      //     <div class="chapter-opener" data-chapter-label="C.01">C.01</div>
      //
      // HISTORICAL: this is a real element rather than a `::before` because
      // the Paged.js polisher stripped `::before` on `.chapter`/`.page`. That
      // engine is gone, so a pseudo-element may now be viable — but the
      // structural element is also what carries `data-chapter-label` to the
      // viewer, so this is a deliberate keep, not an unexamined leftover. A structural element is the simplest
      // mechanism that survives pagination and is reusable across
      // projects (any project styling `.chapter-opener` gets the same
      // markup).
      if (label && !chapter.openerEmitted) {
        const opener = new state.Token('html_block', '', 0);
        opener.content = `<div class="chapter-opener" data-chapter-label="${escapeAttr(label)}">${escapeHtml(label)}</div>\n`;
        out.push(opener);
        chapter.openerEmitted = true;
      }

      const spread = stack.get('spread');
      if (spread) {
        spread.sawAnyPage = true;
        spread.noPagesYet = false;
      } else if (options.preferPagesInSpreads) {
        warn(state.env, meta.__line || 0, 'page_outside_spread', '@page used outside of a spread; allowed, but spreads are recommended for deliberate grouping.', meta);
      }
    }

    function openSection(meta) {
      const t = new state.Token('layout_section_open', 'div', 1);
      addClasses(t, 'section', meta.attrs && meta.attrs.class ? meta.attrs.class : '');
      attachDataAttrs(t, 'section', meta.name, meta.attrs || {});
      // Precomputed here (instead of scanned per-render from the renderer
      // rule) so the col-split renderer branch is O(1): the transform pass
      // is the single place that walks the marker stream, so it is also the
      // right place to record whether THIS section's body contains a
      // @column-break. Stored on the token's own `meta` (not env / not a
      // rendered attribute) since it's per-token render guidance, not
      // author-visible output. `line` is the 1-based marker line, threaded
      // for the source-range annotation rule (source-range.ts). Do NOT set
      // token.map here — see the do-not-use-token.map comment in
      // openChapter above (ADR 0009); applies identically here.
      t.meta = { hasColumnBreak: false, line: meta.__line };
      stack.open(
        {
          kind: 'section',
          meta: { name: meta.name || null, attrs: { ...(meta.attrs || {}) } },
          openToken: t,
        },
        t
      );
    }

    for (let i = 0; i < state.tokens.length; i++) {
      const tok = state.tokens[i];

      if (tok.type !== 'layout_marker') {
        out.push(tok);
        continue;
      }

      const meta = tok.meta || {};
      const kind = meta.kind;
      const line = meta.__line || 0;

      if (kind === 'chapter') {
        stack.close('chapter');
        openChapter(meta);
        continue;
      }

      if (kind === 'spread') {
        if (stack.has('spread')) {
          warn(state.env, line, 'nested_spread', '@spread encountered while another spread is open; closing the previous spread automatically.', meta);
        }
        stack.close('spread');
        openSpread(meta);
        continue;
      }

      if (kind === 'page') {
        stack.close('page');
        openPage(meta);
        continue;
      }

      if (kind === 'section') {
        stack.close('section');

        // A @section with no open @page is VALID AUTHORING and warns about
        // nothing. Audited 2026-08-12 across both real books: all 17
        // occurrences were `@section .gp-columns-2` — column runs used as
        // layout wrappers around flowing prose, exactly what the marker is
        // for. Zero rendered wrong, zero used .gp-pin. A diagnostic that is
        // 17-for-17 false positives trains authors to ignore diagnostics.
        //
        // The one harm an unwrapped section could cause — a .gp-pin with no
        // containing block — already has its own dedicated diagnostic in
        // gp-pin-scope.js, which reports it precisely instead of by proxy.
        //
        // An `implicitPage` option used to wrap these in a synthetic
        // `data-page="auto"` page. Removed with the warning: nothing in the
        // product ever set it, no manifest key or CLI flag could reach it,
        // and enabling it would have forced a page break before every
        // wrapped section (`.page { break-before: page }` applies to the
        // synthetic wrapper too). If page-assignment is ever genuinely
        // wanted, build it deliberately against a measured symptom — do not
        // resurrect a switch that was unreachable and broken.
        const spread = stack.get('spread');
        if (spread && spread.noPagesYet) {
          warn(
            state.env,
            line,
            'spread_without_pages',
            '@section inside a spread without an explicit @page. Allowed (adhoc spread), but explicit @page markers give stronger control.',
            meta
          );
        }

        openSection(meta);
        continue;
      }

      if (kind === 'continue') {
        const section = stack.get('section');
        if (!section || !section.meta) {
          warn(state.env, line, 'continue_without_section', '@continue used without an open @section; ignoring marker.', meta);
          continue;
        }

        const contMeta = {
          name: section.meta.name,
          attrs: { ...(section.meta.attrs || {}) },
        };
        // __line is deliberately re-attached here: contMeta only copies
        // name/attrs from the original section's meta snapshot, and openSection
        // reads meta.__line for the source-range annotation rule. Without this,
        // a continuation section's line would be undefined (non-finite), which
        // consumers must reject rather than silently resolve to whole-document
        // offsets (see ADR 0009).
        contMeta.__line = line;
        const cls = (contMeta.attrs.class || '').split(/\s+/).filter(Boolean);
        if (!cls.includes('gp-continued')) cls.push('gp-continued');
        contMeta.attrs.class = cls.join(' ');

        stack.close('section');
        openSection(contMeta);
        continue;
      }

      if (kind === 'page-break') {
        const t = new state.Token('layout_page_break', 'div', 0);
        // Thread the 1-based marker line for source-range.ts. Do NOT set
        // token.map — see the do-not-use-token.map comment in openChapter
        // above (ADR 0009); applies identically here.
        t.meta = { line };
        t.attrSet('class', 'gp-page-break');
        t.attrSet('aria-hidden', 'true');
        out.push(t);
        continue;
      }

      if (kind === 'column-break') {
        // Record the column-break onto the currently open section's OPEN
        // token (see openSection) rather than rescanning the token stream
        // at render time. At most one section frame is ever open at a time
        // (every section-affecting marker closes the current section
        // before opening the next — see stack.close('section') above and
        // in openPage/openChapter's stack.close calls), so "the currently
        // open section" is unambiguously the one this column-break belongs
        // to.
        const openSectionFrame = stack.get('section');
        if (openSectionFrame && openSectionFrame.openToken && !openSectionFrame.openToken.meta.hasColumnBreak) {
          const sectionCls = openSectionFrame.openToken.attrGet('class') || '';
          if (sectionCls.includes('col-split')) {
            openSectionFrame.openToken.meta.hasColumnBreak = true;
          }
        }

        const t = new state.Token('layout_column_break', 'div', 0);
        // Thread the 1-based marker line for source-range.ts. Do NOT set
        // token.map — see the do-not-use-token.map comment in openChapter
        // above (ADR 0009); applies identically here.
        t.meta = { line };
        t.attrSet('class', 'gp-column-break');
        t.attrSet('aria-hidden', 'true');
        out.push(t);
        continue;
      }

      if (kind === 'end-section') {
        stack.close('section');
        continue;
      }
    }

    // At EOF: close every open scope so each file's render produces balanced
    // HTML. gutterpress renders chapter files one at a time and concatenates the
    // output (src/lib/markdown/index.ts); if any scope leaks across that
    // boundary, the next file's content parses as nested inside the previous
    // file's last unclosed wrapper. closeAll() drains every open frame,
    // innermost kind first, so files that use @page without an enclosing
    // @chapter (e.g. front-matter pages) can't leak an open .page wrapper
    // across the file boundary.
    const eofSpread = stack.get('spread');
    if (eofSpread && !eofSpread.sawAnyPage) {
      warn(
        state.env,
        0,
        'spread_eof_close',
        'An open @spread reached end-of-document; closing it automatically.',
        null
      );
    }

    stack.closeAll();
    state.tokens = out;
  });

  // Renderer rules for injected tokens.
  //
  // col-split handling. HISTORICAL: Paged.js stripped `break-after: column` during CSS
  // preprocessing, so CSS column breaks never fire. Authors opt in by adding
  // `.col-split` to an @section; the renderer then emits explicit
  // <div class="col"> sibling wrappers and treats @column-break as the
  // closing/opening div boundary. @section .two-column WITHOUT .col-split
  // keeps native CSS multi-column balancing behavior.
  //
  // Depth state lives on env (per-render) so renders can't leak state into
  // one another. layout_page_open / layout_chapter_open also reset depth
  // defensively in case of misnested markers within one render.
  function getDepth(env) {
    return (env && env.__colSplitDepth) || 0;
  }
  function setDepth(env, n) {
    if (env) env.__colSplitDepth = n;
  }

  // layout_chapter_close / layout_spread_open / layout_spread_close /
  // layout_page_close intentionally have NO renderer rule: markdown-it's own
  // Renderer.render() already falls back to self.renderToken() for any token
  // type with no registered rule (see markdown-it/lib/renderer.js), so a rule
  // here that only forwarded to renderToken was dead weight that implied it
  // did something. Only layout_chapter_open / layout_page_open need rules,
  // because they also reset the col-split depth counter (a real side effect).
  md.renderer.rules.layout_chapter_open = (tokens, idx, opts, env, self) => {
    setDepth(env, 0);
    return self.renderToken(tokens, idx, opts);
  };
  md.renderer.rules.layout_page_open = (tokens, idx, opts, env, self) => {
    setDepth(env, 0);
    return self.renderToken(tokens, idx, opts);
  };

  md.renderer.rules.layout_section_open = (tokens, idx, opts, env, self) => {
    const token = tokens[idx];
    const cls = token.attrGet('class') || '';

    // hasColumnBreak is precomputed once, during the layout_transform core
    // pass (see openSection / the 'column-break' branch above), instead of
    // rescanning the token stream here on every render.
    if (cls.includes('col-split') && token.meta && token.meta.hasColumnBreak) {
      setDepth(env, getDepth(env) + 1);
      // cls already contains 'section col-split'; it is author-controlled
      // (class=... / .class shorthand on the @section marker) and must be
      // escaped the same as every other attribute value this file emits —
      // it is not safe to assume the marker tokenizer already stripped
      // everything attribute-unsafe (e.g. a `'`-quoted class=value can still
      // carry a literal `"` through, see markers.test.ts).
      //
      // data-source-range (set by the source_range core rule, which runs
      // BEFORE render — see source-range.ts) is threaded through explicitly:
      // this branch bypasses self.renderToken()/renderAttrs, so any attr not
      // named here is silently dropped from output. Without this, a
      // col-split section with a @column-break would be un-targetable by
      // the context menu's "marker" kind (plan §3.1) even though its
      // wrapper token IS annotated internally.
      const rangeAttr = token.attrGet('data-source-range');
      const rangeHtml = rangeAttr ? ` data-source-range="${escapeAttr(rangeAttr)}"` : '';
      return `<div class="${escapeAttr(cls)}"${rangeHtml}><div class="col">\n`;
    }

    return self.renderToken(tokens, idx, opts);
  };

  md.renderer.rules.layout_section_close = (tokens, idx, opts, env, self) => {
    if (getDepth(env) > 0) {
      setDepth(env, getDepth(env) - 1);
      return `</div></div>\n`;
    }
    return self.renderToken(tokens, idx, opts);
  };

  // nesting:0 on <div> emits only an opening tag — emit complete open+close pair instead.
  // Both tokens' class is always the plugin's own literal ('gp-page-break' /
  // 'gp-column-break') today, never author input, but escapeAttr is applied
  // here too so this stays safe if that ever changes.
  //
  // data-source-range (set by the source_range core rule, which runs BEFORE
  // render — see source-range.ts) is threaded through explicitly in both
  // rules below: this custom renderer bypasses self.renderToken()/
  // renderAttrs, so any attr not named here is silently dropped from
  // output. Without this, @page-break / @column-break markers would be
  // un-targetable by the context menu's "marker" kind (plan §3.1's kind
  // precedence explicitly includes "layout wrapper/break") even though
  // this module threads token.meta.line onto them for exactly this
  // purpose.
  md.renderer.rules.layout_page_break = (tokens, idx) => {
    const cls = tokens[idx].attrGet('class') || 'gp-page-break';
    const rangeAttr = tokens[idx].attrGet('data-source-range');
    const rangeHtml = rangeAttr ? ` data-source-range="${escapeAttr(rangeAttr)}"` : '';
    return `<div class="${escapeAttr(cls)}" aria-hidden="true"${rangeHtml}></div>\n`;
  };

  md.renderer.rules.layout_column_break = (tokens, idx, opts, env) => {
    if (getDepth(env) > 0) {
      return `</div><div class="col">\n`;
    }
    const cls = tokens[idx].attrGet('class') || 'gp-column-break';
    const rangeAttr = tokens[idx].attrGet('data-source-range');
    const rangeHtml = rangeAttr ? ` data-source-range="${escapeAttr(rangeAttr)}"` : '';
    return `<div class="${escapeAttr(cls)}" aria-hidden="true"${rangeHtml}></div>\n`;
  };

  // layout_marker tokens are transformed away in the core rule
  md.renderer.rules.layout_marker = () => '';
}

/**
 * The minimal CSS the DOM this module emits requires. Author utility
 * vocabulary lives in gutterpress-css.ts — see the ownership note above.
 * Consumers should inject this into <head> after their user stylesheets so
 * the layout contract (page/section/column breaks) wins at equal specificity.
 *
 * `.page`/`.spread` are given `position: relative` so they are the containing
 * block for any abspos descendant: a mispinned `bottom: 0` now fails LOCALLY
 * on its own page instead of resolving against the document canvas and
 * painting on the last page of the book.
 *
 * The break/orphan rules below (`break-after` on headings, image sizing,
 * first-child glue) are all `:where()` so they carry zero specificity —
 * author CSS at any specificity wins outright, reusing this same
 * after-author injection point.
 *
 * `vertical-align: bottom` on a lone image is a print-correctness rule, not
 * cosmetics. An `<img>` in a `<p>` is inline-level, so its line box adds
 * half-leading/descender space UNDER the image: an image sized to exactly the
 * page content box (a book capping art at `page-height - margins`, or art that
 * naturally fills the page) produces a paragraph a few px TALLER than the box
 * it was sized to fit. MEASURED (Chromium 148, field guide chapter 1, 10in
 * content box): a 956px image made a 963.59px paragraph — a 3.6px overflow
 * that pushed the enclosing named-page wrapper's bottom edge onto the NEXT
 * sheet, so Chromium named that sheet after the PREVIOUS page name and the new
 * template's running head and folio silently vanished. `vertical-align:
 * bottom` collapses the line box onto the image, keeping the image inline (so
 * `text-align: center` still centers it — `display: block` would not).
 *
 */
export const MARKER_CSS = `
/* The UA default of 8px body margin is a screen affordance with no meaning
   in paged media, and engines disagree about it: a polyfill that treats the
   page div as the page box drops it, native print keeps it. Left in place it
   insets EVERY page's content by 8px per side, and -- measured, 300dpi,
   6x4in sheet -- it is what stops a full-width block from reaching the
   paper: it lands at 0.080..5.917in of a 6in sheet instead of
   0.000..6.000in, because width:100% resolves against the BODY content box,
   not the page's. Zeroing it here (first in the cascade) makes the two
   agree. Authors who want a body margin still just declare one. */
body { margin: 0; }

.gp-page-break { break-before: page; }
.page { break-before: page; }
.spread { break-before: page; }
:where(.page, .spread) { position: relative; }
.gp-column-break { break-after: column; height: 0; font-size: 0; line-height: 0; visibility: hidden; }

:where(h1,h2,h3,h4,h5,h6) { break-after: avoid; }
:where(img, svg, video) { max-width: 100%; }
:where(p > img:only-child, figure > img) { width: fit-content; max-width: 100%; height: auto; vertical-align: bottom; }
:where(.section, figure) > :where(:first-child) { break-before: avoid; }

`;
