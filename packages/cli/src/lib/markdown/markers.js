/**
 * Gutterpress layout markers — the `@page`/`@section`/`@chapter` authoring
 * surface, and the CSS the DOM it emits requires (`MARKER_CSS`).
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
 *
 * Declared markers (#240 — "declarative container components in core"):
 *   A plugin may export a `markers` table instead of (or alongside) hand-
 *   writing its own block rule:
 *
 *     export const markers = {
 *       callout:  { tag: 'div', class: 'dc-alert',
 *                   variants: { note: 'dc-note', warning: 'dc-note warning' },
 *                   label: { class: 'dc-alert-label', from: 'attr:label' },
 *                   autoCloseAt: ['eof'] },
 *       sidebar:  { tag: 'aside', class: 'dc-sidebar' },
 *       'dm-note': { alias: 'callout', preset: { variant: 'dm' } },
 *       'roll-table': { deprecated: 'Removed in 17.3.0 — use @outcome.' },
 *     };
 *
 *   This is DATA the loader (`plugins.ts`) reads off the plugin module —
 *   the same relationship `css`/`styles` already have (CLAUDE.md §5: the
 *   `(md, options) => void` plugin function signature is untouched, no host
 *   `ctx` is injected). `renderer.ts`'s `createMarkdownRenderer` merges every
 *   loaded plugin's table via `buildDeclaredMarkerRegistry` (below) —
 *   validating collisions against core's own eight names and against each
 *   other, resolving `alias`/`preset` indirection — and hands the result to
 *   THIS plugin as `pluginOptions.declaredMarkers`. From there, `@callout` /
 *   `@end-callout` run through the EXACT SAME grammar, escaping, class
 *   merging, `data-source-range`/`data-chapter-src` threading and warning
 *   channel as `@section` — see `parseMarkerLine`'s `declaredWords` param,
 *   `openDeclaredMarker`, and the declared-marker branch in `layout_transform`
 *   below. A plugin that needs more than a declarative wrapper still just
 *   writes a plain markdown-it block rule by hand; the declarative path is
 *   an alternative to that, never a replacement for it.
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

/**
 * The marker kinds this module understands. Also the near-miss dictionary.
 *
 * These names are RESERVED TO CORE, and the reservation is silent: a name here
 * is claimed during BLOCK parsing, which runs before user plugins register on
 * `md.core.ruler.push`. A plugin that defines a marker of the same name is
 * therefore never reached — core consumes the line first, the plugin's handler
 * does not run, and nothing warns, because from the typo-detector's point of
 * view the line was legitimately claimed (see the note above that rule).
 *
 * Observed in the field guide: a project plugin defined its own `@continue`
 * for splitting skill cards across a page. Core owns `continue`, so both call
 * sites emitted a core "used without an open @section" warning and the
 * author's intended card split silently never happened. Branded names
 * (`@skill-continue`) avoid the collision entirely, which is what the plugin
 * rule in CLAUDE.md §5 means by project plugins adding BRANDED component
 * markers.
 */
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

/**
 * @param {string} line
 * @param {Set<string>|null} [declaredWords] — every declared marker's own
 *   name PLUS its auto-derived `end-<name>` closer (built once per plugin()
 *   call by `declaredKindWords`, from the registry `buildDeclaredMarkerRegistry`
 *   resolved). `null`/omitted for the zero-declared-markers case, which is
 *   every project not using #240 — behavior is then IDENTICAL to before this
 *   parameter existed.
 */
