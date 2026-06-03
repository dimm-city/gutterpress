## Issue #19

- Verdict: accepted
- Branch: `release/0.2.0`
- Reviewer notes: loading overlay now shows live layout progress, exposes cancel during rendering, and returns the app to the empty state by stopping the preview server.
- Tester logs:
  - `bun run --cwd packages/viewer check`
  - `bun run --cwd packages/viewer typecheck`
  - `bun --filter @dimm-city/print-md test`
  - `bun run --cwd packages/viewer build`
  - `bun run --cwd packages/viewer electron:build`
- Residual risk: render progress currently uses page-count growth from the preview DOM, so exact progress cadence depends on how Paged.js emits page nodes.
