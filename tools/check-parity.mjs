#!/usr/bin/env node
// tools/check-parity.mjs — SFE-P3d-parity standing gate.
//
// Run specification: docs/plans/source-first-editor/runs/SFE-P3d-parity.md
// Binding decisions: docs/plans/source-first-editor-enterprise-refactor.md
//   D8  — after P3 parity the preview keeps navigation/selection/copy/open
//         link-image/diagnostics/page-controls/source-reveal only; every
//         mutation-capable action must have moved to a source/rich command.
// Guardrails: docs/plans/source-first-editor/pr158-lessons.md
//   G-01/AP-01 — parity is proven by EXERCISING the replacement, never by
//         asserting it exists.
//   AP-21      — an empty/vacuous result is a fixture error, never a silent
//         pass: an empty EXTRACTED action set is always a FAIL, not "nothing
//         to check".
//   G-12/AP-20 — a gate must prove it ran and prove it can fail (see
//         tools/check-parity.test.mjs for the sabotage proofs).
//
// ─────────────────────────────────────────────────────────────────────────
// WHAT "DERIVED" MEANS HERE (read this before touching the extraction code)
// ─────────────────────────────────────────────────────────────────────────
// The run specification is explicit: "A literal array of action names
// hard-coded in the checker IS NOT AN EXTRACTION." This file does not
// hard-code the set of mutation-capable preview actions anywhere. Instead it
// performs real (if intentionally shallow — see LIMITATIONS below) static
// analysis of the two live source files:
//
//   packages/desktop/src/lib/routes/context-menu-controller.svelte.ts
//   packages/desktop/src/lib/routes/inline-edit-controller.svelte.ts
//
// CONTEXT-MENU EXTRACTION ALGORITHM
//   1. Build a "code mask" over the file that blanks out string and comment
//      content (so brace/identifier scanning never trips on a `{`/`}`
//      appearing inside a doc-comment or a quoted literal).
//   2. Scan for every object-literal span (`{ ... }`) that directly declares
//      BOTH an `id` property and a `run` property at the same nesting depth
//      — i.e. every `ContextMenuItem` literal, whether its `run` closure is
//      inline or its `id` is a plain string literal or a destructured
//      shorthand (`{ id, label, kind }`) fed by an array the item is built
//      from via `.map()`.
//   3. Separately parse every `private`/`public` method body in the class
//      and compute which methods REACH the commit path — seeded by methods
//      whose OWN body (nested item-literal `run` closures excluded, so a
//      method that merely CONSTRUCTS other items is not conflated with a
//      method that ITSELF calls the commit path) contains a call to
//      `commitEngine.commitRangePatch(`, then closed one hop by "any method
//      that calls `this.<seed method>` — a bare reference counts, not only a
//      direct call, so `run: this.helperEdit.bind(this)` reaches exactly
//      like `run: () => this.helperEdit()` does" (this file's real shape
//      needs only one hop — `commit()` is the seed, `promptEditMarkerLine()`
//      is the one method that calls it — but the closure is computed to a
//      fixed point so a future multi-hop helper chain is still found).
//      SFE-P3d-parity repair round 1 (CONFIRMED finding): also seeded by any
//      `this.deps.<name>(` call whose `<name>` is NOT in the small,
//      maintained `READ_ONLY_DEPENDENCY_METHODS` allowlist below — a
//      constructor-injected dependency (`ContextMenuDeps`) is, by
//      construction, invisible to the method-name call graph, and the one
//      real case (`block-edit`'s `this.deps.openInlineEdit(...)`) used to
//      reach the gate ONLY because `inline-edit-controller.svelte.ts`
//      independently yields the same synthetic id — a NEW dependency
//      callback that mutates would have been silently invisible from this
//      file's own extraction. The allowlist is fail-safe in the unsafe
//      direction: an unrecognized dependency method is treated as
//      commit-reaching by default, not the reverse.
//   4. An item literal is a MUTATION-CAPABLE ACTION when its own `run` text
//      contains `this.commit(`/`commitRangePatch(` directly, references
//      `this.<method>` for a method found reachable in step 3, or calls
//      `this.deps.<name>(` for a `<name>` outside the read-only allowlist.
//   4a. RESIDUAL CALL-SITE ACCOUNTING (SFE-P3d-parity repair round 1,
//      CONFIRMED finding — closes the "an ordinary TypeScript shape this
//      shallow scanner doesn't recognize makes the whole action silently
//      vanish" failure mode independently of steps 2-4 above): after
//      extraction, this file separately re-scans the WHOLE (masked) source
//      for every real-code occurrence of `commitRangePatch(` / `this.commit(`
//      and asserts each one falls inside EITHER a recognized method body
//      (step 3) OR an item's extracted `run` value span (step 2/4). A hit
//      that falls in neither — a method-shorthand `run() {...}` (no `:`,
//      never recognized as a property value), a modifier-less helper method
//      (step 3 requires `private`/`public`/`protected`), a class-field arrow
//      (`x = () => {...}` is not `IDENT(...)`), a bare module-level
//      function, or a `run` built by object-spread (`{ ...BASE, run: ... }`,
//      which has no `id` at the spread's own depth so step 2 never records
//      it) — is a REAL, LOUD gate failure (RULE 1b), never a silent pass.
//      This is deliberately independent of, and does not require, widening
//      steps 2/3 to recognize every one of those shapes by name: the run's
//      binding constraint is "cannot silently vanish", and a hard FAIL that
//      names the orphan call site's file:line satisfies that even where this
//      scanner cannot also produce a clean action id for it (see LIMITATIONS).
//   5. For an item literal with a LITERAL string id, that string is the
//      action id. For a SHORTHAND id (`{ id, ... }` fed by `.map()`), the
//      nearest enclosing `IDENTIFIER.map(` call is found, `IDENTIFIER`'s own
//      array-literal declaration is located elsewhere in the file, and every
//      `id: "…"` entry inside THAT array becomes an action id — this is what
//      lets `FORMAT_KINDS`' four entries (bold/italic/strike/code) surface
//      as four actions from one shared `.map()` call site, and is exactly
//      the mechanism that makes a FIFTH entry added to `FORMAT_KINDS` (or a
//      wholly new literal-id item elsewhere) appear in the extracted set
//      with no change to this file.
//
// INLINE-EDIT-CONTROLLER EXTRACTION
//   `InlineEditController` has no per-action `id` — it is ONE mutation
//   surface (the in-flow "edit this block" free-text path). Extraction here
//   is simpler and equally real: does a private method's body (again, code-
//   masked) contain a call to `commitEngine.commitRangePatch(`? If yes, the
//   synthetic action id `block-edit` is extracted, carrying the file:line of
//   the real call site as evidence it was not invented.
//
// LIMITATIONS (stated plainly rather than silently assumed away — SFE-P3d-parity's
// own instructions: "If a lane finds the extraction cannot be made reliable
// … it reports that rather than falling back to a hand-list and calling it
// derived". Corrected by SFE-P3d-parity repair round 1 (CONFIRMED finding):
// this section previously made two claims that were false the day it was
// written — see git history for the original text — and understated how far
// a real TypeScript shape could defeat the scanner. Both are fixed below.):
//   - This is a string/brace-balance scanner, not a real TypeScript parser.
//     It correctly skips `//` and `/* */` comments and `'`/`"`/`` ` ``
//     string content (including escapes) for the purpose of brace/paren
//     matching, but does not model template-literal `${…}` interpolation
//     depth. `context-menu-controller.svelte.ts` DOES contain a code-bearing
//     template literal today (inside the `FORMAT_KINDS.map()` callback,
//     `` `This selection already contains ${label.toLowerCase()} formatting.` ``
//     — a disabled-reason string, not inside a comment). Extraction survives
//     it only because that literal is brace-balanced and has no nested
//     backtick, so the naive "scan to the next same-quote character" string
//     handling still finds the true closing backtick and blanks the whole
//     span uniformly — a template literal that itself contained a nested
//     backtick (a tagged template, or one embedding another template) would
//     not be handled correctly. A fixture in check-parity.test.mjs now
//     exercises exactly this shape (a code-bearing, interpolated template
//     literal inside a commit-reaching item's `run` closure) and asserts the
//     action is still extracted.
//   - The array-resolution step (§5 above) finds the id array via the
//     identifier name immediately before `.map(` and a same-name `= [`
//     declaration elsewhere in the file. A shorthand-id item fed by
//     anything other than a locally-declared array literal (e.g. an
//     imported array, or a `.filter().map()` chain) would not resolve — none
//     of that shape exists in the current file, and if introduced, this
//     checker's liveness/notes output makes the miss visible rather than
//     silently under-counting (an item flagged commit-reaching with an
//     unresolved shorthand id is reported as a NOTE and still fails the
//     "has no matrix mapping" rule under a synthetic placeholder id).
//   - The commit-reachability closure is call-graph analysis over METHOD
//     NAMES textually, not real binding resolution. This is the same
//     "spirit of check-render-purity.mjs" string-scan posture the sibling
//     check-architecture.mjs documents for its own import-specifier scan.
//   - RESIDUAL CALL-SITE ACCOUNTING (rule 1b, added by SFE-P3d-parity repair
//     round 1) is what actually backs a "cannot silently vanish" claim now —
//     NOT the shape of steps 2-4 alone. An adversarial verification pass
//     (repair round 1) constructed six ordinary TypeScript shapes that each
//     independently made steps 2-4 alone extract ZERO actions for a real
//     commit-reaching item, with the gate exiting 0: a method-shorthand
//     `run() {...}` property, a modifier-less helper method, a class-field
//     arrow property, a module-level free function invoked from `run`, an
//     object-spread-built item (`{ ...BASE, run: ... }`, `id` supplied by
//     the spread), and a bound method reference (`run: this.helperEdit.bind(this)`
//     — this LAST one is now additionally fixed at the step-3/4 level by
//     widening the reachability test from `this\.<name>\(` to the bare
//     `this\.<name>` reference, so it gets a real action id, not just a
//     residual failure). Rule 1b (see step 4a above) catches the other five
//     as loud gate failures naming the orphan call site — it does NOT give
//     them a clean action id or a matrix row of their own; a human must add
//     one to clear the failure. This is a materially WEAKER guarantee than
//     "every shape is correctly identified", and is stated as such rather
//     than reasserting the stronger claim the original text made.
//   - STILL NOT COVERED, disclosed rather than silently assumed: a mutation
//     reached only through a constructor-injected dependency callback whose
//     OWN implementation lives in a DIFFERENT file — i.e. `this.deps.<name>(...)`
//     where `<name>` is outside `READ_ONLY_DEPENDENCY_METHODS` — is treated
//     as commit-reaching (step 3), but if the real mutation lived behind a
//     dependency name this checker cannot see calling `commitRangePatch(`
//     nowhere in either of the two scanned files (imagine a THIRD file
//     entirely), rule 1b's residual scan — which only re-scans the same two
//     files' own text — would not find a local call site to flag either.
//     Cross-file dependency-injection reachability is not implemented; a
//     genuinely new mutation surface introduced entirely through a
//     dependency call whose body the two scanned files never locally
//     reference `commitRangePatch(`/`this.commit(` in is a known gap, not a
//     silently-assumed non-issue.
//
// Usage:  node tools/check-parity.mjs [--root <path>]
//   --root defaults to the repository root (two levels up from this file).
//   Self-tests pass a temp-dir fixture via --root so no rule ever touches
//   the live repository during a test run.
//
// Exit codes (matching tools/check-architecture.mjs's convention):
//   0 — every rule passed (WARNs allowed).
//   1 — at least one rule found a real violation.
//   2 — usage/internal error (missing files, unreadable root, unparsable
//       matrix).
//
// Dependency-free (Node built-ins only) by design.
// Tested by tools/check-parity.test.mjs (node tools/check-parity.test.mjs).
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

