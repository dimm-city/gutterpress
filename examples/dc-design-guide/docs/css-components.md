
**What Good Component CSS Looks Like**
1. One real base class owns structure and defaults.
2. Variant classes only override a small documented public API (custom properties).
3. Direct property overrides on variants only for truly distinct structural exceptions.
4. Keep selectors flat and predictable.
5. Use semantic variants, not implementation variants.

**Good Pattern — `.dc-alert` base + thin variants**
```css
/* Base: owns structure, spacing, typography, break behavior, and the public API */
.dc-alert {
  --dc-alert-bg:          var(--paper-light);
  --dc-alert-border:      var(--crimson);
  --dc-alert-fg:          var(--ink-smoke);
  --dc-alert-label-color: var(--dc-alert-border);

  background:   var(--dc-alert-bg);
  border-left:  4px solid var(--dc-alert-border);
  color:        var(--dc-alert-fg);
  font-size:    var(--fs-body-sm);
  line-height:  var(--lh-normal);
  padding:      var(--space-lg) var(--space-xl);
  break-inside: avoid;
  page-break-inside: avoid;
}

.dc-alert p             { margin: 0; font-style: italic; }
.dc-alert p + p         { margin-top: 6pt; }
```

```css
/* Thin variants: override only the public API */
.dc-vibe-callout {
  --dc-alert-border: var(--hud-magenta);
}

.dc-origin-callout {
  --dc-alert-bg:           var(--surface-orange-tint);
  --dc-alert-border:       var(--blood);
  --dc-alert-label-color:  var(--crimson);
  --dc-alert-border-width: 3px;
}
```

The public API for `.dc-alert` variants is: `--dc-alert-bg`, `--dc-alert-border`,
`--dc-alert-fg`, `--dc-alert-label-color`. Direct property overrides (e.g. `margin`,
`border-left-width`, `width`) are acceptable on individual variants when the value is
truly exceptional and not shared.

**Bad Pattern — direct structural overrides on variants**
```css
/* Don't do this — variants copy structural rules from the base */
.dc-alert--vibe {
  --dc-alert-border: var(--hud-magenta);
  padding: var(--space-sm) var(--space-md);   /* ← structural, not API */
  font-size: 10pt;                             /* ← structural, not API */
}

.dc-alert--origin {
  --dc-alert-bg: var(--surface-orange-tint);
  --dc-alert-border: var(--blood);
  border-left-width: 3px;
  padding: 6pt 9pt;                            /* ← duplicates base padding logic */
  font-size: 9.5pt;                            /* ← duplicates base font-size */
}
```

Padding and font-size are structural. When variants start overriding them directly,
you end up with parallel copies of the component shell that diverge silently over time.

**Bad Pattern — over-engineered internal variable API**
```css
/* Don't do this — exposes every internal dimension as a configurable knob */
.dc-alert {
  --alert-margin-top: …;
  --alert-margin-right: …;
  --alert-margin-bottom: …;
  --alert-margin-left: …;
  --alert-padding-x: …;
  --alert-padding-y: …;
  --alert-label-size: …;
  --alert-label-weight: …;
  --alert-label-spacing: …;
  --alert-label-display: …;
  --alert-border-width: …;
  --alert-border-color: …;
  …
}
```

This turns the component into a configuration engine. Variants no longer look like
thin overrides — they look like full re-declarations. Use direct properties for
one-off exceptions; use custom properties only for the small shared API.

**How This Applies to Alert Variants**

Keep `.dc-alert` as the only shell. Let variant classes `.dc-note`, `.dc-vibe-callout`,
`.dc-origin-callout`, `.dc-visit-callout`, `.dc-gear-callout`, `.dc-dm-note` override:
- surface/background (`--dc-alert-bg`)
- accent/border color (`--dc-alert-border`)
- label color (`--dc-alert-label-color`)
- exceptional spacing only when truly needed (direct property, not a new variable)

**Reference Methodologies**
- BEM: base block + modifier classes
- CUBE CSS: composition/layout separate from component block
- Design-token layering: global tokens → component aliases → variant overrides
