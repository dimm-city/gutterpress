/**
 * `gp_pin_scope_check` — the `.gp-pin` diagnostic AND #226's `unknown_gp_class`
 * check.
 *
 * The split from `markers.js` is by role: that module owns the structural DOM,
 * while `.gp-pin` and the rest of the `gp-*` vocabulary are author utility
 * vocabulary (see gutterpress-css.ts), so the rules that police them live
 * with the utility layer.
 *
 * renderer.ts registers this immediately after the marker plugin, which
 * preserves the ordering both checks depend on: markdown-it-attrs has already
 * attached `{.gp-pin}`/`{.gp-typo}`-style classes, and the marker plugin has
 * already produced the layout_*_open/_close tokens the pin-scope walk counts.
 *
 * It only ever appends to `env.layoutWarnings` — it never changes output — so
 * a document with no markers behaves exactly as if it were not registered,
 * which matters because a markerless document containing a `.gp-pin` image or
 * a typo'd `gp-*` class is precisely the leak/typo either check warns about.
 */

import { GP_CLASSES } from "./gutterpress-css.ts";

/** Local copy of `markers.js`'s private `warn`: env.layoutWarnings is the
 * shared diagnostic channel both write to, and `markers.js` does not export
 * the helper. */
function warn(env, line, type, message, marker) {
  if (!env.layoutWarnings) env.layoutWarnings = [];
  env.layoutWarnings.push({ line, type, message, marker });
}

/**
 * Levenshtein distance — a separate local copy, not an import. This file and
 * `markers.js` are both leaves the pure `/render` graph bundles (§1/§8); the
 * `.js`-to-`.js` import would be fine, but `markers.js`'s `editDistance` is
 * module-private (unexported), and `cli.ts`'s copy is Node-coupled (part of
 * the CLI entry, not the render core) — copying the ~10-line algorithm is
 * cheaper and safer than either alternative. Used only for the
 * `unknown_gp_class` "did you mean" suggestion below.
 */
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Nearest known `gp-*` class to `cls`, or null when nothing is close enough.
 * Threshold scales with the typed class's length (matching `cli.ts`'s
 * `closestSubcommand` heuristic) rather than `markers.js`'s tighter
 * distance-1-only rule for marker KEYWORDS: `gp-*` class names are longer and
 * share common word stems (`gp-columns-2`/`gp-columns-3`), so a same-length
 * proportional threshold catches realistic typos (a missing `s`:
 * `gp-column-2` -> `gp-columns-2` is distance 1) without the false positives
 * a short-keyword threshold would risk here.
 */
function nearestGpClass(cls) {
  const threshold = Math.max(2, Math.floor(cls.length / 3));
  let best = null;
  let bestDistance = Infinity;
  for (const known of GP_CLASSES) {
    const d = editDistance(cls, known);
    if (d < bestDistance) {
      bestDistance = d;
      best = known;
    }
  }
  return best !== null && bestDistance > 0 && bestDistance <= threshold ? best : null;
}

function hasPinClass(token) {
  const cls = token.attrGet && token.attrGet('class');
  return typeof cls === 'string' && cls.split(/\s+/).includes('gp-pin');
}

/**
 * Human-readable element name for an `unknown_gp_class` message — the marker
 * kinds spell themselves as the author types them (`@section`), everything
 * else gets an article + its common name.
 */
function elementNameFor(token) {
  switch (token.type) {
    case 'layout_chapter_open': return '@chapter';
    case 'layout_spread_open': return '@spread';
    case 'layout_page_open': return '@page';
    case 'layout_section_open': return '@section';
    case 'image': return 'an image';
    case 'heading_open': return 'a heading';
    case 'paragraph_open': return 'a paragraph';
    case 'link_open': return 'a link';
    default:
      return token.tag ? `a <${token.tag}>` : 'an element';
  }
}

/**
 * #226: warn on any `gp-`-prefixed class this token carries that is not part
 * of core's published vocabulary (`GP_CLASSES`, gutterpress-css.ts). Before
 * this, a misremembered or misspelled utility class (an author typed
 * `@section .gp-columns-all` when the class did not exist yet) rendered as a
 * silent no-op — the class landed in the DOM, nothing happened, and nothing
 * said why. Runs everywhere (no @page/@spread depth gating, unlike the
 * `.gp-pin` scope check below): an unknown class is a mistake whether or not
 * it sits inside a page.
 */
