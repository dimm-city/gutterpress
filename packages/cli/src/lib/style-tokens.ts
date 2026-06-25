/**
 * Style tokens — read/write a stylesheet's `:root` custom properties so the
 * viewer can offer a GUIDED styling surface (color pickers + size controls)
 * instead of forcing non-technical authors to hand-edit raw CSS. This is the
 * mechanism behind print-md's stated goal: "style your project by setting CSS
 * custom properties".
 *
 * Shared lib (CLI + viewer through the platform seam). Pure Node fs + postcss —
 * NO subprocess, NO bundler — so it bundles under `bun build --compile` and
 * runs in the packaged viewer's main process (CLAUDE.md §1/§3/§8). The renderer
 * never imports this; it calls `getPlatform().readStyleTokens(...)`.
 */
import { readFile, writeFile } from "node:fs/promises";
import postcss from "postcss";

/** How a custom property should be edited in the guided UI. */
export type StyleTokenKind = "color" | "length" | "text";

/** One editable `:root` custom property. */
export interface StyleToken {
  /** The custom property name, e.g. `--heading-color`. */
  name: string;
  /** The raw declared value, e.g. `#cc0000` or `1.5rem`. */
  value: string;
  /** Editor affordance to use. */
  kind: StyleTokenKind;
  /** Human label derived from the name, e.g. "Heading color". */
  label: string;
  /** For `length`: the numeric part. */
  number?: number;
  /** For `length`: the unit (px, rem, em, pt, %, …). */
  unit?: string;
}

/** A 3/4/6/8-digit hex color. */
const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
/** A number with an OPTIONAL CSS length/percentage unit (unit-less allowed). */
const LENGTH_RE = /^(-?\d*\.?\d+)\s*(px|rem|em|pt|%|vh|vw|vmin|vmax|ch|cm|mm|in)?$/;
/** Color functions we treat as colors (rendered as a swatch, edited as text). */
const COLOR_FN_RE = /^(rgb|rgba|hsl|hsla|oklch|oklab|color|lab|lch)\(/i;
/**
 * CSS named colors + the keyword colors. A value like `red` belongs in the
 * Colors group with a swatch (UX review D-3: named colors were dumped into
 * "Other" as raw text, incoherent for a property literally named "Color paper").
 */
const NAMED_COLORS = new Set(
  (
    "transparent currentcolor black silver gray grey white maroon red purple fuchsia green lime " +
    "olive yellow navy blue teal aqua cyan magenta orange aliceblue antiquewhite aquamarine azure " +
    "beige bisque blanchedalmond blueviolet brown burlywood cadetblue chartreuse chocolate coral " +
    "cornflowerblue cornsilk crimson darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey " +
    "darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray " +
    "dimgrey dodgerblue firebrick floralwhite forestgreen gainsboro ghostwhite gold goldenrod " +
    "greenyellow honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen " +
    "lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey " +
    "lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue " +
    "lightyellow limegreen linen mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen " +
    "mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose " +
    "moccasin navajowhite oldlace olivedrab orangered orchid palegoldenrod palegreen paleturquoise " +
    "palevioletred papayawhip peachpuff peru pink plum powderblue rosybrown royalblue saddlebrown " +
    "salmon sandybrown seagreen seashell sienna skyblue slateblue slategray slategrey snow springgreen " +
    "steelblue tan thistle tomato turquoise violet wheat whitesmoke yellowgreen rebeccapurple"
  ).split(" "),
);

/** Derive a friendly label from a custom-property name. */
function labelFor(name: string): string {
  const words = name.replace(/^--/, "").replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Classify a value into an editor affordance. */
function classify(value: string): Pick<StyleToken, "kind" | "number" | "unit"> {
  const v = value.trim();
  if (HEX_RE.test(v) || COLOR_FN_RE.test(v) || NAMED_COLORS.has(v.toLowerCase())) {
    return { kind: "color" };
  }
  // A numeric value — with OR without a unit (e.g. `1.45` line-height) — gets
  // the number stepper (UX review D-4).
  const m = LENGTH_RE.exec(v);
  if (m) return { kind: "length", number: Number(m[1]), unit: m[2] ?? "" };
  return { kind: "text" };
}

/** True when the postcss rule's selector list targets `:root`. */
function isRootRule(selector: string): boolean {
  return selector.split(",").some((s) => s.trim() === ":root");
}

/**
 * Read the `:root` custom properties from a stylesheet, in source order,
 * deduped (last declaration wins, matching the cascade). Returns `[]` for a
 * file with no `:root` custom properties (or an unreadable/empty file).
 */
export async function readStyleTokens(cssPath: string): Promise<StyleToken[]> {
  let css: string;
  try {
    css = await readFile(cssPath, "utf-8");
  } catch {
    return [];
  }
  let root;
  try {
    root = postcss.parse(css);
  } catch {
    return [];
  }

  const byName = new Map<string, StyleToken>();
  root.walkRules((rule) => {
    if (!isRootRule(rule.selector)) return;
    rule.walkDecls((decl) => {
      if (!decl.prop.startsWith("--")) return;
      byName.set(decl.prop, {
        name: decl.prop,
        value: decl.value.trim(),
        label: labelFor(decl.prop),
        ...classify(decl.value),
      });
    });
  });
  return [...byName.values()];
}

/**
 * Set a `:root` custom property's value in a stylesheet, preserving every other
 * declaration and the file's formatting. Updates the LAST `:root` declaration
 * of `name` if present (the one that wins the cascade); otherwise appends it to
 * the last `:root` rule, creating a `:root {}` rule if the file has none.
 * `name` must start with `--`. Returns the new file contents.
 */
export async function writeStyleToken(
  cssPath: string,
  name: string,
  value: string,
): Promise<string> {
  if (!name.startsWith("--")) {
    throw new Error(`Not a custom property: "${name}" (must start with --).`);
  }
  const css = await readFile(cssPath, "utf-8");
  const root = postcss.parse(css);

  let lastDecl: import("postcss").Declaration | undefined;
  let lastRootRule: import("postcss").Rule | undefined;
  root.walkRules((rule) => {
    if (!isRootRule(rule.selector)) return;
    lastRootRule = rule;
    rule.walkDecls(name, (decl) => {
      lastDecl = decl;
    });
  });

  if (lastDecl) {
    lastDecl.value = value;
  } else if (lastRootRule) {
    lastRootRule.append({ prop: name, value });
  } else {
    root.append(postcss.rule({ selector: ":root" }).append({ prop: name, value }));
  }

  const out = root.toString();
  await writeFile(cssPath, out, "utf-8");
  return out;
}
