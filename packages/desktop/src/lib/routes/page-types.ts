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
// process. currentPage/splitPaneRatio are live (mirrors the canonical
// `ProjectState` in platform/shared-types.ts); lastChapter/sidebarOpen/
// cursorLine/editorScroll are dead schema — declared for the in-app editor
// (#38) / chapter list (#42), which shipped without ever consuming them (the
// canonical ProjectState dropped them under #30; this legacy duplicate still
// carries them so old persisted JSON keeps parsing). `viewMode` was a live
// field until view mode stopped being stored at all — it is now derived from
// the workspace mode, so nothing reads a per-project snapshot of it.
export type PersistedProjectState = {
  currentPage?: number;
  lastChapter?: string;
  sidebarOpen?: boolean;
  cursorLine?: number;
  editorScroll?: number;
  splitPaneRatio?: number;
};
