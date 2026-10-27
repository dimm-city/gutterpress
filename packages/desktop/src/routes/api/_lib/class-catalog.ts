import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ClassCatalogEntry } from '../../../lib/api';
import type { LibModule } from './route';

// The classes a book can write, beyond core's own `gp-*` vocabulary: what each
// enabled extension DOCUMENTS in its component catalog (`gutterpress.components`,
// a `components.yaml`), and what the book's own active stylesheets style. Feeds
// the editor's `.class` autocomplete and the Block properties dialog's modifier
// toggles. Host-side Node code (CLAUDE.md §8): the SPA gets plain entries.
//
// Core only checks that a catalog file EXISTS; the entry shape is each package's
// own (house-style's scaffold and gp-dimm-city's differ). So this reads a small,
// tolerant subset and ignores the rest: `name`, `status`, `label`,
// `description`/`notes`/`breaks`/`recipe` (for the one-line description),
// `modifier` (a class that changes a component without being one), `emits`, and
// `variants[].recipe`. A catalog with none of them lists nothing; a malformed
// one is skipped. That reader is deliberately small: core is expected to own a
// real catalog reader later, and this should then be deleted, not extended.

type Source = ClassCatalogEntry['source'];

const MAX_DESCRIPTION = 140;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** First sentence of a free-text field, flattened to one line and capped. */
function firstSentence(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const flat = text.replace(/\s+/g, ' ').trim();
  // "none" / "as skill" say nothing on their own line.
  if (flat.length < 12 || /^(none|n\/a)\b/i.test(flat)) return undefined;
  const sentence = /^(.+?[.!?])(\s|$)/.exec(flat)?.[1] ?? flat;
  return sentence.length > MAX_DESCRIPTION ? `${sentence.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…` : sentence;
}

function prettify(name: string): string {
  const spaced = name.replace(/[-_]+/g, ' ').trim();
  return spaced ? spaced[0]!.toUpperCase() + spaced.slice(1) : name;
}

function describe(entry: Record<string, unknown>, modifier: boolean): string | undefined {
  const fields = modifier
    ? ['description', 'breaks', 'notes', 'recipe']
    : ['description', 'notes', 'breaks', 'recipe'];
  for (const field of fields) {
    const text = firstSentence(str(entry[field]));
    if (text) return text;
  }
  return undefined;
}

const CLASS_TOKEN = /(?<![\w\-./])\.([A-Za-z_][\w-]*)/g;

/** The `.class` words in a catalog `emits` string or list (the first one found). */
function classFromEmits(emits: unknown): string | undefined {
  for (const item of typeof emits === 'string' ? [emits] : asArray(emits)) {
    const first = typeof item === 'string' ? /\.([A-Za-z_][\w-]*)/.exec(item)?.[1] : undefined;
    if (first) return first;
  }
  return undefined;
}

/** `@word` markers a recipe writes (not closers), without the `@`. */
function recipeMarkers(recipe: string | undefined): string[] {
  if (!recipe) return [];
  const words = [...recipe.matchAll(/@([A-Za-z][\w-]*)/g)].map((m) => m[1]!).filter((w) => !w.startsWith('end-'));
  return [...new Set(words)];
}

/**
 * The classes a recipe asks the author to WRITE. A recipe also describes what
 * lands in the HTML, so a `.word` counts only where an author types it: inside
 * `{…}`, on a segment that starts with a marker (`@section .x`), or anywhere in
 * an `origin: author` entry. That keeps `…→ .variable` style output notes out.
 * A recipe that shows raw HTML (`<div class="…">`) describes structure, not
 * something typed in `{…}`, so there only the brace form counts.
 */
