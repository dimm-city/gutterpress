import adapter from "./adapter-electron.js";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // adapter-electron.js writes the SvelteKit server unbundled to build/.
    // In production the Electron main process constructs that Server and
    // answers app:// requests with Server.respond() in-process. In dev,
    // VITE_DEV_SERVER_URL is used directly (unchanged). Host capabilities are
    // exposed as +server.ts routes; the bridge surface is limited to
    // push-events and build-pipeline IPC.
    adapter: adapter({ out: "build" }),
    // Emit relative asset URLs so app://-served pages don't request static
    // assets from the protocol root.
    paths: { relative: true },
    // The same build serves both the web PWA and Electron's app:// origin.
    // Register manually in +layout.svelte so app:// never attempts to use a SW.
    serviceWorker: { register: false },
  },
};

export default config;
