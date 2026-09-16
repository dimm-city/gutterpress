/**
 * SFE-P2a Lane C — coordination harness bridging this corpus to Lane B's
 * real standard-command layer (`@dimm-city/gutterpress-editor/standard`).
 *
 * REBASED (SFE-P2a Lane C2-reconcile) onto Lane B's landed, committed-in-tree
 * `applyCommand` contract — `src/web/standard/apply-command.ts` +
 * `src/core/commands.ts`. This file previously carried a coordination-only
 * dynamic-import fallback (a relative path to `src/web/standard/index.ts`,
 * used only because Lane B had not landed and the package's `"./standard"`
 * export subpath did not exist yet) and an "ASSUMED CONTRACT" doc comment
 * describing what that module's shape was GUESSED to be. Both are gone: Lane
 * B has landed, `package.json` declares `"./standard": "./src/web/standard/index.ts"`,
 * and the self-referencing subpath import below resolves cleanly both at
 * typecheck (`tsc --noEmit`, `moduleResolution: "bundler"`) and at runtime
 * (`bun test`) — verified directly, the same way desktop's
 * `toolbar-actions.ts` already consumes it. The dynamic-import indirection
 * existed ONLY to decouple this corpus's typecheck from Lane B's landing
 * order; that coordination gap is closed, so a plain static import is the
 * smallest design that still satisfies the run spec.
 *
 * The REAL contract this harness now targets, verbatim from the real
 * modules (previously guessed, now confirmed by reading the tree):
 *
 *   - `applyCommand(snapshot: DocumentSnapshot, selection: CommandSelection,
 *     command: EditorCommand): { readonly edit: SourceEdit } | { readonly
 *     refused: Diagnostic }` — a PURE function taking a `DocumentSnapshot`
 *     directly, NOT a host. It only COMPUTES an edit; it never applies one
 *     and never touches a host (D3/D7: applying is `host.applyEdit(edit)`,
 *     a separate step). `computeAgainstHost` below makes that two-step flow
 *     explicit for every corpus test.
 *   - `CommandSelection` is `{ start: number; endExclusive: number }` —
 *     always ORDERED (`start <= endExclusive`; a reversed pair is an
 *     `invalid-range` refusal), NOT a directional `{anchor, head}` pair.
 *     `RandomSelectionPair`/`normalizeSelection` below preserve the
 *     randomized test's "both orders" generation (SFE-P2a.md DETAILS (4))
 *     by generating a directional pair and normalizing it before it ever
 *     reaches `applyCommand` — exactly what a real drag-selection UI does.
 *   - `toggle-list`'s parameter field is named `variant`
 *     (`"bullet" | "ordered" | "task"`), not `style`.
 *   - Result discrimination is `"edit" in result` / `"refused" in result`
 *     (a two-branch object union), not an `{ok: boolean, ...}` shape.
 */
import { MemoryDocumentHost } from "../../../src/core/memory-host.ts";
import type { SourceEdit } from "../../../src/core/contracts.ts";
import type { EditorDocumentHost } from "../../../src/core/hosts.ts";
import type { EditorCommand } from "../../../src/core/commands.ts";
import {
  applyCommand,
  type ApplyCommandResult,
  type CommandSelection,
} from "@dimm-city/gutterpress-editor/standard";

export type { ApplyCommandResult, CommandSelection };

/**
 * The exact 12 command "kind" members SFE-P2a.md's "Command list (the
 * union's full extent this run — nothing more)" authorizes, matching
 * `EditorCommand`'s own union in `../../../src/core/commands.ts` exactly
 * (confirmed by reading that file — Lane B's union has precisely these 12
 * members, in this order). AP-21 liveness: if `EditorCommand` ever grows a
 * 13th member, THIS ARRAY (and the size assertion in fixtures.test.ts) must
 * be updated in the same change — otherwise a new command silently gets zero
 * corpus coverage.
 */
export const EXPECTED_COMMAND_KINDS = [
  "toggle-bold",
  "toggle-italic",
  "toggle-strike",
  "toggle-inline-code",
  "set-heading",
  "toggle-blockquote",
  "toggle-list",
  "insert-link",
  "insert-image",
  "toggle-code-block",
  "insert-horizontal-rule",
  "insert-table",
] as const;

export type CommandKind = (typeof EXPECTED_COMMAND_KINDS)[number];

