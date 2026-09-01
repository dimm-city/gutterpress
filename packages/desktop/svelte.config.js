import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // adapter-static emits a plain static file tree to build/ — no Node
    // server, no build/handler.js. The app has zero server routes (every
    // request/reply operation moved to typed IPC in SFE-P5c), so this is a
    // pure client SPA: `fallback: "index.html"` writes build/index.html as
    // the entry point for every client-side route, and `src/routes/+layout.ts`
    // sets `export const ssr = false` so the whole tree renders client-only.
    // In production, electron/app-protocol.ts serves build/ directly from
    // disk under the app:// scheme (no local HTTP server, no proxy). In dev,
    // VITE_DEV_SERVER_URL is used directly (unchanged).
    adapter: adapter({ pages: "build", assets: "build", fallback: "index.html" }),
    // Emit relative asset URLs so app://-served pages don't request static
    // assets from the protocol root.
    paths: { relative: true },
  },
};

export default config;
