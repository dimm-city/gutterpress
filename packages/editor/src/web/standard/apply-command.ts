/**
 * `applyCommand` — the single pure entry point every `EditorCommand` (D1/D3
 * vocabulary, `core/commands.ts`) is computed through (SFE-P2a Lane B, run
 * spec DETAILS: "IMPLEMENT (packages/editor/src/web/standard/): pure
 * functions — applyCommand(snapshot, selection, command): {edit: SourceEdit}
 * | {refused: Diagnostic} — NO DOM, NO adapter dependency (the caller wires
 * selection from whatever surface)").
 *
 * This function never touches a host: it reads `snapshot` and `selection`,
 * returns either the ONE minimal `SourceEdit` the command computes (D3:
 * "the smallest safe common source range") or a refusal `Diagnostic`, and
 * leaves APPLYING that edit (`host.applyEdit(edit)`, D3/D7) to the caller.
 * `expectedVersion` is filled in here, from `snapshot.version`, exactly
 * once — every per-command module below returns only `{from, to, insert}`
 * (`ComputedEdit`, `wrap-inline.ts`) and never sees a version number.
 */
import type { DocumentSnapshot, SourceEdit } from "../../core/contracts.ts";
import type { Diagnostic } from "../../core/diagnostics.ts";
import type { EditorCommand } from "../../core/commands.ts";
import { computeToggleBlockquote } from "./blockquote.ts";
import { computeToggleCodeBlock } from "./code-block.ts";
import { isValidRange } from "../../core/apply-edit.ts";
import { computeSetHeading } from "./heading.ts";
import { computeInsertHorizontalRule } from "./hr.ts";
import { computeInsertImage, computeInsertLink } from "./link-image.ts";
import { computeToggleList } from "./list.ts";
import { computeInsertTable } from "./table.ts";
import { BOLD_SPEC, INLINE_CODE_SPEC, ITALIC_SPEC, STRIKE_SPEC, wrapInline } from "./wrap-inline.ts";

/** A selection expressed the way `applyCommand`/`commandState` accept it —
 *  named `start`/`endExclusive` (not `from`/`to`) so it reads unambiguously
 *  as "the CALLER's current selection", distinct from a `SourceEdit`'s own
 *  `from`/`to` (the range a command's returned edit REPLACES, which is
 *  usually NOT the same range as the selection that produced it — e.g. a
 *  wrap toggle-OFF's edit range extends past the selection to cover the
 *  markers being removed). */
export interface CommandSelection {
  readonly start: number;
  readonly endExclusive: number;
}

export type ApplyCommandResult = { readonly edit: SourceEdit } | { readonly refused: Diagnostic };

function invalidSelection(snapshot: DocumentSnapshot, selection: CommandSelection): boolean {
  return !isValidRange(selection.start, selection.endExclusive, snapshot.text.length);
}

function invalidRangeDiagnostic(): Diagnostic {
  return {
    category: "EDITOR_INVALID_RANGE",
    message:
      "This command's selection falls outside the current document, so it was not applied. Reload the current document and reapply your change.",
    safeAction: "Reload and reapply",
  };
}

function fencedCodeBlockDiagnostic(): Diagnostic {
  return {
    category: "EDITOR_INVALID_RANGE",
    message:
      "This heading command targets a line inside a fenced code block, so it was not applied. Move the cursor outside the code block, or edit the block's contents directly in source.",
    safeAction: "Move outside the code block",
  };
}

export function applyCommand(
  snapshot: DocumentSnapshot,
  selection: CommandSelection,
  command: EditorCommand,
): ApplyCommandResult {
  if (invalidSelection(snapshot, selection)) {
    return { refused: invalidRangeDiagnostic() };
  }

  const { text } = snapshot;
  const { start, endExclusive } = selection;

  switch (command.kind) {
    case "toggle-bold": {
      const e = wrapInline(text, start, endExclusive, BOLD_SPEC);
      return edit(snapshot, e);
    }
    case "toggle-italic": {
      const e = wrapInline(text, start, endExclusive, ITALIC_SPEC);
      return edit(snapshot, e);
    }
    case "toggle-strike": {
      const e = wrapInline(text, start, endExclusive, STRIKE_SPEC);
      return edit(snapshot, e);
    }
    case "toggle-inline-code": {
      const e = wrapInline(text, start, endExclusive, INLINE_CODE_SPEC);
      return edit(snapshot, e);
    }
    case "set-heading": {
      const result = computeSetHeading(text, start, command.level);
      if ("refusal" in result) {
        return { refused: fencedCodeBlockDiagnostic() };
      }
      return edit(snapshot, result.edit);
    }
    case "toggle-blockquote":
      return edit(snapshot, computeToggleBlockquote(text, start, endExclusive));
    case "toggle-list":
      return edit(snapshot, computeToggleList(text, start, endExclusive, command.variant));
    case "insert-link":
      return edit(snapshot, computeInsertLink(text, start, endExclusive, command.href, command.text));
    case "insert-image":
      return edit(snapshot, computeInsertImage(text, start, endExclusive, command.src, command.alt));
    case "toggle-code-block":
      return edit(snapshot, computeToggleCodeBlock(text, start, endExclusive, command.lang));
    case "insert-horizontal-rule":
      return edit(snapshot, computeInsertHorizontalRule(text, start));
    case "insert-table":
      return edit(snapshot, computeInsertTable(text, start, command.rows, command.cols));
  }
}

function edit(
  snapshot: DocumentSnapshot,
  computed: { readonly from: number; readonly to: number; readonly insert: string },
): { readonly edit: SourceEdit } {
  return {
    edit: {
      from: computed.from,
      to: computed.to,
      insert: computed.insert,
      expectedVersion: snapshot.version,
    },
  };
}
