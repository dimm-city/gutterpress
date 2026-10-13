/**
 * Report a problem → the prefilled GitHub issue. Pure and node-free (the
 * renderer builds the link as the author types). The query keys are the field
 * ids of `.github/ISSUE_TEMPLATE/bug_report.yml`; renaming one there breaks it.
 */

export const ISSUE_URL = 'https://github.com/dimm-city/gutterpress/issues/new';
export const ISSUE_TEMPLATE = 'bug_report.yml';
/** GitHub answers a much longer issues/new link with an error page, so the log is cut to fit. */
export const MAX_ISSUE_URL = 8000;
export const LOG_TRIMMED_NOTE = '… earlier lines left out to fit the link (the full log is on your clipboard)';

export interface IssueAnswers {
  title: string;
  whatHappened: string;
  expected: string;
  steps: string;
}

export interface IssueBundle {
  /** System + book sections (Markdown). */
  diagnostics: string;
  /** App log tail, or a "(app log unavailable)" line. */
  log: string;
}

/** The issues/new link with every field filled in; the log keeps its newest lines that fit. */
export function buildIssueUrl(
  answers: IssueAnswers,
  bundle: IssueBundle,
  max = MAX_ISSUE_URL,
): { url: string; logTrimmed: boolean } {
  const params = new URLSearchParams({ template: ISSUE_TEMPLATE });
  if (answers.title.trim()) params.set('title', `[Bug]: ${answers.title.trim()}`);
  if (answers.whatHappened.trim()) params.set('what-happened', answers.whatHappened.trim());
  if (answers.expected.trim()) params.set('expected', answers.expected.trim());
  if (answers.steps.trim()) params.set('steps', answers.steps.trim());
  params.set('diagnostics', bundle.diagnostics);
  const base = `${ISSUE_URL}?${params}`;
  const lines = bundle.log.split('\n');
  for (let drop = 0; drop <= lines.length; drop++) {
    const kept = lines.slice(drop).join('\n');
    const log = drop === 0 ? kept : [LOG_TRIMMED_NOTE, kept].filter(Boolean).join('\n');
    const url = `${base}&${new URLSearchParams({ log })}`;
    if (url.length <= max) return { url, logTrimmed: drop > 0 };
  }
  return { url: base, logTrimmed: true };
}

/** The clipboard copy: the author's answers, then the full report (log untrimmed). */
export function reportText(answers: IssueAnswers, report: string): string {
  const section = (heading: string, text: string) => (text.trim() ? [`## ${heading}`, text.trim(), ''] : []);
  return [
    ...section('Summary', answers.title),
    ...section('What happened?', answers.whatHappened),
    ...section('What did you expect?', answers.expected),
    ...section('Steps to reproduce', answers.steps),
    report,
  ].join('\n');
}
