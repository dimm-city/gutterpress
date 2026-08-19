# Core-Rule Provenance — making rich editing lossless for real plugin books

**Status:** draft for team review · 2026-08-19
**Scope:** `packages/cli/src/lib/markdown/plugin-provenance.ts`, `packages/desktop/src/lib/editor/markdown-doc/*`, `docs/fixtures/advanced-book`
**Decision this implements:** "Option B" from the finding recorded in `docs/remaining-work.md` (§ Engineering, 2026-08-19): extend the provenance/adoption machinery to plugin **core-ruler transforms**, so books like the Dimm City Field Guide round-trip through the rich editor instead of being silently damaged by it.

Everything in this document is either measured on the real book or read from
the code at the cited symbol. Nothing is inferred from behavior alone.

---

## 1. The problem, measured

The rich editor opens every Field Guide chapter richly — and a save from rich
mode silently deletes the book's component markup. Measured with the same
machinery `tests/editor/plugin-roundtrip.test.ts` uses (`createEditorRenderer`
with the book's own `dimm-city-plugin.js`, `canEditRichly`, `isFixpoint`,
`normalize`), against **both** the current dc-op-manual `main` and the
restored `restore/re-land-refactor-native` tree — identical results, so this
is not content drift; it is ours:

| Property | Result | Meaning |
| --- | --- | --- |
| `canEditRichly` | **14/14 pass** | Every chapter opens in rich mode — which is also the default (`editor.mode: "rich"`). |
| Byte fixpoint (`isFixpoint`) | **2/14 hold** | For 12 chapters the *normal form itself is unstable* — normalizing the normalized text changes it again. |
| Meaning preserved (`semanticHtml(render(text))` vs `render(normalize(text))`) | **0/14 hold** | The first serialize changes what the book renders. |

Determinism was verified first (same input → same render, same normalize,
twice), so none of this is plugin statefulness in the harness.

What concretely happens to `chapter-00.md` on one rich-mode save:

- The `@lede` / `@end-lede` marker lines are **deleted from the source**; the
  rendered `<div class="dc-intro">` wrapper disappears.
- `@toc` is deleted; the `<div class="dc-toc">` wrapper disappears.
- The pull-quote block collapses to a plain paragraph.
- Typographer output is baked back into the author's bytes
  (`doesn't` → `doesn’t`, `"…"` → `“…”`) — a separate defect, see §6.1.

This is the exact failure CLAUDE.md §5 declares the design must prevent:
*"the file opens in SOURCE mode with the reason shown, rather than opening
richly and mis-serializing an author's book."* Today it opens richly and
mis-serializes the author's book.

---

## 2. How plugin round-tripping works today (inventory)

One dialect, one pipeline. The editor parses with Gutterpress's own
`createMarkdownRenderer()` plus one editor-only core rule
(`packages/desktop/src/lib/editor/markdown-doc/renderer.ts`).