export interface CorpusCommandCase {
  readonly label: string;
  readonly command: EditorCommand;
  /** Whether calling the SAME command a second time on the just-produced
   * edit's range is expected to be its own inverse (byte-identical
   * round-trip). Non-toggles are one-shot inserts with no such inverse. */
  readonly isToggle: boolean;
}

/**
 * One representative case per command kind (a few kinds get more than one,
 * to cover their parameter variants) — the deterministic cross-product this
 * corpus's byte-identity/locality tests iterate against every fixture.
 * Random parameter variation across the FULL range of each kind's valid
 * params is the randomized test's job (see `randomCommand` below), not
 * this list's.
 */
export const CORPUS_COMMAND_CASES: readonly CorpusCommandCase[] = [
  { label: "toggle-bold", command: { kind: "toggle-bold" }, isToggle: true },
  { label: "toggle-italic", command: { kind: "toggle-italic" }, isToggle: true },
  { label: "toggle-strike", command: { kind: "toggle-strike" }, isToggle: true },
  { label: "toggle-inline-code", command: { kind: "toggle-inline-code" }, isToggle: true },
  { label: "set-heading level 2", command: { kind: "set-heading", level: 2 }, isToggle: false },
  { label: "set-heading none", command: { kind: "set-heading", level: "none" }, isToggle: false },
  { label: "toggle-blockquote", command: { kind: "toggle-blockquote" }, isToggle: true },
  {
    label: "toggle-list bullet",
    command: { kind: "toggle-list", variant: "bullet" },
    isToggle: true,
  },
  {
    label: "toggle-list ordered",
    command: { kind: "toggle-list", variant: "ordered" },
    isToggle: true,
  },
  { label: "toggle-list task", command: { kind: "toggle-list", variant: "task" }, isToggle: true },
  {
    label: "insert-link",
    command: { kind: "insert-link", href: "https://example.com/", text: "example" },
    isToggle: false,
  },
  {
    label: "insert-image",
    command: { kind: "insert-image", src: "cover.png", alt: "cover" },
    isToggle: false,
  },
  { label: "toggle-code-block", command: { kind: "toggle-code-block" }, isToggle: true },
  {
    label: "toggle-code-block with lang",
    command: { kind: "toggle-code-block", lang: "js" },
    isToggle: true,
  },
  { label: "insert-horizontal-rule", command: { kind: "insert-horizontal-rule" }, isToggle: false },
  {
    label: "insert-table",
    command: { kind: "insert-table", rows: 2, cols: 2 },
    isToggle: false,
  },
];

export function wholeDocumentSelection(text: string): CommandSelection {
  return { start: 0, endExclusive: text.length };
}

/** The oracle every locality assertion compares Lane B's edit against:
 * plain `String.prototype.slice` splicing, independent of any host. */
export function spliceIndependently(text: string, from: number, to: number, insert: string): string {
  return text.slice(0, from) + insert + text.slice(to);
}

/**
 * Computes `command`'s edit against `host`'s CURRENT snapshot via the real
 * `applyCommand`, and — for an accepted (non-refused) result — applies it to
 * `host` via `host.applyEdit` (the same two-step "compute, then apply" flow
 * every real caller uses; `applyCommand` itself never touches a host, D3).
 *
 * Returns the exact `ApplyCommandResult` `applyCommand` produced, so every
 * caller discriminates the SAME way production code does:
 * `"edit" in result` / `"refused" in result`.
 */
export function computeAgainstHost(
  host: EditorDocumentHost,
  selection: CommandSelection,
  command: EditorCommand,
): ApplyCommandResult {
  const result = applyCommand(host.getSnapshot(), selection, command);
  if ("edit" in result) {
    const applied = host.applyEdit(result.edit);
    if (!applied.ok) {
      // applyCommand attaches `expectedVersion` from the SAME snapshot it
      // just read (apply-command.ts's `edit()` helper), and every corpus
      // host here is freshly constructed and read immediately before this
      // call (AP-25: no fixture or host is ever reused across cases) — so
      // `host.applyEdit` rejecting an edit `applyCommand` just computed as
      // valid would mean the two disagree about the current snapshot or the
      // computed range, a real contract violation this corpus must not
      // swallow silently by treating it as an ordinary refusal.
      throw new Error(
        `host.applyEdit REJECTED (reason: "${applied.reason}") an edit applyCommand just computed as ` +
          `valid — command=${JSON.stringify(command)} selection=${JSON.stringify(selection)} ` +
          `edit=${JSON.stringify(result.edit)}`,
      );
    }
  }
  return result;
}

