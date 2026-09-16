# Markdown editor

`@vscode/markdown-editor` is an experimental, browser-based hybrid Markdown
editor. It keeps Markdown source as the canonical document while presenting
inactive blocks in rendered form and active blocks in editable source form.

Start with the [current implementation specification](./docs/specification.md).
It explains the architecture, runtime data flow, public integration surface,
extension points, the VS Code custom text editor adapter, tests, and current
limitations.

Other package documents:

- [Original design](./docs/design.md) - historical design intent.
- [Original implementation plan](./docs/plan.md) - historical roadmap; its
  checkboxes do not describe current completion.
- [Engineering backlog](./docs/todo.md) - known issues and future work.

From this package directory:

```sh
pnpm test
pnpm test:e2e
pnpm build
pnpm build:explorer
```

Playwright reuses test servers from the same worktree using a deterministic
worktree-specific port pair. Set `VSCODE_MARKDOWN_EDITOR_E2E_BASE_PORT` to the
first port of a different adjacent pair if the generated ports conflict with
another local service.
