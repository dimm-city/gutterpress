## Issue #24

- Verdict: accepted
- Branch: `issue-24-pre-export-check`
- Worktree: `/tmp/opencode/print-md-issue-24`
- Reviewer notes: Save PDF now blocks before the file dialog when no folder is open, while the preview is still rendering, or when cached diagnostics indicate a required Save PDF tool is unavailable.
- Tester logs:
  - `bun run --cwd packages/viewer check`
  - `bun run --cwd packages/viewer typecheck`
- Residual risk: there is no dedicated automated coverage yet for the new inline warning flow.
