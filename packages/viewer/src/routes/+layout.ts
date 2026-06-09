// Force full client-side rendering. adapter-static otherwise tries to
// prerender every route, which is meaningless for a single-page Electron
// shell that talks to the host via the platform adapter (not network).
export const ssr = false;
export const prerender = true;
