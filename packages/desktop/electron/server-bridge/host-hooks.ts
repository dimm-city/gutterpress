/**
 * Shared desktop/doctor hooks for server routes that need Electron host APIs.
 *
 * Routes reach them through `getHostServices().desktop` / `.doctor` /
 * `.appImage` (`./host-services.ts`).
 */

import type {
  AppImageInstallResult,
  AppImageRemoveResult,
  AppImageStatus,
} from '../appimage-integration';

interface DialogFilter {
  name: string;
  extensions: string[];
}

interface OpenDialogOptions {
  title?: string;
  properties?: string[];
  filters?: DialogFilter[];
}

interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: DialogFilter[];
}

/** The author's answer to the unsaved-changes prompt. */
export type UnsavedChoice = "save" | "discard" | "cancel";

export interface DesktopHooks {
  showOpenDialog: (options: OpenDialogOptions) => Promise<{
    canceled: boolean;
    filePaths: string[];
  }>;
  showSaveDialog: (options: SaveDialogOptions) => Promise<{
    canceled: boolean;
    filePath?: string;
  }>;
  /** Native trust gate shown before downloading and executing an npm plugin. */
  confirmNpmPluginInstall: (packageName: string) => Promise<boolean>;
  /**
   * Native Save / Don't Save / Cancel prompt for leaving a file with unsaved
   * edits while "Save edits automatically" is off. `fileName` null = the
   * whole window is closing.
   */
  confirmUnsavedChanges: (fileName: string | null) => Promise<UnsavedChoice>;
  openExternal: (url: string) => Promise<void>;
  showItemInFolder: (filePath: string) => void;
  /** Create (if needed) and open the diagnostic logs folder in the OS file manager. */
  openLogsFolder: () => Promise<void>;
  getNativeTheme: () => { shouldUseDarkColors: boolean };
  getUserDataPath: () => string;
}

export interface DoctorHooks {
  getDesktopVersion: () => string;
}

/**
 * Linux AppImage application-menu integration (#119).
 *
 * Fixed-argument by design: the three operations take NO parameters, so the
 * renderer can never supply an install path — the managed destinations are
 * computed host-side from `app.getPath("home")` + `$XDG_DATA_HOME` inside
 * `electron/appimage-integration.ts`.
 */
export interface AppImageHooks {
  /** Supported/installed/repair-needed state. Safe to call on every platform. */
  getStatus: () => Promise<AppImageStatus>;
  /** Install or repair the managed AppImage, icon, and desktop entry. */
  install: () => Promise<AppImageInstallResult>;
  /** Remove the desktop entry + icon (idempotent). */
  remove: () => Promise<AppImageRemoveResult>;
}