function recipeClasses(recipe: string | undefined, isAuthor: boolean): string[] {
  if (!recipe) return [];
  const rawHtml = recipe.includes('<');
  const out: string[] = [];
  for (const segment of recipe.split(/\s+[|/]\s+|\s{2,}/)) {
    const startsWithMarker = segment.replace(/^[\s(\[]*(?:or\s+)?/, '').startsWith('@');
    for (const m of segment.matchAll(CLASS_TOKEN)) {
      const at = m.index ?? 0;
      const inBraces = segment.lastIndexOf('{', at) > segment.lastIndexOf('}', at);
      if (inBraces || (!rawHtml && (isAuthor || startsWithMarker))) out.push(m[1]!);
    }
  }
  return out;
}

/**
 * The classes a `modifier:` field names: its own string, each string of a list
 * (`[dc-h3, dc-h4]`), or (for `true`) the entry's emitted/written class.
 */
function modifierClasses(entry: Record<string, unknown>): string[] {
  const m = entry.modifier;
  const asClass = (v: unknown): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const cls = v.trim().replace(/^\./, '');
    return /^[A-Za-z_][\w-]*$/.test(cls) ? cls : undefined;
  };
  if (Array.isArray(m)) return m.map(asClass).filter((c): c is string => !!c);
  if (typeof m === 'string') return [asClass(m)].filter((c): c is string => !!c);
  if (m !== true) return [];
  const cls = classFromEmits(entry.emits) ?? recipeClasses(str(entry.recipe), true).at(-1);
  return cls ? [cls] : [];
}

/**
 * The classes one extension's component catalog documents. Retired and
 * unimplemented entries are skipped (the catalog's own words for "does not
 * work"). A modifier is flagged so Block properties can offer it as a toggle.
 */
export function parseCatalogClasses(yamlText: string, source: Source): ClassCatalogEntry[] {
  let doc: unknown;
  try {
    doc = parseYaml(yamlText);
  } catch {
    return [];
  }
  const root = asRecord(doc);
  if (!root) return [];

  const byClass = new Map<string, ClassCatalogEntry>();
  const add = (cls: string, fields: Omit<ClassCatalogEntry, 'class' | 'source'>): void => {
    const existing = byClass.get(cls);
    if (!existing) {
      byClass.set(cls, { class: cls, ...fields, source });
    } else if (fields.modifier && !existing.modifier) {
      // The modifier entry documents the class best; it replaces a looser mention.
      byClass.set(cls, { class: cls, ...fields, source });
    }
  };

  for (const group of ['components', 'page_templates']) {
    for (const raw of asArray(root[group])) {
      const entry = asRecord(raw);
      const name = entry && str(entry.name);
      if (!entry || !name) continue;
      const status = str(entry.status);
      if (status === 'retired' || status === 'unimplemented') continue;
      const isAuthor = str(entry.origin) === 'author';
      const recipe = str(entry.recipe);
      const appliesTo = recipeMarkers(recipe);
      const label = str(entry.label) ?? prettify(name);

      for (const modifier of modifierClasses(entry)) {
        add(modifier, { description: describe(entry, true), modifier: true, appliesTo, label });
      }
      for (const cls of recipeClasses(recipe, isAuthor)) {
        add(cls, { description: describe(entry, false), appliesTo, label });
      }
      for (const v of asArray(entry.variants)) {
        const variant = asRecord(v);
        const variantRecipe = variant && str(variant.recipe);
        if (!variant || !variantRecipe) continue;
        const description = describe(variant, false) ?? describe(entry, false);
        for (const cls of recipeClasses(variantRecipe, true)) {
          add(cls, { description, appliesTo: recipeMarkers(variantRecipe), label: str(variant.name) ?? label });
        }
      }
    }
  }
  return [...byClass.values()];
}

/**
 * Class names a stylesheet's SELECTORS use. Comments and strings are blanked,
 * and only the text before a `{` is read, so `url(logo.png)`, `0.5em` and
 * declaration values never count. At-rule preludes are skipped.
 */
export function extractCssClasses(css: string): string[] {
  const clean = css
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
  const found = new Set<string>();
  let prelude = '';
  for (const ch of clean) {
    if (ch === '{') {
      if (!prelude.trimStart().startsWith('@')) {
        for (const m of prelude.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) found.add(m[1]!);
      }
      prelude = '';
    } else if (ch === '}' || ch === ';') {
      prelude = '';
    } else {
      prelude += ch;
    }
  }
  return [...found].sort();
}

const MAX_STYLESHEET_BYTES = 1_000_000;
const MAX_BOOK_CLASSES = 500;

type CatalogLib = Pick<LibModule, 'listProjectExtensions' | 'readExtensionMeta' | 'pathEscapesFolder' | 'listProjectStyles'>;

/** Every documented extension class and every class the book's own active stylesheets use. */
export async function collectClassCatalog(projectDir: string, lib: CatalogLib): Promise<ClassCatalogEntry[]> {
  const out: ClassCatalogEntry[] = [];

  for (const entry of await lib.listProjectExtensions(projectDir)) {
    if (!entry.enabled || !entry.dir || !entry.carries.components) continue;
    try {
      const rel = (await lib.readExtensionMeta(entry.dir)).components?.trim();
      if (!rel || lib.pathEscapesFolder(rel)) continue;
      const text = await readFile(path.join(entry.dir, rel), 'utf8');
      out.push(...parseCatalogClasses(text, { kind: 'extension', ref: entry.use, name: entry.label }));
    } catch {
      // An unreadable catalog just lists nothing; the Looks & features tab reports broken extensions.
    }
  }

  const documented = new Set(out.map((e) => e.class));
  const book = new Set<string>();
  try {
    for (const style of await lib.listProjectStyles(projectDir)) {
      if (!style.active) continue;
      try {
        const css = await readFile(style.path, 'utf8');
        if (css.length <= MAX_STYLESHEET_BYTES) for (const cls of extractCssClasses(css)) book.add(cls);
      } catch {
        // A missing stylesheet is the CSS editor's and Problems' business.
      }
    }
  } catch {
    // No stylesheets resolvable: nothing from the book.
  }
  for (const cls of [...book].sort().slice(0, MAX_BOOK_CLASSES)) {
    if (!documented.has(cls)) out.push({ class: cls, appliesTo: [], source: { kind: 'book' } });
  }
  return out;
}
