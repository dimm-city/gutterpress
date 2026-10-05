/**
 * One-click install of the optional pre-press tools (Ghostscript, qpdf).
 * Host code. `planToolInstall` is pure (platform + a bin probe in, a command
 * out) so it is testable; the route re-plans server-side and never runs
 * anything the renderer sends.
 */
import { spawnSync } from 'node:child_process';

export type ToolId = 'gs' | 'qpdf';

export interface ToolInstallPlan {
  command: string;
  args: string[];
  label: string;
}

export const TOOL_DOWNLOAD_URLS: Record<ToolId, string> = {
  gs: 'https://www.ghostscript.com/releases/gsdnld.html',
  qpdf: 'https://github.com/qpdf/qpdf/releases',
};

const PKG: Record<ToolId, string> = { gs: 'ghostscript', qpdf: 'qpdf' };
const WINGET_ID: Record<ToolId, string> = { gs: 'ArtifexSoftware.GhostScript', qpdf: 'QPDF.QPDF' };

export function isToolId(id: unknown): id is ToolId {
  return id === 'gs' || id === 'qpdf';
}

export function planToolInstall(
  toolId: ToolId,
  platform: NodeJS.Platform,
  hasBin: (bin: string) => boolean,
): ToolInstallPlan | null {
  const pkg = PKG[toolId];
  if (platform === 'linux') {
    if (hasBin('apt-get')) return { command: 'pkexec', args: ['apt-get', 'install', '-y', pkg], label: 'Install with apt' };
    if (hasBin('dnf')) return { command: 'pkexec', args: ['dnf', 'install', '-y', pkg], label: 'Install with dnf' };
    if (hasBin('pacman')) return { command: 'pkexec', args: ['pacman', '-S', '--noconfirm', pkg], label: 'Install with pacman' };
    return null;
  }
  if (platform === 'darwin' && hasBin('brew')) {
    return { command: 'brew', args: ['install', pkg], label: 'Install with Homebrew' };
  }
  if (platform === 'win32' && hasBin('winget')) {
    return {
      command: 'winget',
      args: ['install', '--id', WINGET_ID[toolId], '-e', '--accept-source-agreements', '--accept-package-agreements'],
      label: 'Install with winget',
    };
  }
  return null;
}

/** Production `hasBin`: is `bin` on PATH? */
export function binOnPath(bin: string): boolean {
  return spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }).status === 0;
}