function parseMarkerLine(line, declaredWords) {
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

  const head = tokens[0]; // "@chapter" | "@spread" | "@page" | "@section" | "@continue" | "@end-section" | "@page-break" | "@column-break" | a declared marker's own name | "@end-<declared name>"
  const kind = head.slice(1);

  // #240: a declared marker's own name (e.g. "callout") and its
  // auto-derived closer ("end-callout") are recognized ALONGSIDE the eight
  // core kinds — `declaredWords` is pre-validated (buildDeclaredMarkerRegistry)
  // to never overlap KNOWN_KINDS, so this can never make an existing core
  // kind mean something new.
  if (!KNOWN_KINDS.includes(kind) && !(declaredWords && declaredWords.has(kind))) return null;

  // Every closer — core's own "end-section", and every declared marker's
  // auto-derived "end-<name>" — takes no body, exactly like page-break /
  // column-break / continue. `end-section` already matches the `end-`
  // prefix, so this single check covers all of them.
  if (kind === 'page-break' || kind === 'column-break' || kind === 'continue' || kind.startsWith('end-')) {
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

/**
 * The other half of every "that isn't marker syntax" warning: the line may
 * not be a marker at all.
 *
 * A marker is any line whose first non-space character is `@` followed by a
 * known kind — including a line a PARAGRAPH happened to wrap onto. A book
 * that writes about Gutterpress hits this the moment a sentence breaks
 * before "@page container", and the author sees a page split mid-sentence
 * with a warning that only explains class syntax. MEASURED on this repo's
 * own gp-image-positioning fixture, which shipped that exact split.
 *
 * The remedy is standard markdown, not a Gutterpress escape: `\@page`
 * renders as literal `@page` (CommonMark lists `@` as escapable ASCII
 * punctuation, and this rule never sees the line because it no longer
 * starts with `@`), and so does an inline-code span. Naming it in the
 * warning is what turns a confusing diagnostic into a fix — the author who
 * trips this never typed an escape, because they never intended a marker.
 */
function proseEscapeHint(kind) {
  return (
    ` If this line is prose that happens to begin with "@${kind}" — a wrapped sentence, for` +
    ` instance — escape it as \\@${kind} or write it as \`@${kind}\` in backticks, and it stays text.`
  );
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
    // The four core kinds keep their historical, hand-picked attribute
    // names verbatim (unchanged by #240). Any other `kind` reaching here is
    // a DECLARED marker's own base name (`openDeclaredMarker` passes
    // `decl.baseKind`, e.g. "callout") — those get the same treatment
    // generically: `data-<kind>="<name>"`, `name` being the marker's bare
    // argument (the variant selector, e.g. "warning") or an alias's preset
    // variant. This is "the same machinery as @section" applied to a kind
    // @section's own author never gets to pick.
    if (kind === 'chapter') token.attrSet('data-chapter-label', name);
    else if (kind === 'spread') token.attrSet('data-spread', name);
    else if (kind === 'page') token.attrSet('data-page', name);
    else if (kind === 'section') token.attrSet('data-section', name);
    else token.attrSet(`data-${kind}`, name);
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

// ─────────────────────────────────────────────────────────────────────────
// #240 — declarative container components.
//
// The registry-building half (this section) is pure data validation: given
// every loaded plugin's raw `markers` export, produce ONE flat, fully-
// resolved Map (alias/preset baked in, autoCloseAt normalized) or throw a
// load-time error identifying the offending plugin(s). `renderer.ts`'s
// `createMarkdownRenderer` calls `buildDeclaredMarkerRegistry` once, BEFORE
// `md.use(gutterpressMarkers, { declaredMarkers })`, so this plugin's own
// block/core rules (above and below) never see raw, unvalidated plugin
// input — by the time `plugin()` runs, every declared name is known-safe.
// ─────────────────────────────────────────────────────────────────────────

/**
 * A declared marker's name must read like every core kind does: lower-case,
 * hyphen-separated. `end-` is reserved for the auto-derived closer
 * namespace (see `declaredKindWords`) — a plugin declaring a name that
 * starts with it would silently collide with SOME other marker's own
 * closer, so it is rejected outright rather than left as a footgun.
 */
const DECLARED_NAME_RE = /^[a-z][a-z0-9-]*$/;

function validateDeclaredMarkerName(name, pluginName) {
  if (!DECLARED_NAME_RE.test(name)) {
    throw new Error(
      `Plugin "${pluginName}" declares marker "@${name}" with an invalid name — marker names must be ` +
        `lower-case letters, digits and hyphens, starting with a letter (like core's own "page-break").`
    );
  }
  if (name.startsWith('end-')) {
    throw new Error(
      `Plugin "${pluginName}" declares marker "@${name}", but names starting with "end-" are reserved ` +
        `for the auto-derived closer of another declared marker (a container named "${name.slice(4)}" ` +
        `would collide with it). Rename this marker.`
    );
  }
}

/** A lower-case HTML tag name — used for both a container's own `tag` and its `label.tag`. */
const TAG_NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Validate + normalize the container-shaped fields common to a direct
 * declaration and an alias's target: `tag`, `class`, `variants`, `label`,
 * `autoCloseAt`. Shared by `resolveMarkerDeclaration` for both cases so an
 * alias's target is held to exactly the same contract a directly-declared
 * container is.
 */
function resolveContainerShape(name, pluginName, decl) {
  const tag = decl.tag !== undefined ? decl.tag : 'div';
  if (typeof tag !== 'string' || !TAG_NAME_RE.test(tag)) {
    throw new Error(
      `Plugin "${pluginName}"'s marker "@${name}" has an invalid \`tag\` (${JSON.stringify(decl.tag)}) — ` +
        `must be a lower-case HTML tag name.`
    );
  }

  const classBase = decl.class !== undefined ? decl.class : '';
  if (typeof classBase !== 'string') {
    throw new Error(`Plugin "${pluginName}"'s marker "@${name}" has a \`class\` that is not a string.`);
  }

  let variants;
  if (decl.variants !== undefined) {
    if (typeof decl.variants !== 'object' || decl.variants === null || Array.isArray(decl.variants)) {
      throw new Error(`Plugin "${pluginName}"'s marker "@${name}" has \`variants\` that is not a plain object.`);
    }
    variants = {};
    for (const [variantName, variantClass] of Object.entries(decl.variants)) {
      if (typeof variantClass !== 'string') {
        throw new Error(
          `Plugin "${pluginName}"'s marker "@${name}" variant "${variantName}" is not a string.`
        );
      }
      variants[variantName] = variantClass;
    }
  }

  let label;
  if (decl.label !== undefined) {
    if (typeof decl.label !== 'object' || decl.label === null || Array.isArray(decl.label)) {
      throw new Error(`Plugin "${pluginName}"'s marker "@${name}" has a \`label\` that is not an object.`);
    }
    if (typeof decl.label.class !== 'string' || !decl.label.class) {
      throw new Error(
        `Plugin "${pluginName}"'s marker "@${name}" has a \`label.class\` that is not a non-empty string.`
      );
    }
    // Only "attr:<name>" is supported today — the marker's own attribute of
    // that name becomes the label text (see openDeclaredMarker). The
    // "attr:" prefix leaves room to add other sources later (e.g. the
    // marker's own bare name) without a breaking format change; anything
    // else is rejected now rather than silently doing nothing later.
    const match =
      typeof decl.label.from === 'string' ? /^attr:([A-Za-z_][A-Za-z0-9_-]*)$/.exec(decl.label.from) : null;
    if (!match) {
      throw new Error(
        `Plugin "${pluginName}"'s marker "@${name}" has a \`label.from\` (${JSON.stringify(
          decl.label.from
        )}) that is not "attr:<name>" — that is the only supported form today.`
      );
    }
    const labelTag = decl.label.tag !== undefined ? decl.label.tag : 'div';
    if (typeof labelTag !== 'string' || !TAG_NAME_RE.test(labelTag)) {
      throw new Error(
        `Plugin "${pluginName}"'s marker "@${name}" has an invalid \`label.tag\` (${JSON.stringify(
          decl.label.tag
        )}).`
      );
    }
    label = { class: decl.label.class, attr: match[1], tag: labelTag };
  }

  let autoCloseAtEof = false;
  if (decl.autoCloseAt !== undefined) {
    if (!Array.isArray(decl.autoCloseAt)) {
      throw new Error(`Plugin "${pluginName}"'s marker "@${name}" has an \`autoCloseAt\` that is not an array.`);
    }
    for (const value of decl.autoCloseAt) {
      // "eof" is the only checkpoint this mechanism understands today (the
      // only one #240 names) — reject anything else now, loudly, rather
      // than silently ignoring a typo'd or not-yet-implemented value.
      if (value !== 'eof') {
        throw new Error(
          `Plugin "${pluginName}"'s marker "@${name}" declares an unsupported \`autoCloseAt\` value ` +
            `${JSON.stringify(value)} — only "eof" is currently supported.`
        );
      }
    }
    autoCloseAtEof = decl.autoCloseAt.includes('eof');
  }

  return { tag, classBase, variants, label, autoCloseAtEof };
}

/**
 * Resolve one already name-collision-checked registry entry into its final
 * shape, given the FULL raw registry (so an alias can look up a target
 * declared by a different plugin, loaded in any order) and the plugin-name
 * map (for error messages).
 *
 * Three shapes come out of this:
 *   - `{ name, deprecated }` — deprecated wins over every other field
 *     (CLAUDE.md-style "warn and strip generically": a marker mid-retirement
 *     does not also need a working tag/class).
 *   - `{ name, baseKind: name, tag, classBase, variants, label, autoCloseAtEof }`
 *     — an ordinary directly-declared container. `baseKind` equals its own
 *     `name` (no indirection), which lets `layout_transform` treat direct
 *     and aliased containers identically (see below).
 *   - `{ name, baseKind: <alias target>, presetVariant, tag, classBase,
 *      variants, label, autoCloseAtEof }` — an alias: the container shape is
 *     copied from its (validated) target, `baseKind` points at the target so
 *     `@dm-note` and `@end-callout` open/close the SAME frame, and
 *     `presetVariant` supplies the variant selector when the alias's own
 *     invocation line has no explicit bare name (openDeclaredMarker: an
 *     explicit name on the line still wins).
 */
function resolveMarkerDeclaration(name, rawDecl, rawRegistry, originOf) {
  const pluginName = originOf.get(name);

  if (typeof rawDecl !== 'object' || rawDecl === null || Array.isArray(rawDecl)) {
    throw new Error(`Plugin "${pluginName}"'s marker "@${name}" is not a plain object.`);
  }

  if (rawDecl.deprecated !== undefined) {
    if (typeof rawDecl.deprecated !== 'string' || !rawDecl.deprecated) {
      throw new Error(
        `Plugin "${pluginName}"'s marker "@${name}" has a \`deprecated\` value that is not a non-empty string.`
      );
    }
    return { name, deprecated: rawDecl.deprecated };
  }

  if (rawDecl.alias !== undefined) {
    if (typeof rawDecl.alias !== 'string' || !rawDecl.alias) {
      throw new Error(
        `Plugin "${pluginName}"'s marker "@${name}" has an \`alias\` value that is not a non-empty string.`
      );
    }
    const targetRaw = rawRegistry.get(rawDecl.alias);
    if (!targetRaw) {
      throw new Error(
        `Plugin "${pluginName}"'s marker "@${name}" aliases unknown marker "@${rawDecl.alias}" — no ` +
          `loaded plugin declares it.`
      );
    }
    if (targetRaw.deprecated !== undefined) {
      throw new Error(
        `Plugin "${pluginName}"'s marker "@${name}" aliases "@${rawDecl.alias}", which is deprecated: ` +
          `${targetRaw.deprecated}`
      );
    }
    if (targetRaw.alias !== undefined) {
      throw new Error(
        `Plugin "${pluginName}"'s marker "@${name}" aliases "@${rawDecl.alias}", which is itself an alias. ` +
          `Chained aliases are not supported — alias the base marker directly.`
      );
    }
    const preset = rawDecl.preset !== undefined ? rawDecl.preset : {};
    if (typeof preset !== 'object' || preset === null || Array.isArray(preset)) {
      throw new Error(`Plugin "${pluginName}"'s marker "@${name}" has a \`preset\` that is not a plain object.`);
    }
    if (preset.variant !== undefined && typeof preset.variant !== 'string') {
      throw new Error(`Plugin "${pluginName}"'s marker "@${name}" has a \`preset.variant\` that is not a string.`);
    }
    const container = resolveContainerShape(rawDecl.alias, originOf.get(rawDecl.alias), targetRaw);
    return { name, baseKind: rawDecl.alias, presetVariant: preset.variant, ...container };
  }

  return { name, baseKind: name, ...resolveContainerShape(name, pluginName, rawDecl) };
}

/**
 * Merge every loaded plugin's `markers` export into ONE flat, resolved
 * registry — `Map<name, ResolvedDecl>` — validating collisions at LOAD TIME
 * (#240 / P2): a declared name that shadows a core reserved name, or that
 * two different plugins both declare, throws immediately, naming both
 * sides, instead of the pre-#240 silent-skip footgun (core claims its
 * `@`-names during block parsing, before any plugin runs, so a colliding
 * plugin marker used to never run and never warn — see the header comment
 * on `KNOWN_KINDS`).
 *
 * @param {{ pluginName: string, markers: Record<string, unknown> }[]} sources
 *   One entry per LOADED plugin that declared a non-empty `markers` export,
 *   in plugin load order. A plugin with no `markers` export is simply
 *   omitted by the caller — this function never sees it.
 * @returns {Map<string, object>} empty when `sources` is empty.
 */
export function buildDeclaredMarkerRegistry(sources) {
  const rawRegistry = new Map();
  const originOf = new Map();

  for (const { pluginName, markers } of sources) {
    if (!markers) continue;
    for (const [name, rawDecl] of Object.entries(markers)) {
      validateDeclaredMarkerName(name, pluginName);

      if (KNOWN_KINDS.includes(name)) {
        throw new Error(
          `Plugin "${pluginName}" declares marker "@${name}", which is a core Gutterpress marker name ` +
            `(${KNOWN_KINDS.map((k) => `@${k}`).join(', ')}). Core marker names cannot be shadowed — ` +
            `rename the plugin's marker.`
        );
      }

      if (rawRegistry.has(name)) {
        throw new Error(
          `Marker "@${name}" is declared by both plugin "${originOf.get(name)}" and plugin "${pluginName}". ` +
            `Declared marker names must be unique across every loaded plugin — rename one of them.`
        );
      }

      rawRegistry.set(name, rawDecl);
      originOf.set(name, pluginName);
    }
  }

  // Second pass: every name is now known, so an alias can resolve regardless
  // of which plugin (or which position within its own table) declared its
  // target.
  const resolved = new Map();
  for (const [name, rawDecl] of rawRegistry) {
    resolved.set(name, resolveMarkerDeclaration(name, rawDecl, rawRegistry, originOf));
  }
  return resolved;
}

/**
 * Every `@`-word `parseMarkerLine` must recognize for a given registry: each
 * declared name itself (opens it, or — for a deprecated-only entry — warns
 * and strips it) plus its auto-derived `end-<name>` closer. `null` when the
 * registry is empty, matching `declaredMarkers`'s own null-for-empty
 * convention above.
 */
function declaredKindWords(declaredMarkers) {
  if (!declaredMarkers) return null;
  const words = new Set();
  for (const name of declaredMarkers.keys()) {
    words.add(name);
    words.add(`end-${name}`);
  }
  return words;
}

/**
 * Nearest declared marker name to `word`, or null when nothing is close
 * enough — the declared-marker counterpart of `nearestKind` above, used only
 * by `scanForUnknownDeclaredMarkers`. A PROPORTIONAL threshold (matching
 * `gp-pin-scope.js`'s `nearestGpClass`, not `nearestKind`'s tighter
 * distance-1-only rule): declared names can be longer/compound
 * ("roll-table", "outcome-ladder"), where a fixed distance-1 threshold would
 * miss realistic typos the way it does for `gp-*` classes.
 */
function nearestDeclaredMarkerName(word, declaredMarkers) {
  const w = word.toLowerCase();
  const threshold = Math.max(2, Math.floor(w.length / 3));
  let best = null;
  let bestDistance = Infinity;
  for (const known of declaredMarkers.keys()) {
    const d = editDistance(w, known);
    if (d < bestDistance) {
      bestDistance = d;
      best = known;
    }
  }
  return best !== null && bestDistance > 0 && bestDistance <= threshold ? best : null;
}

/**
 * #240's "unknown marker" diagnostic — the marker twin of `gp-pin-scope.js`'s
 * `unknown_gp_class` (#226): given a COMPLETE registry, warn on an unclaimed
 * `@word` line close to a declared name, instead of letting it print as
 * literal text with no explanation (e.g. "@calout" when a plugin declares
 * "callout"). Reuses `unknown_gp_class`'s channel (`env.layoutWarnings` via
 * `warn()`) and message shape (`Unknown X "…". Did you mean "…"?`) rather
 * than `scanForMistypedMarkers`'s longer, core-specific wording.
 *
 * Deliberately UNGATED by `state.env.__layoutMarkersUsed` — unlike
 * `scanForMistypedMarkers` (whose docstring documents that a document whose
 * ONLY marker is a typo stays silent, a deliberate, measured trade-off for
 * the eight short core keywords), `unknown_gp_class` has no such gate, and a
 * plugin's marker vocabulary deserves the same treatment: a document whose
 * ONLY marker is "@calout" must still be caught. Callers only reach here
 * with a non-empty registry (see the call site in layout_transform below),
 * so a project using no declarative-marker plugin pays nothing and behaves
 * exactly as it did before #240.
 *
 * Reuses the exact "unclaimed marker-like line" scan `scanForMistypedMarkers`
 * uses (an inline token whose parent is a paragraph_open, `@word` anchored to
 * whitespace/EOL) so the same prose/heading/handle/email/fenced-code
 * exclusions apply — see that function's header for the full rationale.
 */
function scanForUnknownDeclaredMarkers(state, declaredMarkers) {
  if (!declaredMarkers) return;
  for (let tokenIndex = 0; tokenIndex < state.tokens.length; tokenIndex++) {
    const tok = state.tokens[tokenIndex];
    if (tok.type !== 'inline' || !tok.map) continue;
    const opener = state.tokens[tokenIndex - 1];
    if (!opener || opener.type !== 'paragraph_open') continue;
    const lines = tok.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = /^@([A-Za-z][A-Za-z0-9-]*)(?=\s|$)/.exec(lines[i].trim());
      if (!m) continue;
      const word = m[1];
      if (KNOWN_KINDS.includes(word) || declaredMarkers.has(word)) continue;
      const suggestion = nearestDeclaredMarkerName(word, declaredMarkers);
      if (!suggestion) continue;
      warn(
        state.env,
        tok.map[0] + i + 1,
        'unknown_marker',
        `Unknown marker "@${word}". Did you mean "@${suggestion}"?`,
        null
      );
    }
  }
}

export default function plugin(md, pluginOptions = {}) {
  const options = {
    // `implicitPage` was removed 2026-08-12 — see the @section branch below.
    preferPagesInSpreads: false,
    ...pluginOptions,
  };

  // #240: the already-merged, already-collision-checked registry
  // `renderer.ts`'s `createMarkdownRenderer` builds (via
  // `buildDeclaredMarkerRegistry`, below) from every loaded plugin's
  // `markers` export. `null` for the overwhelming common case (no loaded
  // plugin declares any), normalized here so every call site below can do a
  // plain truthiness check instead of re-deriving "empty Map vs null" logic.
  const declaredMarkers =
    options.declaredMarkers instanceof Map && options.declaredMarkers.size > 0
      ? options.declaredMarkers
      : null;
  const declaredWords = declaredKindWords(declaredMarkers);

  function markerBlock(state, startLine, endLine, silent) {
    const pos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const line = state.src.slice(pos, max);

    const parsed = parseMarkerLine(line, declaredWords);
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
          `@${parsed.kind}: "${t}" is not something a marker understands, so it was kept verbatim as a class name. Write a class as .my-class (or {.my-class}), an id as #my-id, and anything else as key=value.` +
            proseEscapeHint(parsed.kind),
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
              )}"), or write classes as .${tokens.join(' .')}.` + proseEscapeHint(parsed.kind),
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
    // #240: unlike scanForMistypedMarkers below, this runs BEFORE (and
    // regardless of) the __layoutMarkersUsed gate — see
    // scanForUnknownDeclaredMarkers's header for why a declared-marker typo
    // must be caught even in a document with no OTHER marker at all. It is a
    // no-op whenever declaredMarkers is null (every project not using #240).
    scanForUnknownDeclaredMarkers(state, declaredMarkers);

    if (!state.env.__layoutMarkersUsed) return;

    scanForMistypedMarkers(state);

    const out = [];

    /**
     * Declared-container frames (#240), LIFO. Unlike the four core scope
     * kinds below (ONE fixed, author-independent hierarchy, closed by
     * static rank — SCOPE_CLOSE_ORDER), declared containers have no such
     * hierarchy between EACH OTHER: a plugin might declare "sidebar" and an
     * unrelated plugin "callout", with no declared relationship between the
     * two. Correctness therefore needs a plain innermost-first stack —
     * whichever declared container opened LAST closes FIRST — rather than a
     * fixed rank invented for kinds that were never given one.
     *
     * Always more nested than @section: opening (or explicitly closing) any
     * of the four core scopes drains every open declared frame FIRST (see
     * the `drainDeclaredFrames()` call at the top of the chapter/spread/
     * page/section/continue/end-section branches below), so a callout can
     * never straddle a page or section boundary even when its author forgot
     * the matching `@end-...`. The EOF drain (`drainDeclaredFramesAtEof`)
     * runs before `stack.closeAll()` for the identical reason.
     *
     * @typedef {Object} DeclaredFrame
     * @property {string} kind - the resolved BASE kind (an alias's target,
     *   or its own name) — this is what `@end-<name>` (alias-resolved too)
     *   looks up, so `@dm-note ... @end-callout` closes the right frame.
     * @property {string} tag - the close token's tag (must match the open).
     * @property {object} decl - the resolved declaration, for autoCloseAtEof.
     * @property {number} line - the marker's own 1-based line, for the
     *   eof-close warning.
     */
    /** @type {DeclaredFrame[]} */
    const declaredFrames = [];

    /** Index (from the top) of the most-recently-opened frame of `kind`, or -1. */
    function declaredFrameIndex(kind) {
      for (let i = declaredFrames.length - 1; i >= 0; i--) {
        if (declaredFrames[i].kind === kind) return i;
      }
      return -1;
    }

    /**
     * Close `kind` and everything opened after it, innermost first — the
     * same "close this and everything nested inside it" contract as
     * `stack.close` below, generalized to a plain array instead of a
     * fixed-rank one. A no-op (returns false) when `kind` isn't open,
     * matching `stack.close`'s own idempotence.
     */
    function closeDeclaredFrame(kind) {
      const at = declaredFrameIndex(kind);
      if (at === -1) return false;
      while (declaredFrames.length > at) {
        const frame = declaredFrames.pop();
        out.push(new state.Token('layout_component_close', frame.tag, -1));
      }
      return true;
    }

    /**
     * Silently drain every open declared frame — called whenever a core
     * scope boundary closes out anything nested inside it. Silent because
     * @section's own boundary-close is silent too (see every `stack.close`
     * call below): a declared container is exactly as "not always closed
     * explicitly" as @section is, from a page/chapter/spread's point of view.
     */
    function drainDeclaredFrames() {
      while (declaredFrames.length) {
        const frame = declaredFrames.pop();
        out.push(new state.Token('layout_component_close', frame.tag, -1));
      }
    }

    /**
     * EOF variant of the drain above: unlike a mid-document scope boundary,
     * reaching EOF with a frame still open is worth a warning UNLESS its
     * declaration opted out via `autoCloseAt: ["eof"]` (#240) — a plugin
     * author sets that specifically to say "this container is commonly used
     * without an explicit close", the same implicit contract @section itself
     * has (@section never warns at EOF either). Without that opt-in, an
     * EOF-close most likely means a forgotten `@end-<name>`, mirroring
     * @spread's own `spread_eof_close` precedent.
     */
    function drainDeclaredFramesAtEof() {
      while (declaredFrames.length) {
        const frame = declaredFrames.pop();
        if (!frame.decl.autoCloseAtEof) {
          warn(
            state.env,
            frame.line || 0,
            'declared_marker_eof_close',
            `An open @${frame.kind} reached end-of-document; closing it automatically. Add ` +
              `@end-${frame.kind} to close it explicitly, or declare autoCloseAt: ["eof"] on this ` +
              `marker if running to end-of-document is expected.`,
            null
          );
        }
        out.push(new state.Token('layout_component_close', frame.tag, -1));
      }
    }

    /**
     * Open a declared container (#240) — the same recipe `openChapter` /
     * `openSpread` / `openPage` / `openSection` below hand-write per kind,
     * run once, generically, off a plugin-declared table instead. `decl` is
     * already fully resolved (`resolveMarkerDeclaration`): alias/preset
     * baked in, `autoCloseAt` normalized to a boolean.
     */
    function openDeclaredMarker(meta, decl) {
      const t = new state.Token('layout_component_open', decl.tag, 1);
      // Thread the 1-based marker line for source-range.ts, exactly like
      // every other layout_*_open token below — see the do-not-use-
      // token.map comment in openChapter (ADR 0009); applies identically
      // here. This is what makes data-source-range/data-chapter-src fall
      // out of the EXISTING, unconditional source_range core rule with zero
      // extra plumbing (isAnnotationTarget keys on token.nesting === 1, not
      // on any particular token TYPE).
      t.meta = { line: meta.__line };

      // The variant selector: the marker's own bare name/argument
      // (`@callout warning` -> "warning"), falling back to an alias's
      // preset variant (`@dm-note` with no args -> decl.presetVariant, e.g.
      // "dm") when the line supplied none. An explicit name on the line
      // always wins over a preset.
      const variant = meta.name || decl.presetVariant || null;
      const variantClass = (variant && decl.variants && decl.variants[variant]) || '';
      const baseClass = [decl.classBase, variantClass].filter(Boolean).join(' ');
      addClasses(t, baseClass, meta.attrs && meta.attrs.class ? meta.attrs.class : '');
      attachDataAttrs(t, decl.baseKind, variant, meta.attrs || {});

      out.push(t);
      declaredFrames.push({ kind: decl.baseKind, tag: decl.tag, decl, line: meta.__line });

      // Label injection (#240) — the same "structural element carrying the
      // data as both text content and an attribute" recipe as @chapter's
      // .chapter-opener above (openPage), generalized: `decl.label.attr` is
      // the marker's OWN attribute to read (e.g. "label"), already
      // validated to exist by resolveContainerShape. A real element, not a
      // ::before, for the same reasons chapter-opener is one (survives
      // pagination, reusable across projects, targetable by the viewer).
      if (decl.label) {
        const value = meta.attrs && meta.attrs[decl.label.attr];
        if (value) {
          const labelToken = new state.Token('html_block', '', 0);
          labelToken.content = `<${decl.label.tag} class="${escapeAttr(decl.label.class)}">${escapeHtml(
            value
          )}</${decl.label.tag}>\n`;
          out.push(labelToken);
        }
      }
    }

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
     * @property {string} [classes]
     *   spread/page/section: the AUTHOR's class list for this wrapper (not
     *   the auto-inherited chapter counter class) — read by the
     *   break-inside-grid diagnostic to decide whether an emitted break div
     *   would become a grid item.
     * @property {boolean} [sawContent]
     *   section: at least one non-marker token was emitted inside this
     *   section (drives the empty_section warning).
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
      // the chapter's badge / opener UI; this module treats it as opaque
      // metadata.
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
      stack.open(
        {
          kind: 'spread',
          classes: (meta.attrs && meta.attrs.class) || '',
          noPagesYet: true,
          sawAnyPage: false,
        },
        t
      );
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
      stack.open({ kind: 'page', classes: explicit }, t);

      // Inject a structural chapter-opener element as the page's first
      // child when the chapter has a label AND this is the first @page in
      // that chapter. The element carries the chapter label as both its
      // text content and a data attribute, so projects style it however
      // they like:
      //
      //     <div class="chapter-opener" data-chapter-label="C.01">C.01</div>
      //
      // A real element rather than a `::before`: it is what carries
      // `data-chapter-label` to the viewer, it survives pagination, and it is
      // reusable across projects (any project styling `.chapter-opener` gets
      // the same markup).
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
      // `line` is the 1-based marker line, threaded for the source-range
      // annotation rule (source-range.ts). Do NOT set token.map here — see
      // the do-not-use-token.map comment in openChapter above (ADR 0009);
      // applies identically here.
      t.meta = { line: meta.__line };
      stack.open(
        {
          kind: 'section',
          classes: (meta.attrs && meta.attrs.class) || '',
          sawContent: false,
          meta: { name: meta.name || null, attrs: { ...(meta.attrs || {}) } },
          openToken: t,
        },
        t
      );
    }

    /**
     * The innermost open frame an emitted break div becomes a DIRECT child
     * of: section, else page, else spread. Only the direct parent decides
     * whether the div is a grid item, so a break inside a plain @section
     * that sits inside a grid @page is fine — the div is an ordinary
     * block-flow child there. (@chapter is deliberately not checked: the
     * ratified gp-grid-* diagnostic covers the frames authors put grid
     * classes on, and a grid chapter wrapper is not one of them.)
     */
    function breakHost() {
      return stack.get('section') || stack.get('page') || stack.get('spread');
    }

    /** First gp-grid-* class on a frame's author class list, or null. */
    function gridClassOf(frame) {
      if (!frame || !frame.classes) return null;
      return frame.classes.split(/\s+/).find((c) => c.startsWith('gp-grid-')) || null;
    }

    /**
     * break_inside_grid: a @page-break / @column-break whose emitted div
     * would land DIRECTLY inside a gp-grid-* container. The break marker
     * renders as a real <div>, and a grid container makes every direct
     * child a grid ITEM — so the div takes a cell of its own and shifts
     * every item after it. MEASURED (Chromium 151, grid evidence pack):
     * this corrupts auto-placement in print itself, AND the live preview's
     * break synthesis inserts a spacer div — another item — putting content
     * on the WRONG page: the one page-level print/preview parity break the
     * gp-grid measurements found. Everything else about grids (row
     * fragmentation, break-inside:avoid, gap geometry) held exact parity.
     */
    function warnBreakInsideGrid(kind, line, meta) {
      const host = breakHost();
      const gridClass = gridClassOf(host);
      if (!gridClass) return;
      warn(
        state.env,
        line,
        'break_inside_grid',
        `@${kind} inside a grid container: the enclosing @${host.kind} carries .${gridClass}, so this break's <div> becomes a grid ITEM — it takes a cell of its own, corrupts the grid's placement, and print and the live preview then disagree about which page the content after it lands on. Move the break outside the grid @${host.kind}, or remove it — grid rows already flow and fragment across pages on their own.`,
        meta
      );
    }

    /**
     * empty_section: a DECORATED @section (carrying classes or attributes)
     * closed by a sibling @section or an @end-section with ZERO content
     * tokens between the two markers. The decoration styles an empty
     * element, so the layout the author asked for silently never prints —
     * this exact shape shipped a broken page (a decorated @section
     * immediately followed by a bare @section). An UNdecorated empty
     * section stays silent: it renders as an inert empty div and is a
     * common transient state while drafting. Scoped to the sibling /
     * @end-section closers only — corpus-scanned across both real books
     * with zero false positives; the wider close paths (EOF drain,
     * @page/@chapter cascade closes) were not scanned, so they do not warn.
     */
    function warnIfEmptyDecoratedSection(closingKind, closingLine) {
      const sec = stack.get('section');
      if (!sec || sec.sawContent) return;
      const attrs = (sec.meta && sec.meta.attrs) || {};
      const decorations = [];
      for (const c of (attrs.class || '').split(/\s+/).filter(Boolean)) decorations.push(`.${c}`);
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') continue;
        decorations.push(k === 'id' ? `#${v}` : `${k}=${v}`);
      }
      if (!decorations.length) return;
      const openLine =
        sec.openToken && sec.openToken.meta && Number.isFinite(sec.openToken.meta.line)
          ? sec.openToken.meta.line
          : closingLine;
      warn(
        state.env,
        openLine,
        'empty_section',
        `This @section (${decorations.join(' ')}) was closed by the @${closingKind} on line ${closingLine} with no content between the two markers, so its styling applies to an empty element and nothing prints the layout it asked for. Delete one of the two markers, or move the content that belongs inside the section between them.`,
        null
      );
    }

    for (let i = 0; i < state.tokens.length; i++) {
      const tok = state.tokens[i];

      if (tok.type !== 'layout_marker') {
        // Any non-marker token emitted while a section is open is content
        // for empty_section purposes (a break div, emitted from the marker
        // branches below, deliberately is not).
        const openSectionFrame = stack.get('section');
        if (openSectionFrame) openSectionFrame.sawContent = true;
        out.push(tok);
        continue;
      }

      const meta = tok.meta || {};
      const kind = meta.kind;
      const line = meta.__line || 0;

      if (kind === 'chapter') {
        // #240: a declared container can never straddle a chapter boundary —
        // see the DeclaredFrame typedef comment above.
        drainDeclaredFrames();
        stack.close('chapter');
        openChapter(meta);
        continue;
      }

      if (kind === 'spread') {
        if (stack.has('spread')) {
          warn(state.env, line, 'nested_spread', '@spread encountered while another spread is open; closing the previous spread automatically.', meta);
        }
        drainDeclaredFrames(); // #240 — see the chapter branch above.
        stack.close('spread');
        openSpread(meta);
        continue;
      }

      if (kind === 'page') {
        drainDeclaredFrames(); // #240 — see the chapter branch above.
        stack.close('page');
        openPage(meta);
        continue;
      }

      if (kind === 'section') {
        drainDeclaredFrames(); // #240 — see the chapter branch above.
        warnIfEmptyDecoratedSection('section', line);
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

        // #240 — see the chapter branch above: @continue closes and reopens
        // the section, so anything declared-container-shaped nested inside
        // it closes too, same as it would across any other section boundary.
        drainDeclaredFrames();

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
        warnBreakInsideGrid('page-break', line, meta);
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
        warnBreakInsideGrid('column-break', line, meta);
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
        drainDeclaredFrames(); // #240 — see the chapter branch above.
        warnIfEmptyDecoratedSection('end-section', line);
        stack.close('section');
        continue;
      }

      // #240 — declared markers. Checked LAST: every core kind above is
      // matched by literal string, and buildDeclaredMarkerRegistry rejects
      // any declared name that collides with one of them, so a `kind`
      // reaching here can only be a declared container's own name or its
      // auto-derived "end-<name>" closer (parseMarkerLine never recognizes
      // anything else as a marker in the first place — see declaredWords).
      if (declaredMarkers) {
        const openDecl = declaredMarkers.get(kind);
        if (openDecl) {
          if (openDecl.deprecated) {
            warn(state.env, line, 'deprecated_marker', `@${kind} is deprecated: ${openDecl.deprecated}`, meta);
            continue;
          }
          // Re-entrant: opening a second instance of the SAME declared kind
          // closes the first (and anything nested inside it) — the exact
          // rule @section itself follows (see the section branch above).
          closeDeclaredFrame(openDecl.baseKind);
          openDeclaredMarker(meta, openDecl);
          continue;
        }

        if (kind.startsWith('end-')) {
          const closeDecl = declaredMarkers.get(kind.slice(4));
          if (closeDecl) {
            if (closeDecl.deprecated) {
              warn(state.env, line, 'deprecated_marker', `@${kind} is deprecated: ${closeDecl.deprecated}`, meta);
              continue;
            }
            if (!closeDeclaredFrame(closeDecl.baseKind)) {
              warn(
                state.env,
                line,
                'declared_marker_close_without_open',
                `@${kind} used without an open @${closeDecl.baseKind}; ignoring marker.`,
                meta
              );
            }
            continue;
          }
        }
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

    // #240: declared containers are innermost (see the DeclaredFrame typedef
    // comment above), so they must drain — and emit their close tokens —
    // BEFORE the core scopes below close, or their close divs would land
    // outside their own page/section/chapter wrapper.
    drainDeclaredFramesAtEof();
    stack.closeAll();
    state.tokens = out;
  });

  // Renderer rules for injected tokens.
  //
  // layout_chapter_open / layout_chapter_close / layout_spread_open /
  // layout_spread_close / layout_page_open / layout_page_close /
  // layout_section_open / layout_section_close intentionally have NO
  // renderer rule: markdown-it's own Renderer.render() already falls back to
  // self.renderToken() for any token type with no registered rule (see
  // markdown-it/lib/renderer.js), so a rule here that only forwarded to
  // renderToken would be dead weight that implied it did something.

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
    const chapterAttr = tokens[idx].attrGet('data-chapter-src');
    const chapterHtml = chapterAttr ? ` data-chapter-src="${escapeAttr(chapterAttr)}"` : '';
    return `<div class="${escapeAttr(cls)}" aria-hidden="true"${rangeHtml}${chapterHtml}></div>\n`;
  };

  md.renderer.rules.layout_column_break = (tokens, idx) => {
    const cls = tokens[idx].attrGet('class') || 'gp-column-break';
    const rangeAttr = tokens[idx].attrGet('data-source-range');
    const rangeHtml = rangeAttr ? ` data-source-range="${escapeAttr(rangeAttr)}"` : '';
    const chapterAttr = tokens[idx].attrGet('data-chapter-src');
    const chapterHtml = chapterAttr ? ` data-chapter-src="${escapeAttr(chapterAttr)}"` : '';
    return `<div class="${escapeAttr(cls)}" aria-hidden="true"${rangeHtml}${chapterHtml}></div>\n`;
  };

  // layout_marker tokens are transformed away in the core rule
  md.renderer.rules.layout_marker = () => '';
}

