import type MarkdownIt from "markdown-it";

/**
 * GFM-style blockquote alert plugin for DC-branded callouts.
 *
 * Transforms:
 *   > [!NOTE]
 *   > Content here
 *
 * into DC-branded styled divs based on the alert type prefix.
 *
 * The [!TYPE] line is consumed by the plugin and NOT rendered as content.
 */

type AlertConfig = {
  classes: string;
  label?: string;
};

const DC_ALERT_TYPES: Record<string, AlertConfig> = {
  NOTE:      { classes: "dc-note",             label: "Note" },
  WARNING:   { classes: "dc-note warning",     label: "Warning" },
  DM:        { classes: "dc-note-callout",     label: "Dream Master Note" },
  VIBE:      { classes: "dc-vibe-callout" },
  ORIGIN:    { classes: "dc-origin-callout" },
  VISIT:     { classes: "dc-visit-callout" },
  GEAR:      { classes: "dc-gear-callout" },
  FLAVOR:    { classes: "dc-prose flavor" },
  PULLQUOTE: { classes: "dc-pullquote flush" },
};

const ALERT_PATTERN = /^\[!([A-Z_]+)\]/i;

export function dcAlertsPlugin(md: MarkdownIt): void {
  md.core.ruler.push("dc_alerts", (state) => {
    const tokens = state.tokens;
    // Use any[] to avoid requiring specific Token import path
    const newTokens: any[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];

      // Look for blockquote_open
      if (!tok || tok.type !== "blockquote_open") {
        newTokens.push(tok);
        continue;
      }

      // Find the matching blockquote_close and locate first inline token
      let closeIdx = -1;
      let firstInlineIdx = -1;
      let depth = 0;

      for (let j = i; j < tokens.length; j++) {
        const jt = tokens[j];
        if (!jt) continue;
        if (jt.type === "blockquote_open") depth++;
        if (jt.type === "blockquote_close") {
          depth--;
          if (depth === 0) {
            closeIdx = j;
            break;
          }
        }
        if (firstInlineIdx === -1 && jt.type === "inline") {
          firstInlineIdx = j;
        }
      }

      if (closeIdx === -1 || firstInlineIdx === -1) {
        newTokens.push(tok);
        continue;
      }

      // Check if first inline matches [!TYPE]
      const inlineTok = tokens[firstInlineIdx];
      if (!inlineTok) {
        newTokens.push(tok);
        continue;
      }

      const match = inlineTok.content.match(ALERT_PATTERN);
      if (!match) {
        newTokens.push(tok);
        continue;
      }

      const alertType = match[1]!.toUpperCase();
      const config = DC_ALERT_TYPES[alertType];
      if (!config) {
        newTokens.push(tok);
        continue;
      }

      // Emit opening div token
      const openTok = new state.Token("html_block", "", 0);
      openTok.block = true;
      let openHtml = `<div class="${config.classes}">`;
      if (config.label) {
        openHtml += `<span class="dc-note-label">${config.label}</span>`;
      }
      openHtml += "\n";
      openTok.content = openHtml;
      newTokens.push(openTok);

      // Strip the [!TYPE] prefix (and any trailing whitespace) from the first inline
      const prefixMatch = inlineTok.content.match(/^\[![A-Z_]+\][ \t]*/i);
      const stripped = prefixMatch
        ? inlineTok.content.slice(prefixMatch[0].length).trim()
        : inlineTok.content;

      // Find the paragraph wrapping the first inline so we can suppress it if
      // content becomes empty
      const paragraphOpenIdx = firstInlineIdx - 1;
      const paragraphCloseIdx = firstInlineIdx + 1;
      const wrapsInParagraph =
        paragraphOpenIdx > i &&
        tokens[paragraphOpenIdx]?.type === "paragraph_open" &&
        tokens[paragraphCloseIdx]?.type === "paragraph_close";

      for (let j = i + 1; j < closeIdx; j++) {
        const t = tokens[j];
        if (!t) continue;

        // Handle the first inline token — emit stripped version
        if (j === firstInlineIdx) {
          if (stripped === "") {
            // Empty content — suppress this inline token (and its paragraph wrapper)
            continue;
          }
          // Create a new inline token with stripped content and re-parse children
          const strippedTok = new state.Token("inline", "", 0);
          strippedTok.content = stripped;
          strippedTok.children = [];
          state.md.inline.parse(stripped, state.md, state.env, strippedTok.children);
          newTokens.push(strippedTok);
          continue;
        }

        // When the first inline was empty, also suppress its paragraph wrapper
        if (stripped === "" && wrapsInParagraph) {
          if (j === paragraphOpenIdx || j === paragraphCloseIdx) {
            continue;
          }
        }

        newTokens.push(t);
      }

      // Emit closing div token
      const closeTok = new state.Token("html_block", "", 0);
      closeTok.block = true;
      closeTok.content = "</div>\n";
      newTokens.push(closeTok);

      // Skip past blockquote_close
      i = closeIdx;
    }

    state.tokens = newTokens;
  });
}
