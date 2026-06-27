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

export interface UpdaterStatus {
  currentVersion: string | null;
}

export interface DoctorHooks {
  getUpdaterStatus: () => Promise<UpdaterStatus>;
  getViewerVersion: () => string;
}

export function getDesktopHooks(): DesktopHooks | null {
  return (globalThis as unknown as { __printMdDesktopHooks__?: DesktopHooks }).__printMdDesktopHooks__ ?? null;
}

export function getDoctorHooks(): DoctorHooks | null {
  return (globalThis as unknown as { __printMdDoctorHooks__?: DoctorHooks }).__printMdDoctorHooks__ ?? null;
}
