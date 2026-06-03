## Issue #18

- Verdict: accepted
- Branch: `issue-18-viewer-chromium`
- Worktree: `/tmp/opencode/print-md-issue-18`
- Reviewer notes: viewer `doctor` payload now replaces the external browser row with a positive built-in Chromium row using Electron's Chromium version.
- Tester logs:
  - `bun run --cwd packages/viewer check`
  - `bun run --cwd packages/viewer typecheck`
- Residual risk: the viewer-side filter currently matches the external Chromium row by its `bin` string.
