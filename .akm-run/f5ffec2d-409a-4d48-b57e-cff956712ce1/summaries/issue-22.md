## Issue #22

- Verdict: accepted
- Branch: `issue-22-focus-trap`
- Worktree: `/tmp/opencode/print-md-issue-22`
- Reviewer notes: both dialogs now keep Tab/Shift+Tab within the modal, preserve trigger focus on close, and keep initial focus inside the dialog; the URL dialog still focuses its input first.
- Tester logs:
  - `bun run --cwd packages/viewer check`
  - `bun run --cwd packages/viewer typecheck`
- Residual risk: no automated keyboard navigation coverage exists for the dialogs yet.
