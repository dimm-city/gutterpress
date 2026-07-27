// Force full client-side rendering. The SPA pages are not prerendered —
// adapter-node serves them dynamically. All "API" work goes through
// +server.ts routes (the default seam) or the platform adapter (push
// streams / live-BrowserWindow calls — see ADR 0004).
export const ssr = false;