const CONTEXT_MENU_REL = join("packages", "desktop", "src", "lib", "routes", "context-menu-controller.svelte.ts");
const INLINE_EDIT_REL = join("packages", "desktop", "src", "lib", "routes", "inline-edit-controller.svelte.ts");
const MATRIX_REL = join("docs", "plans", "source-first-editor", "parity-matrix.md");
const KNOWN_COMMAND_FILES = {
  "toolbar-actions.ts": join("packages", "desktop", "src", "lib", "editor", "toolbar-actions.ts"),
  "rich-commands.ts": join("packages", "desktop", "src", "lib", "editor", "rich-commands.ts"),
  "commands.ts": join("packages", "editor", "src", "core", "commands.ts"),
};
// Sentinel replacement identifiers for "the surface is the editor's own
// always-available direct-text-edit capability" — not a named exported
// function, so existence is definitional rather than grep-checked; still
// subject to the "must have test evidence" rule below.
const DIRECT_EDIT_SENTINELS = new Set(["source-editor#direct-text-edit", "rich-editor#direct-text-edit"]);

function repoRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function parseArgs(argv) {
  let root;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root") root = argv[++i];
    else if (arg.startsWith("--root=")) root = arg.slice("--root=".length);
  }
  return { root };
}

// ---------------------------------------------------------------------------
// Code-aware scanning primitives (comments/strings masked out)
// ---------------------------------------------------------------------------

