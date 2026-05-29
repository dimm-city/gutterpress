'use strict';

/**
 * markdown-it-paged (inlined from dimm-city/markdown-it-paged)
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
 *   page-break -> <div class="md-page-break" aria-hidden="true"></div>
 *   column-break -> <div class="md-column-break" aria-hidden="true"></div>
 *
 * Opt-in:
 *   If no markers are present, plugin does nothing.
 *
 * Validation:
 *   Warnings are pushed into env.layoutWarnings: Array<{ line, type, message, marker? }>
 */

function isBareToken(token) {
  return token && !token.includes('=') && !token.startsWith('.') && !token.startsWith('#');
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

  const head = tokens[0]; // "@chapter" | "@spread" | "@page" | "@section" | "@continue" | "@end-section" | "@page-break" | "@column-break"
  const kind = head.slice(1);

  if (!['chapter', 'spread', 'page', 'section', 'continue', 'page-break', 'column-break', 'end-section'].includes(kind)) return null;

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

  for (let idx = 0; idx < body.length; idx++) {
    if (idx === nameIndex) continue;

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

    classes.push(t);
  }

  if (classes.length) attrs.class = classes.join(' ');
  return { kind, name, attrs };
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

function plugin(md, pluginOptions = {}) {
  const options = {
    implicitPage: false,
    preferPagesInSpreads: false,
    warnOnBreakWithoutScope: true,
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

    state.line = startLine + 1;
    return true;
  }

  md.block.ruler.before('paragraph', 'layout_marker', markerBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });

  md.core.ruler.after('block', 'layout_transform', function (state) {
    if (!state.env.__layoutMarkersUsed) return;

    const out = [];
    let chapterOpen = false;
    let spreadOpen = false;
    let pageOpen = false;
    let sectionOpen = false;
    let currentSectionMeta = null;

    let spreadStartedWithNoPagesYet = false;
    let sawAnyPageInsideCurrentSpread = false;

    // Chapter counter context inherited by child @page directives.
    // When an @chapter declares ch="N" (or a .chapter-N class), every @page
    // opened within that chapter automatically gets the same .chapter-N
    // class. This lets CSS rules like `.page.chapter-3 { counter-reset:
    // chapter 3 }` in page-rules.css match every page in the chapter,
    // because Paged.js needs the class on every page wrapper (it clones
    // content per page). Authors don't hand-apply .chapter-N anywhere.
    let chapterCounterClass = '';

    // Chapter label propagated to every child @page as data-chapter-label.
    // This lets CSS reach the chapter label from any descendant page via
    // attr(data-chapter-label) — e.g. to render a chapter-opener badge as
    // a ::before pseudo on the page where the content actually lives,
    // rather than on the chapter wrapper (which paged.js may split into
    // an empty leading sheet).
    let chapterLabel = '';

    function closeOpenScopes() {
      closeSection();
      closePage();
      closeSpread();
    }

    function closeChapter() {
      if (!chapterOpen) return;
      closeOpenScopes();
      out.push(new state.Token('layout_chapter_close', 'div', -1));
      chapterOpen = false;
      chapterCounterClass = '';
      chapterLabel = '';
    }

    function closeSection() {
      if (!sectionOpen) return;
      out.push(new state.Token('layout_section_close', 'div', -1));
      sectionOpen = false;
      currentSectionMeta = null;
    }

    function closePage() {
      if (!pageOpen) return;
      closeSection();
      out.push(new state.Token('layout_page_close', 'div', -1));
      pageOpen = false;
    }

    function closeSpread() {
      if (!spreadOpen) return;
      closePage();
      out.push(new state.Token('layout_spread_close', 'div', -1));
      spreadOpen = false;
      spreadStartedWithNoPagesYet = false;
      sawAnyPageInsideCurrentSpread = false;
    }

    function openChapter(meta) {
      const t = new state.Token('layout_chapter_open', 'div', 1);
      const classes = meta.attrs?.class || '';
      addClasses(t, 'chapter', classes);
      // Pass meta.name so attachDataAttrs emits `data-chapter-label="<name>"`
      // (e.g. data-chapter-label="C.01"). Consumer plugins use this to render
      // the chapter's badge / opener UI; standard markdown-it-paged treats it
      // as opaque metadata.
      attachDataAttrs(t, 'chapter', meta.name, meta.attrs || {});
      out.push(t);
      chapterOpen = true;
      // Track the label so we can propagate it to child @page elements (see
      // openPage). Paged.js may split the chapter across multiple sheets;
      // having data-chapter-label on each child page lets CSS render the
      // chapter badge on the page where content actually lives.
      chapterLabel = meta.name || '';
      // Resolve chapter counter class: explicit `.chapter-N` in the class
      // list takes priority over the `ch="N"` attribute.
      const explicit = (classes.match(/(?:^|\s)(chapter-\d+)(?=\s|$)/) || [])[1] || '';
      const fromAttr = meta.attrs?.ch ? `chapter-${meta.attrs.ch}` : '';
      chapterCounterClass = explicit || fromAttr;
    }

    function openSpread(meta) {
      const t = new state.Token('layout_spread_open', 'div', 1);
      addClasses(t, 'spread', meta.attrs && meta.attrs.class ? meta.attrs.class : '');
      attachDataAttrs(t, 'spread', meta.name, meta.attrs || {});
      out.push(t);
      spreadOpen = true;
      spreadStartedWithNoPagesYet = true;
      sawAnyPageInsideCurrentSpread = false;
    }

    function openPage(meta) {
      const t = new state.Token('layout_page_open', 'div', 1);
      const explicit = (meta.attrs && meta.attrs.class) ? meta.attrs.class : '';
      // Auto-inherit the open chapter's counter class so .page.chapter-N
      // selectors in page-rules.css match every page in the chapter without
      // the author repeating .chapter-N on every @page directive.
      const tokens = explicit ? explicit.split(/\s+/) : [];
      const merged = (chapterCounterClass && !tokens.includes(chapterCounterClass))
        ? (explicit ? `${explicit} ${chapterCounterClass}` : chapterCounterClass)
        : explicit;
      addClasses(t, 'page', merged);
      attachDataAttrs(t, 'page', meta.name, meta.attrs || {});
      // Propagate the chapter label so CSS can target the chapter-opener
      // page via attribute selector (paged.js may split the chapter wrapper
      // into an empty leading sheet, but the child page stays with its
      // content).
      if (chapterLabel) t.attrSet('data-chapter-label', chapterLabel);
      out.push(t);
      pageOpen = true;

      // Inject a structural chapter-opener element as the page's first
      // child when the chapter has a label AND this is the first @page in
      // that chapter. The element carries the chapter label as both its
      // text content and a data attribute, so projects style it however
      // they like:
      //
      //     <div class="chapter-opener" data-chapter-label="C.01">C.01</div>
      //
      // Paged.js strips `::before` declarations on `.chapter` and `.page`
      // elements during its polisher pass, so a pure-CSS pseudo-element
      // approach isn't viable here. A structural element is the simplest
      // mechanism that survives pagination and is reusable across
      // projects (any project styling `.chapter-opener` gets the same
      // markup).
      if (chapterLabel) {
        const opener = new state.Token('html_block', '', 0);
        opener.content = `<div class="chapter-opener" data-chapter-label="${escapeAttr(chapterLabel)}">${escapeHtml(chapterLabel)}</div>\n`;
        out.push(opener);
        // Clear so subsequent @page directives in the same chapter don't
        // emit another opener — the opener belongs on the FIRST page only.
        chapterLabel = '';
      }

      if (spreadOpen) {
        sawAnyPageInsideCurrentSpread = true;
        spreadStartedWithNoPagesYet = false;
      } else if (options.preferPagesInSpreads) {
        warn(state.env, meta.__line || 0, 'page_outside_spread', '@page used outside of a spread; allowed, but spreads are recommended for deliberate grouping.', meta);
      }
    }

    function openSection(meta) {
      const t = new state.Token('layout_section_open', 'div', 1);
      addClasses(t, 'section', meta.attrs && meta.attrs.class ? meta.attrs.class : '');
      attachDataAttrs(t, 'section', meta.name, meta.attrs || {});
      out.push(t);
      sectionOpen = true;
      currentSectionMeta = {
        name: meta.name || null,
        attrs: { ...(meta.attrs || {}) },
      };
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
        closeChapter();
        openChapter(meta);
        continue;
      }

      if (kind === 'spread') {
        if (spreadOpen) {
          warn(state.env, line, 'nested_spread', '@spread encountered while another spread is open; closing the previous spread automatically.', meta);
        }
        closeSpread();
        openSpread(meta);
        continue;
      }

      if (kind === 'page') {
        closePage();
        openPage(meta);
        continue;
      }

      if (kind === 'section') {
        closeSection();

        if (!pageOpen) {
          if (options.implicitPage) {
            warn(state.env, line, 'implicit_page', '@section used without an open @page; creating an implicit page wrapper (data-page="auto").', meta);
            openPage({ name: 'auto', attrs: {}, __line: line });
          } else {
            warn(state.env, line, 'section_without_page', '@section used without an open @page; region will render but will not be wrapped in a page.', meta);
          }
        }

        if (spreadOpen && spreadStartedWithNoPagesYet) {
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
        if (!sectionOpen || !currentSectionMeta) {
          warn(state.env, line, 'continue_without_section', '@continue used without an open @section; ignoring marker.', meta);
          continue;
        }

        const contMeta = {
          name: currentSectionMeta.name,
          attrs: { ...(currentSectionMeta.attrs || {}) },
        };
        const cls = (contMeta.attrs.class || '').split(/\s+/).filter(Boolean);
        if (!cls.includes('pmd-continued')) cls.push('pmd-continued');
        contMeta.attrs.class = cls.join(' ');

        closeSection();
        openSection(contMeta);
        continue;
      }

      if (kind === 'page-break') {
        const t = new state.Token('layout_page_break', 'div', 0);
        t.attrSet('class', 'md-page-break');
        t.attrSet('aria-hidden', 'true');
        out.push(t);
        continue;
      }

      if (kind === 'column-break') {
        const t = new state.Token('layout_column_break', 'div', 0);
        t.attrSet('class', 'md-column-break');
        t.attrSet('aria-hidden', 'true');
        out.push(t);
        continue;
      }

      if (kind === 'end-section') {
        closeSection();
        continue;
      }
    }

    // At EOF: close every open scope so each file's render produces balanced
    // HTML. print-md renders chapter files one at a time and concatenates the
    // output (src/lib/markdown/index.ts); if any scope leaks across that
    // boundary, the next file's content parses as nested inside the previous
    // file's last unclosed wrapper.
    //
    // We must close ALL four scope kinds explicitly here. closeChapter()
    // cascades through inner scopes via closeOpenScopes(), but only when
    // chapterOpen is true — files that use @page without an enclosing
    // @chapter (e.g. front-matter pages) would otherwise leak an open
    // .page wrapper across the file boundary. Each close* function is
    // idempotent, so calling them all in innermost→outermost order is safe.
    if (spreadOpen && !sawAnyPageInsideCurrentSpread) {
      warn(
        state.env,
        0,
        'spread_eof_close',
        'An open @spread reached end-of-document; closing it automatically.',
        null
      );
    }

    closeSection();
    closePage();
    closeSpread();
    closeChapter();
    state.tokens = out;
  });

  // Renderer rules for injected tokens.
  //
  // col-split handling: Paged.js strips `break-after: column` during CSS
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

  md.renderer.rules.layout_chapter_open = (tokens, idx, opts, env, self) => {
    setDepth(env, 0);
    return self.renderToken(tokens, idx, opts);
  };
  md.renderer.rules.layout_chapter_close = (tokens, idx, opts, env, self) => self.renderToken(tokens, idx, opts);
  md.renderer.rules.layout_spread_open = (tokens, idx, opts, env, self) => self.renderToken(tokens, idx, opts);
  md.renderer.rules.layout_spread_close = (tokens, idx, opts, env, self) => self.renderToken(tokens, idx, opts);
  md.renderer.rules.layout_page_open = (tokens, idx, opts, env, self) => {
    setDepth(env, 0);
    return self.renderToken(tokens, idx, opts);
  };
  md.renderer.rules.layout_page_close = (tokens, idx, opts, env, self) => self.renderToken(tokens, idx, opts);

  md.renderer.rules.layout_section_open = (tokens, idx, opts, env, self) => {
    const token = tokens[idx];
    const cls = token.attrGet('class') || '';

    if (cls.includes('col-split')) {
      // Look ahead for layout_column_break before the matching section_close
      let depth = 1;
      let hasBreak = false;
      for (let i = idx + 1; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.type === 'layout_section_open') depth++;
        if (t.type === 'layout_section_close') { depth--; if (depth === 0) break; }
        if (t.type === 'layout_column_break' && depth === 1) { hasBreak = true; break; }
      }
      if (hasBreak) {
        setDepth(env, getDepth(env) + 1);
        // cls already contains 'section col-split'
        return `<div class="${cls}"><div class="col">\n`;
      }
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

  // nesting:0 on <div> emits only an opening tag — emit complete open+close pair instead
  md.renderer.rules.layout_page_break = (tokens, idx) => {
    const cls = tokens[idx].attrGet('class') || 'md-page-break';
    return `<div class="${cls}" aria-hidden="true"></div>\n`;
  };

  md.renderer.rules.layout_column_break = (tokens, idx, opts, env) => {
    if (getDepth(env) > 0) {
      return `</div><div class="col">\n`;
    }
    const cls = tokens[idx].attrGet('class') || 'md-column-break';
    return `<div class="${cls}" aria-hidden="true"></div>\n`;
  };

  // layout_marker tokens are transformed away in the core rule
  md.renderer.rules.layout_marker = () => '';
}

/**
 * Minimal Paged.js-friendly CSS for the classes this plugin emits.
 * Consumers should inject this into <head> after their user stylesheets so
 * the layout contract (page/section/column breaks) wins at equal specificity.
 */
const PAGED_CSS = `
.md-page-break { break-before: page; }
.page { break-before: page; }
.spread { break-before: page; }
.section { break-inside: avoid; }
.section.col-split { break-inside: auto; }
.md-column-break { break-after: column; height: 0; font-size: 0; line-height: 0; visibility: hidden; }
`;

// CJS default export
module.exports = plugin;
// Allow ESM default import via interop
module.exports.default = plugin;
module.exports.PAGED_CSS = PAGED_CSS;