**Block-rule provenance** (`packages/cli/src/lib/markdown/plugin-provenance.ts`):
while `applyPlugins` runs, every **block rule** a plugin registers is wrapped
(`withBlockRuleProvenance` intercepts `md.block.ruler`'s `push/at/before/after`).
On each successful non-silent invocation, every token the rule pushed without
a `map` is stamped `token.meta.gpEditorLines = [startLine, state.line]` — the
exact line range the tokenizer consumed. Ground truth from the tokenizer, no
obligations on the plugin (§5: plugins stay plain markdown-it).

**Adoption** (`packages/desktop/src/lib/editor/markdown-doc/parser.ts`,
`adoptPluginTokens`): unknown block `X_open`/`X_close` pairs and atoms are
rewritten onto the generic `plugin_block` / `plugin_atom` token types when
their authored lines are recoverable — from `token.map`, else the
`gpEditorLines` stamp, else `token.markup`. The recovered lines are stored in
`meta.gpPlugin` and are **all the serializer ever writes back**
(`serializer.ts` `gp_plugin_block` writes `marker` + content + `closeMarker`;
`gp_plugin_atom` writes the marker line verbatim). Anything unrecoverable is
left untouched and the ProseMirror parser **raises**
(`Token type \`x\` not supported by Markdown parser`) — which is what
`canEditRichly` catches and turns into a source-mode verdict.

**The generated-content channel** (`renderer.ts`): `markers.js` injects
content the author never wrote (the `.chapter-opener` badge) as a map-less
`html_block`. The editor-only core rule `editor_tag_generated` retags every
**map-less `html_block`** to `gp_generated`, which renders exactly like
`html_block` in the view but **serializes to nothing** (`serializer.ts`
`gp_generated() {}`). For the badge this is lossless *because its generator
line (`@chapter …`) is still in the document* — re-rendering the serialized
source regenerates the badge.

---

## 3. The gap, precisely

The Dimm City plugin registers **no block rules and no inline rules**. Its
entire vocabulary is two **core-ruler transforms**:

```
md.core.ruler.push('dc_alerts', dcAlertsTransform);          // line ~766
md.core.ruler.push('dimm_city_transform', function (state)…  // line ~789
```

`dimm_city_transform` is a single pass over `state.tokens` building
`newTokens`. Surviving tokens are pushed **by object reference**
(`newTokens.push(tok)`, 11 sites). Marker paragraphs are **consumed** — e.g.
the `@lede` handling:

```js
const ledeMarker = parseMarker(tok, tokens, i, '@lede');
if (ledeMarker.matched) {
  closeAll();
  newTokens.push(makeToken('html_block', '<div class="dc-intro">\n'));
  inLede = true;
  i += 2; continue;          // skips paragraph_open + inline + paragraph_close
}
```

The three authored tokens (which **carry maps**) are dropped; a synthesized
`html_block` (a plain object literal with `map: null` — all **79**
`makeToken` call sites in the plugin synthesize `html_block`) takes their
place.

Now trace those synthesized wrappers through the editor:

1. They pass through **no block rule**, so `withBlockRuleProvenance` never
   sees them — no `gpEditorLines` stamp.
2. `editor_tag_generated` retags them `gp_generated` (map-less `html_block`).
3. `gp_generated` serializes to **nothing**.
4. The authored `@lede` lines are not in the token stream at all (consumed in
   step 0), so nothing else carries them.

Net: the wrapper AND its authored source vanish on save. Nothing raises, so
`canEditRichly` says yes, and the fail-closed contract is bypassed. The
`gp_generated` invariant — *"dropping is lossless because the generator line
is still in the document"* — holds for `markers.js`'s badge and does **not**
hold for a transform that consumed its generator lines.

Two footnotes on the gap's shape:

- **The fixture gate cannot see it.** `docs/fixtures/advanced-book`'s plugin
  (the go/no-go gate) exercises block rules of every registration style plus
  a token transform that **decorates** existing tokens. It never
  consumes-and-replaces mapped tokens from a core rule. That is exactly the
  dimm-city pattern, and it is the missing fixture coverage (§7).
- **There is a second door.** Only `html_block` gets the `gp_generated`
  retag. A core rule that synthesized, say, map-less `paragraph_open` or
  table tokens would be absorbed as if authored and serialized as
  *regenerated markdown* rather than the authored source — a different flavor
  of silent loss. dimm-city doesn't do this today (79/79 are `html_block`),
  but the design below must close both doors, not pattern-match one token
  type.
- **Doc drift to fix while here:** `plugin-provenance.ts`'s header says
  core-rule injections *"fail closed — the same provenance rule as the
  editor's `editor_drop_generated`"*. The implemented rule is named
  `editor_tag_generated` and it does not fail closed — it retags to a
  serialize-to-nothing node. The comment describes the design intent this
  plan implements; update it when landing.

---

## 4. Design: provenance for core-rule transforms

### 4.0 Constraints (all from CLAUDE.md §5 — non-negotiable)

1. **No Gutterpress plugin API.** Plugins stay plain markdown-it. Everything
   below is host-side observation at registration time, exactly like
   `withBlockRuleProvenance`. A plugin author changes nothing.
2. **Fail closed on ambiguity.** Where authored source cannot be attributed
   from ground truth, the file refuses rich mode with a named reason — never
   a guess.
3. **No inference from gaps.** Adoption must not deduce source "from gaps
   between neighbours". The mechanism below satisfies this because a
   before/after token-array diff is a deterministic record of *what the
   transform itself did* — which tokens it removed and what it inserted in
   their place — not a spatial guess. The removed tokens' own `map`s are the
   tokenizer's ground truth; the diff only transfers that truth onto the
   tokens that replaced them.

### 4.1 Where: a sibling wrapper in `plugin-provenance.ts`

Add `withCoreRuleProvenance(md, apply)` alongside `withBlockRuleProvenance`,
applied by the same `applyPlugins` window. It intercepts `md.core.ruler`'s
registration methods (same `REGISTRATION_METHODS` table) and wraps each core
rule a plugin registers. Base-pipeline core rules (registered before the
window) and host rules (after) stay untouched — same scoping rule the block
wrapper already has, and it is what keeps `markers.js`'s badge on the
`gp_generated` path unchanged.

### 4.2 What the wrapper does per invocation

```
before = state.tokens.slice()                    // array copy, same objects
fingerprints = per-token (type, content, map ref) for morph detection
run the plugin's core rule
diff before vs state.tokens by OBJECT IDENTITY   // two-pointer walk
```

Because surviving tokens keep object identity (measured: dimm-city pushes
them by reference; any rebuild-the-array transform that *copies* tokens would
show them as removed+inserted, which degrades to fail-closed, never to a
wrong attribution), the diff yields **hunks**: maximal runs of
`{ removed: Token[], inserted: Token[] }` between surviving anchors. A
surviving object whose `type` or `content` changed (fingerprint mismatch) is
treated as a single-token hunk `{ removed: [old self], inserted: [new self] }`
— it has its own `map`, so it attributes trivially.

Per hunk, apply this policy table:

| removed | inserted | action | why it is lossless / honest |
| --- | --- | --- | --- |
| ≥1, **all** carrying `map` or an existing `gpEditorLines` stamp | ≥1 | Stamp every inserted token with `gpEditorLines = [min start, max end]` over the removed tokens' ranges, plus a shared `gpCoreHunk` group id. | The transform's own input/output record says these tokens replaced exactly those source lines. Serializing those lines verbatim and re-running the pipeline regenerates the same tokens. |
| ≥1, **any** without map/stamp | any | Stamp inserted tokens `gpEditorUnattributable` (a poison marker). | Attribution is ambiguous → fail closed. The editor raises with a named reason (§4.3) instead of guessing. |
| 0 | ≥1 | No stamp. Falls through to the existing `gp_generated` retag (for `html_block`) — and for **non-html** injected types, poison them too (the "second door", §3). | A pure injection consumed no source; the pipeline will regenerate it from the surviving source on every render. Dropping it from the model is provably lossless. |
| ≥1 (mapped) | 0 | Phase 1: poison → refuse with a named reason. Phase 2 (only if a real plugin needs it): synthesize an invisible `plugin_atom` carrying the lines. | Consumed-to-nothing lines have no token to ride on. Refusing is honest; nothing in dimm-city or the fixture hits this row today. |

Chained rules compose: a stamped token is "attributed" for a later rule's
diff (the stamp is map-equivalent in the first policy row), so rule 2
consuming rule 1's output propagates ranges correctly.

### 4.3 Editor-side changes (`packages/desktop/src/lib/editor/markdown-doc/`)

**`renderer.ts` — `editor_tag_generated`:** it already runs after plugin core
rules (registered after `createMarkdownRenderer(plugins)` returns). Narrow it:

- map-less `html_block` **with** `gpEditorLines` → leave alone (adoption will
  take it).
- **with** `gpEditorUnattributable` → retag to a type the parser has no
  handler for (e.g. `gp_unattributable`), so the parse raises with a message
  naming the plugin rule — same UX as every other refusal: the file opens in
  source mode with the reason shown.
- otherwise (map-less, unstamped `html_block`) → `gp_generated`, exactly as
  today. The chapter-opener badge path is byte-for-byte unchanged.

**`parser.ts` — `adoptPluginTokens`:** add a branch ahead of the
`_open`/`_close` pair logic: a token carrying `gpEditorLines` **and**
`gpCoreHunk` (i.e. core-synthesized, attributed) rewrites its hunk group to a
single `plugin_atom` whose `marker`/`text` is `lines.slice(start, end)`
verbatim — the `authoredBlock` helper already computes exactly this from a
stamp. Remaining tokens of the same hunk are dropped from the stream (they
are part of the same replacement; their source is the same lines). Inner
content between an open-hunk and a close-hunk is untouched — those tokens
survived the transform with their maps and stay ordinary editable nodes.

**`serializer.ts`:** no changes. `gp_plugin_atom` already writes the authored
lines verbatim; that is the entire round-trip guarantee.

**Net effect on the Field Guide:** `@lede` becomes an atom serializing
`@lede`; the paragraphs after it stay editable prose; `@end-lede` becomes an
atom serializing `@end-lede`. Save reproduces the author's bytes; the
pipeline regenerates the `dc-intro` wrapper on every render, so print and
preview are untouched.

### 4.4 View fidelity: phase 1 honest, phase 2 pretty

Phase 1 renders each adopted wrapper marker as the atom chrome
(`pluginAtom` — visible labeled leaf), with the wrapper's interior styled as
ordinary flow rather than nested inside the `dc-intro` box. Correctness
first: the author's file can no longer be damaged; the editor view is
slightly less print-faithful *inside* plugin wrappers.

Phase 2 (optional, UX): pair an open-hunk whose inserted HTML is a single
opening tag with the later hunk inserting its matching close tag (same
synthesized nesting depth — deterministic from the transform's own output,
still no guessing), and adopt the pair as one `gp_plugin_block`
(`marker`/`closeMarker` = the two authored line sets). `pluginBlock().toDOM`
then renders the real tag + attrs around editable content — full view
fidelity, same serializer. Unpairable hunks stay atoms. Ship phase 1 alone if
phase 2 slips; phase 1 is already strictly better than both today's silent
loss and option A's blanket source-mode.

### 4.5 Performance

One array copy + fingerprint pass + linear diff per plugin core rule per
parse. The Field Guide's largest chapter is ~2k tokens × 2 rules — microseconds
against a parse that already builds every token. The stamp is `meta`-only:
nothing reaches the DOM, print output is byte-identical (same guarantee the
block-rule stamp already documents).

---

## 5. Why not the alternatives

- **Option A (blanket refuse when a core rule consumed mapped tokens)** is
  the honest *stopgap* — it enforces the stated contract in ~a day. But it
  sends every chapter of the flagship book to source mode permanently, i.e.
  rich editing simply doesn't exist for the product's own reference book.
  Ship it as the interim guard (§8 phase 0) only if B's timeline demands it.
- **Teach the plugin to use block rules** (rewrite dimm-city as stamped block
  rules): fixes one book, not the class. §5 exists because we cannot control
  how the hundreds of markdown-it plugins on npm are written; GFM-alert-style
  core transforms (`dc_alerts` consuming blockquote tokens) are a common
  published pattern. The host must observe, not prescribe.
- **Serialize the synthesized HTML instead of dropping it**: materializes
  generated markup as source — the exact chapter-opener bug the
  `gp_generated` channel was built to prevent, now at book scale.

---

## 6. Adjacent defects to fix in the same epic (separate PRs)

### 6.1 Typographer output baked into the author's source

`normalize` writes `’`/`“”`/`—` substitutions into the file because the
document model is built from typographer-processed inline tokens. Rendered
HTML is unchanged (the substitution is idempotent), so the fixpoint and
semantic gates are blind to it by construction — but it rewrites bytes the
author never touched, which pollutes diffs and sync history. Proposed fix:
the **doc-model parse** runs with `typographer: false, linkify: false` while
the view/preview render keeps them (they are presentation, and the print
path is untouched either way). Acceptance: normalize of a plugin-free file
that only differs by straight quotes leaves the quotes alone; full corpus
gate stays green.

### 6.2 Blank-line churn (the 12/14 fixpoint instability)

The observed churn is the serializer emitting double blank lines between
loose-list items on pass 1 and single on pass 2 — measured only around
content that pass 1 freed from stripped wrappers, and the first-party
(plugin-free) corpus holds fixpoint in CI. Expectation: it disappears once
wrappers are adopted instead of stripped (the list never gets re-parented).
**Re-measure after §4 lands**; if any instability persists on a plugin-free
reproduction, file it separately against the serializer's list spacing.

### 6.3 Comment drift

`plugin-provenance.ts` header (`editor_drop_generated`, "must fail closed")
— update to describe the implemented three-way split (adopt / refuse /
`gp_generated`) and name the real rule.

---

## 7. Test plan

**Close the fixture blind spot first** — extend
`docs/fixtures/advanced-book/book/plugins/field-markers.js` with a core-ruler
transform that mirrors the dimm-city shape, so the go/no-go gate exercises
every policy row:

1. a wrapper pair (`@lede`-like: consume marker paragraph → synthesize
   map-less `html_block` open/close, inner tokens surviving by reference);
2. an atom (consume one marker paragraph → synthesize one wrapper);
3. an alerts-style morph (consume mapped `blockquote_open` run → synthesize
   replacement, like `dc_alerts`);
4. a **copying** transform variant (rebuilds surviving tokens as fresh
   objects) → must land in the poison row, proving degradation is to
   fail-closed, never to misattribution;
5. a pure injection (no consumption) → must stay on the `gp_generated` path;
6. a non-`html_block` synthesized token → must poison (second door).

**Gates that must go green:**

- `tests/editor/plugin-roundtrip.test.ts` — extended fixture at 100%
  rich-editable / fixpoint / semantic-preservation (rows 1–3), plus explicit
  refusal-reason assertions (rows 4, 6).
- `tests/editor/markdown-doc-corpus.test.ts` — unchanged corpus stays green
  (proves the badge path and plugin-free books are untouched).
- New unit tests for the hunk differ (identity anchors, morph detection,
  chained rules, stamp-as-map equivalence).
- A regression test that `editor_tag_generated` never retags a stamped token.

**Acceptance on the real book** (the numbers this whole plan exists to move),
using the measurement harness in Appendix A against the restored
dc-op-manual tree:

| Property | today | required |
| --- | --- | --- |
| rich-editable | 14/14 | 14/14 |
| byte fixpoint | 2/14 | **14/14** |
| meaning preserved | 0/14 | **14/14** |

(§6.1's typographer toggle is needed for byte-level cleanliness of the first
save, but fixpoint/semantic must hit 14/14 from §4 alone — verify both
separately.)

---

## 8. Rollout

- **Phase 0 (optional interim, ~1 day):** poison-only — wrap core rules,
  detect consumption of mapped tokens, refuse rich mode with the named
  reason. Stops the silent damage immediately; Field Guide chapters open in
  source mode until phase 1. Skip if phase 1 lands promptly. **Until
  something ships, rich mode's `editor.mode: "rich"` default is actively
  dangerous for plugin books of this shape** — weigh flipping the default or
  phase-0 first.
- **Phase 1 (the fix):** `withCoreRuleProvenance` + policy table + atom
  adoption + fixture extension + gates. Lossless round-trip, atom-level view.
- **Phase 2 (UX):** open/close hunk pairing → `gp_plugin_block` adoption for
  full in-view wrapper fidelity.
- **Alongside:** §6.1 typographer toggle (own PR, own corpus measurement),
  §6.3 comment fix (ride along with phase 1).

---

## Appendix A — measurement harness

Place as e.g. `packages/desktop/tests/editor/field-guide-check.manual.ts`
(kept out of `bun test` by the name) and run
`bun tests/editor/field-guide-check.manual.ts <path-to-field-guide>`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  canEditRichly, createEditorRenderer, isFixpoint, normalize,
} from "../../src/lib/editor/markdown-doc";
import { semanticHtml } from "../support/semantic-html";

