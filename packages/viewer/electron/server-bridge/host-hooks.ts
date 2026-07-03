/**
 * Shared desktop/doctor hooks for server routes that need Electron host APIs.
 */

import { createHostBridge } from './create-host-bridge';

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

export const { register: registerDesktopHooks, get: getDesktopHooks } =
  createHostBridge<DesktopHooks>('__printMdDesktopHooks__');

export const { register: registerDoctorHooks, get: getDoctorHooks } =
  createHostBridge<DoctorHooks>('__printMdDoctorHooks__');
