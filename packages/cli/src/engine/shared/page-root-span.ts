/**
 * A page root (`.page` / `.spread`) is the containing block for `.gp-pin`, and
 * core gives it `min-height: calc(var(--gp-content-h) - 1px)` so its bottom
 * edge is the page foot (see the long comment in markers.js — the 1px cushion
 * is load-bearing: a box ending exactly on the sheet edge costs an empty
 * sheet). A root that runs across N sheets needs the same contract
 * generalised: its bottom edge is the foot of its LAST sheet, so a bottom pin
 * sits there rather than under the last line of text (#519).
 *
 * Shared by the compiler agent (`extendPageRoots`, agent.ts) and the viewer
 * (`extendSpanningPageRoots`, fragment.ts) so the PDF and the live preview
 * agree.
 *
 * @param height   the root's laid-out height (all fragments, summed)
 * @param content  the content height of the page context the root is in
 * @param offset   how far into its first sheet the root starts (0 if at the top)
 * @returns the min-height to set, or null when the root fits one sheet
 */
export function spanningMinHeight(height: number, content: number, offset = 0): number | null {
  if (!(content > 0) || height <= content + 1) return null;
  const sheets = Math.ceil((height + offset) / content);
  return sheets * content - offset - 1;
}