// SFE-P3d-parity repair round 1 (CONFIRMED finding, fail-open sabotage
// proof): a regex literal whose character class holds an UNPAIRED quote
// (e.g. `const APOS = /['"]/g;`) is invisible to this scanner — it has no
// notion of a regex literal at all — so the stray `'`/`"` inside it opens a
// PHANTOM string that this naive "scan to the next same-quote character"
// logic then hunts for the close of, potentially swallowing the rest of the
// file (every subsequent brace, item literal, and method body) as fake
// string content while reporting nothing wrong. Full regex-literal detection
// (division-vs-regex disambiguation) is real-parser territory this
// dependency-free scanner deliberately does not attempt (see LIMITATIONS).
// What IS cheap and reliable: a well-formed TypeScript/Svelte source file
// never legitimately ends mid-string or mid-block-comment — reaching EOF
// while still "inside" one is always anomalous, and a phantom string opened
// by a stray quote inside a regex character class either (a) never finds a
// same-quote character again before EOF (this scanner's fixture below), or
// (b) happens to close somewhere later, in which case the RESULT is
// silently wrong data rather than a crash — case (a) this function catches
// directly; case (b) is exactly why rule 1b's residual call-site accounting
// (see this file's header) exists as a second, independent line of defense
// that does not depend on the mask being correct in the first place.
// Returns `{ mask, unterminated }` — `unterminated` is `null` when the scan
// completed cleanly, or `{ kind, start }` (line-reportable via `lineOf`)
// naming the first string/comment span that never found its terminator.
function buildMask(text) {
  const n = text.length;
  const mask = new Uint8Array(n); // 1 = real code, 0 = string/comment content
  let unterminated = null;
  let i = 0;
  while (i < n) {
    const c = text[i];
    const c2 = text[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && text[i] !== "\n") {
        mask[i] = 0;
        i++;
      }
      continue;
    }
    if (c === "/" && c2 === "*") {
      const spanStart = i;
      mask[i] = 0;
      mask[i + 1] = 0;
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        mask[i] = 0;
        i++;
      }
      if (i < n) {
        mask[i] = 0;
        mask[i + 1] = 0;
        i += 2;
      } else if (!unterminated) {
        unterminated = { kind: "comment", start: spanStart };
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      const spanStart = i;
      mask[i] = 0;
      i++;
      while (i < n && text[i] !== quote) {
        if (text[i] === "\\" && i + 1 < n) {
          mask[i] = 0;
          mask[i + 1] = 0;
          i += 2;
          continue;
        }
        mask[i] = 0;
        i++;
      }
      if (i < n) {
        mask[i] = 0;
        i++;
      } else if (!unterminated) {
        unterminated = { kind: "string", start: spanStart };
      }
      continue;
    }
    mask[i] = 1;
    i++;
  }
  return { mask, unterminated };
}

// A SEPARATE mask from buildMask(): blanks ONLY `//`/`/* */` comment
// content, leaving string-literal content at mask=1 ("real code"). Needed
// because buildMask() deliberately blanks BOTH comments AND string content
// (so brace-matching never trips on a brace that happens to sit inside a
// quoted string) — which means it cannot be reused to answer "does this
// quoted literal appear in REAL CODE (as opposed to only inside a comment
// mentioning it)?": every quoted literal is mask=0 under buildMask() by
// construction. commandExists() needs exactly the opposite distinction.
function buildCommentOnlyMask(text) {
  const n = text.length;
  const mask = new Uint8Array(n).fill(1);
  let i = 0;
  while (i < n) {
    const c = text[i];
    const c2 = text[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && text[i] !== "\n") {
        mask[i] = 0;
        i++;
      }
      continue;
    }
    if (c === "/" && c2 === "*") {
      mask[i] = 0;
      mask[i + 1] = 0;
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        mask[i] = 0;
        i++;
      }
      if (i < n) {
        mask[i] = 0;
        mask[i + 1] = 0;
        i += 2;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      // Skip over string content WITHOUT blanking it (it stays mask=1) —
      // only its role here is "don't let a `//`/`/*` inside a string start
      // a fake comment span".
      const quote = c;
      i++;
      while (i < n && text[i] !== quote) {
        if (text[i] === "\\" && i + 1 < n) {
          i += 2;
          continue;
        }
        i++;
      }
      if (i < n) i++;
      continue;
    }
    i++;
  }
  return mask;
}

function isIdentStart(ch) {
  return /[A-Za-z_$]/.test(ch);
}
function isIdentPart(ch) {
  return /[A-Za-z0-9_$]/.test(ch);
}

