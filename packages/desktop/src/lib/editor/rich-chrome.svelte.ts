/**
 * Inline editor chrome — the slash menu and the selection bubble toolbar.
 *
 * Host-free and DOM-free by design (CLAUDE.md §8 / ADR 0004): this owns the
 * STATE and the geometry maths, the Svelte components own the markup, and the
 * editor plugin below feeds it. That is the same split
 * `context-menu-controller.svelte.ts` uses, and it keeps the whole thing
 * testable without mounting anything.
 *
 * ## Positioning across the iframe boundary
 *
 * The rich editor lives in a same-origin iframe and ProseMirror runs in the
 * host document, so `view.coordsAtPos()` returns coordinates in the FRAME's
 * viewport. They become app coordinates the same way `ContextMenuController`
 * and `BlockOverlayController` do it — add the iframe's own bounding rect —
 * and then flip near an edge and clamp inside the workspace.
 *
 * That flip-and-clamp lives in `$lib/flip-clamp` and is shared with the
 * context menu, which had the original private copy of it.
 */

import type { Rect } from "$lib/flip-clamp";
import type { RichToolbarAction, ToolbarPayloadLike } from "$lib/editor/rich-commands";

/**
 * What the chrome should show, in APP coordinates.
 *
 * The editor reports frame-viewport coordinates; the host adds the frame's own
 * rect and the workspace it must stay inside, producing this.
 */
export interface ChromeAnchor {
  kind: "slash" | "selection";
  x: number;
  y: number;
  query?: string;
  workspace: Rect;
}


// ---------------------------------------------------------------------------
// slash menu
// ---------------------------------------------------------------------------

/**
 * One insertable block.
 *
 * `keywords` widens matching beyond the label so "bullet" finds "List" — a
 * slash menu that only matches its own labels makes the author guess the
 * vocabulary.
 */
export interface SlashItem {
  id: string;
  label: string;
  detail: string;
  keywords: string[];
}

/**
 * What `/` offers.
 *
 * Every entry maps to a toolbar action that already exists, so the slash menu
 * adds a way to reach commands rather than a second set of them. The layout
 * markers are here because they are the product's own authoring surface and
 * are otherwise buried in a toolbar dropdown.
 */
export const SLASH_ITEMS: readonly SlashItem[] = [
  { id: "heading-1", label: "Heading 1", detail: "Chapter-level title", keywords: ["h1", "title"] },
  { id: "heading-2", label: "Heading 2", detail: "Section title", keywords: ["h2"] },
  { id: "heading-3", label: "Heading 3", detail: "Sub-section title", keywords: ["h3"] },
  { id: "ul", label: "Bulleted list", detail: "A list of points", keywords: ["bullet", "unordered", "list"] },
  { id: "ol", label: "Numbered list", detail: "A list of steps", keywords: ["ordered", "number", "list"] },
  { id: "blockquote", label: "Quote", detail: "Set text apart", keywords: ["quote", "blockquote", "pull"] },
  { id: "code", label: "Code", detail: "Monospaced code", keywords: ["code", "monospace", "pre"] },
  { id: "hr", label: "Divider", detail: "A horizontal rule", keywords: ["rule", "hr", "divider", "line"] },
  { id: "table", label: "Table", detail: "Rows and columns", keywords: ["table", "grid"] },
  { id: "page-break", label: "Page break", detail: "Start a new page here", keywords: ["page", "break", "@page-break"] },
  { id: "section", label: "Section", detail: "@section … @end-section", keywords: ["section", "@section"] },
  { id: "two-column", label: "Two columns", detail: "A two-column section", keywords: ["column", "two", "split"] },
  { id: "chapter", label: "Chapter", detail: "@chapter, with a first page", keywords: ["chapter", "@chapter"] },
  { id: "spread", label: "Spread", detail: "@spread, facing pages", keywords: ["spread", "@spread"] },
];

/** Items matching `query`, label first then keywords, in menu order. */
export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...SLASH_ITEMS];
  const starts: SlashItem[] = [];
  const contains: SlashItem[] = [];
  for (const item of SLASH_ITEMS) {
    const label = item.label.toLowerCase();
    if (label.startsWith(q)) starts.push(item);
    else if (label.includes(q) || item.keywords.some((k) => k.includes(q))) contains.push(item);
  }
  return [...starts, ...contains];
}

/**
 * The toolbar action a slash item runs.
 *
 * Deliberately returns the EXISTING action + payload rather than a new command,
 * so `/` and the toolbar button cannot diverge on what they insert.
 */
export function slashAction(
  id: string,
): { action: RichToolbarAction; payload?: ToolbarPayloadLike } | null {
  switch (id) {
    case "heading-1": return { action: "heading", payload: { level: 1 } };
    case "heading-2": return { action: "heading", payload: { level: 2 } };
    case "heading-3": return { action: "heading", payload: { level: 3 } };
    case "ul": return { action: "ul" };
    case "ol": return { action: "ol" };
    case "blockquote": return { action: "blockquote" };
    case "code": return { action: "code" };
    case "hr": return { action: "hr" };
    case "table": return { action: "table", payload: { cols: 3 } };
    case "page-break": return { action: "page-break" };
    case "section": return { action: "layout-block", payload: { kind: "section" } };
    case "two-column": return { action: "layout-block", payload: { kind: "two-column" } };
    case "chapter": return { action: "layout-block", payload: { kind: "chapter" } };
    case "spread": return { action: "layout-block", payload: { kind: "spread" } };
    default: return null;
  }
}

/**
 * Is `/` at this position a command trigger, or a literal slash?
 *
 * The UX contract pins this: the menu opens only at the start of a line or
 * after whitespace (`ux-design-contract.md` §1). Anything else — a URL, a
 * fraction, `and/or` — is the author typing a slash, and popping a menu over
 * it would be the surface guessing.
 */
export function isSlashTrigger(textBefore: string): boolean {
  if (!textBefore.endsWith("/")) return false;
  const preceding = textBefore.slice(0, -1);
  return preceding === "" || /\s$/.test(preceding);
}
