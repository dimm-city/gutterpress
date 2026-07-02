/**
 * Shared desktop/doctor hooks for server routes that need Electron host APIs.
 */

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

const DESKTOP_GLOBAL_KEY = '__printMdDesktopHooks__' as const;
const DOCTOR_GLOBAL_KEY = '__printMdDoctorHooks__' as const;

declare global {
  // eslint-disable-next-line no-var
  var __printMdDesktopHooks__: DesktopHooks | undefined;
  // eslint-disable-next-line no-var
  var __printMdDoctorHooks__: DoctorHooks | undefined;
}

export function registerDesktopHooks(hooks: DesktopHooks): void {
  globalThis[DESKTOP_GLOBAL_KEY] = hooks;
}

export function getDesktopHooks(): DesktopHooks | null {
  return globalThis[DESKTOP_GLOBAL_KEY] ?? null;
}

export function registerDoctorHooks(hooks: DoctorHooks): void {
  globalThis[DOCTOR_GLOBAL_KEY] = hooks;
}

export function getDoctorHooks(): DoctorHooks | null {
  return globalThis[DOCTOR_GLOBAL_KEY] ?? null;
}
