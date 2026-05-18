import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// print-md uses Bun-specific APIs (Bun.serve, Bun.file, with { type: "file" })
// and native deps. Keep its whole subgraph external from any Vite/Rollup pass
// so the workspace dep resolves at runtime under Bun.
const externalIds = [
  "@dimm-city/print-md",
  "@dimm-city/print-md/api",
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
