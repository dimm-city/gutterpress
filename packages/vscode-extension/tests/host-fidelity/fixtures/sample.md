# Sample fixture

A tiny Markdown file the host-fidelity smoke test opens with the
`gutterpress.markdownEditor` custom editor. Content is intentionally
unremarkable — this test proves the extension activates and the webview
resolves, not any particular editing behavior (that is covered by the
`bun test` unit suites and, once Lane C lands its webview entry, the
real-Chromium `*.btest.ts` proofs referenced by `test:browser`).
