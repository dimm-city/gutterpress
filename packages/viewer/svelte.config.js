import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Static SPA — no SvelteKit server. The frontend is built to plain
    // HTML/JS/CSS in build/ and served by Electron via a custom app://
    // protocol handler. All "API" calls go through ipcMain instead of fetch.
    adapter: adapter({
      pages: "build",
      assets: "build",
      fallback: "index.html",
      precompress: false,
      strict: true,
    }),
    // Emit relative asset URLs so app://-served pages don't try to load
    // /favicon.ico from the protocol root.
    paths: { relative: true },
  },
};

export default config;
