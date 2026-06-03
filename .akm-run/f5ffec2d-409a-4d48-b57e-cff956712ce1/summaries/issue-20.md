## Issue #20

- Verdict: accepted
- Branch: `release/0.2.0`
- Reviewer notes: toolbar page navigation now uses a styled read-only pill that switches into inline edit mode, validates on blur/Enter, and reverts on Escape.
- Tester logs:
  - `bun run --cwd packages/viewer check`
  - `bun run --cwd packages/viewer typecheck`
  - `bun --filter @dimm-city/print-md test`
  - `bun run --cwd packages/viewer build`
  - `bun run --cwd packages/viewer electron:build`
- Residual risk: the chapter-jump dropdown stretch goal is intentionally deferred.
