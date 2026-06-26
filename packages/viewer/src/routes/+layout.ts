// Force full client-side rendering. The SPA pages are not prerendered —
// adapter-node serves them dynamically. All "API" work goes through
// +server.ts routes (Phase 2+) or the platform adapter (legacy IPC).
export const ssr = false;
