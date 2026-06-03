## Issue #21

- Verdict: accepted
- Branch: `release/0.2.0`
- Reviewer notes: PDF export now runs inside a main-process export session with a temp output path, cancel IPC, hidden-window teardown on cancel, export-id keyed progress events, elapsed-time updates after 3 seconds, polite live announcements, and a 2-second success hold.
- Tester logs:
  - `bun run --cwd packages/viewer check`
  - `bun run --cwd packages/viewer typecheck`
  - `bun --filter @dimm-city/print-md test`
  - `bun run --cwd packages/viewer build`
  - `bun run --cwd packages/viewer electron:build`
- Residual risk: cancellation during `printToPDF()` relies on destroying the hidden export window and treating the resulting rejection as a canceled export session.
