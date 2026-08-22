/**
 * `gp_pin_scope_check` — a Gutterpress diagnostic, not a markdown-it-paged one.
 *
 * The plugin is a standalone, independently published markdown-it extension;
 * `.gp-pin` is Gutterpress product vocabulary (see gutterpress-css.ts), so the
 * rule that polices it belongs here rather than inside the plugin.
 *
 * renderer.ts registers this immediately after the paged plugin, which
 * preserves the ordering the check depends on: markdown-it-attrs has already
 * attached `{.gp-pin}` classes, and the paged plugin has already produced the
 * layout_*_open/_close tokens this walk counts.
 *
 * It only ever appends to `env.layoutWarnings` — it never changes output — so
 * a document with no markers behaves exactly as if it were not registered,
 * which matters because a markerless document containing a `.gp-pin` image is
 * precisely the leak this warns about.
 */

/** Local copy of the paged plugin's private `warn`: env.layoutWarnings is the
 * shared diagnostic channel both write to, and this module must not reach into
 * the plugin for a helper. */
function warn(env, line, type, message, marker) {
  if (!env.layoutWarnings) env.layoutWarnings = [];
  env.layoutWarnings.push({ line, type, message, marker });
}

export default function gpPinScope(md) {
  // Parse-time scope check for the author-facing `.gp-pin` class (gutterpress-css.ts): a pinned element resolves against its nearest positioned
  // ancestor, which core makes .page/.spread. Outside any @page/@spread its
  // containing block is the document canvas — it can print on a completely
  // different sheet, and the multicol preview MASKS that failure (the
  // viewer's .gp-strip wrapper is positioned and exactly one page tall, so
  // the pin looks right on screen). Warn here, where the source line is
  // still known.
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

  function hasPinClass(token) {
    const cls = token.attrGet && token.attrGet('class');
    return typeof cls === 'string' && cls.split(/\s+/).includes('gp-pin');
  }

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
    }
  });
}
