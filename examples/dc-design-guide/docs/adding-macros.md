# Adding A DC Macro

This is the shortest safe path for adding a new Dimm City plugin macro.

Use the existing `@skill` implementation in `plugins/dimm-city-plugin.js` as the main reference. It follows the right model:

- one real root class: `.dc-skill-card`
- **no per-card variant** — shapes come from the `.specialty.<name>` parent container (CSS parent-selector model, not card-level attributes)
- internal styling through descendant selectors: `.dc-skill-card .dc-card-tab`, `.dc-skill-card .dc-card-body`, `.dc-skill-card .dc-ability`

For new macros, prefer the simplest version that works. In many cases you do not need extra child classes at all. A root shell plus descendant element selectors is often enough, which keeps both the plugin and the markdown simpler.

## Variant system note

Card variants (skill cards, path shells, specialty cards, specialty intros) are controlled entirely by the `.specialty.<name>` parent container, not by `variant=` attributes. The `@specialty .augmerc` wrapper applies the augmerc clip-path and accent color to every card inside automatically. Do NOT add `variant=` attributes to `@skill`, `@continue`, or `@learning-path`.

## Currently registered macros

`@chapter`, `@page`, `@section`, `@end-section`, `@spread`, `@page-break`, `@column-break`, `@specialty`, `@end-specialty`,
`@specialty-intro`, `@end-specialty-intro`, `@specialty-art`, `@end-specialty-art`,
`@specialty-card`, `@end-specialty-card`,
`@learning-path`, `@end-learning-path`, `@skill`, `@end-skill`, `@continue`,
`@outcome`, `@end-outcome`, `@chapter-opener`,
`@class-entry`, `@end-class-entry`, `@roll-table`, `@end-roll-table`,
`@options-table`, `@end-options-table`,
`@sidebar`, `@end-sidebar`, `@sidebar-box`, `@end-sidebar-box`,
`@definition`, `@end-definition`, `@procedure`, `@end-procedure`,
`@callout`, `@end-callout`, `@dm-note`, `@end-dm-note`,
`@toc`, `@end-toc`,
`@gear`, `@end-gear`, `@tape`, `@lede`, `@end-lede`,
`@glossary`, `@end-glossary`

## Blank-line requirement for markers

Macro open and close markers **must** be separated from surrounding content by blank lines. Without the blank lines, markdown-it merges the marker line into the preceding or following paragraph and the macro is silently ignored.

Correct:

```markdown
@callout
This is the callout body.

More content here.

@end-callout
```

Wrong (markers merged into paragraph — macro never fires):

```markdown
@callout
This is the callout body.
@end-callout
```

The rule applies to every open marker (`@macro-name`) and every close marker (`@end-macro-name`):

- Open marker: must have a blank line **after** it before the first content line.
- Close marker: must have a blank line **before** it after the last content line.

When two macros appear back-to-back (e.g. multiple `@skill` cards inside a `@learning-path`), each open/close pair must still follow this rule — no two markers should share the same paragraph block.

This is a markdown-it parsing constraint, not a plugin limitation. If a macro appears to render nothing, missing blank lines around its markers are the first thing to check.

## 1. Design the emitted HTML first

Before touching the parser, decide the exact root class and inner hooks.

Good shape:

```html
<section class="dc-intel-card variant-2">
  <div class="dc-intel-card-head">Black Site</div>
  <div class="dc-intel-card-body">
    <p>Body copy.</p>
  </div>
</section>
```

Even simpler shape:

```html
<section class="dc-intel-card variant-2">
  <h3>Black Site</h3>
  <p>The vault is below street level.</p>
  <ul>
    <li>Two drone nests</li>
    <li>One blind service tunnel</li>
  </ul>
</section>
```

Rules:

- Emit one top-level `dc-` class for the component shell.
- Put variant classes on that same root element.
- Style internals with descendant selectors, not separate top-level sibling classes.
- Prefer descendant element selectors like `.dc-intel-card h3` and `.dc-intel-card p + p` when the content structure is simple and stable.
- Add child classes only when you need repeated roles that plain elements cannot identify clearly.
- Only expose a small variant API: surface, accent, foreground, title treatment.
- Do not turn padding, margins, widths, or break behavior into a large custom-property API.

## 2. Add the marker to `dimm-city-plugin.js`

For a simple wrapper macro, follow the `@sidebar-box` and `@definition` pattern.

```js
const intelMarker = parseMarker(tok, tokens, i, '@intel-card');
if (intelMarker.matched) {
  const userAttrs = { ...intelMarker.attrs };
  const variant = userAttrs['variant'] ? ' variant-' + esc(userAttrs['variant']) : '';
  delete userAttrs['variant'];

  newTokens.push(
    makeToken(
      'html_block',
      '<section' + buildAttrs(userAttrs, 'dc-intel-card' + variant) + '>\n'
    )
  );
  i += 2;
  continue;
}

if (isMarker(tok, tokens, i, '@end-intel-card')) {
  newTokens.push(makeToken('html_block', '</section>\n'));
  i += 2;
  continue;
}
```

