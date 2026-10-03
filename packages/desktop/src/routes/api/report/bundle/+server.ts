/**
 * POST /api/report/bundle — the "Report a problem" diagnostic bundle: system
 * details, a summary of the open book's manifest, and the tail of the app log,
 * formatted for a GitHub issue. Read-only; sends nothing anywhere — the
 * author copies the text and files the issue in their browser.
 */
import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { formatProblemReport, summarizeManifest, tailLog, type ProblemReport } from '$lib/server/problem-report.js';
import { APP_LOG_FILENAME } from '../../../../../electron/recovery-paths';
import { defineRoute, getHostServices, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

async function readAppLogTail(): Promise<string | null> {
  for (const root of getHostServices().fsGuard.readOnlyRoots()) {
    try {
      return tailLog(await readFile(path.join(root, APP_LOG_FILENAME), 'utf-8'));
    } catch {
      // not this root (recovery dir), or no log yet
    }
  }
  return null;
}

async function summarizeBook(lib: Awaited<ReturnType<typeof loadLib>>, projectDir: string): Promise<string[]> {
  try {
    const manifest = await lib.loadManifest(projectDir);
    const mdCount = (await readdir(projectDir)).filter((n) => n.endsWith('.md')).length;
    return summarizeManifest(manifest, mdCount);
  } catch (e) {
    return [`manifest could not be read: ${e instanceof Error ? e.message : String(e)}`];
  }
}

export const POST: RequestHandler = defineRoute<{ projectDir: string | null }>({
  validate: async (raw) => {
    const projectDir = (raw as { projectDir?: unknown } | null)?.projectDir;
    return { projectDir: projectDir ? await requireProjectDir(projectDir, 'report/bundle') : null };
  },
  call: async ({ body }): Promise<ProblemReport> => {
    const lib = await loadLib();
    const diag = await lib.getSystemDiagnostics();
    return formatProblemReport({
      desktopVersion: getHostServices().doctor.getDesktopVersion(),
      libVersion: diag.libVersion,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      platform: diag.platform,
      configDir: diag.configDir,
      tools: diag.tools.filter((t) => t.id !== 'chromium'),
      book: body.projectDir ? await summarizeBook(lib, body.projectDir) : null,
      appLog: await readAppLogTail(),
      homeDir: os.homedir(),
    });
  },
});