/**
 * The minimal CSS the DOM this module emits requires. Author utility
 * vocabulary lives in gutterpress-css.ts — see the ownership note above.
 *
 * The real contract (#227; a prior version of this paragraph said the
 * opposite and was stale — 2026-09-01 CSS architecture review, C4):
 * consumers inject this FIRST, wrapped in `@layer gp.marker` (assemble.ts
 * declares `@layer gp.marker, gp.vocab;` before both core blocks). Author
 * CSS — plugin CSS, every project stylesheet, anything loaded via
 * `engineStyles.native` — stays UNLAYERED, and per the CSS Cascade Layers
 * spec unlayered CSS always wins over layered CSS regardless of selector
 * specificity. That is what makes "author wins" true now, not injection
 * order. The `:where()` wrapping on the break/orphan/sizing rules below is
 * a NARROWER, still-necessary guarantee that survives the layer: it keeps
 * this block from out-specificity-ing whatever ELSE an author writes
 * (their own plain `.section { break-inside: ... }`, say) — a concern
 * `@layer` doesn't touch, since two unlayered rules still settle by
 * ordinary specificity between themselves.
 *
 * `.page`/`.spread` are given `position: relative` so they are the containing
 * block for any abspos descendant: a mispinned `bottom: 0` now fails LOCALLY
 * on its own page instead of resolving against the document canvas and
 * painting on the last page of the book.
 *
 * `min-height: var(--gp-content-h)` is the other half of that contract: a
 * page root that only shrink-wraps its text is a containing block whose
 * `bottom` edge is the end of the PROSE, so `.gp-pin .gp-bottom` (and every
 * hand-written `position: absolute; bottom: 0`) lands under the last
 * paragraph instead of at the page foot. Nothing in a continuous document
 * stretches a page root to the page area on its own, so both renderers
 * publish the page CONTENT height as `--gp-content-h` for the page context
 * the element is in
 * (the viewer on each `.gp-strip`; the compiler on `:root` plus every
 * `page:` assignment selector), and custom properties inherit, so this one
 * rule reaches a page root at any wrapper depth. Undefined var (plain
 * markdown-it use, no engine) falls back to `1px`, which the cushion below
 * takes back to zero — the rule is inert outside the pipeline, leaving the
 * page root shrink-wrapped exactly as it is today.
 *
 * It is `min-height`, not `height`: a `.page` whose content runs past one
 * sheet must still fragment normally. The whole rule is `:where()`, so an
 * author who wants any of it back sets their own value at any specificity.
 *
 * `box-sizing` and `display` are what make a page-sized min-height safe, and
 * both were found by MEASURING a real book (docs/fixtures/css-authoring-spike)
 * print one extra sheet without them:
 *
 *   - `border-box`, because a page root with padding (that fixture's cover
 *     has `padding-top: 2.5in`) would otherwise be one content box PLUS its
 *     padding tall, which is one sheet plus 2.5in — the overflow lands on a
 *     spurious blank sheet.
 *   - `flow-root`, because a child margin collapsing THROUGH the root's edge
 *     survives the forced break and eats into the new sheet: that fixture's
 *     last page opens with an `<h2>` whose 22.4px margin-top pushed a
 *     719px-tall root down 22.4px on a 720px sheet, spilling it. A page root
 *     is a page; containing its children's margins is what a page does. The
 *     viewer already forces `flow-root` on displaced page roots for exactly
 *     this reason (`stabilizeFullHeightPageRoots`, fragment.ts) — declaring
 *     it once in core means both renderers start from the same box. Zero
 *     specificity, so an authored `display: flex`/`grid` page root still
 *     wins, which is the case that function's comment warns about.
 *
 * The `- 1px` is the fragmentation cushion, and it is load-bearing. A box
 * whose bottom edge lands EXACTLY on the fragmentainer's edge costs an empty
 * fragment: MEASURED (Chromium 148, 384x480px sheet, 24px margins, one
 * short page root) `min-height: 432px` prints 2 sheets with the second
 * blank while `431px` prints 1 — and the viewer's multicol strip does the
 * same, which is how it first showed up (an 8pp preview of a 7pp book on
 * the gp-image-positioning fixture). One px at 96dpi is 0.75pt: it moves a
 * pinned foot up by less than a point and absorbs sub-pixel rounding in the
 * published value. Do not "clean it up" — the sheet it costs is silent.
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
 * #231 — two engine-generic print fixes adopted from a real book's own
 * engine sheet (2026-09-01 CSS architecture review, finding C8), because
 * both are written entirely in terms of core's own published contract and
 * fix a failure every book with big art or a `<figure>` hits, not a
 * DC-brand-specific one:
 *
 *   - A bare markdown placard (`![Alt](art.jpg)`, no class) taller than the
 *     page content box is monolithic replaced content, and the fragmenter
 *     SLICES it mid-image across the page break instead of moving it whole.
 *     Capping a bare image to `--gp-content-h` (core's own published page
 *     CONTENT height for the page context it is in — see the min-height
 *     rule above) with `object-fit: contain` letterboxes it onto one page
 *     instead. Scoped to `:not([class])` so it never touches a `.gp-full`,
 *     `.gp-bleed`, or any other explicitly sized/classed image — an author
 *     who already sized their own art has already made the call this rule
 *     exists to make for the ones who haven't. `--gp-content-h` is
 *     published by BOTH renderers (the compiler on `:root` plus every
 *     `page:` assignment selector; the viewer on each `.gp-strip`), so this
 *     rule cannot itself split preview from print.
 *
 *     MEASURED on the field guide (295pp, adopted verbatim from its own
 *     native-furniture.css §9, which carried this exact rule for months):
 *     chapter-01's rabbit placard paints 717.0pt tall on the default page
 *     both before and after adoption (core's cap and the book's copy agree
 *     bit-for-bit — the book's copy is now a harmless duplicate of core's,
 *     not a competing rule). Chapter-03's full-sheet plate (an `@page` with
 *     zero margins, so the content box IS the sheet) paints 621.0 x 804.0pt
 *     inside its 621 x 810pt sheet both before and after — the OLD hand-
 *     computed version of this rule (`calc(var(--page-height) - 0.5in -
 *     0.75in - 4px)`, hard-coding the DEFAULT page's margins) over-capped
 *     this named page's art to 553.5 x 717.0pt, a 1.3in band of bare wall
 *     along its foot; reading the cap off `--gp-content-h` instead fixed
 *     that BEFORE core ever adopted the rule, so adoption itself changes
 *     nothing further. Total page count unchanged at 295pp — no
 *     shrink-to-fit side effect from moving the rule into core.
 *
 *   - `figure { break-inside: avoid }` keeps in-flow art (anything an
 *     author or a plugin wraps in a real `<figure>`) from being sliced
 *     across a page break the same way a bare placard would be — the
 *     `:where(p > img:only-child, figure > img)` sizing rule above already
 *     assumes the figure survives as one piece; without this it did not.
 *
 * Design-for-deletion note (CLAUDE.md): neither rule is a Chromium-gap shim
 * with a removal trigger — both are permanent, standards-verbatim defaults
 * in the same category as the min-height/box-sizing/vertical-align rules
 * above (real print-fragmentation behavior, not a spec feature Chrome has
 * yet to ship). They stay `:where()` so an author's own sizing or
 * break-inside rule, at ANY specificity, still wins outright.
 *
 * The companion "spanner + unbreakable box" glue pattern (`column-span: all`
 * followed by a `break-inside: avoid` box, native-engine-styling-guide.md
 * §5) was measured for this same adoption pass and DELIBERATELY NOT
 * adopted: a `:where()`-zero-specificity override can never win against
 * whatever real-specificity rule gave the box its `break-inside: avoid` in
 * the first place (a synthetic 2-column fixture with the candidate
 * `:where(.gp-columns-all) + :where(*) { break-inside: auto }` produced
 * BYTE-IDENTICAL output to the same fixture without it, across every
 * geometry swept), and the field guide's own native-furniture.css §13 shows
 * a context-blind version of the same idea is actively wrong for at least
 * one real, shipped case (a short, non-fragmenting instance that needed its
 * `avoid` restored after a general fragmenting-context rule took it away).
 * It stays an author remedy, named in the styling guide (`.gp-columns-all`).
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
:where(.page, .spread) { position: relative; display: flow-root; box-sizing: border-box; min-height: calc(var(--gp-content-h, 1px) - 1px); }
.gp-column-break { break-after: column; height: 0; font-size: 0; line-height: 0; visibility: hidden; }

:where(h1,h2,h3,h4,h5,h6) { break-after: avoid; }
:where(img, svg, video) { max-width: 100%; }
:where(p > img:only-child, figure > img) { width: fit-content; max-width: 100%; height: auto; vertical-align: bottom; }
:where(p) > :where(img:not([class])) { max-height: calc(var(--gp-content-h) - 4px); object-fit: contain; }
:where(figure) { break-inside: avoid; }
:where(.section, figure) > :where(:first-child) { break-before: avoid; }

`;
