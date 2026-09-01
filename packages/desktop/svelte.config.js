import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // adapter-node emits a Node.js server to build/. In production the
    // Electron main process starts a local HTTP server from build/handler.js
    // and forwards app:// requests to it via fetch. In dev, VITE_DEV_SERVER_URL
    // is used directly (unchanged). Host capabilities are exposed as +server.ts
    // routes; the bridge surface is limited to push-events and build-pipeline IPC.
    adapter: adapter({ out: "build" }),
    // Emit relative asset URLs so app://-served pages don't request static
    // assets from the protocol root.
    paths: { relative: true },
  },
};

export default config;
