// Force full client-side rendering. adapter-static (svelte.config.js) builds
// this as a pure SPA: no server routes exist (every request/reply operation
// moved to typed IPC in SFE-P5c/P5d), so every page renders client-only and
// electron/app-protocol.ts serves the static build output directly from
// disk. Host capabilities go through the platform adapter or
// window.electron.* (push streams / live-BrowserWindow calls — see ADR 0004).
export const ssr = false;
