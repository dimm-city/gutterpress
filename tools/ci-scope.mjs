import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const gates = ['cli', 'desktop', 'plugin', 'tooling', 'render', 'preview', 'behaviour', 'audit'];

export function selectGates(files, full = false) {
  const selected = new Set(full ? gates : []);
  const add = (...names) => names.forEach(name => selected.add(name));
  for (const file of files) {
    // Prose is different from Markdown shipped as a template or test fixture.
    if (/^[^/]+\.md$/.test(file) ||
        (file.startsWith('docs/') && !file.startsWith('docs/fixtures/')) ||
        /^packages\/[^/]+\/(?:[^/]+\.md$|docs\/)/.test(file) ||
        /^packaging\/[^/]+\.md$/.test(file) || file.startsWith('website/')) continue;
    if (file === 'bun.lock' || file === 'package.json' || /^packages\/[^/]+\/package.json$/.test(file)) {
      add(...gates);
    } else if (file.startsWith('packages/cli/')) {
      add('cli');
      if (file.includes('/tests/compat/')) add('preview');
      else if (!/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) &&
               !/^packages\/cli\/(?:tests|src\/test-helpers)\//.test(file)) {
        add('desktop', 'plugin', 'render', 'preview', 'behaviour');
      }
    } else if (file.startsWith('packages/desktop/')) {
      add('desktop');
      if (!/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) &&
          (!file.includes('/tests/') || file.includes('/tests/integration/'))) add('behaviour');
    } else if (file.startsWith('packages/open-design-plugin/')) {
      add('plugin');
    } else if (/^(?:examples|docs\/fixtures)\//.test(file)) {
      add('cli', 'render', 'preview');
    } else if (/^(?:Formula|bucket|packaging)\//.test(file) ||
               /^tools\/(?:prepare-release-assets|update-package-managers)(?:\.test)?\.mjs$/.test(file)) {
      add('tooling');
    } else if (file === 'Dockerfile' || file === '.dockerignore') {
      // Docker has its own build gate.
    } else {
      // New packages, shared config, workflow edits and unknown paths run all gates.
      add(...gates);
    }
  }
  return Object.fromEntries(gates.map(name => [name, selected.has(name)]));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const base = event.pull_request?.base.sha ?? event.before;
  let full = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' || !base || /^0+$/.test(base);
  let files = [];
  if (!full) {
    try {
      execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', base], { stdio: 'inherit' });
      // Treat renames as deletion + addition so moving code into docs cannot hide it.
      files = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', base, 'HEAD'],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean);
    } catch (error) {
      console.warn(`Cannot establish changed paths; running all gates: ${error.message}`);
      full = true;
    }
  }
  const result = selectGates(files, full);
  for (const [key, value] of Object.entries(result)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  console.log(JSON.stringify({ files, gates: result }, null, 2));
}
