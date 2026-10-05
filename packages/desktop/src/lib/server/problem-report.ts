/**
 * "Report a problem" — the diagnostic bundle an author pastes into a GitHub
 * issue. Host code; pure (data in, text out) so it is testable. The route
 * (`api/report/bundle`) gathers the inputs; nothing here touches disk.
 *
 * Deliberately NOT a telemetry channel: the author sees the full text, copies
 * it, and files the issue themselves in their browser. Nothing leaves the
 * machine until they submit the form on github.com.
 *
 * Privacy: the book section is a SUMMARY of the manifest (preset, targets,
 * styles, extensions, page size …) — never title, authors, publish settings
 * or chapter text. The author's home directory is replaced with `~` across
 * the whole report so tool paths and log lines carry no username.
 */

export const ISSUE_URL = 'https://github.com/dimm-city/gutterpress/issues/new';
/** `.github/ISSUE_TEMPLATE/bug_report.yml` — its field ids are the prefill query params. */
export const ISSUE_TEMPLATE = 'bug_report.yml';
/** Tail of the app log to include — enough context, small enough to paste. */
export const LOG_TAIL_BYTES = 8 * 1024;

export interface ProblemReportTool {
  name: string;
  found: boolean;
  version?: string;
  path?: string;
}

export interface ProblemReportInput {
  desktopVersion: string;
  libVersion: string;
  electronVersion?: string;
  chromeVersion?: string;
  platform: { os: string; arch: string; release: string; node: string };
  configDir: string;
  tools: ProblemReportTool[];
  /** `summarizeManifest()` lines, or null when no book is open. */
  book: string[] | null;
  /** Tail of the app log, or null when it could not be read. */
  appLog: string | null;
  /** `os.homedir()` — redacted to `~` everywhere in the output. */
  homeDir: string;
}

/** The manifest fields a bug report needs — the shape, never the content. */
export interface ManifestLike {
  preset?: string;
  targets?: string[];
  styles?: string[];
  extensions?: Array<string | { use: string }>;
  source?: { files?: string[] | null };
  page?: { width?: number; height?: number };
  pdfx?: { flavor?: string };
  print?: { signature?: number };
  lint?: { enabled?: boolean };
  validate?: { enabled?: boolean };
}

export function summarizeManifest(m: ManifestLike, markdownFileCount: number): string[] {
  const list = (xs: string[] | undefined) => (xs && xs.length ? xs.join(', ') : '(none)');
  const lines = [
    `preset: ${m.preset ?? '(default)'}`,
    `targets: ${list(m.targets)}`,
    `styles: ${list(m.styles)}`,
    `extensions: ${list(m.extensions?.map((e) => (typeof e === 'string' ? e : e.use)))}`,
    `source files: ${m.source?.files ? `${m.source.files.length} listed` : 'all chapter files'} (${markdownFileCount} .md in book folder)`,
  ];
  if (m.page?.width || m.page?.height) lines.push(`page: ${m.page.width ?? '?'} × ${m.page.height ?? '?'}`);
  if (m.pdfx?.flavor) lines.push(`pdfx: ${m.pdfx.flavor}`);
  if (m.print?.signature) lines.push(`print signature: ${m.print.signature}`);
  if (m.lint?.enabled === false) lines.push('lint: disabled');
  if (m.validate?.enabled === false) lines.push('validate: disabled');
  return lines;
}

/** Last `maxBytes` of a log, cut at a line boundary. */
export function tailLog(text: string, maxBytes = LOG_TAIL_BYTES): string {
  const trimmed = text.trimEnd();
  if (Buffer.byteLength(trimmed) <= maxBytes) return trimmed;
  const tail = trimmed.slice(-maxBytes);
  const nl = tail.indexOf('\n');
  return nl === -1 ? tail : tail.slice(nl + 1);
}

export function redactHome(text: string, homeDir: string): string {
  if (!homeDir) return text;
  // Both separators: a Windows home shows up as C:\Users\x and C:/Users/x.
  const variants = new Set([homeDir, homeDir.replace(/\\/g, '/')]);
  let out = text;
  for (const v of variants) if (v) out = out.split(v).join('~');
  return out;
}

export interface ProblemReport {
  /** The full Markdown report (system + book + log tail) for the clipboard. */
  report: string;
  /** `issues/new` with the system + book sections prefilled; the log is pasted. */
  issueUrl: string;
}

export function formatProblemReport(input: ProblemReportInput): ProblemReport {
  const tools = input.tools
    .map((t) => `${t.name}: ${t.found ? `${t.version ?? 'found'}${t.path ? ` (${t.path})` : ''}` : 'NOT FOUND'}`)
    .join(' · ');
  const system = [
    `## System`,
    `- Gutterpress desktop ${input.desktopVersion}, lib ${input.libVersion}`,
    `- Electron ${input.electronVersion ?? '?'} · Chromium ${input.chromeVersion ?? '?'} · Node ${input.platform.node}`,
    `- ${input.platform.os} ${input.platform.arch} (${input.platform.release})`,
    `- config directory: ${input.configDir}`,
    `- tools: ${tools || '(none)'}`,
  ];
  const book = ['## Book', ...(input.book ? input.book.map((l) => `- ${l}`) : ['- (no book open)'])];
  const log = [
    '## App log (tail)',
    '```',
    input.appLog === null ? '(app log unavailable)' : input.appLog || '(empty)',
    '```',
  ];
  const diagnostics = redactHome([...system, '', ...book].join('\n'), input.homeDir);
  const report = redactHome([...system, '', ...book, '', ...log].join('\n'), input.homeDir);
  const params = new URLSearchParams({ template: ISSUE_TEMPLATE, diagnostics });
  return { report, issueUrl: `${ISSUE_URL}?${params}` };
}