/** Constructs a fresh host for `fixtureText` and computes+applies `command`
 * once at the whole-document selection. Every corpus test starts from a
 * fresh host per case — no fixture or host is ever reused/mutated across
 * cases (pr158-lessons.md AP-25). */
export function applyOnFreshHost(
  fixtureText: string,
  command: EditorCommand,
): {
  readonly host: EditorDocumentHost;
  readonly selection: CommandSelection;
  readonly result: ApplyCommandResult;
} {
  const host = new MemoryDocumentHost({ text: fixtureText, version: 0 });
  const selection = wholeDocumentSelection(fixtureText);
  const result = computeAgainstHost(host, selection, command);
  return { host, selection, result };
}

/** The four `toggle-*` kinds implemented by `wrap-inline.ts`'s `wrapInline`
 *  — see `toggleOffSelection`'s doc comment for why these need DIFFERENT
 *  toggle-off selection math than every other toggle kind. */
const WRAP_TOGGLE_KINDS: ReadonlySet<EditorCommand["kind"]> = new Set([
  "toggle-bold",
  "toggle-italic",
  "toggle-strike",
  "toggle-inline-code",
]);

/**
 * The selection a real "press the same toggle button again" interaction
 * would use to invert a JUST-APPLIED toggle command's edit, computed purely
 * from that edit plus the ORIGINAL selection that produced it (no re-reading
 * of the resulting text, no per-command marker string imported into this
 * corpus).
 *
 * Two shapes, matching the two toggle-detection strategies `web/standard/`
 * actually implements (verified by reading wrap-inline.ts / blockquote.ts /
 * list.ts / code-block.ts):
 *
 *  - LINE-based toggles (blockquote, list, code-block) detect "already on"
 *    by re-inspecting the FULL touched-line span (`touchedLines(text, start,
 *    endExclusive)` — e.g. `computeToggleBlockquote`'s `allQuoted`), so
 *    re-selecting the edit's own resulting range `[edit.from, edit.from +
 *    edit.insert.length)` re-targets exactly the lines the first call just
 *    (un)marked.
 *  - WRAP-based toggles (bold/italic/strike/inline-code) detect "already on"
 *    by checking for a marker immediately OUTSIDE the selection boundary
 *    (`wrapInline`'s `before`/`after` check). Re-selecting the FULL inserted
 *    range (markers included) would look OUTSIDE those markers — at the
 *    surrounding original text, not at them — and would toggle ON again
 *    instead of OFF. The correct re-select is the CONTENT ONLY: the middle
 *    of `edit.insert`, excluding the symmetric marker pair `wrapInline` just
 *    added. Marker length is derived arithmetically from the edit itself:
 *    `wrapInline`'s toggle-ON branch always emits `insert.length ===
 *    originalSelectionLength + 2 * markerLength` (the selected content
 *    passes through byte-for-byte, flanked by one marker on each side — see
 *    wrap-inline.ts), so `markerLength = (insert.length -
 *    originalSelectionLength) / 2` — no per-command marker string needs to
 *    be imported here.
 */
export function toggleOffSelection(
  kind: EditorCommand["kind"],
  originalSelection: CommandSelection,
  edit: SourceEdit,
): CommandSelection {
  if (WRAP_TOGGLE_KINDS.has(kind)) {
    const originalLength = originalSelection.endExclusive - originalSelection.start;
    const markerLength = (edit.insert.length - originalLength) / 2;
    return {
      start: edit.from + markerLength,
      endExclusive: edit.from + edit.insert.length - markerLength,
    };
  }
  return { start: edit.from, endExclusive: edit.from + edit.insert.length };
}

// ── Deterministic PRNG (mulberry32) ────────────────────────────────────────
//
// Copied from ../../core/property.test.ts's own established pattern (SFE-P1a:
// "a SEEDED deterministic randomized property test ... no Math.random,
// determinism is binding"), duplicated rather than imported so this corpus's
// randomized test does not reach into another test file's module. `SEED` is
// this corpus's OWN fixed constant (see randomized.test.ts) — distinct from
// property.test.ts's, deliberately, so the two seeded sequences never
// silently correlate.
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function next(): number {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  // Guard on LENGTH, not on the picked value being `undefined` — one of
  // this corpus's own picked arrays (`CODE_BLOCK_LANGS`) legitimately
  // contains `undefined` as a real element ("no lang specified"), so
  // checking the picked value itself would misreport that valid pick as
  // "array was empty" (a latent bug this fix corrects: previously
  // undetectable because randomCommand could not run at all before Lane B
  // landed — see this file's header).
  if (items.length === 0) throw new Error("pick() called with an empty array");
  const index = Math.floor(rand() * items.length);
  return items[index] as T;
}

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6, "none"] as const;
const LIST_VARIANTS = ["bullet", "ordered", "task"] as const;
const CODE_BLOCK_LANGS: readonly (string | undefined)[] = [undefined, "js", "ts", "python", "plaintext"];

