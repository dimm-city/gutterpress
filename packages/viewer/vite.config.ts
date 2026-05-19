import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// Keep @dimm-city/print-md-lib and its runtime deps external from Vite/Rollup so
// they resolve at runtime from node_modules (not bundled into the SSR output).
const externalIds = [
  "@dimm-city/print-md-lib",
  "@dimm-city/print-md-lib/api",
  "puppeteer-core",
  "chokidar",
  "citty",
  "yaml",
  "markdown-it",
  "markdown-it-attrs",
  "markdown-it-footnote",
  "markdown-it-source-map",
  "pagedjs",
  "stylelint",
];

const isExternal = (id: string) => {
  return externalIds.some((e) => id === e || id.startsWith(e + "/"));
};

export default defineConfig({
  plugins: [sveltekit()],
  ssr: {
    // Do NOT bundle anything from print-md or its native deps for the server build.
    external: externalIds,
    noExternal: [],
  },
  optimizeDeps: {
    exclude: externalIds,
  },
  build: {
    rollupOptions: {
      external: (id) => isExternal(id),
    },
  },
  server: {
    fs: {
      allow: [".."],
    },
  },
});
