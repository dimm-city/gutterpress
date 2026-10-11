/**
 * Which left-panel tabs are shown — pure, so the rule is unit-tested and the
 * panel just renders it. (`projects` is the Books tab's internal id; it is
 * also the id of the persisted `leftPanel.activeTab` value.)
 */
export type LeftPanelTabId = "projects" | "toc" | "files" | "media";

/** Every tab, in display order. */
export const LEFT_PANEL_TAB_IDS: readonly LeftPanelTabId[] = ["projects", "toc", "files", "media"];

/**
 * TEMPORARY: hides the left panel's Books tab while the product owner decides
 * whether the status bar's folder button (which opens the start screen's Books
 * tab) replaces it. Nothing is deleted — set this to `false` to bring the tab
 * back exactly as it was (the tab's panel, list and persisted selection are
 * all still wired).
 */
export const HIDE_BOOKS_TAB = true;

/** Reader mode (Settings → App) keeps only Books and TOC: Files and Media are for editing. */
export function visibleTabIds(readerMode: boolean, hideBooks: boolean = HIDE_BOOKS_TAB): LeftPanelTabId[] {
  return LEFT_PANEL_TAB_IDS.filter((id) => (readerMode ? id === "projects" || id === "toc" : true)).filter(
    (id) => !(hideBooks && id === "projects"),
  );
}

/**
 * The tab actually shown: the active one, or the first visible tab when the
 * active (e.g. remembered) one is hidden — a remembered Files/Media in reader
 * mode, or a remembered Books while it is hidden. The stored value is left
 * alone, so un-hiding restores the author's choice.
 */
export function shownTabId(active: LeftPanelTabId, visible: readonly LeftPanelTabId[]): LeftPanelTabId {
  return visible.includes(active) ? active : (visible[0] ?? active);
}