/** Builds a random command with random-but-shape-valid parameters, covering
 * the full parameter range each kind allows (unlike `CORPUS_COMMAND_CASES`'s
 * fixed representative values) — SFE-P2a.md DETAILS (4): "random command
 * with random valid params." */
export function randomCommand(rand: () => number): EditorCommand {
  const kind = pick(rand, EXPECTED_COMMAND_KINDS);
  switch (kind) {
    case "set-heading":
      return { kind, level: pick(rand, HEADING_LEVELS) };
    case "toggle-list":
      return { kind, variant: pick(rand, LIST_VARIANTS) };
    case "insert-link":
      return {
        kind,
        href: `https://example.com/${Math.floor(rand() * 1000)}`,
        text: rand() < 0.5 ? "link text" : undefined,
      };
    case "insert-image":
      return {
        kind,
        src: `asset-${Math.floor(rand() * 1000)}.png`,
        alt: rand() < 0.5 ? "alt text" : undefined,
      };
    case "toggle-code-block":
      return { kind, lang: pick(rand, CODE_BLOCK_LANGS) };
    case "insert-table":
      return { kind, rows: 1 + Math.floor(rand() * 4), cols: 1 + Math.floor(rand() * 4) };
    case "toggle-bold":
    case "toggle-italic":
    case "toggle-strike":
    case "toggle-inline-code":
    case "toggle-blockquote":
    case "insert-horizontal-rule":
      return { kind };
  }
}

/** A randomly generated selection BEFORE ordering — `anchor`/`head` may come
 *  out in either order (SFE-P2a.md DETAILS (4): "random valid selection
 *  (random offsets clamped to length, both orders)"), mirroring a real
 *  directional drag-selection. The real `CommandSelection` (`{start,
 *  endExclusive}`) is always ordered — `normalizeSelection` below sorts a
 *  pair into one before it ever reaches `applyCommand`, exactly what a real
 *  editor surface does before calling this command layer. */
export interface RandomSelectionPair {
  readonly anchor: number;
  readonly head: number;
}

/** Random offsets clamped to `textLength`, anchor/head in EITHER order. */
export function randomSelectionPair(rand: () => number, textLength: number): RandomSelectionPair {
  return {
    anchor: Math.floor(rand() * (textLength + 1)),
    head: Math.floor(rand() * (textLength + 1)),
  };
}

/**
 * Like `randomSelectionPair`, but with probability `outOfRangeChance`
 * deliberately returns a pair that normalizes to an OUT-OF-RANGE
 * `CommandSelection` (`endExclusive` beyond `textLength`) instead of a
 * clamped, always-valid one.
 *
 * G-12/AP-21: `applyCommand`'s `invalidSelection` refusal path (D14's
 * `EDITOR_INVALID_RANGE` category) was otherwise NEVER reached by this
 * corpus — `randomSelectionPair` clamps both offsets to `[0, textLength]`
 * by construction, so every selection it produces is valid and the
 * refusal-path assertions in `randomized.test.ts` (the `DIAGNOSTIC_
 * CATEGORIES` membership check, the "a REFUSED command still changed the
 * document" check) never executed. A gate that can only ever see one
 * outcome is not proving anything about the other.
 */
export function randomSelectionPairMaybeOutOfRange(
  rand: () => number,
  textLength: number,
  outOfRangeChance = 0.15,
): RandomSelectionPair {
  if (rand() < outOfRangeChance) {
    const overshoot = 1 + Math.floor(rand() * 50);
    return { anchor: 0, head: textLength + overshoot };
  }
  return randomSelectionPair(rand, textLength);
}

/** Sorts a directional `{anchor, head}` pair into an ordered `CommandSelection`. */
export function normalizeSelection(pair: RandomSelectionPair): CommandSelection {
  return {
    start: Math.min(pair.anchor, pair.head),
    endExclusive: Math.max(pair.anchor, pair.head),
  };
}

/** Deterministic, dependency-free FNV-1a 32-bit hash, used only to give the
 * determinism test a short, stable fingerprint of a whole iteration
 * transcript — not a security or collision-resistance requirement. */
export function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
