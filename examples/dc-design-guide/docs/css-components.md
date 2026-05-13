
**What Good Component CSS Looks Like**
1. One real base class owns structure and defaults.
2. Variant classes only override a small public API.
3. Don’t expose internal layout as a variable API unless consumers genuinely need it.
4. Prefer direct properties for one-off exceptions over creating 12 custom properties.
5. Keep selectors flat and predictable.
6. Use semantic variants, not implementation variants.

**Good Pattern**
```css
.alert {
  --alert-bg: var(--paper-light);
  --alert-border: var(--crimson);
  --alert-text: var(--ink-smoke);

  background: var(--alert-bg);
  border-left: 4px solid var(--alert-border);
  color: var(--alert-text);
  font-size: var(--fs-body-sm);
  line-height: var(--lh-normal);
  padding: var(--space-lg) var(--space-xl);
  break-inside: avoid;
  page-break-inside: avoid;
}

.alert p {
  margin: 0;
  font-style: italic;
}

.alert p + p {
  margin-top: 6pt;
}
```

```css
.alert--vibe {
  --alert-border: var(--hud-magenta);
  padding: var(--space-sm) var(--space-md);
}

.alert--origin {
  --alert-bg: var(--surface-orange-tint);
  --alert-border: var(--blood);
  border-left-width: 3px;
  padding: 6pt 9pt;
}
```

That is the model we should follow.

**Bad Pattern**
- Base class with 15 to 20 variables for:
  - margin-top/right/bottom/left
  - padding-x/y
  - width/max-width
  - label font size/weight/spacing/display
  - line-height
  - border width/color split into many knobs
- This turns CSS into an internal configuration engine instead of a maintainable component.

**How This Applies Here**

For alerts:
- Keep `.dc-alert` as the only shell.
- Let `.dc-note`, `.dc-vibe-callout`, `.dc-origin-callout`, `.dc-visit-callout`, `.dc-gear-callout`, `.dc-dm-note` only override:
  - surface/background
  - accent/border color
  - border width if truly different
  - label text/color
  - exceptional spacing only when needed

For cards:
- Treat `.dc-skill-card`, `.dc-path-shell`, and `.dc-specialty-card` as distinct components.
- If they share anything, keep it limited to a tiny alias layer only:
  - surface
  - accent
- Each concrete component should own:
  - spacing
  - break behavior
  - clip-path
  - layout quirks
  - odd/even specialty flipping

**Practical Rules I Should Follow Next**
1. No more “margin-top/right/bottom/left” variable APIs.
2. No more variable APIs for label typography unless multiple variants truly share them.
3. If only one variant needs a different padding, set `padding` on that variant directly.
4. If only one variant needs a different border width, set it directly.
5. Use custom properties only for the values that are genuinely shared across variants:
   - background
   - accent/border color
   - foreground/text color
   - label text
   - sometimes title/tab color

**Reference Methodologies**
- BEM:
  - base block + modifier classes
- CUBE CSS:
  - composition/layout separate from component block
- Design-token layering:
  - global tokens -> component aliases -> variant overrides

**What I should do from here**
1. Fix visual regressions first.
2. Then simplify toward this exact base-plus-thin-variants model.
3. Avoid introducing any new internal token surface unless we can justify it.
