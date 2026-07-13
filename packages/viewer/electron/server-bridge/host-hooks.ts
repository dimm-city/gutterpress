/**
 * Shared desktop/doctor hooks for server routes that need Electron host APIs.
 *
 * Storage lives in the single collapsed host object (ARCH review #31,
 * `./host-services.ts`) — `getDesktopHooks()`/`getDoctorHooks()` are thin
 * derived selectors over it.
 */

import { getHostServices } from './host-services';

export interface DialogFilter {
  name: string;
  extensions: string[];
}

export interface OpenDialogOptions {
  title?: string;
  properties?: string[];
  filters?: DialogFilter[];
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: DialogFilter[];
}

export interface DesktopHooks {
  showOpenDialog: (options: OpenDialogOptions) => Promise<{
    canceled: boolean;
    filePaths: string[];
  }>;
  showSaveDialog: (options: SaveDialogOptions) => Promise<{
    canceled: boolean;
    filePath?: string;
  }>;
  openExternal: (url: string) => Promise<void>;
  showItemInFolder: (filePath: string) => void;
  getNativeTheme: () => { shouldUseDarkColors: boolean };
  getUserDataPath: () => string;
}

export interface DoctorHooks {
  getViewerVersion: () => string;
}

/** The live `DesktopHooks` slice of the collapsed host object, or null before `registerHostServices` runs. */
export function getDesktopHooks(): DesktopHooks | null {
  return getHostServices()?.desktop ?? null;
}

/** The live `DoctorHooks` slice of the collapsed host object, or null before `registerHostServices` runs. */
export function getDoctorHooks(): DoctorHooks | null {
  return getHostServices()?.doctor ?? null;
}