If the macro has structure, parse markdown tokens into named child elements the same way `@skill` turns:

- `####` into the card title
- `>` into flavor text
- ordered lists into ability rows

That is usually better than asking authors to write raw HTML.

If the macro is just a shell around normal markdown content, do less: open the wrapper, let standard markdown render `h3`, `p`, `ul`, and `li`, then close the wrapper. That keeps the parser logic small and avoids creating extra internal hook classes you do not really need.

## 3. Add CSS in `css/components.css`

The root class owns the shell. Inner parts are descendants.

```css
.dc-intel-card {
  --dc-intel-bg: var(--paper-light);
  --dc-intel-accent: var(--hud-blue);
  --dc-intel-fg: var(--ink);

  background: var(--dc-intel-bg);
  border-left: 4px solid var(--dc-intel-accent);
  color: var(--dc-intel-fg);
  padding: var(--space-lg) var(--space-xl);
  break-inside: avoid;
  page-break-inside: avoid;
}

.dc-intel-card .dc-intel-card-head {
  font-family: var(--font-display);
  text-transform: uppercase;
  letter-spacing: var(--ls-display);
  margin: 0 0 8pt;
}

.dc-intel-card p {
  margin: 0;
}

.dc-intel-card p + p,
.dc-intel-card ul,
.dc-intel-card ol {
  margin-top: 6pt;
}
```

Simpler still, with no child classes beyond the shell:

```css
.dc-intel-card {
  --dc-intel-bg: var(--paper-light);
  --dc-intel-accent: var(--hud-blue);
  --dc-intel-fg: var(--ink);

  background: var(--dc-intel-bg);
  border-left: 4px solid var(--dc-intel-accent);
  color: var(--dc-intel-fg);
  padding: var(--space-lg) var(--space-xl);
  break-inside: avoid;
  page-break-inside: avoid;
}

.dc-intel-card h3 {
  margin: 0 0 8pt;
  font-family: var(--font-display);
  text-transform: uppercase;
  letter-spacing: var(--ls-display);
}

.dc-intel-card p,
.dc-intel-card ul,
.dc-intel-card ol {
  margin: 0;
}

.dc-intel-card p + p,
.dc-intel-card p + ul,
.dc-intel-card p + ol,
.dc-intel-card ul + p,
.dc-intel-card ol + p,
.dc-intel-card ul + ul,
.dc-intel-card ol + ol {
  margin-top: 6pt;
}
```

That pattern is usually the right default for a new wrapper macro:

- plugin emits one shell class
- markdown stays normal
- CSS targets descendant elements inside the shell
- variants only change the shell-level public API

## 4. Add thin root-level variants

Variants should override only the small public API or a truly exceptional property.

```css
.dc-intel-card.variant-2 {
  --dc-intel-bg: var(--paper-aged);
  --dc-intel-accent: var(--crimson);
}

.dc-intel-card.variant-3 {
  --dc-intel-bg: var(--ink-dark);
  --dc-intel-fg: var(--paper-cream);
  --dc-intel-accent: var(--amber);
}
```

Use semantic variant names when they represent meaning. Numeric `variant="N"` is a valid pattern for new macros when the variants are just preset visual shells.

> **DC-specific rule:** Do NOT use `variant=` on `@skill`, `@continue`, or `@learning-path`. Those macros derive their visual shape entirely from the `.specialty.<name>` parent container — a `@specialty .augmerc` wrapper applies the correct clip-path and accent to every card inside automatically. `variant=` on a skill or path card is a no-op and must be removed.

## 5. Add markdown examples

Simple wrapper example:

```markdown
@intel-card variant="2" #black-site
### Black Site
The vault is below street level.

- Two drone nests
- One blind service tunnel
@end-intel-card
```

Simplest authoring form:

```markdown
@intel-card variant="2" #black-site
### Black Site
The vault is below street level.

- Two drone nests
- One blind service tunnel
@end-intel-card
```

The plugin does not need to convert `###`, paragraphs, or lists into custom internal HTML for that version. It can just emit the opening and closing shell and let markdown render the contents normally.

If you want the macro to behave more like `@skill`, document the intended structure explicitly:

```markdown
@intel-card variant="3"
#### Black Site
> Quiet on the outside. Surgical on the inside.
1. **Entry:** Service lift behind the noodle stand.
2. **Heat:** Corporate response in 2 rounds.
@end-intel-card
```

## 6. Validate it in the guide

- Add a specimen in the appropriate guide chapter.
- Confirm the emitted class has a matching rule in `components.css`.
- Keep the component root-owned: one `.dc-*` shell, thin root variants, descendant selectors underneath.

## Skill Card Checklist

When in doubt, copy these decisions from `@skill`:

- root class owns variant state
- child structure is fixed and predictable
- descendant selectors style internals
- variants are thin and live on the root
- markdown authors write content structure, not HTML chrome

For simpler macros, reduce that even further:

- one shell class on the wrapper
- one optional root variant class
- descendant element selectors for headings, paragraphs, and lists
- no extra child classes unless they solve a real structural problem