const BOOK = process.argv[2]!;
const mod = await import(join(BOOK, "..", "dc-design-guide", "plugins", "dimm-city-plugin.js"));
const md = createEditorRenderer([{ name: "dimm-city", plugin: mod.default, options: {}, css: mod.css }]);

let rich = 0, fix = 0, sem = 0;
const files = readdirSync(BOOK).filter((f) => f.endsWith(".md")).sort();
for (const f of files) {
  const text = readFileSync(join(BOOK, f), "utf8");
  const v = canEditRichly(md, text);
  if (!v.ok) { console.log(`SOURCE-MODE ${f}: ${v.reason}`); continue; }
  rich++;
  if (isFixpoint(md, text).ok) fix++; else console.log(`NOT-FIXPOINT ${f}`);
  if (semanticHtml(md.render(text, {})) === semanticHtml(md.render(normalize(md, text), {}))) sem++;
  else console.log(`MEANING-DRIFT ${f}`);
}
console.log(`rich ${rich}/${files.length} · fixpoint ${fix}/${rich} · meaning ${sem}/${rich}`);
```

Verify determinism before trusting any failure (render and normalize the same
text twice; compare) — that is what separates real lossiness from plugin
statefulness.

## Appendix B — evidence excerpt (chapter-00, one normalize pass)

```diff
-@lede
-
-Twelve chapters of dreams, dirt, and what bites back. Read them in any order — the city doesn't care where you start.
-
-@end-lede
+Twelve chapters of dreams, dirt, and what bites back. Read them in any order — the city doesn’t care where you start.
```

Rendered-HTML consequence: `<div class="dc-intro">…</div>` and
`<div class="dc-toc">…</div>` are gone from the normalized render; the
curly apostrophe is the §6.1 defect riding along.

## Appendix C — file / symbol map

| Piece | Location |
| --- | --- |
| Block-rule stamp (pattern to mirror) | `packages/cli/src/lib/markdown/plugin-provenance.ts` — `withBlockRuleProvenance`, `GP_EDITOR_LINES`, `REGISTRATION_METHODS` |
| Plugin apply window | `packages/cli/src/lib/markdown/plugins.ts` — `applyPlugins` |
| Generated-content retag | `packages/desktop/src/lib/editor/markdown-doc/renderer.ts` — `editor_tag_generated` (map-less `html_block` → `gp_generated`) |
| Adoption + refusal | `packages/desktop/src/lib/editor/markdown-doc/parser.ts` — `adoptPluginTokens`, `authoredBlock`, raise site ("Token type … not supported") |
| Generic nodes | `schema.ts` — `pluginBlock()` (renders tag+attrs around content), `pluginAtom()` (visible atom chrome) |
| Verbatim write-back | `serializer.ts` — `gp_plugin_block`, `gp_plugin_atom`, `gp_generated() {}` |
| The real-world consumer shape | `dc-op-manual/dc-design-guide/plugins/dimm-city-plugin.js` — `dc_alerts` (~766), `dimm_city_transform` (~789), `makeToken` (79 × `html_block`, `map: null`), `parseMarker` + `i += 2` consumption |
| Go/no-go gate to extend | `docs/fixtures/advanced-book` + `packages/desktop/tests/editor/plugin-roundtrip.test.ts` |
| Corpus gate (must stay green) | `packages/desktop/tests/editor/markdown-doc-corpus.test.ts` |
