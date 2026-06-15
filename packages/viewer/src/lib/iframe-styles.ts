/**
 * CSS that must be injected INTO the cross-origin preview iframe.
 *
 * Because the SvelteKit toolbar (port A) and the print-md preview server
 * (port B) are on different origins, stylesheet rules defined in the toolbar
 * cannot reach the iframe's DOM. We push them in via the pmd:inject-styles
 * postMessage protocol added to pagedjs-bridge.js.
 *
 * Two style blocks are managed:
 *  - "viewer-canvas": zoom, background, page shadows, spread/single/two-column
 *    layout (these are the rules that preview.js built via buildViewerStyleSheet
 *    and injectViewerStyles in the original same-origin architecture).
 *  - "debug": crop marks, page box overlays, bleed/safe area indicators.
 */

/** Build the canvas + view-mode stylesheet, parameterised by background color. */
export function buildViewerStyles(bg: string): string {
  return `
/* Injected by print-md viewer — not in preview.css (Paged.js strips @media pagedjs-ignore) */

/* Zoom — set via --pmd-zoom CSS custom property (JS sets the number) */
html { --pmd-zoom: 1; }
.pagedjs_pages { zoom: var(--pmd-zoom) !important; }

/* Canvas (space around pages) */
html, body {
  background-color: ${bg} !important;
  min-height: 100% !important;
}
body {
  margin: 0 !important;
  padding: 0 0 32px !important;
}

/* Spread container (two-page side-by-side default) */
.pagedjs_pages {
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: wrap !important;
  /* Center each row so a LONE page (the cover, or an odd last page) sits in the
     middle of the spread instead of flex-starting to the left half, leaving the
     right half empty. Full two-page rows fill the fixed width exactly, so
     centering is a no-op for them. */
  justify-content: center !important;
  width: calc(var(--pagedjs-width) * 2 + 8mm) !important;
  margin: 20mm auto !important;
  row-gap: 20mm !important;
  column-gap: 8mm !important;
}

/* Page shadows */
.pagedjs_page {
  margin: 0 !important;
  box-shadow:
    0 2px 6px rgba(0, 0, 0, 0.40),
    0 8px 28px rgba(0, 0, 0, 0.35) !important;
}

/* Reset Paged.js bleed offsets so column-gap controls the gutter */
.pagedjs_left_page .pagedjs_sheet { margin-left: 0 !important; }
.pagedjs_right_page { position: relative !important; left: 0 !important; }

/* Single-page mode */
body.view-single .pagedjs_pages {
  flex-direction: column !important;
  width: fit-content !important;
  align-items: center !important;
  row-gap: 16mm !important;
}
body.view-single .pagedjs_right_page {
  left: 0 !important;
  position: relative !important;
}
body.view-single .pagedjs_left_page .pagedjs_sheet { margin-left: 0 !important; }
body.view-single .pagedjs_left_page {
  width: calc(var(--pagedjs-bleed-left) + var(--pagedjs-pagebox-width) + var(--pagedjs-bleed-right)) !important;
}

/* Two-column mode */
body.view-two-column .pagedjs_pages {
  flex-direction: row !important;
  flex-wrap: wrap !important;
  justify-content: center !important;
  width: calc(var(--pagedjs-width) * 2 + 8mm) !important;
  row-gap: 20mm !important;
  column-gap: 8mm !important;
  align-items: flex-start !important;
}
body.view-two-column .pagedjs_page { margin: 0 !important; }
body.view-two-column .pagedjs_first_page { margin-left: 0 !important; }
body.view-two-column .pagedjs_right_page { position: relative !important; left: 0 !important; }
body.view-two-column .pagedjs_left_page .pagedjs_sheet { margin-left: 0 !important; }
body.view-two-column .pagedjs_left_page {
  width: calc(var(--pagedjs-bleed-left) + var(--pagedjs-pagebox-width)) !important;
}
`.trim();
}

/** Debug-mode CSS: crop marks, page box overlays, bleed/safe area indicators. */
export const DEBUG_STYLES = `
/* Debug mode — injected by print-md viewer; scoped under body.debug */
body.debug {
  --color-pageBox: violet;
  --pagedjs-crop-color: black;
  --pagedjs-crop-shadow: white;
  --pagedjs-mark-cross-display: block;
  --pagedjs-mark-crop-display: block;
}
body.debug .pagedjs_pagebox {
  box-shadow: 0 0 0 1px violet !important;
}
body.debug .pagedjs_margin-top-left-corner-holder,
body.debug .pagedjs_margin-top,
body.debug .pagedjs_margin-top-left,
body.debug .pagedjs_margin-top-center,
body.debug .pagedjs_margin-top-right,
body.debug .pagedjs_margin-top-right-corner-holder,
body.debug .pagedjs_margin-bottom-left-corner-holder,
body.debug .pagedjs_margin-bottom,
body.debug .pagedjs_margin-bottom-left,
body.debug .pagedjs_margin-bottom-center,
body.debug .pagedjs_margin-bottom-right,
body.debug .pagedjs_margin-bottom-right-corner-holder,
body.debug .pagedjs_margin-right,
body.debug .pagedjs_margin-right-top,
body.debug .pagedjs_margin-right-middle,
body.debug .pagedjs_margin-right-bottom,
body.debug .pagedjs_margin-left,
body.debug .pagedjs_margin-left-top,
body.debug .pagedjs_margin-left-middle,
body.debug .pagedjs_margin-left-bottom {
  box-shadow: 0 0 0 1px inset rgba(255, 0, 255, 0.3) !important;
}
body.debug .pagedjs_bleed-top,
body.debug .pagedjs_bleed-bottom,
body.debug .pagedjs_bleed-left,
body.debug .pagedjs_bleed-right {
  background-color: rgba(255, 0, 0, 0.08) !important;
}
body.debug .pagedjs_area {
  outline: 1px dashed rgba(0, 150, 255, 0.5) !important;
  outline-offset: -1px;
}
`.trim();
