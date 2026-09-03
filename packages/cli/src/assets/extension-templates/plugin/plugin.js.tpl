/**
 * {{NAME}} — a Gutterpress plugin.
 *
 * A Gutterpress plugin is a PLAIN markdown-it plugin: one function with the
 * signature `(md, options) => void`. There is no Gutterpress plugin API, no
 * base class, and no host-injected context object — which is exactly why any
 * of the hundreds of markdown-it plugins on npm works here unchanged.
 *
 * Two ways to add a container, both used below:
 *
 *   1. DECLARATIVELY — `export const markers`. A table of marker names, each
 *      describing the wrapper element Gutterpress should emit. This is DATA
 *      the loader reads off this module; it is not an API call. Core's own
 *      marker parser then handles `@term-box` / `@end-term-box` through the
 *      exact same grammar, class merging and warning channel as `@section`.
 *      Reach for this whenever "wrap a block in an element with a class" is
 *      all you need.
 *
 *   2. BY HAND — an ordinary markdown-it rule, registered on `md` inside the
 *      default export. Reach for this when a declarative wrapper cannot
 *      express it: inline syntax (below), token rewriting, custom renderers.
 *
 * WHAT THIS FILE MUST NOT DO
 *
 *   - It must not `import` from "gutterpress". Plugin code is resolved against
 *     the book's folder, and Gutterpress ships as a single compiled binary
 *     with no `node_modules` for that import to find. If you need a helper
 *     from core, inline a copy of it here. (Type-only imports are erased
 *     before runtime and are therefore safe — see README.md.)
 *   - It must not emit `gp-` classes. That prefix belongs to Gutterpress core.
 *     Everything this plugin emits carries its own prefix instead — see
 *     PREFIX below and `test/plugin.test.js`, which fails the build if a
 *     `gp-` class ever creeps in.
 */

/**
 * THE load-bearing convention: every class, custom property and marker name
 * this package emits starts with this prefix.
 *
 * Why it matters. A book loads core, a theme, and any number of plugins into
 * ONE flat CSS namespace and ONE flat marker namespace. Nothing scopes them
 * for you. A prefix is what keeps `{{SLUG}}`'s callout from colliding with
 * some other plugin's callout — and `gp-` is reserved for core, so taking it
 * would mean silently overriding Gutterpress's own vocabulary.
 *
 * Change it if you like — shorter reads better in CSS (`dc-` for Dimm City,
 * say). It appears in three places, on purpose: here, in `styles/plugin.css`,
 * and as `PREFIX` in `test/plugin.test.js`. The test file states the
 * convention INDEPENDENTLY, so changing it in one place fails the suite
 * instead of silently agreeing with itself.
 */
const PREFIX = "{{PREFIX}}";

/**
 * Declarative containers (the `markers` export).
 *
 * Every key becomes an author-facing marker: `@term-box` opens it and
 * `@end-term-box` closes it — the closer is derived for you, never declared.
 *
 *   @term-box warning label="Read this first"
 *   Ordinary **markdown** goes here.
 *   @end-term-box
 *
 * Fields, all optional:
 *   tag         wrapper element            (default "div")
 *   class       base class on the wrapper
 *   variants    extra classes keyed by the marker's bare word
 *   label       a label element built from one of the marker's attributes
 *   autoCloseAt ["eof"] closes an unclosed container at end of file
 *
 * Names are validated when the book loads: lower-case letters, digits and
 * hyphens; they may not start with `end-`, and they may not shadow a core
 * marker (`@page`, `@section`, `@chapter`, …). A name two loaded plugins both
 * declare is a hard error naming both sides — which is the other half of why
 * the prefix convention exists.
 */
export const markers = {
  "term-box": {
    tag: "aside",
    class: `${PREFIX}term-box`,
    variants: {
      note: `${PREFIX}term-box-note`,
      warning: `${PREFIX}term-box-warning`,
    },
    label: {
      tag: "p",
      class: `${PREFIX}term-box-label`,
      from: "attr:label",
    },
    autoCloseAt: ["eof"],
  },
};

/** The markdown-it inline rule's name, and the class it emits. */
const TERM_RULE = `${PREFIX}term`;
const TERM_TOKEN = `${PREFIX}term`;

/**
 * The bespoke half: an inline rule turning `[[key term]]` into
 * `<span class="{{PREFIX}}term">key term</span>`.
 *
 * Declarative markers cannot do this — they wrap BLOCKS, and this is inline
 * syntax in the middle of a sentence. That is the dividing line: reach for
 * `markers` for block containers, write a rule by hand for anything else.
 *
 * Returned from a factory so the emitted class can come from plugin options,
 * and exported so `test/plugin.test.js` can drive it directly.
 *
 * @param {string} className class placed on the emitted span
 * @returns {(state: object, silent: boolean) => boolean} a markdown-it inline rule
 */
export function createTermRule(className) {
  return function termRule(state, silent) {
    const start = state.pos;
    const max = state.posMax;

    // Cheapest possible bail-out first: markdown-it runs this on every `[`.
    if (start + 2 >= max) return false;
    if (state.src.charCodeAt(start) !== 0x5b /* [ */) return false;
    if (state.src.charCodeAt(start + 1) !== 0x5b /* [ */) return false;

    const close = state.src.indexOf("]]", start + 2);
    // The closing `]]` must exist AND sit inside the current inline span —
    // `posMax` is not the end of the document, it is the end of what this
    // inline context is allowed to consume.
    if (close === -1 || close + 2 > max) return false;

    const raw = state.src.slice(start + 2, close);
    if (raw.includes("\n") || raw.includes("[") || raw.trim() === "") return false;

    // `silent` means "validate only, emit nothing" — markdown-it uses it to
    // probe. Honouring it is required of every inline rule.
    if (!silent) {
      const open = state.push(`${TERM_TOKEN}_open`, "span", 1);
      open.attrSet("class", className);
      const text = state.push("text", "", 0);
      text.content = raw.trim();
      state.push(`${TERM_TOKEN}_close`, "span", -1);
    }

    state.pos = close + 2;
    return true;
  };
}

/**
 * The plugin function. This is the module's default export and the only thing
 * Gutterpress requires of it.
 *
 * @param {import("markdown-it").default} md the markdown-it instance
 * @param {{ termClass?: string }} [options] whatever the book's manifest put
 *   under this plugin's `options:` key
 */
export default function {{IDENT}}(md, options = {}) {
  const termClass =
    typeof options.termClass === "string" && options.termClass
      ? options.termClass
      : `${PREFIX}term`;

  // BEFORE "link", because `[[` would otherwise start being parsed as a link
  // label and this rule would never see it.
  md.inline.ruler.before("link", TERM_RULE, createTermRule(termClass));
}

/**
 * Optional metadata. Gutterpress shows this in the desktop app's Extensions
 * panel. Purely descriptive — nothing here changes how the plugin behaves.
 */
export const metadata = {
  name: "{{NAME}}",
  description: "{{DESCRIPTION}}",
};
