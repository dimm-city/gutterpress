import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectGates } from './ci-scope.mjs';

const enabled = (files, full) => Object.entries(selectGates(files, full)).filter(([, value]) => value).map(([key]) => key).sort();
const all = ['audit', 'behaviour', 'cli', 'desktop', 'plugin', 'preview', 'render', 'tooling'];

for (const [name, files, expected] of [
  ['prose only', ['AGENTS.md', 'docs/architecture-rules.md', 'packages/cli/README.md', 'website/site/about.md'], []],
  ['desktop unit tests', ['packages/desktop/tests/editor/save.test.ts'], ['desktop']],
  ['desktop source', ['packages/desktop/src/lib/Editor.svelte'], ['behaviour', 'desktop']],
  ['desktop acceptance', ['packages/desktop/tests/integration/editor.pw.mjs'], ['behaviour', 'desktop']],
  ['CLI unit test', ['packages/cli/src/bun-serve-drift.test.ts'], ['cli']],
  ['CLI test helpers', ['packages/cli/src/test-helpers/testkit.ts'], ['cli']],
  ['preview test', ['packages/cli/tests/compat/preview-smoke.pw.ts'], ['cli', 'preview']],
  ['CLI runtime and consumers', ['packages/cli/src/lib/manifest.ts'], ['behaviour', 'cli', 'desktop', 'plugin', 'preview', 'render']],
  ['shipped Markdown template', ['packages/cli/src/assets/templates/book/chapter-01.md'], ['behaviour', 'cli', 'desktop', 'plugin', 'preview', 'render']],
  ['rendering fixtures', ['docs/fixtures/recto-chapters/book/01-chapters.md'], ['cli', 'preview', 'render']],
  ['plugin instructions', ['packages/open-design-plugin/plugin/SKILL.md'], ['plugin']],
  ['release metadata', ['Formula/gutterpress.rb', 'tools/update-package-managers.test.mjs'], ['tooling']],
  ['container only', ['Dockerfile', '.dockerignore'], []],
  ['dependencies', ['bun.lock'], all],
  ['package manifest', ['packages/desktop/package.json'], all],
  ['CI configuration', ['.github/workflows/ci.yml'], all],
  ['new package', ['packages/new-package/src/index.ts'], all],
  ['shared config', ['tsconfig.json'], all],
  ['mixed docs and code', ['README.md', 'packages/desktop/src/app.html'], ['behaviour', 'desktop']],
  ['code deleted or renamed into docs', ['packages/cli/src/lib/old.ts', 'docs/old.md'], ['behaviour', 'cli', 'desktop', 'plugin', 'preview', 'render']],
]) test(name, () => assert.deepEqual(enabled(files), expected));

test('manual or uncertain diff runs every gate', () => assert.deepEqual(enabled([], true), all));

test('CLI handles a real Git rename and falls back safely when the base is unavailable', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ci-scope-'));
  const script = fileURLToPath(new URL('./ci-scope.mjs', import.meta.url));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init', '-q');
    git('config', 'user.name', 'CI test');
    git('config', 'user.email', 'ci@example.invalid');
    mkdirSync(path.join(dir, 'packages/cli/src'), { recursive: true });
    writeFileSync(path.join(dir, 'packages/cli/src/old.ts'), 'export const old = true;\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    git('remote', 'add', 'origin', dir);
    mkdirSync(path.join(dir, 'docs'));
    git('mv', 'packages/cli/src/old.ts', 'docs/old.md');
    git('commit', '-qm', 'rename');
    for (const [sha, expectAudit] of [[base, false], ['f'.repeat(40), true]]) {
      const output = path.join(dir, 'outputs');
      const event = path.join(dir, 'event.json');
      writeFileSync(output, '');
      writeFileSync(event, JSON.stringify({ before: sha }));
      execFileSync(process.execPath, [script], {
        cwd: dir,
        env: { ...process.env, GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const result = readFileSync(output, 'utf8');
      assert.match(result, /cli=true/);
      assert.match(result, /render=true/);
      assert.match(result, new RegExp(`audit=${expectAudit}`));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
