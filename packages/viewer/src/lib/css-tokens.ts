/**
 * Pure `:root` custom-property read/write for the guided Design panel.
 *
 * This replaces a whole node-side lib module + a 5-layer IPC seam. Editing CSS
 * custom properties is just text manipulation, so it runs in the RENDERER on the
 * stylesheet text the platform's `readFile`/`writeFile` already provide — no
 * postcss, no `style:*` IPC, no `StyleToken` duplicated across the boundary.
 * Pure strings → §8-clean and unit-testable.
 */

/** One editable `:root` custom property. */
export interface StyleToken {
  /** The custom-property name, e.g. `--heading-color`. */
  name: string;
  /** The raw declared value, e.g. `#cc0000` or `1.5rem`. */
  value: string;
  /** Human label derived from the name, e.g. "Heading color". */
  label: string;
  /** For a numeric value: the numeric part. */
  number?: number;
  /** For a numeric value: the unit (px, rem, …), or "" when unit-less. */
  unit?: string;
}

/** A number with an optional CSS length/percentage unit. */
const LENGTH_RE = /^(-?\d*\.?\d+)\s*(px|rem|em|pt|%|vh|vw|vmin|vmax|ch|cm|mm|in)?$/;
/** A rule whose selector list contains `:root`, capturing selector + body. */
const ROOT_RULE_RE = /([^{}]*:root[^{}]*)(\{)([^}]*)(\})/g;
/** One custom-property declaration inside a rule body. */
const DECL_RE = /(--[\w-]+)\s*:\s*([^;]+);/g;

/** Derive a friendly label from a custom-property name. */
function labelFor(name: string): string {
  const words = name.replace(/^--/, "").replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Parse the `:root` custom properties from a stylesheet, in source order, deduped
 * (last declaration wins, matching the cascade). Numeric values carry `number` +
 * `unit`. Color vs text is decided by the panel (the browser resolves colors).
 */
export function parseRootTokens(css: string): StyleToken[] {
  const byName = new Map<string, StyleToken>();
  for (const rule of css.matchAll(ROOT_RULE_RE)) {
    const body = rule[3] ?? "";
    for (const decl of body.matchAll(DECL_RE)) {
      const name = decl[1]!;
      const value = decl[2]!.trim();
      const lm = LENGTH_RE.exec(value);
      byName.set(name, {
        name,
        value,
        label: labelFor(name),
        ...(lm ? { number: Number(lm[1]), unit: lm[2] ?? "" } : {}),
      });
    }
  }
  return [...byName.values()];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Set a `:root` custom property's value, in every `:root` rule that declares it,
 * preserving the rest of the file. Returns the new CSS (unchanged if the property
 * isn't found). `name` must start with `--`.
 */
export function setRootToken(css: string, name: string, value: string): string {
  if (!name.startsWith("--")) return css;
  const declRe = new RegExp(`(${escapeRe(name)}\\s*:\\s*)([^;]*)(;)`, "g");
  return css.replace(ROOT_RULE_RE, (full, sel: string, open: string, body: string, close: string) => {
    if (!body.includes(name)) return full;
    const newBody = body.replace(declRe, (_d, pre: string, _old: string, semi: string) => pre + value + semi);
    return sel + open + newBody + close;
  });
}
