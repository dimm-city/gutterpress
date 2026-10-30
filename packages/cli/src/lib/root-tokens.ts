/**
 * A stylesheet's root-level custom properties — the design settings Book
 * setup shows — read and written with postcss (#454).
 *
 * "Root-level" means a declaration in a `:root` rule that is not inside
 * `@media`, `@supports` or any other conditional group (and, postcss being a
 * parser, never one in a comment). A `:root` inside a cascade layer counts,
 * tagged with its layer. Values are read as written, so a `;` inside
 * `url("data:…")` is part of the value, and a write changes only the
 * declarations it names: every other byte of the sheet is kept.
 *
 * Host-side only: postcss never reaches the desktop's SPA (architecture rules
 * §8). The desktop reads these through its `style/book-css` route and writes
 * through `style/edit-tokens` (`book-css.ts`).
 *
 * **Token annotations (issue #244).** Theme authors curate what the guided
 * panel shows with a tiny comment grammar in the `:root` block — no new file
 * format, no schema, and (since it's ordinary CSS comments) no risk to a
 * plain browser or a build that never heard of Gutterpress. Three
 * directives, each written in a block comment right before the declaration it
 * describes:
 *
 * - `@group <name>` — show the token under a "<name>" heading instead of the
 *   Fonts/Colors/Sizes/Other bucket its kind would choose.
 * - `@label <text>` — the label shown instead of the default one.
 * - `@internal` — leave the token out of the panel. The CSS is untouched.
 *
 * Each directive applies to the NEXT custom-property declaration only and is
 * consumed by it. A block has defaults too (#435): `@group` and `@internal`
 * in the comments directly BEFORE the `:root` selector apply to every
 * declaration in the block that carries no directive of its own; a
 * declaration's own `@group`, `@label` or `@internal` still wins for that
 * declaration (its own `@group` or `@label` shows it even inside an
 * `@internal` block). Several directives can share one comment (`@label X
 * @group Y`) or be spread across consecutive comments. A comment with none of
 * them is prose and changes nothing.
 */

import postcss, { type Container, type Declaration, type Root, type Rule } from "postcss";

/** One root-level custom property, as a stylesheet declares it. */
export interface RootToken {
  /** The property name, e.g. `--color-accent`. */
  name: string;
  /**
   * The value as written, comments and the space before its `;` included, so
   * writing it back restores the declaration byte for byte (`!important` is
   * not part of it, and stays on the declaration).
   */
  value: string;
  /** An `@label` annotation's text. */
  label?: string;
  /** An `@group` annotation (the declaration's own, else its block's). */
  group?: string;
  /** The cascade layer the `:root` rule sits in, dotted (`ext.look.theme`); absent when unlayered. */
  layer?: string;
}

/** One pending change: a token's new value, or null to remove the book's declaration of it. */
export interface TokenUpdate {
  name: string;
  value: string | null;
}

/** The annotations gathered for one declaration, or for one block's defaults. */
interface Annotation {
  label?: string;
  group?: string;
  internal?: boolean;
}

/**
 * A directive in a comment. The value is everything after the keyword up to
 * the end of the line or the next `@` — excluding `@` is what lets two
 * directives share one comment without one taking in the other.
 */
const DIRECTIVE_RE = /@(group|label|internal)\b[ \t]*([^\n\r@]*)/gi;

/** Fold every directive in one comment onto `into`; prose adds nothing. */
function fold(into: Annotation, comment: string): void {
  for (const d of comment.matchAll(DIRECTIVE_RE)) {
    const key = d[1]!.toLowerCase();
    if (key === "internal") {
      into.internal = true;
      continue;
    }
    const value = d[2]!.trim();
    if (value) into[key as "group" | "label"] = value;
  }
}

/** A `:root` rule outside any conditional group, and the cascade layer it is in. */
interface RootRule {
  rule: Rule;
  layer?: string;
}

/**
 * Every root-level `:root` rule, in source order: the stylesheet's own and
 * those inside `@layer` blocks (nested layers are dotted, as CSS names them).
 * Anything inside another at-rule (`@media`, `@supports`, …) is conditional,
 * so it is not a setting.
 */
function rootRules(root: Root): RootRule[] {
  const out: RootRule[] = [];
  const visit = (container: Container, layer: string | undefined): void => {
    container.each((node) => {
      if (node.type === "rule") {
        if (node.selectors.some((s) => s.trim().toLowerCase() === ":root")) {
          out.push(layer === undefined ? { rule: node } : { rule: node, layer });
        }
      } else if (node.type === "atrule" && node.name.toLowerCase() === "layer" && node.nodes) {
        const name = node.params.trim();
        visit(node, layer === undefined ? name : name ? `${layer}.${name}` : layer);
      }
    });
  };
  visit(root, undefined);
  return out;
}

/** The text of the comments directly before a rule, in source order (its block defaults, #435). */
function leadingComments(rule: Rule): string[] {
  const out: string[] = [];
  for (let prev = rule.prev(); prev?.type === "comment"; prev = prev.prev()) out.unshift(prev.text);
  return out;
}

