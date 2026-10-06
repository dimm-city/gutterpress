/**
 * SFE-P1b Lane A — the sole `@vscode/markdown-editor` adapter's public
 * surface (D5: "No application code outside `packages/editor/src/
 * vscode-adapter/` may import package internals"). Everything a future lane
 * (desktop rich-editor shell, VS Code webview, ...) needs from this
 * directory is re-exported here; nothing here re-exports
 * `@vscode/markdown-editor` itself.
 */
export * from "./adapter.ts";
export * from "./convert.ts";
