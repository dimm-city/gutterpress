/**
 * Shared shape for a crash-recovery entry.
 *
 * Lives in a plain `.ts` module rather than inside `CrashRecoveryDialog.svelte`
 * because non-Svelte code needs it: TypeScript's ambient `*.svelte` declaration
 * exposes only a component default export, so a `import type { RecoveryItem }
 * from "….svelte"` fails to typecheck outside svelte-check.
 */
export interface RecoveryItem {
  filePath: string;
  recoveryPath: string;
  fileName: string;
  savedAt: number;
}
