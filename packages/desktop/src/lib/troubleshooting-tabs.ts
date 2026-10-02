/**
 * The Troubleshooting view's sub-tab contract, mirroring `settings-tabs.ts`:
 * shared by `TroubleshootingView.svelte` and `WelcomeLanding.svelte`'s
 * `showTab("troubleshooting", sub)` deep link. Any value that is not a known
 * id (a stray MouseEvent, say) collapses to the default "diagnostics" tab so
 * the panel can never render empty.
 */

export const TROUBLESHOOTING_TAB_IDS = ["diagnostics", "logs", "sync"] as const;

export type TroubleshootingTab = (typeof TROUBLESHOOTING_TAB_IDS)[number];

/** Collapse any unknown value to a real tab id (default "diagnostics"). */
export function sanitizeTroubleshootingTab(value: unknown): TroubleshootingTab {
  return TROUBLESHOOTING_TAB_IDS.includes(value as TroubleshootingTab)
    ? (value as TroubleshootingTab)
    : "diagnostics";
}
