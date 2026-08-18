/**
 * Semantic-preservation comparator, shared by the corpus gate and the plugin
 * round-trip gate (review rule: one definition, two suites).
 *
 * Drops the attributes that encode SOURCE COORDINATES rather than content,
 * and collapses whitespace outside `<pre>` — a soft line break inside a
 * paragraph renders as a literal newline, and unwrapping turns it into a
 * space; HTML collapses both identically, so that is the accepted
 * reformatting, not lost content. Inside `<pre>` whitespace is significant
 * and stays byte-compared, so the gate keeps its teeth on code blocks.
 */
export const semanticHtml = (html: string) =>
  html
    .replace(/ data-source-(range|line)="[^"]*"/g, "")
    // `data-gp-source-token` / `-occurrence` are the preview↔source mapping;
    // they appear on an authored `[a](b)` but not on a bare domain linkify
    // upgraded, so normalizing `itch.io` to `[itch.io](http://itch.io)` adds
    // them. The href and text — the parts that reach the PDF — are unchanged.
    .replace(/ data-gp-source-(token|occurrence)="[^"]*"/g, "")
    .split(/(<pre[\s\S]*?<\/pre>)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/\s+/g, " ")
            // Attribute ORDER is meaningless in HTML but canonical brace
            // emission reorders it (`{#radio .procedure}` serializes as
            // `{.procedure #radio}`, so `id` and `class` swap places in the
            // rendered tag). Sort each start tag's attributes so the gate
            // compares the attribute SET — values travel with their names, so
            // a real value change still fails.
            .replace(
              /<([a-zA-Z][^\s>/]*)((?:\s+[^\s=>]+(?:="[^"]*")?)+)(\s*\/?)>/g,
              (_m, tag: string, attrs: string, slash: string) => {
                const list = (attrs.match(/\s+[^\s=>]+(?:="[^"]*")?/g) ?? []).map((s) => s.trim());
                return `<${tag}${list.sort().map((s) => ` ${s}`).join("")}${slash}>`;
              },
            ),
    )
    .join("");
