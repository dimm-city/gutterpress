/**
 * Local type declarations for the `+page.svelte` composition root.
 *
 * These are pure structural types used only by the workspace page and its
 * extracted controllers. Kept here (type-only, erased at build) so the page
 * component itself stays focused on wiring, per the Phase 5 decomposition.
 */

import type { DoctorDiagnostics } from "$lib/api";

/** One diagnosed tool row, as returned by `api.doctor()` (ARCH review #40). */
export type DiagnosticsTool = DoctorDiagnostics["tools"][number];

export type UrlPreviewBlockedEvent = {
  url: string;
  reason: string;
};

export type PageState = {
  currentPage?: number;
  totalPages?: number;
};

// Per-project editor/preview state (#43), keyed by folder path in the main
// process. currentPage/viewMode are live; the rest are dead schema for the
// forthcoming in-app editor (#38) / chapter list (#42).
export type PersistedProjectState = {
  currentPage?: number;
  viewMode?: "single" | "two-column";
  lastChapter?: string;
  sidebarOpen?: boolean;
  cursorLine?: number;
  editorScroll?: number;
  splitPaneRatio?: number;
};