function findBalanced(text, mask, openIdx, openCh, closeCh) {
  let depth = 0;
  const n = text.length;
  for (let i = openIdx; i < n; i++) {
    if (mask[i] !== 1) continue;
    if (text[i] === openCh) depth++;
    else if (text[i] === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Finds every `{ ... }` object-literal span that directly (same depth)
// declares both an `id` and a `run` property. Returns id/run property
// descriptors with resolved value spans.
function findItemLiterals(text, mask) {
  const n = text.length;
  const stack = [];
  const results = [];
  // Every `{ ... }` that is a DIRECT ELEMENT of an array literal (`[ {...},
  // {...} ]`), regardless of what properties it has or whether it parses as
  // a recognized `id`+`run` item — SFE-P3d-parity repair round 1 (CONFIRMED
  // finding, shapes A/E: a method-shorthand `run() {...}` property is never
  // registered as a "run" key at all — the preceding `async` keyword eats
  // the key-position check — and an object-spread-built item has no `id` at
  // its own depth — so neither is a `results` entry, yet BOTH are still
  // array elements this enclosing method (`buildItems()`) merely
  // CONSTRUCTS, not implements). Used below to strip every array-element
  // object wholesale before computing commit-reachability, so an
  // unrecognized item's leaked internal call site can never make its
  // CONTAINER method look like a genuine commit-reaching implementation —
  // which would wrongly exempt that exact call site from residual
  // accounting (header step 4a) precisely because of the gap it is
  // evidence of.
  const arrayElementObjectSpans = [];
  let i = 0;
  while (i < n) {
    if (mask[i] !== 1) {
      i++;
      continue;
    }
    const c = text[i];
    if (c === "{" || c === "(" || c === "[") {
      const parent = stack.length > 0 ? stack[stack.length - 1] : null;
      stack.push({ ch: c, start: i, props: new Map(), isArrayElement: c === "{" && !!parent && parent.ch === "[" });
      i++;
      continue;
    }
    if (c === "}" || c === ")" || c === "]") {
      const frame = stack.pop();
      if (frame && frame.ch === "{" && c === "}") {
        if (frame.isArrayElement) arrayElementObjectSpans.push({ start: frame.start, end: i + 1 });
        if (frame.props.has("id") && frame.props.has("run")) {
          results.push({ start: frame.start, end: i, idProp: frame.props.get("id"), runProp: frame.props.get("run") });
        }
      }
      i++;
      continue;
    }
    if (isIdentStart(c) && stack.length > 0 && stack[stack.length - 1].ch === "{") {
      let b = i - 1;
      while (b >= 0 && /\s/.test(text[b])) b--;
      const prevCh = b >= 0 ? text[b] : "";
      const isKeyPos = prevCh === "{" || prevCh === ",";
      let j = i;
      while (j < n && isIdentPart(text[j])) j++;
      const name = text.slice(i, j);
      if (isKeyPos) {
        let k = j;
        while (k < n && /\s/.test(text[k])) k++;
        const frame = stack[stack.length - 1];
        if (text[k] === ":") {
          let vStart = k + 1;
          while (vStart < n && /\s/.test(text[vStart])) vStart++;
          frame.props.set(name, { kind: "colon", valueStart: vStart, valueEnd: null });
          frame._pendingPropName = name;
        } else {
          frame.props.set(name, { kind: "shorthand" });
        }
      }
      i = j;
      continue;
    }
    if (c === "," && stack.length > 0 && stack[stack.length - 1].ch === "{") {
      const frame = stack[stack.length - 1];
      if (frame._pendingPropName) {
        const prop = frame.props.get(frame._pendingPropName);
        if (prop && prop.valueEnd == null) prop.valueEnd = i;
        frame._pendingPropName = null;
      }
      i++;
      continue;
    }
    i++;
  }
  for (const r of results) {
    for (const prop of [r.idProp, r.runProp]) {
      if (prop && prop.kind === "colon" && prop.valueEnd == null) prop.valueEnd = r.end;
    }
  }
  return { results, arrayElementObjectSpans };
}

// Finds every `private`/`public`/`protected` class method's body span.
function findMethodBodies(text, mask) {
  const methods = [];
  const sigRe = /\b(private|public|protected)\s+(static\s+)?(async\s+)?([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = sigRe.exec(text))) {
    if (mask[m.index] !== 1) continue;
    const name = m[4];
    const parenOpen = m.index + m[0].length - 1;
    let depth = 0;
    let i = parenOpen;
    const n = text.length;
    for (; i < n; i++) {
      if (mask[i] !== 1) continue;
      if (text[i] === "(") depth++;
      else if (text[i] === ")") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    while (i < n && !(mask[i] === 1 && text[i] === "{")) i++;
    if (i >= n) continue;
    const bodyStart = i;
    let bdepth = 0;
    let j = i;
    for (; j < n; j++) {
      if (mask[j] !== 1) continue;
      if (text[j] === "{") bdepth++;
      else if (text[j] === "}") {
        bdepth--;
        if (bdepth === 0) {
          j++;
          break;
        }
      }
    }
    methods.push({ name, bodyStart, bodyEnd: j });
  }
  return methods;
}

function resolveShorthandArrayIds(text, mask, itemStart) {
  const mapRe = /\.map\s*\(/g;
  let m;
  let best = null;
  while ((m = mapRe.exec(text))) {
    if (mask[m.index] !== 1) continue;
    const parenOpen = m.index + m[0].length - 1;
    const parenClose = findBalanced(text, mask, parenOpen, "(", ")");
    if (parenClose === -1) continue;
    if (parenOpen < itemStart && itemStart < parenClose) {
      if (!best || m.index > best.mapIndex) best = { mapIndex: m.index };
    }
  }
  if (!best) return null;
  let b = best.mapIndex - 1;
  while (b >= 0 && /[A-Za-z0-9_$.]/.test(text[b])) b--;
  const baseExpr = text.slice(b + 1, best.mapIndex);
  const arrayName = baseExpr.split(".").pop();
  if (!arrayName) return null;
  const declRe = new RegExp(`\\b${arrayName}\\b[^=]*=\\s*\\[`, "g");
  let dm;
  while ((dm = declRe.exec(text))) {
    if (mask[dm.index] !== 1) continue;
    const bracketOpen = dm.index + dm[0].length - 1;
    const bracketClose = findBalanced(text, mask, bracketOpen, "[", "]");
    if (bracketClose === -1) continue;
    const arrText = text.slice(bracketOpen, bracketClose + 1);
    const ids = [...arrText.matchAll(/\bid\s*:\s*"([^"]+)"/g)].map((x) => x[1]);
    if (ids.length > 0) return { arrayName, ids };
  }
  return null;
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

// `ContextMenuDeps` methods known to be read-only/non-mutating (see header
// step 3) — a MAINTAINED ALLOWLIST, not a blocklist: a `this.deps.<name>(`
// call whose `<name>` is NOT in this set is treated as commit-reaching by
// default. This is the fail-safe direction — a newly added dependency
// method starts out "suspect" until proven read-only and added here, rather
// than starting out invisible to the gate. Kept in sync by hand with
// `ContextMenuDeps` in context-menu-controller.svelte.ts; a fixture in
// check-parity.test.mjs exercises what happens when a call falls OUTSIDE it.
const READ_ONLY_DEPENDENCY_METHODS = new Set([
  "client",
  "enabled",
  "rendering",
  "currentDir",
  "openContent",
  "readFile",
  "getIframeOrigin",
  "getWorkspaceRect",
  "promptText",
  "promptImageProperties",
  "goToSource",
  "openMediaPanel",
  "copyToClipboard",
  "toastSuccess",
  "toastError",
]);

// ---------------------------------------------------------------------------
// Residual call-site accounting (SFE-P3d-parity repair round 1, CONFIRMED
// finding — header step 4a). Independent of the item/method-shape scanning
// above: re-scans the WHOLE masked file for every real-code
// `commitRangePatch(` / `this.commit(` call site and reports any that fall
// OUTSIDE both a recognized method body and an extracted item's `run` value
// span. This is what turns "an ordinary shape this scanner doesn't
// recognize" into a loud gate failure instead of a silent miscount — it
// does not need to understand WHY a call site is orphaned (method-shorthand,
// missing modifier, arrow field, spread, module-level function — see
// LIMITATIONS), only THAT it is.
// ---------------------------------------------------------------------------

function findResidualCallSites(text, mask, methods, attributedSpans, relPath, patterns = [/commitRangePatch\s*\(/g, /this\.commit\s*\(/g]) {
  const residual = [];
  const seen = new Set(); // dedupe by start index — a site can match at most one pattern, but guard anyway
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) {
      const idx = m.index;
      if (mask[idx] !== 1) continue; // inside a string/comment — not real code
      if (seen.has(idx)) continue;
      seen.add(idx);
      const inMethod = methods.some((meth) => idx >= meth.bodyStart && idx < meth.bodyEnd);
      const inExtractedSpan = attributedSpans.some((span) => idx >= span.start && idx < span.end);
      if (inMethod || inExtractedSpan) continue;
      residual.push({ file: relPath, line: lineOf(text, idx), snippet: m[0] });
    }
  }
  return residual;
}

// ---------------------------------------------------------------------------
// Extraction: context-menu-controller.svelte.ts
// ---------------------------------------------------------------------------

function extractContextMenuActions(root) {
  const relPath = CONTEXT_MENU_REL;
  const absPath = join(root, relPath);
  if (!existsSync(absPath)) {
    return { error: `context-menu source file not found: ${relPath}` };
  }
  const text = readFileSync(absPath, "utf8");
  const { mask, unterminated } = buildMask(text);
  if (unterminated) {
    return {
      error:
        `${relPath}: the code-mask scanner reached end of file still inside an unterminated ${unterminated.kind} ` +
        `starting at line ${lineOf(text, unterminated.start)} — likely a regex literal containing an unpaired quote ` +
        `(this scanner has no notion of regex literals; see buildMask()'s header). Extraction results cannot be ` +
        `trusted while this holds; fix the source (or, if this really is a regex literal, teach buildMask about it).`,
    };
  }
  const { results: items, arrayElementObjectSpans } = findItemLiterals(text, mask);
  const methods = findMethodBodies(text, mask);

  // Strip nested item-literal spans out of method bodies before seeding the
  // commit-reachability set, so a BUILDER method that merely constructs
  // items (whose closures happen to call the commit path when LATER
  // invoked) is not conflated with a method that calls the commit path
  // itself when the builder runs. See header §3. Two sources, covering
  // every item shape regardless of whether it parsed as a recognized
  // `id`+`run` item:
  //   - every DIRECT ARRAY ELEMENT object (`arrayElementObjectSpans` —
  //     `buildItems()`'s own `[ {...}, {...} ]` return) is stripped WHOLESALE,
  //     recognized or not — this is what keeps an unrecognized item (a
  //     method-shorthand `run() {...}`, shape A; an object-spread-built
  //     item, shape E) from leaking its internal call site into its
  //     CONTAINER method's reachability, which would wrongly exempt that
  //     exact call site from residual accounting (header step 4a).
  //   - every RECOGNIZED item's `run:` value span (`items`) is ALSO
  //     stripped — needed for an item that is NOT a direct array element,
  //     e.g. the `FORMAT_KINDS.map()` callback's `return { ... }`.
  const stripped = text.split("");
  for (const span of arrayElementObjectSpans) {
    for (let k = span.start; k < span.end; k++) stripped[k] = " ";
  }
  for (const it of items) {
    if (it.runProp.kind === "colon") {
      for (let k = it.runProp.valueStart; k < it.runProp.valueEnd; k++) stripped[k] = " ";
    }
  }
  const strippedText = stripped.join("");

  // A bare `this.<name>` REFERENCE counts as reaching, not only a direct
  // `this.<name>(` CALL — SFE-P3d-parity repair round 1 (CONFIRMED finding):
  // `run: this.helperEdit.bind(this)` reaches `helperEdit` exactly like
  // `run: () => this.helperEdit()` does; the old `\(` suffix requirement
  // silently missed it. See header step 3.
  const reachesThisRef = (target, body) => new RegExp(`\\bthis\\.${target}\\b`).test(body);

  const reachesCommit = new Set();
  for (const meth of methods) {
    const body = strippedText.slice(meth.bodyStart, meth.bodyEnd);
    if (/commitRangePatch\s*\(/.test(body)) reachesCommit.add(meth.name);
    // Constructor-dependency seed (header step 3): a call through
    // `this.deps.<name>(` where `<name>` is outside the read-only
    // allowlist is treated as commit-reaching too — a DI callback is
    // invisible to method-name call-graph analysis otherwise.
    const depCallRe = /this\.deps\.([A-Za-z_$][\w$]*)\s*\(/g;
    let dm;
    while ((dm = depCallRe.exec(body))) {
      if (!READ_ONLY_DEPENDENCY_METHODS.has(dm[1])) {
        reachesCommit.add(meth.name);
        break;
      }
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const meth of methods) {
      if (reachesCommit.has(meth.name)) continue;
      const body = strippedText.slice(meth.bodyStart, meth.bodyEnd);
      for (const target of reachesCommit) {
        if (reachesThisRef(target, body)) {
          reachesCommit.add(meth.name);
          changed = true;
          break;
        }
      }
    }
  }

  const actions = new Map(); // id -> [{ file, line }]
  const notes = [];
  const extractedRunSpans = []; // { start, end } — residual accounting exemption (header step 4a)
  for (const it of items) {
    const runText = it.runProp.kind === "colon" ? text.slice(it.runProp.valueStart, it.runProp.valueEnd) : "";
    let reaches = /this\.commit\s*\(/.test(runText) || /commitRangePatch\s*\(/.test(runText);
    if (!reaches) {
      for (const target of reachesCommit) {
        if (target === "commit") continue;
        if (reachesThisRef(target, runText)) {
          reaches = true;
          break;
        }
      }
    }
    if (!reaches) {
      // A `this.deps.<name>(` call outside the read-only allowlist, made
      // DIRECTLY from the item's own run text (not via a helper method) —
      // same rule as the seeding step above, applied here too so an item
      // that calls the dependency inline (not through a private helper)
      // is not missed.
      const depCallRe = /this\.deps\.([A-Za-z_$][\w$]*)\s*\(/g;
      let dm;
      while ((dm = depCallRe.exec(runText))) {
        if (!READ_ONLY_DEPENDENCY_METHODS.has(dm[1])) {
          reaches = true;
          break;
        }
      }
    }
    if (!reaches) continue;
    if (it.runProp.kind === "colon") extractedRunSpans.push({ start: it.runProp.valueStart, end: it.runProp.valueEnd });
    const line = lineOf(text, it.start);
    if (it.idProp.kind === "colon") {
      const raw = it.idProp.valueStart != null ? text.slice(it.idProp.valueStart, it.idProp.valueEnd).trim() : "";
      const litMatch = raw.match(/^["']([^"']+)["']$/);
      if (litMatch) {
        const id = litMatch[1];
        if (!actions.has(id)) actions.set(id, []);
        actions.get(id).push({ file: relPath, line });
      } else {
        // A commit-reaching item whose id is a non-literal expression this
        // scanner cannot resolve. Surfaced explicitly (never silently
        // dropped) as a synthetic id carrying its own location, so the
        // "has no matrix mapping" rule still catches it.
        const id = `unresolved-id@${relPath}:${line}`;
        actions.set(id, [{ file: relPath, line }]);
        notes.push(`commit-reaching item at ${relPath}:${line} has a non-literal, non-shorthand id expression (${JSON.stringify(raw)}) — extracted under synthetic id "${id}"`);
      }
    } else {
      const resolved = resolveShorthandArrayIds(text, mask, it.start);
      if (resolved && resolved.ids.length > 0) {
        for (const id of resolved.ids) {
          if (!actions.has(id)) actions.set(id, []);
          actions.get(id).push({ file: relPath, line });
        }
      } else {
        const id = `unresolved-shorthand-id@${relPath}:${line}`;
        actions.set(id, [{ file: relPath, line }]);
        notes.push(`commit-reaching item at ${relPath}:${line} has a shorthand "id" property whose feeding array could not be resolved — extracted under synthetic id "${id}"`);
      }
    }
  }

  // Residual accounting (header step 4a) must NOT exempt a call site merely
  // for sitting somewhere inside a CONTAINER method's textual span — every
  // item literal `buildItems()`/`buildFormatItems()` return is nested
  // INSIDE that method's own body, so a blanket "any recognized method
  // body" exemption would silently re-swallow exactly the shapes this rule
  // exists to catch (an unrecognized item nested inside `buildItems()`,
  // e.g. a method-shorthand `run` or a spread-built item, sits textually
  // inside `buildItems`'s span even though `buildItems` itself never calls
  // commit directly). Narrowed to methods actually IN `reachesCommit` — a
  // real implementation method (seeded directly, or reached via the
  // `this.<name>`/`this.deps.<name>` closure above) — so a pure item-literal
  // CONTAINER provides no blanket exemption; only an extracted item's own
  // run span (attributedSpans) or a genuinely reaching method's body counts.
  const reachingMethods = methods.filter((meth) => reachesCommit.has(meth.name));
  const residual = findResidualCallSites(text, mask, reachingMethods, extractedRunSpans, relPath);
  return { actions, notes, residual, itemLiteralCount: items.length, methodCount: methods.length };
}

// ---------------------------------------------------------------------------
// Extraction: inline-edit-controller.svelte.ts
// ---------------------------------------------------------------------------

function extractInlineEditActions(root) {
  const relPath = INLINE_EDIT_REL;
  const absPath = join(root, relPath);
  if (!existsSync(absPath)) {
    return { error: `inline-edit source file not found: ${relPath}` };
  }
  const text = readFileSync(absPath, "utf8");
  const { mask, unterminated } = buildMask(text);
  if (unterminated) {
    return {
      error:
        `${relPath}: the code-mask scanner reached end of file still inside an unterminated ${unterminated.kind} ` +
        `starting at line ${lineOf(text, unterminated.start)} — likely a regex literal containing an unpaired quote ` +
        `(this scanner has no notion of regex literals; see buildMask()'s header). Extraction results cannot be ` +
        `trusted while this holds; fix the source (or, if this really is a regex literal, teach buildMask about it).`,
    };
  }
  const methods = findMethodBodies(text, mask);
  const actions = new Map();
  for (const meth of methods) {
    const body = text.slice(meth.bodyStart, meth.bodyEnd);
    const maskedBody = mask.slice(meth.bodyStart, meth.bodyEnd);
    // Re-scan just this method's body with its own mask slice for an
    // un-commented, non-string occurrence of the real call.
    const re = /commitRangePatch\s*\(/g;
    let m;
    while ((m = re.exec(body))) {
      if (maskedBody[m.index] !== 1) continue;
      const line = lineOf(text, meth.bodyStart + m.index);
      if (!actions.has("block-edit")) actions.set("block-edit", []);
      actions.get("block-edit").push({ file: relPath, line });
      break; // one location is enough evidence per method
    }
  }

  // Residual accounting (header step 4a): this file has exactly ONE
  // possible action id ("block-edit"), so a `this.commit(` REFERENCE calling
  // the already-recognized private `commit()` method is not a candidate for
  // a SEPARATE, missed action — it is the same action, reached from another
  // caller (e.g. a default-visibility `endActive(commit: boolean)`, which
  // has no explicit modifier and so is invisible to findMethodBodies —
  // verified live in this file today). Scanning only for bare
  // `commitRangePatch(` here (not `this.commit(`) still catches a genuinely
  // NEW, separate write path that bypasses `commit()` entirely and lives
  // outside any modifier-having method — a modifier-less helper, a
  // class-field arrow, or a bare module-level function.
  const residual = findResidualCallSites(text, mask, methods, [], relPath, [/commitRangePatch\s*\(/g]);
  return { actions, residual, methodCount: methods.length };
}

// ---------------------------------------------------------------------------
// Matrix parsing (docs/plans/source-first-editor/parity-matrix.md)
// ---------------------------------------------------------------------------

// A markdown pipe-table row: splits on unescaped `|`, trims cells, drops the
// leading/trailing empty cells a `| a | b |`-style row produces.
function splitRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const cells = trimmed.split("|").slice(1, -1).map((c) => c.trim());
  return cells;
}

function isSeparatorRow(cells) {
  return cells.every((c) => /^:?-+:?$/.test(c));
}

function parseMatrix(root) {
  const absPath = join(root, MATRIX_REL);
  if (!existsSync(absPath)) {
    return { error: `parity matrix not found: ${MATRIX_REL}` };
  }
  const text = readFileSync(absPath, "utf8");
  const lines = text.split("\n");

  const mapped = []; // { action, replacements: string[], surfaces: string[], evidence: string[], lineNo }
  const waivers = []; // { action, reason, owner, lineNo }

  let section = null; // "mapped" | "waivers" | null
  let headerCells = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = line.match(/^#{2,6}\s+(.*)$/);
    if (heading) {
      const h = heading[1].toLowerCase();
      if (h.includes("mapped action")) {
        section = "mapped";
        headerCells = null;
      } else if (h.includes("waiver")) {
        section = "waivers";
        headerCells = null;
      } else {
        section = null;
        headerCells = null;
      }
      continue;
    }
    if (!section) continue;
    const cells = splitRow(line);
    if (!cells) continue;
    if (isSeparatorRow(cells)) continue;
    if (!headerCells) {
      headerCells = cells.map((c) => c.toLowerCase());
      continue;
    }
    if (section === "mapped") {
      const idx = (name) => headerCells.indexOf(name);
      const actionCell = cells[idx("action")] ?? "";
      const replCell = cells[idx("replacement command(s)")] ?? "";
      const surfaceCell = cells[idx("surface(s)")] ?? "";
      const evidenceCell = cells[idx("test evidence")] ?? "";
      const action = actionCell.replace(/`/g, "").trim();
      if (!action) continue;
      const replacements = replCell
        .split(";")
        .map((s) => s.replace(/`/g, "").trim())
        .filter(Boolean);
      const surfaces = surfaceCell.split(";").map((s) => s.trim()).filter(Boolean);
      const evidence = evidenceCell
        .split(";")
        .map((s) => s.replace(/`/g, "").trim())
        .filter(Boolean);
      mapped.push({ action, replacements, surfaces, evidence, lineNo: i + 1 });
    } else if (section === "waivers") {
      const idx = (name) => headerCells.indexOf(name);
      const actionCell = cells[idx("action")] ?? "";
      const reasonCell = cells[idx("reason")] ?? "";
      const ownerCell = cells[idx("decision owner")] ?? "";
      const action = actionCell.replace(/`/g, "").trim();
      if (!action) continue;
      waivers.push({ action, reason: reasonCell.trim(), owner: ownerCell.trim(), lineNo: i + 1 });
    }
  }
  return { mapped, waivers };
}

// ---------------------------------------------------------------------------
// Rule: replacement command existence
// ---------------------------------------------------------------------------

function commandExists(root, ref) {
  if (DIRECT_EDIT_SENTINELS.has(ref)) return { exists: true, sentinel: true };
  const hashIdx = ref.indexOf("#");
  if (hashIdx === -1) return { exists: false, reason: `malformed reference (expected "file#identifier" or a known sentinel): "${ref}"` };
  const fileKey = ref.slice(0, hashIdx);
  const identifier = ref.slice(hashIdx + 1);
  const relPath = KNOWN_COMMAND_FILES[fileKey];
  if (!relPath) {
    return {
      exists: false,
      reason: `unknown source file "${fileKey}" (known: ${Object.keys(KNOWN_COMMAND_FILES).join(", ")}, or a direct-edit sentinel)`,
    };
  }
  const absPath = join(root, relPath);
  if (!existsSync(absPath)) return { exists: false, reason: `${relPath} does not exist` };
  const text = readFileSync(absPath, "utf8");
  const commentMask = buildCommentOnlyMask(text);
  // Exported symbol form: `export function IDENT`, `export const IDENT`,
  // `export type IDENT`. Guarded against a doc-comment merely NAMING the
  // export (commentMask===1 at the match start means "not inside a
  // comment").
  const exportRe = new RegExp(`\\bexport\\s+(async\\s+)?(function|const|type|interface)\\s+${identifier}\\b`, "g");
  let em;
  while ((em = exportRe.exec(text))) {
    if (commentMask[em.index] === 1) return { exists: true };
  }
  // Quoted-literal form (an EditorCommand `kind` value, a ToolbarAction
  // string, etc.) — require it to appear as a real quoted literal that is
  // itself real code under buildMask() (so this is not, e.g., a bare word
  // match inside an unrelated bigger string) AND not inside a comment.
  const litRe = new RegExp(`["']${identifier}["']`, "g");
  let m;
  while ((m = litRe.exec(text))) {
    // commentMask=1 at the opening quote means this quoted literal is real
    // code (a string literal is untouched by buildCommentOnlyMask — see its
    // header), not text that only appears inside a `//`/`/* */` comment.
    if (commentMask[m.index] === 1) return { exists: true };
  }
  return { exists: false, reason: `"${identifier}" not found as an exported symbol or quoted literal in ${relPath}` };
}

// ---------------------------------------------------------------------------
// Rule: test evidence existence
// ---------------------------------------------------------------------------

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function evidenceExists(root, ref) {
  const sepIdx = ref.indexOf("::");
  if (sepIdx === -1) return { exists: false, reason: `malformed evidence reference (expected "path::test name"): "${ref}"` };
  const relPath = ref.slice(0, sepIdx);
  const testName = ref.slice(sepIdx + 2);
  if (!testName.trim()) return { exists: false, reason: `empty test name in "${ref}"` };
  const absPath = join(root, relPath);
  if (!existsSync(absPath)) return { exists: false, reason: `${relPath} does not exist` };
  const text = readFileSync(absPath, "utf8");
  const escaped = escapeRe(testName);
  const re = new RegExp(`\\b(test(?:\\.each\\([^)]*\\))?|it|describe)\\(\\s*[\`"']${escaped}[\`"']`);
  if (!re.test(text)) {
    return { exists: false, reason: `no test(...)/describe(...) titled "${testName}" found in ${relPath}` };
  }
  return { exists: true };
}

// SFE-P3d-parity repair round 1 (CONFIRMED finding — G-01/AP-01): a cited
// test title existing somewhere in a cited file proves NOTHING about
// whether that test exercises the CITED REPLACEMENT COMMAND — a matrix row
// could cite `locateImagePropertiesAtCaret` as its replacement and a test
// file that imports and exercises only the PURE core module underneath it
// (`caret-token-commands.ts`), never once referencing the named wrapper.
// This is exactly what happened before this repair: three matrix rows
// named ten wrapper functions and every cited test file imported only the
// shared pure module. Requires that AT LEAST ONE evidence file cited for a
// row contain, as real code (not a comment), at least one of that row's
// OWN replacement identifiers — a coarse but real connection between "what
// the row claims replaces the action" and "what the cited test file
// actually imports/calls". Rows whose replacements are ALL sentinels
// (`source-editor#direct-text-edit`/`rich-editor#direct-text-edit` — no
// dedicated function to reference) are exempt; there is nothing to grep for.
function evidenceReferencesReplacement(root, evidenceRefs, replacementRefs) {
  const identifiers = replacementRefs
    .filter((ref) => !DIRECT_EDIT_SENTINELS.has(ref))
    .map((ref) => ref.slice(ref.indexOf("#") + 1))
    .filter(Boolean);
  if (identifiers.length === 0) return { ok: true }; // sentinel-only row — exempt

  const filePaths = [...new Set(evidenceRefs.map((ref) => ref.slice(0, ref.indexOf("::"))).filter(Boolean))];
  for (const relPath of filePaths) {
    const absPath = join(root, relPath);
    if (!existsSync(absPath)) continue; // already reported by evidenceExists
    const text = readFileSync(absPath, "utf8");
    const commentMask = buildCommentOnlyMask(text);
    for (const id of identifiers) {
      const idRe = new RegExp(`\\b${id}\\b`, "g");
      let m;
      while ((m = idRe.exec(text))) {
        if (commentMask[m.index] === 1) return { ok: true };
      }
    }
  }
  return {
    ok: false,
    reason:
      `none of this row's evidence file(s) (${filePaths.join(", ")}) reference any of its own replacement ` +
      `identifier(s) (${identifiers.join(", ")}) as real code — the cited test(s) may prove only the pure core ` +
      `underneath the named replacement, not the replacement itself (G-01/AP-01)`,
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const { root: rootArg } = parseArgs(process.argv.slice(2));
  const root = rootArg ? pathResolve(rootArg) : repoRoot();

  if (!existsSync(root)) {
    console.error(`check-parity: ERROR — root not found: ${root}`);
    process.exit(2);
  }

  const summary = [];
  let hasFail = false;
  const failDetails = [];

  // ── Extraction ─────────────────────────────────────────────────────────
  const cmResult = extractContextMenuActions(root);
  const ieResult = extractInlineEditActions(root);

  if (cmResult.error || ieResult.error) {
    console.error(`check-parity: ERROR — ${cmResult.error || ieResult.error}`);
    process.exit(2);
  }

  const extracted = new Map(); // id -> [{file, line}]
  for (const [id, locs] of cmResult.actions) extracted.set(id, locs);
  for (const [id, locs] of ieResult.actions) {
    extracted.set(id, [...(extracted.get(id) ?? []), ...locs]);
  }

  summary.push(
    `RULE 1 [extraction]: scanned ${cmResult.itemLiteralCount} context-menu item literal(s) across ${cmResult.methodCount} method(s), ${ieResult.methodCount} inline-edit method(s) — extracted ${extracted.size} mutation-capable action id(s)`,
  );
  for (const note of cmResult.notes) summary.push(`  NOTE: ${note}`);

  // AP-21 liveness, PER SOURCE FILE (SFE-P3d-parity repair round 1,
  // CONFIRMED finding — a UNION check across both files let a total
  // collapse of ONE file's extraction hide behind the OTHER file still
  // contributing at least one action; `block-edit` is extracted from BOTH
  // files independently today, so a union check could never actually go
  // red on either file alone). Each file must independently show it saw
  // real, structured content AND produced at least one action — zero item
  // literals, zero methods, or zero actions in EITHER file is always a
  // fixture/scan error, never a silent pass.
  if (cmResult.itemLiteralCount === 0 || cmResult.methodCount === 0 || cmResult.actions.size === 0) {
    summary.push(
      `RULE 1 [extraction]: FAIL (liveness, AP-21) — context-menu-controller.svelte.ts extraction yielded ` +
        `${cmResult.itemLiteralCount} item literal(s), ${cmResult.methodCount} method(s), ${cmResult.actions.size} action(s)`,
    );
    hasFail = true;
    failDetails.push(
      "Context-menu extraction produced a zero count somewhere it should not have. Per AP-21 this is always a " +
        "fixture/scan error, never a silent pass — either the file no longer contains any commit()-reaching item " +
        "(in which case the preview mutation surface has already been deleted and this gate's whole purpose is gone), " +
        "or the extraction's own pattern-matching stopped recognizing the real code shape.",
    );
  } else {
    summary.push(`RULE 1 [extraction]: PASS — context-menu-controller.svelte.ts liveness (nonempty items/methods/actions)`);
  }
  if (ieResult.methodCount === 0 || ieResult.actions.size === 0) {
    summary.push(
      `RULE 1 [extraction]: FAIL (liveness, AP-21) — inline-edit-controller.svelte.ts extraction yielded ` +
        `${ieResult.methodCount} method(s), ${ieResult.actions.size} action(s)`,
    );
    hasFail = true;
    failDetails.push(
      "Inline-edit extraction produced a zero count somewhere it should not have. Per AP-21 this is always a " +
        "fixture/scan error, never a silent pass.",
    );
  } else {
    summary.push(`RULE 1 [extraction]: PASS — inline-edit-controller.svelte.ts liveness (nonempty methods/actions)`);
  }

  // RULE 1b [residual calls] (SFE-P3d-parity repair round 1, CONFIRMED
  // finding — header step 4a): every real-code `commitRangePatch(`/
  // `this.commit(` call site in either file must be attributable to a
  // recognized method body or an extracted item's run span. An orphan call
  // site means a real mutation-capable action escaped extraction under a
  // TypeScript shape this scanner's item/method matching doesn't recognize
  // — this is what keeps that failure mode a loud gate failure instead of a
  // silent undercount (see LIMITATIONS for exactly which shapes this closes
  // and which remain a disclosed gap).
  const residual = [...cmResult.residual, ...ieResult.residual];
  if (residual.length > 0) {
    summary.push(`RULE 1b [residual-calls]: FAIL — ${residual.length} orphan mutation call site(s) attributable to no extracted action`);
    hasFail = true;
    for (const r of residual) {
      failDetails.push(
        `  ORPHAN CALL SITE: "${r.snippet}" at ${r.file}:${r.line} is not inside any recognized method body or ` +
          `extracted item's run span — a real authoring action may have escaped extraction under a TypeScript shape ` +
          `this scanner does not recognize (method-shorthand, missing modifier, class-field arrow, module-level ` +
          `function, or object-spread — see LIMITATIONS). This must be investigated, not passed through.`,
      );
    }
  } else {
    summary.push(`RULE 1b [residual-calls]: PASS — every commitRangePatch(...)/this.commit(...) call site is attributable`);
  }

  // ── Matrix parsing ─────────────────────────────────────────────────────
  const matrix = parseMatrix(root);
  if (matrix.error) {
    console.error(`check-parity: ERROR — ${matrix.error}`);
    process.exit(2);
  }
  summary.push(`RULE 2 [matrix-parse]: parsed ${matrix.mapped.length} mapped row(s), ${matrix.waivers.length} waiver row(s)`);

  const mappedByAction = new Map();
  for (const row of matrix.mapped) {
    if (!mappedByAction.has(row.action)) mappedByAction.set(row.action, []);
    mappedByAction.get(row.action).push(row);
  }
  const waiverByAction = new Map();
  for (const row of matrix.waivers) {
    if (!waiverByAction.has(row.action)) waiverByAction.set(row.action, []);
    waiverByAction.get(row.action).push(row);
  }

  // ── Rule 3: every extracted action has a mapping or a reasoned waiver ──
  const missing = [];
  const doubleCovered = [];
  for (const id of extracted.keys()) {
    const inMapped = mappedByAction.has(id);
    const inWaiver = waiverByAction.has(id);
    if (!inMapped && !inWaiver) missing.push(id);
    if (inMapped && inWaiver) doubleCovered.push(id);
  }
  if (missing.length > 0 || doubleCovered.length > 0) {
    summary.push(`RULE 3 [coverage]: FAIL — ${missing.length} unmapped action(s), ${doubleCovered.length} double-covered action(s)`);
    hasFail = true;
    for (const id of missing) {
      const locs = extracted.get(id).map((l) => `${l.file}:${l.line}`).join(", ");
      failDetails.push(`  UNMAPPED: action "${id}" (found at ${locs}) has no row in ${MATRIX_REL}'s "Mapped actions" or "Waivers" table.`);
    }
    for (const id of doubleCovered) {
      failDetails.push(`  DOUBLE-COVERED: action "${id}" appears in BOTH the mapped table and the waivers table — pick one.`);
    }
  } else {
    summary.push(`RULE 3 [coverage]: PASS — every extracted action has exactly one matrix row`);
  }

  // ── Rule 4: waivers must carry a real reason and owner ─────────────────
  const badWaivers = matrix.waivers.filter((w) => !w.reason || !w.owner);
  if (badWaivers.length > 0) {
    summary.push(`RULE 4 [waiver-completeness]: FAIL — ${badWaivers.length} waiver row(s) missing a reason or owner`);
    hasFail = true;
    for (const w of badWaivers) {
      failDetails.push(
        `  WAIVER INCOMPLETE: action "${w.action}" (${MATRIX_REL}:${w.lineNo}) — reason=${JSON.stringify(w.reason)} owner=${JSON.stringify(w.owner)}. A waiver with no reason or no owner fails the gate.`,
      );
    }
  } else {
    summary.push(`RULE 4 [waiver-completeness]: PASS — ${matrix.waivers.length} waiver(s), all carry a reason and an owner`);
  }

  // ── Rule 5: mapped rows name real, existing replacement commands ───────
  const badCommands = [];
  for (const row of matrix.mapped) {
    if (row.replacements.length === 0) {
      badCommands.push({ row, reason: "no replacement command(s) listed" });
      continue;
    }
    for (const ref of row.replacements) {
      const res = commandExists(root, ref);
      if (!res.exists) badCommands.push({ row, ref, reason: res.reason });
    }
  }
  if (badCommands.length > 0) {
    summary.push(`RULE 5 [command-existence]: FAIL — ${badCommands.length} replacement command reference(s) do not resolve`);
    hasFail = true;
    for (const b of badCommands) {
      failDetails.push(`  BAD COMMAND: action "${b.row.action}" (${MATRIX_REL}:${b.row.lineNo}) — ${b.ref ? `"${b.ref}": ` : ""}${b.reason}`);
    }
  } else {
    summary.push(`RULE 5 [command-existence]: PASS — every mapped replacement command resolves to real source`);
  }

  // ── Rule 6: mapped rows have behavioral test evidence ───────────────────
  const badEvidence = [];
  for (const row of matrix.mapped) {
    if (row.evidence.length === 0) {
      badEvidence.push({ row, reason: "no test evidence listed" });
      continue;
    }
    for (const ref of row.evidence) {
      const res = evidenceExists(root, ref);
      if (!res.exists) badEvidence.push({ row, ref, reason: res.reason });
    }
    // SFE-P3d-parity repair round 1 (CONFIRMED finding): existence of the
    // cited test title is not enough — it must connect to the row's OWN
    // replacement command(s), not merely a test of the pure core beneath
    // them. See evidenceReferencesReplacement's own header.
    const refCheck = evidenceReferencesReplacement(root, row.evidence, row.replacements);
    if (!refCheck.ok) badEvidence.push({ row, reason: refCheck.reason });
  }
  if (badEvidence.length > 0) {
    summary.push(`RULE 6 [test-evidence]: FAIL — ${badEvidence.length} test evidence reference(s) do not resolve`);
    hasFail = true;
    for (const b of badEvidence) {
      failDetails.push(`  BAD EVIDENCE: action "${b.row.action}" (${MATRIX_REL}:${b.row.lineNo}) — ${b.ref ? `"${b.ref}": ` : ""}${b.reason}`);
    }
  } else {
    summary.push(`RULE 6 [test-evidence]: PASS — every mapped row cites a real test`);
  }

  // ── Informational: stale matrix rows (WARN only) ────────────────────────
  const staleMapped = matrix.mapped.filter((r) => !extracted.has(r.action));
  const staleWaivers = matrix.waivers.filter((r) => !extracted.has(r.action));
  if (staleMapped.length > 0 || staleWaivers.length > 0) {
    summary.push(
      `RULE 7 [stale-rows]: PASS with WARN — ${staleMapped.length} mapped + ${staleWaivers.length} waiver row(s) reference an action id no longer extracted (harmless unless it hides a rename)`,
    );
  } else {
    summary.push(`RULE 7 [stale-rows]: PASS — no stale matrix rows`);
  }

  console.log("check-parity: rule summary");
  for (const line of summary) console.log(`  ${line}`);

  if (failDetails.length > 0) {
    console.error("\ncheck-parity: FAIL — one or more parity gate rules failed:");
    for (const line of failDetails) console.error(line);
  }

  if (hasFail) {
    console.error("\ncheck-parity: FAIL — see details above.");
    process.exit(1);
  }

  console.log("\ncheck-parity: OK — every extracted preview mutation action has a mapped, existing, tested replacement or a reasoned waiver.");
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error(`check-parity: ERROR — ${err && err.stack ? err.stack : err}`);
  process.exit(2);
}
