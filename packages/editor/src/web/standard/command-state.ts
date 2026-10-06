/**
 * `commandState` — per-command `{applicable, active}` for toolbars (SFE-P2a
 * Lane B, run spec: "commandState(snapshot, selection): per-command
 * {applicable, active} for toolbars — pure function, no DOM").
 *
 * "pure, cheap (line-local inspection; document precision limits honestly,
 * e.g. bold-active detection inside nested emphasis is best-effort — but
 * NEVER wrong about applicable)" — every `active` check below reuses the
 * EXACT SAME detection each command's own `apply-command.ts` branch uses
 * (`isWrapped` mirrors `wrapInline`'s own marker check, `isBlockquoteActive`
 * mirrors `computeToggleBlockquote`'s `allQuoted`, ...), so `commandState`
 * and `applyCommand` never disagree about what "currently on" means.
 * `applicable` is `false` ONLY where a command is a NAMED refusal case
 * (today: `set-heading` inside a fenced code block) — every other command
 * is applicable at every selection, matching "NEVER wrong about
 * applicable": reporting `false` when a command would actually succeed
 * would make a toolbar wrongly disable a working button, which the run
 * spec singles out as the one thing this function may not get wrong.
 */
import type { DocumentSnapshot } from "../../core/contracts.ts";
import type { ListVariant, SetHeadingLevel } from "../../core/commands.ts";
import { isBlockquoteActive } from "./blockquote.ts";
import { isExactFencedBlock } from "./code-block.ts";
import { currentHeadingLevel } from "./heading.ts";
import { isInsideFencedCodeBlock, lineAt } from "./line-utils.ts";
import { activeListVariant } from "./list.ts";
import { BOLD_SPEC, INLINE_CODE_SPEC, ITALIC_SPEC, STRIKE_SPEC, isWrapped } from "./wrap-inline.ts";
import type { CommandSelection } from "./apply-command.ts";

export interface CommandStateEntry {
  readonly applicable: boolean;
  readonly active: boolean;
}

export interface SetHeadingState extends CommandStateEntry {
  /** The heading level currently active at the selection's line, or
   *  `"none"`. Lets a toolbar highlight the CURRENTLY active level among
   *  several heading buttons, not just report a single boolean. */
  readonly level: SetHeadingLevel;
}

export interface ToggleListState extends CommandStateEntry {
  /** Which list variant is currently active at the selection, or `null`. */
  readonly variant: ListVariant | null;
}

export interface CommandStateMap {
  readonly "toggle-bold": CommandStateEntry;
  readonly "toggle-italic": CommandStateEntry;
  readonly "toggle-strike": CommandStateEntry;
  readonly "toggle-inline-code": CommandStateEntry;
  readonly "set-heading": SetHeadingState;
  readonly "toggle-blockquote": CommandStateEntry;
  readonly "toggle-list": ToggleListState;
  readonly "insert-link": CommandStateEntry;
  readonly "insert-image": CommandStateEntry;
  readonly "toggle-code-block": CommandStateEntry;
  readonly "insert-horizontal-rule": CommandStateEntry;
  readonly "insert-table": CommandStateEntry;
}

/** `{applicable: true, active: false}` — the shape of every "insert" family
 *  command (`insert-link`, `insert-image`, `insert-horizontal-rule`,
 *  `insert-table`): none of them has an "already applied at this selection"
 *  concept the way a toggle does, and none has a named refusal case in this
 *  run, so both fields are constant. */
const ALWAYS_APPLICABLE_NEVER_ACTIVE: CommandStateEntry = { applicable: true, active: false };

export function commandState(snapshot: DocumentSnapshot, selection: CommandSelection): CommandStateMap {
  const { text } = snapshot;
  const { start, endExclusive } = selection;

  const headingLevel = currentHeadingLevel(text, start);
  const line = lineAt(text, start);
  const headingApplicable = !isInsideFencedCodeBlock(text, line.start);

  const listVariant = activeListVariant(text, start, endExclusive);

  return {
    "toggle-bold": {
      applicable: true,
      active: isWrapped(text, start, endExclusive, BOLD_SPEC),
    },
    "toggle-italic": {
      applicable: true,
      active: isWrapped(text, start, endExclusive, ITALIC_SPEC),
    },
    "toggle-strike": {
      applicable: true,
      active: isWrapped(text, start, endExclusive, STRIKE_SPEC),
    },
    "toggle-inline-code": {
      applicable: true,
      active: isWrapped(text, start, endExclusive, INLINE_CODE_SPEC),
    },
    "set-heading": {
      applicable: headingApplicable,
      active: headingApplicable && headingLevel !== "none",
      level: headingApplicable ? headingLevel : "none",
    },
    "toggle-blockquote": {
      applicable: true,
      active: isBlockquoteActive(text, start, endExclusive),
    },
    "toggle-list": {
      applicable: true,
      active: listVariant !== null,
      variant: listVariant,
    },
    "insert-link": ALWAYS_APPLICABLE_NEVER_ACTIVE,
    "insert-image": ALWAYS_APPLICABLE_NEVER_ACTIVE,
    "toggle-code-block": {
      applicable: true,
      active: isExactFencedBlock(text, start, endExclusive),
    },
    "insert-horizontal-rule": ALWAYS_APPLICABLE_NEVER_ACTIVE,
    "insert-table": ALWAYS_APPLICABLE_NEVER_ACTIVE,
  };
}
