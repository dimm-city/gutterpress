import type MarkdownIt from "markdown-it";
import type { StateBlock } from "markdown-it/lib/rules_block/state_block";

/**
 * Custom hr (horizontal rule / thematic break) rule that extracts {page} attributes.
 *
 * Matches patterns like:
 * - `---` → regular hr
 * - `--- {page}` → hr with page marker
 * - `--- {page .class1 .class2}` → hr with page marker and modifiers
 */
const customHrRule = (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
  let pos = state.bMarks[startLine] + ((state.tIndent?.[startLine]) || 0);
  const maximum = state.eMarks[startLine];

  // Check if line is too indented
  if (pos + 3 > maximum) return false;

  // Get the marker character
  let marker = state.src.charCodeAt(pos);

  // Check for -, *, or _
  if (marker !== 0x2d && marker !== 0x2a && marker !== 0x5f) return false;

  // Count and validate the pattern
  let count = 1;
  pos++;
  while (pos < maximum) {
    const ch = state.src.charCodeAt(pos);
    if (ch === marker) {
      count++;
      pos++;
    } else if (ch === 0x20 || ch === 0x09) {
      // space or tab
      pos++;
    } else {
      break;
    }
  }

  // Need at least 3 markers
  if (count < 3) return false;

  // Extract the rest of the line (after the markers and spaces)
  const restOfLine = state.src.slice(pos, maximum).trim();

  // Check if there's a {page} marker
  const pageMatch = restOfLine.match(/^\{page\s*(.*?)\}?\s*$/);

  // If there are non-whitespace characters that don't match {page}, reject
  if (restOfLine && !pageMatch) return false;

  if (silent) return true;

  state.line = startLine + 1;

  const token = state.push("hr", "hr", 0);
  token.map = [startLine, state.line];

  // If we found a page marker, add attributes
  if (pageMatch) {
    token.attrSet("page", "true");

    // Parse modifiers (classes)
    const modifiersStr = pageMatch[1].trim();
    if (modifiersStr) {
      // Extract class names from the modifier string
      // Supports: .class1 .class2 or just class1 class2
      const classNames = modifiersStr
        .split(/\s+/)
        .map((cls) => cls.replace(/^\./, "")) // Remove leading dots
        .filter(Boolean);

      if (classNames.length > 0) {
        token.attrSet("class", classNames.join(" "));
      }
    }
  }

  return true;
};

/**
 * Register custom hr rule that supports page markers.
 * Must be called BEFORE the pageMarkerPlugin.
 */
export const registerCustomHrRule = (md: MarkdownIt) => {
  // Replace the default hr rule with our custom one
  md.block.ruler.at("hr", customHrRule);
};

export type { StateBlock };
