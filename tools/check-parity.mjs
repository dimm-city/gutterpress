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
//      that calls `this.<seed method>(`" (this file's real shape needs only
//      one hop — `commit()` is the seed, `promptEditMarkerLine()` is the one
//      method that calls it — but the closure is computed to a fixed point
//      so a future multi-hop helper chain is still found).
//   4. An item literal is a MUTATION-CAPABLE ACTION when its own `run` text
//      contains `this.commit(`/`commitRangePatch(` directly, OR calls
//      `this.<method>(` for a method found reachable in step 3.
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
// derived"):
//   - This is a string/brace-balance scanner, not a real TypeScript parser.
//     It correctly skips `//` and `/* */` comments and `'`/`"`/`` ` ``
//     string content (including escapes) for the purpose of brace/paren
//     matching, but does not model template-literal `${…}` interpolation
//     depth — neither target file contains a code-bearing backtick outside a
//     comment today (verified by direct inspection at authoring time), so
//     this is a real constraint on the technique, not a hidden bug, and is
//     exercised by a fixture in check-parity.test.mjs.
//   - The array-resolution step (§5 above) finds the id array via the
//     identifier name immediately before `.map(` and a same-name `= [`
//     declaration elsewhere in the file. A shorthand-id item fed by
//     anything other than a locally-declared array literal (e.g. an
//     imported array, or a `.filter().map()` chain) would not resolve — none
//     of that shape exists in the current file, and if introduced, this
//     checker's liveness/notes output makes the miss visible rather than
//     silently under-counting (an item flagged commit-reaching with an
//     unresolved shorthand id is reported as a NOTE and still fails the
//     "has no matrix mapping" rule under a synthetic placeholder id, so it
//     cannot silently vanish from the gate).
//   - The commit-reachability closure is call-graph analysis over METHOD
//     NAMES textually, not real binding resolution. This is the same
//     "spirit of check-render-purity.mjs" string-scan posture the sibling
//     check-architecture.mjs documents for its own import-specifier scan.
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

function buildMask(text) {
  const n = text.length;
  const mask = new Uint8Array(n); // 1 = real code, 0 = string/comment content
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
      const quote = c;
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
      }
      continue;
    }
    mask[i] = 1;
    i++;
  }
  return mask;
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
  let i = 0;
  while (i < n) {
    if (mask[i] !== 1) {
      i++;
      continue;
    }
    const c = text[i];
    if (c === "{" || c === "(" || c === "[") {
      stack.push({ ch: c, start: i, props: new Map() });
      i++;
      continue;
    }
    if (c === "}" || c === ")" || c === "]") {
      const frame = stack.pop();
      if (frame && frame.ch === "{" && c === "}") {
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
  return results;
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
  const mask = buildMask(text);
  const items = findItemLiterals(text, mask);
  const methods = findMethodBodies(text, mask);

  // Strip nested item-literal `run` value spans out of method bodies before
  // seeding the commit-reachability set, so a BUILDER method that merely
  // constructs items (whose closures happen to call the commit path when
  // LATER invoked) is not conflated with a method that calls the commit
  // path itself when the builder runs. See header §3.
  const stripped = text.split("");
  for (const it of items) {
    if (it.runProp.kind === "colon") {
      for (let k = it.runProp.valueStart; k < it.runProp.valueEnd; k++) stripped[k] = " ";
    }
  }
  const strippedText = stripped.join("");

  const reachesCommit = new Set();
  for (const meth of methods) {
    const body = strippedText.slice(meth.bodyStart, meth.bodyEnd);
    if (/commitRangePatch\s*\(/.test(body)) reachesCommit.add(meth.name);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const meth of methods) {
      if (reachesCommit.has(meth.name)) continue;
      const body = strippedText.slice(meth.bodyStart, meth.bodyEnd);
      for (const target of reachesCommit) {
        if (new RegExp(`\\bthis\\.${target}\\s*\\(`).test(body)) {
          reachesCommit.add(meth.name);
          changed = true;
          break;
        }
      }
    }
  }

  const actions = new Map(); // id -> [{ file, line }]
  const notes = [];
  for (const it of items) {
    const runText = it.runProp.kind === "colon" ? text.slice(it.runProp.valueStart, it.runProp.valueEnd) : "";
    let reaches = /this\.commit\s*\(/.test(runText) || /commitRangePatch\s*\(/.test(runText);
    if (!reaches) {
      for (const target of reachesCommit) {
        if (target === "commit") continue;
        if (new RegExp(`\\bthis\\.${target}\\s*\\(`).test(runText)) {
          reaches = true;
          break;
        }
      }
    }
    if (!reaches) continue;
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
  return { actions, notes, itemLiteralCount: items.length, methodCount: methods.length };
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
  const mask = buildMask(text);
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
  return { actions, methodCount: methods.length };
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

  // AP-21 liveness: an empty extracted set is a fixture error, never a
  // silent pass — it means the extraction never actually exercised the
  // controllers' real shape (both source files were readable, so a real
  // repo tree with real context-menu items should never land here).
  if (extracted.size === 0) {
    summary.push(`RULE 1 [extraction]: FAIL (liveness, AP-21) — zero mutation-capable actions extracted`);
    hasFail = true;
    failDetails.push(
      "Extraction produced an EMPTY action set. Per AP-21 this is always a fixture/scan error, never a silent pass — " +
        "either the two source files no longer contain any commit()-reaching context-menu item or commitRangePatch() " +
        "call (in which case the preview mutation surface has already been deleted and this gate's whole purpose is " +
        "gone), or the extraction's own pattern-matching stopped recognizing the real code shape. Either way this must " +
        "be investigated, not passed through.",
    );
  } else {
    summary.push(`RULE 1 [extraction]: PASS — nonempty, real action set`);
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
