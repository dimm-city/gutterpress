# Core-Rule Provenance — making rich editing lossless for real plugin books

**Status:** v3, AS BUILT (implemented + adversarially reviewed + fixed) · 2026-08-20 — see the As-built addendum before Appendix A for every deviation from v2 and the final measured numbers.
**Scope:** `packages/cli/src/lib/markdown/plugin-provenance.ts` + `renderer.ts`, `packages/desktop/src/lib/editor/markdown-doc/*`, `docs/fixtures/advanced-book`
**Decision this implements:** "Option B" from the finding in `docs/remaining-work.md` (§ Engineering, 2026-08-19): extend the provenance/adoption machinery to plugin **core-ruler transforms**, so books like the Dimm City Field Guide round-trip through the rich editor instead of being silently damaged by it.

**v2 (2026-08-20).** v1 was pressure-tested against source by a five-agent
adversarial verification pass before any implementation. It found v1's policy
table unsatisfiable (markdown-it never puts `map` on `*_close` tokens, so
v1's flagship `@lede` case landed on *refuse*, not *adopt*), an
enclosing-map double-write in the alerts shape, a non-`html_block` synthesis
that already exists today (`dc_alerts` builds a fresh `inline` token), an
unreachable adoption insertion point (the `handled`-skip runs first), an
`adoptHtmlWrappers` interaction that would write the *synthesized HTML* into
the author's file, and a serializer-delim hazard for hunks inside surviving
containers. §4 is rewritten around those findings; §3, §6 and §7 carry the
corrections. Every claim below is verified at the cited symbol.

---

## 1. The problem, measured

The rich editor opens every Field Guide chapter richly — and a save from rich
mode silently deletes the book's component markup. Measured with the
committed harness (`packages/desktop/tests/editor/plugin-book-roundtrip.manual.ts`,
Appendix A) against **both** the current dc-op-manual `main` and the restored
`restore/re-land-refactor-native` tree — identical results, so this is not
content drift; it is ours:

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
`applyPlugins` (which lives at `packages/cli/src/lib/markdown/renderer.ts:209-229`
— `plugins.ts` only re-exports it) wraps the whole `md.use(plugin, options)`
loop in `withBlockRuleProvenance(md, …)`, which intercepts
`md.block.ruler`'s `push/at/before/after` for the duration. On each
successful non-silent invocation, every token the rule pushed without a
`map` is stamped `token.meta.gpEditorLines = [startLine, state.line]` — the
exact line range the tokenizer consumed. Ground truth from the tokenizer, no
obligations on the plugin (§5: plugins stay plain markdown-it).

**Adoption** (`packages/desktop/src/lib/editor/markdown-doc/parser.ts`,
`adoptPluginTokens`): unknown block `X_open`/`X_close` pairs and atoms are
rewritten onto the generic `plugin_block` / `plugin_atom` token types when
their authored lines are recoverable — from `token.map`, else the
`gpEditorLines` stamp, else `token.markup`. The recovered lines are stored in
`meta.gpPlugin` and are **all the serializer ever writes back**
(`serializer.ts` `gp_plugin_block` writes `marker` + content + `closeMarker`;
`gp_plugin_atom` writes the marker verbatim). Anything unrecoverable is left
untouched and the ProseMirror parser **raises**
(`Token type \`x\` not supported by Markdown parser`), which `canEditRichly`
turns into a source-mode verdict. Note two mechanics that shape §4.3:
`adoptPluginTokens` skips every token whose type is in the schema's `handled`
set at the **top** of its loop (parser.ts:131), and `adoptHtmlWrappers` runs
**before** it in the facade (parser.ts:505-508), splitting and pairing
authored lone-tag `html_block` tokens.

**The generated-content channel** (`renderer.ts`): `markers.js` injects
content the author never wrote (the `.chapter-opener` badge) as a map-less
`html_block`. The editor-only core rule `editor_tag_generated` retags every
**map-less `html_block`** to `gp_generated`, which renders exactly like
`html_block` in the view but **serializes to nothing**. For the badge this is
lossless *because its generator line (`@chapter …`) is still in the
document* — re-rendering the serialized source regenerates it.

---

## 3. The gap, precisely

The Dimm City plugin registers **no block rules and no inline rules**. Its
entire vocabulary is two **core-ruler transforms** (`dc_alerts` and
`dimm_city_transform`; at lines 732/755 in the `main` copy, 766/789 in the
restored copy — the two differ slightly, and the fix must serve both).

`dimm_city_transform` is a single forward pass over `state.tokens` building
`newTokens`. Surviving tokens are pushed **by object reference** (verified at
8 sites; `dc_alerts` at 4 more; no site copies a token, and neither rule
reorders or duplicates). Marker paragraphs are **consumed** — e.g. `@lede`:

```js
const ledeMarker = parseMarker(tok, tokens, i, '@lede');
if (ledeMarker.matched) {
  closeAll();
  newTokens.push(makeToken('html_block', '<div class="dc-intro">\n'));
  inLede = true;
  i += 2; continue;          // skips paragraph_open + inline + paragraph_close
}
```

The consumed run is `paragraph_open` (map spans the whole paragraph),
`inline` (map), and `paragraph_close` — which, like **every** markdown-it
close token, carries **no map** (`rules_block/paragraph.mjs:43`; same for
`heading_close`, `blockquote_close`, list/table closes). Any attribution rule
that demands a map on every removed token is therefore unsatisfiable for
essentially every consumption this plugin performs. The synthesized
replacement is a plain object literal with `map: null` (84 `makeToken` sites
in the `main` copy, all `html_block`).

`dc_alerts` (`> [!NOTE] …` blockquotes) has a more hostile shape, and it ships
in the acceptance set today (`chapter-00.md:89`, `chapter-02 1 Augmerc.md:170`):

- `blockquote_open` — whose `map` spans the **entire** blockquote, interior
  included — is removed in one place and replaced by an `html_block` open;
- the interior paragraphs **survive by reference**;
- the first `inline` token is removed and replaced by a **synthesized
  `new state.Token('inline', …)`** with freshly re-parsed children and no map
  — a non-`html_block` synthesis that exists **today**, inside a surviving
  paragraph;
- `blockquote_close` (map-less) is removed in a **separate, later** place and
  replaced by the closing `html_block`.

Trace the `@lede` wrappers through the editor: no block rule saw them (no
stamp) → `editor_tag_generated` retags map-less `html_block` →
`gp_generated` → serializes to nothing — and the authored `@lede` lines were
consumed in step 0, so nothing else carries them. Net: wrapper AND authored
source vanish on save; nothing raises; `canEditRichly` says yes. The
`gp_generated` invariant — *dropping is lossless because the generator line
is still in the document* — holds for the badge and does **not** hold for a
transform that consumed its generator lines.

Two more notes that shape the fix:

- **The fixture gate cannot see any of this.** `advanced-book`'s only core
  rule is decorate-only (`field_markers_decorate`, an `attrJoin` on
  surviving `heading_open` tokens). It never consumes, never synthesizes,
  never splits a container.
- **Doc drift to fix while here:** `plugin-provenance.ts`'s header names a
  rule `editor_drop_generated` that "must fail closed"; the implemented rule
  is `editor_tag_generated` and it silently drops. Update the comment when
  landing.

---

## 4. Design v2: provenance for core-rule transforms

### 4.0 Constraints (all from CLAUDE.md §5 — non-negotiable)

1. **No Gutterpress plugin API.** Host-side observation at registration time
   only, exactly like `withBlockRuleProvenance`. A plugin author changes
   nothing.
2. **Fail closed on ambiguity.** Where authored source cannot be attributed
   from ground truth, the file refuses rich mode with a reason that names the
   offending plugin rule — never a guess.
3. **No inference from gaps.** Every attribution below derives from the
   transform's own input/output record — which token objects it removed,
   which it inserted, and the removed tokens' own maps/stamps. Object
   identity of survivors makes the diff exact; where identity or maps run
   out, the answer is *refuse*, never *interpolate*.

### 4.1 Where: `withCoreRuleProvenance` beside the block wrapper

Add it to `plugin-provenance.ts`, nested around the same `applyPlugins`
callback at `renderer.ts:210` (core and block rulers are distinct `Ruler`
instances; the interception transfers verbatim — same registration methods
and fn indices in markdown-it 14.3.0, rules stored as the registered
function, `__cache__` invalidated on registration). Capture the **rule name**
at registration (`args[fnIndex-1]`) — the poison reason needs it. Base and
host core rules (registered outside the window — `markers.js`'s
`layout_transform`, `gp-pin-scope`, `inline-source`, `source_range`) stay
untouched, so the chapter-opener badge path is byte-for-byte unchanged.

Two hard environmental constraints on this code: it joins the node-free
`gutterpress/render` closure (`scripts/check-render-pure.mjs` bans node
builtins and `createRequire` in `dist/render.js`), and the desktop SPA
value-imports that closure into the **browser bundle** — the differ literally
executes in-browser. Zero dependencies, pure JS.

Core rules receive `(state)` with no ok/silent semantics — the block
wrapper's `ok && !silent` gate has deliberately no analogue here.

### 4.2 The differ: hunks → regions → policy

Per wrapped rule invocation:

```
before = state.tokens.slice()                 // same objects, array copy
fp     = per-token fingerprint: (type, content, children ref)
run the plugin's core rule
after  = state.tokens
```

**Moves poison.** Compute the identity intersection of `before`/`after`. If
the shared tokens' relative order differs, stamp every non-shared `after`
token with poison (rule name, reason "reordered authored content") and stop —
a moved mapped token is authored source in a new place, and neither dropping
nor re-attributing it is ground truth. (Neither dimm-city rule reorders;
`footnote_tail`-style movers are base-pipeline and never wrapped.)

**Morphs are hunks.** A shared token whose fingerprint changed in `type`,
`content`, or `children` (array reference; the one children-mutating site in
dimm-city co-rewrites `content`, but children-only edits are a one-line
evasion for other plugins, so the reference is part of the fingerprint) is
treated as a single-token hunk `{removed:[old self], inserted:[new self]}`.
**Attrs-only changes are deliberately ignored** — `attrJoin`/`attrSet` on
survivors is regenerated presentation (the fixture's decorate rule and
dimm-city's measured `attrJoin` sites are the precedents); do not let a
future reader "fix" this into a poison source.

**Hunks.** Between consecutive shared anchors: `{removed: before-segment,
inserted: after-segment}`.

**Attributing a removed run.** A removed token is *attributable* iff:

- it carries `map` or a `gpEditorLines`/`gpCoreHunk` stamp, **or**
- it is a close token (`nesting === -1`) whose matching open (by a nesting
  walk over the removed run) is removed **in the same hunk** — markdown-it
  guarantees the open's map spans the whole construct including the close
  line, so the close adds no unattributed source.

A close whose open is **not** in the hunk triggers span pairing (below). Any
other unattributable removed token → poison. The hunk's range is the union of
its removed tokens' maps/stamps. Without the close-token clause, every
consumption in the real plugin — including `@lede` — lands on poison; this is
the v1 flaw that made the acceptance table unreachable.

**Span pairing (the `dc_alerts` shape).** When hunk A removes an open token
whose matching close is removed in a later hunk B, merge A through B — every
inserted, surviving, and morphed token between them — into **one region**
attributed to the open token's map (which spans the whole construct). This
remains the transform's own record — *which objects it removed* — not gap
inference. It also resolves the synthesized-`inline` problem structurally:
`dc_alerts`' replacement inline sits inside the region and is swallowed with
it, never adopted at an illegal inline position.

**Overlap guard.** A single-hunk attribution whose range covers any surviving
token's map (and was not resolved into a region by span pairing) → poison.
This is what prevents the double-write failure: an adopted atom serializing
lines that surviving editable nodes serialize again.

**Depth guard.** A region whose `after`-span sits inside a *surviving*
container (blockquote/list — `token.level > 0` relative to survivors) →
poison. Serializer delim mechanics (`prosemirror-markdown`'s `wrapBlock`)
would double-prefix or under-prefix verbatim lines there. Top-level regions —
including alerts, where the removed range covers the container itself — are
unaffected.

**Type guard.** A hunk whose inserted tokens are not all block-level and that
is not swallowed by a region → poison (named reason). This closes the "second
door" for **replacement** rows, not just injections.

**Policy table (v2):**

| Hunk | Action |
| --- | --- |
| removals attributable (incl. paired closes), insertions ≥ 1, top-level, no unresolved overlap | Stamp every `after` token in the region span with `meta.gpCoreHunk = { id, range:[start,end), rule }`. |
| removals ≥ 1, insertions = 0 (isolated consumed-to-nothing) | Poison. Note: this **will** fire on plausible layouts — `@end-procedure`, stray `@skill`, the consumed `##### Outcomes` header insert nothing at their site and only merge into a neighbor hunk when no surviving token separates them. The field guide's shipped lazy `@end-procedure` (absorbed into the last list item) round-trips via the merged hunk whose range comes from `ordered_list_open.map`, which includes lazily-continued lines. |
| removals = 0, insertions all map-less and stamp-less `html_block` | No stamp — the existing `gp_generated` path; provably lossless (the pipeline regenerates pure injections from surviving source). |
| removals = 0, insertions containing a mapped token (a move) or a non-`html_block` type | Poison. A mapped "insertion" is authored source that moved; a map-less non-html injection would be absorbed as authored markdown. |
| anything else (unattributable removal, unresolved overlap, nested region, inline-type replacement outside a region) | Poison: `meta.gpCorePoison = { rule, reason }` on the inserted/morphed tokens. |

Poison is **meta-only** — token types are left untouched, so every render
path (preview, semantic gates, normalize planner) is pixel-identical; only
the editor's parse acts on it (§4.3).

**Chaining.** Stamped tokens count as attributed for later rules' diffs
(stamp ≡ map in the attribution clause), so `dimm_city_transform` consuming a
`dc_alerts` product attributes through the stamp. Re-stamping overwrites with
the merged range.

### 4.3 Editor-side changes (`packages/desktop/src/lib/editor/markdown-doc/`)

The v1 insertion point was unreachable (`adoptPluginTokens` skips `handled`
types — `html_block`, `paragraph_open`, … — at the top of its loop) and
`adoptHtmlWrappers` runs even earlier and would adopt dimm-city's lone-tag
`<div class="dc-intro">` as an HTML wrapper, writing the **synthesized HTML**
into the file as the "marker" — strictly worse than today. v2 therefore adds
a dedicated pass that runs **first**, plus guards:

**Facade order** (parser.ts:505-508) becomes:

```
md.parse → raiseOnPoison → adoptCoreRegions → adoptHtmlWrappers → adoptPluginTokens
```

1. **`raiseOnPoison(tokens)`** — scan for `meta.gpCorePoison`; throw a
   human sentence naming the rule (the `referenceLabels` precedent:
   an explicit pre-parse raise, because the library's own message names only
   a token type). `canEditRichly` forwards it and the file opens in source
   mode with e.g. *"The plugin rule `dc_alerts` rewrote content whose source
   can't be recovered."* Because poison is meta-only, `md.render` needs no
   new renderer rule and stays visually identical.
2. **`adoptCoreRegions(tokens, lines)`** — group contiguous tokens sharing a
   `gpCoreHunk` id; verify every token between the first and last member
   belongs (same id, or a survivor whose `map ⊆ range` — swallowed); replace
   the whole span with **one** `plugin_atom` whose `gpPlugin.marker` (and
   visible `text`) is `lines.slice(start, end)` **verbatim**. Any
   contiguity violation → convert to poison and let step 1's next parse
   refuse (defense in depth: convert and throw immediately).
3. **`adoptHtmlWrappers`** — add a guard in **both** its passes (expansion
   and pairing): skip any token carrying `gpCoreHunk`/`gpCorePoison`. Only
   mapped, authored HTML participates. (After step 2 the hunked tokens are
   already `plugin_atom`, but the guard keeps the invariant local and covers
   the expansion pass's meta-dropping copies.)
4. **`editor_tag_generated`** (renderer.ts) — predicate must be the exact
   complement of adoption's: retag map-less `html_block` to `gp_generated`
   **only** when it carries neither `gpCoreHunk` nor `gpCorePoison`. A
   map-less `html_block` stamped by the *block*-rule provenance (stamp, no
   hunk id) keeps today's `gp_generated` retag — the status quo for a shape
   no fixture emits; do not silently widen it into plain-`html_block`
   absorption.

**Serializer:** no changes. `gp_plugin_atom` writes the marker verbatim;
`write()` preserves interior newlines at top level, and the depth guard
(§4.2) excludes the container cases where delims would corrupt it. The atom's
view chrome collapses whitespace — if multi-line atoms (alerts) should show
line structure, that is one `white-space: pre-line` rule on the atom chrome,
not a schema change.

**Net effect on the Field Guide:** `@lede` / `@end-lede` become two atoms
serializing their authored lines; the prose between them stays ordinary
editable nodes. A `> [!NOTE]` alert becomes one atom carrying the whole
blockquote verbatim (interior not richly editable — the price of the
enclosing-map shape; still lossless). Save reproduces the author's bytes; the
pipeline regenerates all wrappers on every render, so print and preview are
untouched.

### 4.4 View fidelity: phase 1 honest, phase 2 pretty

Phase 1 (above) is correctness: no file can be damaged; wrapper markers show
as labeled atoms. Phase 2 pairs an open-atom with its close-atom when the
synthesized HTML forms a matching tag pair at the same synthesized depth
(deterministic from the transform's own output) and adopts the pair as one
`gp_plugin_block` — `pluginBlock().toDOM` then renders the real tag + attrs
around editable content. Unpairable regions stay atoms. Ship phase 1 alone if
phase 2 slips.

### 4.5 Performance

One array copy + fingerprint pass + linear identity diff per plugin core rule
per parse; microseconds against tokenization. Meta-only stamps: DOM, print
output, and preview are byte-identical.

---

## 5. Why not the alternatives

- **Option A (blanket refuse)** enforces the contract in ~a day but sends
  every chapter of the flagship book to source mode permanently. Ship only as
  the §8 phase-0 stopgap if phase 1's timeline demands it.
- **Rewrite dimm-city as block rules**: fixes one book, not the class; §5
  exists because we cannot control how npm plugins are written, and
  GFM-alert-style core transforms are a common published pattern.
- **Serialize the synthesized HTML**: materializes generated markup as source
  — the chapter-opener bug at book scale (and exactly what the unguarded
  `adoptHtmlWrappers` path would do by accident).

---

## 6. Adjacent defects to fix in the same epic (separate PRs)

### 6.1 Typographer/linkify output baked into the author's source

The doc model is built from typographer-processed inline tokens, so
`normalize` writes `’`/`“”`/`–`/`…`/`©` substitutions and linkify rewrites
into the file. Rendered HTML is unchanged (idempotent), so the fixpoint and
semantic gates are blind to it by construction.

**Fix:** flip `md.options.typographer` and `md.options.linkify` to `false`
inside `createDocParser(...).parse()` — the single choke point every
doc-model parse funnels through (`normalize`, `isFixpoint`, `canEditRichly`,
editor mount, `replaceDoc`; verified: no other `md.parse` call sites in the
SPA) — and restore the **prior values** in a `finally`. Non-negotiable
details, all verified:

- **Exception safety is the core of the fix, not hygiene:** throwing is the
  *routine* path through this choke point (fail-closed refusals, reference
  definitions), and the md instance is a session-long shared cache
  (`project-renderer.ts`: every consumer must hold the same instance). A flip
  without `try/finally` leaks `typographer:false` into every later render on
  the first refused file — the semantic gates go quietly blind.
- Per-call flipping is sound in markdown-it 14.3.0: `smartquotes`,
  `replacements`, and both `linkify` rules re-read `state.md.options` at run
  time; the default preset never disables rules at construction. Cite
  markdown-it's "don't modify options on the fly" doc note as a performance
  remark, *not* a correctness bar — a second instance is the worse
  alternative (violates the same-instance requirement, doubles plugin
  application).
- Everything between flip and restore is synchronous (md.parse,
  `MarkdownParser.parse`, `referenceLabels`, both adoption passes) — no
  interleaving. Wrap the whole `parse()` body so `referenceLabels`' own
  `md.parse` is covered too.
- Straight quotes serialize back byte-identically (`esc()` never escapes
  `'`/`"`; `escapeExtraCharacters` unset). One known first-save edge: a
  paragraph line starting with `-` (previously typographered to `–`) now
  hits the start-of-line escape and serializes as `\-…` — accept and
  document, or add a corpus case.
- **Product tradeoff to state and reconcile:** the rich-editor *view* renders
  the ProseMirror doc, so it will show straight quotes/plain dashes while
  print keeps typographer. Amend `renderer.ts`'s header promise ("text looks
  as it will print") in the same PR.

**Acceptance:** quotes, `--`/`...`, `(c)`/`(tm)`/`(r)`, and bare URLs all
survive normalize byte-identically on a plugin-free file; a **leak
regression** — parse a file that throws (footnote ref or `[label]: url`
definition) on a shared instance, then assert `md.options.typographer ===
true` and a subsequent `md.render` still emits curly quotes; full corpus gate
stays green.

### 6.2 Blank-line churn (the 12/14 fixpoint instability)

Mechanism, located: `serializer.ts` contains no list-spacing code — the
double blank comes from `prosemirror-markdown`'s
`MarkdownSerializerState.renderList`, whose same-type-adjacency branch calls
`flushClose(3)` (two blank lines) whenever two same-type list nodes serialize
back-to-back. Today `gp_generated() {}` deletes the wrappers that separated
two list fragments → same-type lists adjacent → double blank on pass 1 →
pass-2 reparse merges them into one loose list → single blank → churn. §4's
adoption removes the list split, so the churn is **expected** to disappear —
**re-measure after §4 lands.** If any instability survives on a plugin-free
reproduction, the in-repo fix address is an override of
`bullet_list`/`ordered_list` in `gutterpressMarkdownSerializer`'s node table
(serializer.ts:100-102), not a hunt through local serializer code.

### 6.3 Comment drift

`plugin-provenance.ts` header (`editor_drop_generated`, "must fail closed")
→ describe the implemented three-way split (adopt / refuse / `gp_generated`)
and name the real rule, `editor_tag_generated`.

---

## 7. Test plan

**Close the fixture blind spot with the TRUE shapes** — a fixture that
consumes a whole blockquote in one tidy hunk proves nothing about span
pairing, the overlap guard, or the inline-type guard.

In `docs/fixtures/advanced-book/book/plugins/field-markers.js`, add a
core-ruler transform (plus `export const css` styling for its wrappers, kept
fragmentation-neutral — plain block divs — so the parity gate stays green
with its empty allowlist), exercised by a **new chapter `07-transforms.md`**
registered in `manifest.yaml` `source.files`:

1. a wrapper pair (`@lede`-like: consume the 3-token marker paragraph —
   including its map-less `paragraph_close` — synthesize map-less
   `html_block` open/close, inner tokens surviving by reference);
2. an atom (consume one marker paragraph → synthesize one wrapper);
3. the **true alerts shape**: `blockquote_open` removed in one hunk, matching
   close removed in a separate later hunk, interior surviving by reference,
   first inline replaced by a synthesized `inline` token with re-parsed
   children — must adopt as ONE atom via span pairing, and the saved bytes
   must contain the whole authored blockquote once;
4. a lazy-continuation tail (the field guide's shipped idiom: `@end-…`
   absorbed into the last list item, no marker paragraph of its own) —
   must adopt via the merged hunk attributed from `ordered_list_open.map`;
5. an isolated consumed-to-nothing marker (a surviving paragraph between the
   marker and its construct) — must **refuse** with the rule named. Put this
   in a separate chapter added to the exclusion filter
   (`plugin-roundtrip.test.ts:52` — the only exclusion mechanism) and to a
   refusal test, or the 100% gates fail by construction.

Implement the remaining rows as **inline throwaway plugins inside
`plugin-roundtrip.test.ts`** (the existing pattern at lines ~169-259):

6. a **copying** transform (rebuilds survivors as fresh objects) → poison —
   degradation is to fail-closed, never misattribution;
7. a non-`html_block` pure injection → poison (second door);
8. a **moving** transform (same mapped objects re-appended elsewhere) →
   poison;
9. a stamped synthesized wrapper whose tags are lone `<div>`/`</div>` lines →
   assert `adoptHtmlWrappers` does NOT adopt it (saved bytes contain the
   authored marker, not the HTML) — the regression for the materialization
   trap;
10. a stamped `html_block` containing multiple tag lines → the expansion-pass
    guard (no stamp-dropping, no atom-per-copy duplication).

Authoring constraints (all verified against the current gates): chapter
prose must not contain the literal class/marker strings any
`not.toContain(...)` assertion scans for; the new chapter joins the
**bare-pipeline** corpus automatically (`mdFilesIn` scans the directory), so
its marker paragraphs must hold bare fixpoint + semantic preservation as
plain paragraphs; `normalize-project.test.ts`'s idempotence over the fixture
and `native-parity-gate.ts` (fixture is in `DEFAULT_FIXTURES`; missing = hard
error) must stay green; mirror `02-field-notes.md`'s verbatim marker-line
round-trip pattern for the new markers.

**Gates that must go green:** extended `plugin-roundtrip.test.ts` at 100%
rich/fixpoint/semantic for included chapters + refusal-reason assertions
(`verdict.reason` contains the rule name); `markdown-doc-corpus.test.ts`'s
two hard assertions unchanged; new cli-side unit tests for the differ (close
pairing, span pairing, overlap guard, depth guard, morphs incl.
children-ref, moves, chained rules, attrs-ignored); the regression that
`editor_tag_generated` never retags a stamped token.

**Build order (bake into every stage):** any edit under `packages/cli/src`
requires `bun run --cwd packages/cli build:library` before desktop tests or
the manual harness observe it — `gutterpress/render` resolves to
`dist/render.js` via the workspace symlink. `build:library` itself runs the
engine-bundle build, `check-render-pure.mjs` (which now binds the differ),
and `tsc -p tsconfig.build.json`.

**Acceptance on the real book** (the numbers this plan exists to move), using
Appendix A against the restored dc-op-manual tree:

| Property | today | required |
| --- | --- | --- |
| rich-editable | 14/14 | **14/14** (no chapter may regress to refuse) — as-built: met with the one-line book fix; 13/14 honest refusal without it (see addendum) |
| byte fixpoint | 2/14 | **14/14** |
| meaning preserved | 0/14 | **14/14** |

(§6.1 is needed for byte-clean *first* saves; fixpoint/semantic must hit
14/14 from §4 alone — verify both separately.)

---

## 8. Rollout

- **Phase 0 (optional interim, ~1 day):** poison-only — wrap core rules,
  poison every consuming hunk, refuse with the named reason. Stops the silent
  damage immediately at the cost of source-mode for plugin books. Skip if
  phase 1 lands promptly. **Until something ships, `editor.mode: "rich"` as
  the default is actively dangerous for this book shape.**
- **Phase 1 (the fix):** §4.1-4.3 + §7 fixture/gates. Lossless round-trip,
  atom-level view.
- **Phase 2 (UX):** §4.4 pairing → `gp_plugin_block` for in-view wrapper
  fidelity.
- **Alongside:** §6.1 typographer toggle (own PR, own measurements), §6.3
  comment fix (rides with phase 1).

---

## As-built addendum (v3, 2026-08-20)

Phase 1 plus §6.1/§6.3 shipped in one pass: implementation → 5-dimension
adversarial review (18 raw findings, 17 confirmed by independent verifiers
with end-to-end reproductions) → fix stage with sabotage-verified regression
tests (every new test was proven to FAIL against the pre-fix code). What
shipped differs from v2 in the following ways — the v2 sections above remain
the design rationale; this list is normative for the code:

**Differ (`plugin-provenance.ts`) beyond v2:**
- *Interior coverage* (third attribution clause): a removed token nested
  inside a matched open/close pair of the same removed run is attributable
  when that open carries a range — markdown-it leaves `map` off nested
  construct furniture (`th_open`/`td_open`/cell inline), so consumed tables
  poisoned under the literal v2 clause.
- *Deep children fingerprint*: the morph check compares a recursive
  per-child (type, content) signature in addition to the children array
  reference — an in-place `child.content` edit (the markdown-it
  `replacements` pattern) is a morph, not an invisible bake-into-source.
- *Sticky poison (no laundering)*: every removed token and morph anchor is
  probed for `gpCorePoison` before classification; a later rule that
  consumes a poisoned token re-poisons its replacement span with the
  ORIGINAL rule/reason (first poison wins, over `forcedReason` too).
- *Orphan side channel*: a refusal with no token carrier (a transform
  consumed the whole document) is recorded as
  `env.gpCorePoisonOrphan = { rule, reason }` (`GP_CORE_POISON_ORPHAN`),
  first-wins, fail-soft on hostile env objects.
- *Stamp-aware overlap guard*: the guard uses `tokenRange()` (map OR stamp),
  so chained rules cannot mint two regions over the same lines; consuming a
  strict subset of an earlier stamped region poisons, whole-region
  consumption still chains.
- *Region containment guard*: a span-paired region poisons when any
  swallowed survivor's range is not fully contained in the region range —
  a mismatched cross-construct pair refuses instead of deleting the content
  between it.
- *Depth guard exemption*: survivor depth counts all surviving containers
  EXCEPT `markers.js`'s structural layout family (chapter/spread/page/
  section), which the editor serializes delim-free; without the exemption
  every real chapter (transforms inside `@page`/`@section`) would refuse.
- *Poison-target fallbacks*: consumed-to-nothing parks poison on the nearest
  surviving neighbor; pure moves poison the displaced survivors (v2's
  target set was empty for both shapes).

**Editor (`markdown-doc/`) beyond v2:**
- Facade adds `raiseOnOrphanPoison` (env key + an independent backstop:
  non-blank source with an empty post-pipeline token stream refuses) ahead
  of `raiseOnPoison` → `adoptCoreRegions` → guarded `adoptHtmlWrappers` →
  `adoptPluginTokens`.
- `adoptCoreRegions` applies the map-within-range test to same-id members
  too — a too-narrow stamp refuses rather than truncating the atom's lines.
- `editor_entity_source` (the §6.1 companion rule): authored entities are
  retagged onto `html_inline` before `text_join` so saves keep their bytes —
  EXCEPT inside headings, where the retag is skipped (heading content is
  `(text | image)*`; the atom would silently delete the whole heading — the
  confirmed critical). In a heading `&amp;` decodes on save (the pre-change
  lesser loss, render-identical).
- Fidelity slots (spec-silent in v2, required by the meaning column):
  authored bullet character round-trips (`bullet_list.attrs.bullet` — this
  REPLACED v2's §6.2 renderList override and changed the normalize canon:
  bullets no longer canonicalize to `*`; CommonMark splits adjacent lists
  only on marker change, which the field guide uses deliberately);
  paragraph block-end braces round-trip (bound to the paragraph only when
  whitespace precedes `{` — `) {.x}` is the paragraph's, `){.x}` the
  image's); `horizontal_rule` braces; value-less braces carry (`{disabled}`
  byte-stable; `{key=""}` canonicalizes to `{key}` — same parsed attribute);
  a cell-text pass strips start-of-line escapes inside table cells (inline
  context; the escapes were print-harmful there).
- §6.1's `\--` first-save edge is **print-visible** (markdown-it 14 joins
  text tokens after replacements, so `\--` prints literally as `--`, not an
  en dash) — the tradeoff bullet in §6.1 reads accordingly.

**Final measured numbers** (harness of Appendix A, after all fixes):

| Book | rich | fixpoint | meaning |
| --- | --- | --- | --- |
| Field guide, restored tree + the one-line dead-marker fix | **14/14** | **14/14** | **14/14** |
| Field guide, unmodified (`main` copy) | 13/14 | 13/13 | 13/13 |
| Design guide (informational) | 19/19 | 19/19 | 18/19 |

The unmodified book's one refusal is the honest consumed-to-nothing poison:
chapter-02 0's `@end-callout` is dead text (the plugin's `@procedure`
handler force-closes the callout first), named verbatim in the refusal. The
render-identical one-line removal is pushed as dc-op-manual branch
`fix/field-guide-dead-end-callout` (based on the restore branch); with it
the acceptance table is met in full. The design guide's single meaning
drift (`07-markdown-reference.md`) is the schema's documented link-first
mark-order trade, proven pre-existing by full-revert comparison.

**Phase 2 — SHIPPED (2026-08-20).** `adoptCoreRegions` records single-token
regions whose synthesized content is one lone open/close tag as pairing
candidates, and `pairCoreWrapperRegions` retags matched candidates
(nearest-unclosed by tag, the same discipline `adoptHtmlWrappers` uses for
authored wrappers) into one `gp_plugin_block` whose `marker`/`closeMarker`
are the authored lines and whose `tag`/`viewAttrs` come from the synthesized
open tag — so the editor renders the plugin's real element and classes
around the editable content and the book's own stylesheet applies in-view.
Pairing is strictly view-level: a paired block serializes byte-identically
to the two atoms plus content (re-verified: all three harness runs
unchanged, 14/14 ×3 on the fixed book), so every rejection fails SOFT to
atoms — unmatched or crossed tags, unbalanced between-content, and the
adjacent-pair shape, where two touching marker paragraphs merge into ONE
differ hunk and stay one verbatim atom. Measured on the real book (after
the cross-pair barrier below): chapter-00 holds two `@lede → div.dc-intro`
styled blocks — the credits and introduction pages — plus the authored
`colophon-grid` HTML wrapper via the pre-existing path; the chapter's FIRST
`@lede` stays a labeled atom because its true closer merged into the
`@end-lede`/`@toc` barrier atom (see below). Multi-tag
constructs — the skill-card shells, span-paired alerts, the `@callout`
family (its synthesized open is `<div>` + label `<span>` in one token, not a
lone tag) — remain labeled atoms by design; pairing them would need
multi-token wrapper synthesis
support (a possible phase 2.5, owner's call on value). Cosmetic: multi-line
atom chrome renders whitespace-collapsed; the `white-space: pre-line` polish
is deferred to the `editor-parity.mjs` visual pass on a machine that can
render the app — styling a view this container cannot see would be a blind
change.

**Phase 2 correction — the cross-pair barrier (2026-08-21).** Rendered-view
screenshots of chapter-00 (the editor's DOM under the book's own built CSS,
Chrome 148) exposed a pairing defect the byte gates could not see — a paired
block serializes byte-identically to its atoms, so a WRONG pair is invisible
to fixpoint and meaning checks. The defect: multi-member regions produced no
pairing candidate at all, so nearest-unclosed tag matching paired ACROSS
them — and a multi-member atom is exactly where a swallowed true closer
lives (adjacent marker paragraphs merge into one hunk: `@end-lede` + `@toc`
became one atom holding both the lede's `</div>` and the toc's open). On
chapter-00 the first `@lede`'s opener paired with the TOC's later `</div>`,
nesting the entire TOC inside the lede's `dc-intro` box in the editing view.

The fix makes every non-candidate region an explicit **barrier** that clears
the open-pair stack, and additionally fails a pair soft when an AUTHORED
lone-tag `html_block` sits between the markers (its own `adoptHtmlWrappers`
pair, formed later, may cross this one's boundary — its nesting is still 0
during the balance scan). Both halves carry sabotage-verified regression
tests in `core-provenance.test.ts`: the chapter-00 shape (a clean pair
before the merged atom must still style; the swallowed-closer opener must
stay an atom; the toc list must remain a top-level sibling) and the
authored-tag crossing (the authored wrapper wins, both markers stay atoms).

Audit of what the barrier kills, measured by re-running the block census
with the barrier disabled: exactly four pre-fix blocks across the book were
cross-pairs — chapter-00 (`@lede` × toc's close), chapter-02 0
(`@definition` × the NEXT definition's close, fusing two panels), chapter-04
(same definition-chain shape), chapter-05 (`@gear` × a later card's close,
fusing gear cards) — and all four are the unsound kind: each spanned a
barrier atom holding its true closer. Every sound pair in the corpus
survived (chapter-00's two, ch01, ch02-6/7/8, ch04's four, ch05's clean
`@gear` pair). Zero collateral: in this corpus the conservative barrier
never dropped a correct pairing.

**Proof against the canonical fixed book** (`fix/field-guide-dead-end-callout`,
identity-verified copy):
- Roundtrip harness: **14/14 rich · 14/14 fixpoint · 14/14 meaning**, three
  consecutive runs identical (determinism).
- Edit-cycle harness (`plugin-book-edit-cycle.manual.ts`, real ProseMirror
  transactions): mid-paragraph insertion changes **exactly one line** in the
  saved bytes on 14/14 chapters; the same edit inside a styled wrapper keeps
  both authored marker lines byte-identical on 7/7 chapters that hold one
  (was 8 pre-barrier — the eighth "wrapper" was chapter-02 0's unsound
  cross-pair); edited bytes are their own normal form on every chapter.
- Strict PDF build of the canonical book: 269 pages, clean.
- Rendered-view evidence (DOMSerializer + the live app's `rawHtmlView`
  emulated — the static `toDOM` shows raw HTML as text, the app overlays
  NodeViews that render it, so the harness sets `innerHTML` on
  `.gp-generated`/`.gp-raw-html`/`.gp-raw-html-inline` before
  screenshotting): zero escaped markup rendered as text in ch00/ch01/ch04;
  chapter-00's 13 TOC anchors are real `<a>` elements and its HTML comment
  is a real (invisible) comment node; the TOC sits OUTSIDE the `dc-intro`
  box while credits + introduction render styled.
- Fixture book (`advanced-book`): 7/9 rich with both refusals the DESIGNED
  ones (a link-reference definition; the consume-to-nothing chapter naming
  `field_markers_transform`), 7/7 fixpoint, 7/7 meaning. Design guide:
  19/19 rich, 19/19 fixpoint, 18/19 meaning — the one drift is
  `07-markdown-reference.md`'s single `**[x]**` → `[**x**]` mark-order
  normalization (`<strong><a>` → `<a><strong>`, render-equivalent), proven
  pre-existing by re-running with the barrier disabled.

**Known follow-ups recorded, deliberately out of scope:** the pre-existing
block-rule adoption double-write when two sibling map-less tokens share one
`gpEditorLines` range; the pre-existing silent drop of raw inline HTML in
headings; softbreaks joining to spaces on first save (multi-line paragraphs
become one line; idempotent after); ordered-list delimiter (`1.` vs `1)`)
not captured (no occurrence in either book); multi-token wrapper pairing
(phase 2.5) and the atom-chrome `white-space` polish, both above.

## Appendix A — measurement harness

Committed at `packages/desktop/tests/editor/plugin-book-roundtrip.manual.ts`
(the `.manual.ts` name keeps it out of `bun test`). From `packages/desktop`:

```
bun tests/editor/plugin-book-roundtrip.manual.ts <book-dir> [plugin.js]
```

For the field guide the plugin path defaults to
`../dc-design-guide/plugins/dimm-city-plugin.js` beside the book. The plugin
exports `default` + `metadata` only (no `css` export — the harness's
`css: mod.css` is deliberately tolerant of `undefined`). The harness verifies
determinism before measuring; a non-deterministic plugin invalidates the run.

The edit-cycle companion (`plugin-book-edit-cycle.manual.ts`, same CLI shape)
goes beyond parse/serialize: it applies a real ProseMirror transaction
(mid-paragraph `insertText`) to every chapter's normal form and requires the
save to be EXACTLY the edit — one changed line differing only by the
insertion, wrapper marker lines untouched for the inside-a-styled-block
variant, and the edited bytes their own normal form.

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
`<div class="dc-toc">…</div>` are gone from the normalized render; the curly
apostrophe is the §6.1 defect riding along.

## Appendix C — file / symbol map

| Piece | Location |
| --- | --- |
| Block-rule stamp (pattern to mirror) | `packages/cli/src/lib/markdown/plugin-provenance.ts` — `withBlockRuleProvenance`, `GP_EDITOR_LINES`, `REGISTRATION_METHODS` |
| Plugin apply window (the seam) | `packages/cli/src/lib/markdown/renderer.ts:209-229` — `applyPlugins` (re-exported by `plugins.ts`) |
| Generated-content retag | `packages/desktop/src/lib/editor/markdown-doc/renderer.ts` — `editor_tag_generated` |
| Facade + adoption + refusal | `packages/desktop/src/lib/editor/markdown-doc/parser.ts` — facade :505-508, `handled`-skip :131, `adoptHtmlWrappers` :279-338, `adoptPluginTokens`, `referenceLabels` raise precedent :524-531 |
| Generic nodes | `schema.ts` — `pluginBlock()` (tag+attrs around content), `pluginAtom()` (visible atom chrome) |
| Verbatim write-back | `serializer.ts` — `gp_plugin_block`, `gp_plugin_atom`, `gp_generated() {}`; default list rules spread at :100-102 |
| Loose-list double-blank emitter (§6.2) | `prosemirror-markdown` `MarkdownSerializerState.renderList` — same-type `flushClose(3)` |
| The real-world consumer | `dc-op-manual/dc-design-guide/plugins/dimm-city-plugin.js` — `dc_alerts` + `dimm_city_transform` (732/755 on `main`, 766/789 restored), `makeToken` (84 × `html_block`, `map: null`), the synthesized `inline` in `dc_alerts`, `parseMarker` + `i += 2` consumption |
| Go/no-go gate to extend | `docs/fixtures/advanced-book` + `packages/desktop/tests/editor/plugin-roundtrip.test.ts` (exclusion filter :52, throwaway-plugin pattern :169-259, never-leaks scan :109-117) |
| Corpus gate (hard asserts) | `packages/desktop/tests/editor/markdown-doc-corpus.test.ts` (:125, :147) |
| Acceptance harness | `packages/desktop/tests/editor/plugin-book-roundtrip.manual.ts` |
| Edit-cycle harness | `packages/desktop/tests/editor/plugin-book-edit-cycle.manual.ts` |
| Cross-pair barrier | `parser.ts` — `CoreWrapperCandidate` `"barrier"` kind, `pairCoreWrapperRegions`; regression tests in `core-provenance.test.ts` ("BARRIERS later pairing", "AUTHORED lone-tag") |