/** A declaration's value as written (postcss keeps comments in a value aside). */
function writtenValue(decl: Declaration): string {
  return decl.raws.value?.raw ?? decl.value;
}

/**
 * Every root-level custom property a stylesheet declares, in source order,
 * with its annotations; an `@internal` one is left out. Throws postcss's
 * `CssSyntaxError` for a sheet it cannot parse.
 */
export function rootTokens(css: string): RootToken[] {
  const out: RootToken[] = [];
  for (const { rule, layer } of rootRules(postcss.parse(css))) {
    const defaults: Annotation = {};
    for (const comment of leadingComments(rule)) fold(defaults, comment);
    let pending: Annotation = {};
    rule.each((node) => {
      if (node.type === "comment") {
        fold(pending, node.text);
        return;
      }
      if (node.type !== "decl" || !node.prop.startsWith("--")) return;
      // One-shot: the annotation is this declaration's alone.
      const own = pending;
      pending = {};
      const annotated = own.group !== undefined || own.label !== undefined;
      if (own.internal || (defaults.internal && !annotated)) return;
      const group = own.group ?? defaults.group;
      out.push({
        name: node.prop,
        value: writtenValue(node),
        ...(own.label !== undefined ? { label: own.label } : {}),
        ...(group !== undefined ? { group } : {}),
        ...(layer !== undefined ? { layer } : {}),
      });
    });
  }
  return out;
}

/** The root-level declarations of one custom property in a parsed sheet. */
function declarationsOf(root: Root, name: string): Declaration[] {
  return rootRules(root).flatMap(({ rule }) =>
    (rule.nodes ?? []).filter((n): n is Declaration => n.type === "decl" && n.prop === name),
  );
}

/**
 * Take a declaration out, and its `:root` rule with it when nothing is left in
 * the rule. The rule goes with the line break after its `}` and keeps the
 * space before it, so adding a token to a sheet and removing it again gives
 * the sheet back byte for byte.
 */
function removeDeclaration(decl: Declaration): void {
  const rule = decl.parent as Rule;
  decl.remove();
  if ((rule.nodes ?? []).length > 0) return;
  const parent = rule.parent!;
  const next = rule.next();
  const before = rule.raws.before ?? "";
  rule.remove();
  const keep = (after: string | undefined): string => before + (after ?? "").replace(/^\n/, "");
  if (next) next.raws.before = keep(next.raws.before);
  else parent.raws.after = keep(parent.raws.after);
}

/**
 * Add a declaration at the top of the sheet's first root-level `:root` rule,
 * or in a `:root` rule added at the end of a sheet that has none. Never in a
 * comment or a conditional group: those are not `:root` rules here.
 */
function insertDeclaration(root: Root, name: string, value: string): void {
  const rule = rootRules(root)[0]?.rule;
  if (rule) {
    const hadDeclaration = (rule.nodes ?? []).some((n) => n.type === "decl");
    rule.prepend(
      postcss.decl({ prop: name, value, raws: { before: rule.first?.raws.before ?? "\n  ", between: ": " } }),
    );
    if (!hadDeclaration) rule.raws.semicolon = true;
    return;
  }
  const tail = root.raws.after ?? "";
  const added = postcss.rule({ selector: ":root", raws: { between: " ", after: "\n", semicolon: true } });
  added.append(postcss.decl({ prop: name, value, raws: { before: "\n  ", between: ": " } }));
  root.append(added);
  // Set after `append`, which copies the previous node's spacing.
  added.raws.before = tail + ((root.nodes.length > 1 || tail) && !tail.endsWith("\n") ? "\n" : "");
  root.raws.after = "\n";
}

/**
 * Apply a batch of token updates to a book's stylesheets, in cascade order,
 * folding each onto the result of the last so none is lost. A value is set
 * where the book already declares the token — every root-level declaration
 * of it in the LAST sheet that has one, the one that wins — and otherwise
 * added to `sheets[target]`. A null value removes the token from every
 * sheet, so what the looks set shows through. Returns the sheets' new text;
 * a sheet nothing changed comes back as it was given. Throws postcss's
 * `CssSyntaxError` for a sheet it cannot parse.
 */
export function applyTokenUpdates(
  sheets: readonly string[],
  target: number,
  updates: readonly TokenUpdate[],
): string[] {
  const roots = sheets.map((css) => postcss.parse(css));
  const changed = new Set<number>();
  for (const { name, value } of updates) {
    const declared = roots.map((root) => declarationsOf(root, name));
    if (value === null) {
      declared.forEach((decls, i) => {
        for (const decl of decls) removeDeclaration(decl);
        if (decls.length > 0) changed.add(i);
      });
      continue;
    }
    let at = declared.length - 1;
    while (at >= 0 && declared[at]!.length === 0) at--;
    if (at >= 0) {
      for (const decl of declared[at]!) decl.value = value;
      changed.add(at);
    } else {
      insertDeclaration(roots[target]!, name, value);
      changed.add(target);
    }
  }
  return sheets.map((css, i) => (changed.has(i) ? roots[i]!.toString() : css));
}
