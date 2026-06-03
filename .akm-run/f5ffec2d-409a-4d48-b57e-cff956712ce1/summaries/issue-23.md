## Issue #23

- Verdict: accepted
- Branch: `release/0.2.0`
- Reviewer notes: PDF success notifications now persist for 8 seconds and include a Show in Folder action wired through Electron shell IPC.
- Tester logs:
  - `bun run --cwd packages/viewer check`
  - `bun run --cwd packages/viewer typecheck`
  - `bun --filter @dimm-city/print-md test`
  - `bun run --cwd packages/viewer build`
  - `bun run --cwd packages/viewer electron:build`
- Residual risk: no automated toast action coverage exists yet.