function checkUnknownGpClasses(token, env, line) {
  const cls = token.attrGet && token.attrGet('class');
  if (typeof cls !== 'string' || !cls) return;
  for (const c of cls.split(/\s+/)) {
    if (!c.startsWith('gp-') || GP_CLASSES.has(c)) continue;
    const suggestion = nearestGpClass(c);
    const base = `Unknown class "${c}" on ${elementNameFor(token)}.`;
    warn(
      env,
      line,
      'unknown_gp_class',
      suggestion ? `${base} Did you mean "${suggestion}"?` : base
    );
  }
}

export default function gpPinScope(md) {
  // Parse-time scope check for the author-facing `.gp-pin` class
  // (gutterpress-css.ts): a pinned element resolves against its nearest
  // POSITIONED ANCESTOR, falling back to the page/spread that core gives
  // `position: relative`. This rule polices ONE failure — a pin with no
  // positioned ancestor at all, i.e. outside any @page/@spread, where the
  // containing block becomes the document canvas and the art can print on a
  // completely different sheet. The multicol preview MASKS that failure (the
  // viewer's .gp-strip wrapper is positioned and exactly one page tall, so
  // the pin looks right on screen), which is why it is worth a parse-time
  // warning at a known source line.
  //
  // A theme wrapper that is positioned (a `.section` card, a component
  // shell) legitimately becomes the pin's frame — that is the documented
  // contract, not a defect, and this rule deliberately says nothing about
  // it. Scoping a pin to a card is a feature; an author who wanted the sheet
  // instead authors the art outside the wrapper.
  //
  // Registered with `push` so it runs after markdown-it-attrs'
  // curly_attributes (renderer.ts registers attrs before this plugin) has
  // attached `{.gp-pin}` classes AND after layout_transform above has
  // produced the layout_*_open/_close tokens. Unlike layout_transform this
  // rule runs even with zero markers — a markerless document with a .gp-pin
  // image is exactly the leak case — which keeps the plugin's "no markers →
  // does nothing" contract intact: it only emits a diagnostic, never changes
  // output. Raw-HTML wrappers and <img> tags are opaque text in this token
  // walk, so they are neither checked nor counted as containers; the
  // compiler's engine.abspos.leak diagnostic covers those at build time.
  const PIN_OUTSIDE_PAGE_MSG =
    'A .gp-pin element is not inside any @page or @spread, so it is pinned to the whole document instead of the page it sits on — it can print on a completely different sheet. Move it inside an @page or @spread block, or remove .gp-pin.';

  md.core.ruler.push('gp_pin_scope_check', function (state) {
    let depth = 0;
    for (const token of state.tokens) {
      if (token.type === 'layout_page_open' || token.type === 'layout_spread_open') {
        depth += 1;
      } else if (token.type === 'layout_page_close' || token.type === 'layout_spread_close') {
        depth -= 1;
      } else if (depth === 0) {
        if (token.type === 'inline' && token.children) {
          for (const child of token.children) {
            // Children carry no map; the enclosing inline token's map is the
            // block's start line, which is the right thing to report.
            if (child.type === 'image' && hasPinClass(child)) {
              warn(state.env, (token.map?.[0] ?? 0) + 1, 'pin_outside_page', PIN_OUTSIDE_PAGE_MSG);
            }
          }
        } else if (token.nesting === 1 && hasPinClass(token)) {
          warn(state.env, (token.map?.[0] ?? 0) + 1, 'pin_outside_page', PIN_OUTSIDE_PAGE_MSG);
        }
      }

      // unknown_gp_class (#226) — deliberately OUTSIDE the depth===0 branch
      // above: an unknown class is checked everywhere, not just outside a
      // page. Reuses this same top-level walk (and, for inline content, the
      // same per-token children loop) rather than a second pass over
      // state.tokens.
      const line = (token.map?.[0] ?? 0) + 1;
      checkUnknownGpClasses(token, state.env, line);
      if (token.type === 'inline' && token.children) {
        for (const child of token.children) {
          checkUnknownGpClasses(child, state.env, line);
        }
      }
    }
  });
}
