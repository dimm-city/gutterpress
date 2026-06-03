## Issue #11

- Verdict: accepted
- Branch: `release/0.2.0`
- Reviewer notes:
  - URL auth now stays inside Electron's normal browser/session model.
  - HTTP(S) popup windows are no longer forced to the external browser, which allows site-managed auth popups to complete in-app.
  - URL preview responses that advertise iframe-blocking headers now trigger a friendly in-app message instead of silently failing.
  - No app-managed auth layer or provider-specific token flow was added.
- Tester logs:
  - `bun run --cwd packages/viewer check`
  - `bun run --cwd packages/viewer typecheck`
  - `bun --filter @dimm-city/print-md test`
  - `bun run --cwd packages/viewer build`
  - `bun run --cwd packages/viewer electron:build`
- Residual risk: there is still no automated end-to-end coverage for real third-party login flows or popup-based auth journeys.
