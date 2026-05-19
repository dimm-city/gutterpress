import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  shell,
} from "electron";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

// ──────────────────────────────────────────────────────────────────────────
// Lib loader
//
// @dimm-city/print-md-lib is pure ESM; main.js is CJS. We can't require() an
// ESM module, but we can dynamic-import it via Function() — TypeScript's
// CJS transform won't touch that expression. Standard pattern, used widely
// for Electron + ESM dep interop.
//
// The lib is shipped as a normal package in node_modules. Its package.json
// "files" field constrains what electron-builder packages (just dist/ and
// profiles/) — no afterPack hook, no symlink dance.
// ──────────────────────────────────────────────────────────────────────────

interface PreviewHandle {
  url: string;
  port: number;
  inputPath: string;
  stop: () => Promise<void>;
}
interface SplitOutPath {
  outDir: string;
  pdfFileOverride?: string;
}
interface BuildResult {
  outDir: string;
  htmlPath?: string;
  pdfPath?: string;
  fingerprintPath?: string;
}
interface ManifestWithPath {
  manifest: { title?: string };
  manifestDir: string;
}
interface LibModule {
  startPreviewServer: (opts: Record<string, unknown>) => Promise<PreviewHandle>;
  loadManifestWithPath: (input: string) => Promise<ManifestWithPath>;
  splitOutPath: (out: string | undefined, format: string) => SplitOutPath;
  runBuild: (opts: Record<string, unknown>) => Promise<BuildResult>;
  BuildError: new (message: string) => Error;
}

let libPromise: Promise<LibModule> | null = null;

function loadLib(): Promise<LibModule> {
  if (!libPromise) {
    const dynamicImport = new Function(
      "spec",
      "return import(spec)"
    ) as (spec: string) => Promise<LibModule>;
    libPromise = dynamicImport("@dimm-city/print-md-lib");
  }
  return libPromise;
}

// ──────────────────────────────────────────────────────────────────────────
// Preview server state
// ──────────────────────────────────────────────────────────────────────────

let activePreview: PreviewHandle | null = null;

// ──────────────────────────────────────────────────────────────────────────
// Window management
// ──────────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.resolve(__dirname, "./preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  // Surface renderer errors to stdout so terminal-launched runs reveal
  // their own failures without needing DevTools.
  mainWindow.webContents.on(
    "did-fail-load",
    (_e, errorCode, errorDescription, validatedURL) => {
      console.error(
        `[renderer] did-fail-load url=${validatedURL} code=${errorCode} desc=${errorDescription}`
      );
    }
  );
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error(`[renderer] render-process-gone reason=${details.reason}`);
  });
  mainWindow.webContents.on(
    "console-message",
    (_e, level, message, line, sourceId) => {
      if (level >= 2) {
        console.error(
          `[renderer:${level === 3 ? "error" : "warn"}] ${sourceId}:${line} ${message}`
        );
      }
    }
  );

  // adapter-static emits an SPA in build/. We serve it via the app://
  // protocol so the page has a stable origin. Load the root "/" — NOT
  // "/index.html" — so SvelteKit's client router sees the root route.
  // (Loading /index.html makes the router try to resolve a page named
  // "index.html" and throw "Not found: /index.html".)
  mainWindow.loadURL("app://local/");

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  return mainWindow;
}

// ──────────────────────────────────────────────────────────────────────────
// app:// protocol — serves the static SvelteKit SPA from build/
// ──────────────────────────────────────────────────────────────────────────

const STATIC_ROOT = path.resolve(__dirname, "../build");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function mimeFor(p: string): string {
  return MIME[path.extname(p).toLowerCase()] ?? "application/octet-stream";
}

function registerAppProtocol() {
  protocol.handle("app", async (req) => {
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);
    if (!pathname || pathname === "/") pathname = "/index.html";

    // strip leading "/" before joining so path.join treats it as relative
    const rel = pathname.replace(/^\/+/, "");
    const candidate = path.resolve(STATIC_ROOT, rel);

    // Boundary check.
    if (
      candidate !== STATIC_ROOT &&
      !candidate.startsWith(STATIC_ROOT + path.sep)
    ) {
      console.error(`[app://] boundary violation: ${candidate}`);
      return new Response("Forbidden", { status: 403 });
    }

    // Try the exact file first.
    try {
      const data = await readFile(candidate);
      return new Response(data, {
        headers: { "content-type": mimeFor(candidate) },
      });
    } catch {
      // fall through to SPA fallback
    }

    // adapter-static SPA fallback: serve index.html for unknown paths so
    // client-side routing works.
    try {
      const data = await readFile(path.join(STATIC_ROOT, "index.html"));
      return new Response(data, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    } catch (e) {
      console.error(
        `[app://] FATAL: index.html not found at ${STATIC_ROOT}/index.html (${(e as Error).message})`
      );
      return new Response(
        `static root missing at ${STATIC_ROOT}`,
        { status: 500 }
      );
    }
  });
}

// Register the scheme as standard (must happen before app.whenReady) so
// fetch from the page works and ServiceWorker / IndexedDB / etc. behave.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

// ──────────────────────────────────────────────────────────────────────────
// IPC handlers (replace the deleted /api/* SvelteKit routes)
// ──────────────────────────────────────────────────────────────────────────

ipcMain.handle("dialog:openDirectory", async () => {
  if (!mainWindow) return null;
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "Open print-md project",
    properties: ["openDirectory"],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});

ipcMain.handle("dialog:savePdf", async (_e, defaultName?: string) => {
  if (!mainWindow) return null;
  const res = await dialog.showSaveDialog(mainWindow, {
    title: "Save PDF",
    defaultPath: defaultName ?? "book.pdf",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (res.canceled || !res.filePath) return null;
  return res.filePath;
});

ipcMain.handle("shell:openExternal", async (_e, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle("api:status", async () => {
  return { name: "@dimm-city/print-md-viewer", runtime: "node", ok: true };
});

ipcMain.handle("api:preview", async (_e, args: { input?: string }) => {
  const input = args?.input;
  if (!input || typeof input !== "string") {
    throw new Error("Missing 'input' (absolute path to a project directory)");
  }

  const lib = await loadLib();

  // Replace any existing preview before starting a new one.
  if (activePreview) {
    await activePreview.stop().catch(() => {});
    activePreview = null;
  }

  try {
    activePreview = await lib.startPreviewServer({
      input,
      port: 0,
      host: "127.0.0.1",
      noWatch: false,
      openBrowser: false,
      verbose: false,
      debug: false,
      installSignalHandlers: false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack ?? "" : "";
    console.error(`[api:preview] startPreviewServer failed: input=${input}`);
    console.error(`  ${msg}`);
    if (stack) console.error(stack);
    throw new Error(`Preview server failed to start: ${msg}`);
  }

  let title: string = basename(input);
  try {
    const { manifest } = await lib.loadManifestWithPath(input);
    if (manifest.title) title = manifest.title;
  } catch {
    /* not a manifest project — keep dir basename */
  }

  return {
    url: activePreview.url,
    port: activePreview.port,
    input: activePreview.inputPath,
    title,
  };
});

ipcMain.handle(
  "api:build",
  async (
    _e,
    args: {
      input: string;
      format?: "pdf" | "html" | "pdfx";
      out?: string;
      title?: string;
      pdfxFlavor?: string;
      icc?: string;
      manifest?: string;
      stripAnnotations?: boolean;
      skipLint?: boolean;
      skipPreValidate?: boolean;
      skipPostValidate?: boolean;
    }
  ) => {
    if (!args?.input) throw new Error("Missing 'input'");
    const format = args.format ?? "pdf";
    if (format === "pdfx" && !args.icc) {
      throw new Error("PDF/X format requires 'icc' (ICC profile path)");
    }

    const lib = await loadLib();
    const { outDir, pdfFileOverride } = lib.splitOutPath(args.out, format);

    try {
      const result = await lib.runBuild({
        inputDir: args.input,
        format,
        outDir,
        pdfFileOverride,
        title: args.title,
        pdfxFlavor: args.pdfxFlavor as any,
        iccPath: args.icc,
        manifestPath: args.manifest,
        stripAnnotations: args.stripAnnotations,
        skipLint: args.skipLint,
        skipPreValidate: args.skipPreValidate,
        skipPostValidate: args.skipPostValidate,
        rawArgs: { input: args.input, format, out: args.out },
      });
      return {
        outDir: result.outDir,
        htmlPath: result.htmlPath,
        pdfPath: result.pdfPath,
        fingerprintPath: result.fingerprintPath,
      };
    } catch (e: unknown) {
      // BuildError carries actionable multi-line text from the lib's
      // preflightBuildTools / requireChromiumExecutable — preserve it.
      if (e instanceof lib.BuildError) {
        const err = new Error(e.message);
        (err as Error & { code?: string }).code = "BUILD_ERROR";
        throw err;
      }
      // Generic spawn ENOENT: wrap with a friendlier message identifying
      // the missing tool. (Preflight should have caught this earlier, but
      // some downstream tools — e.g. when a tool exists but errors out —
      // can still surface raw ENOENT here.)
      if (e instanceof Error && (e as Error & { code?: string }).code === "ENOENT") {
        const syscall = (e as Error & { syscall?: string }).syscall ?? "";
        const path = (e as Error & { path?: string }).path ?? "";
        const tool = path || syscall.replace(/^spawn /, "");
        const err = new Error(
          `Required system tool not found: ${tool}\n\n` +
          `Install it and re-run. See docs/system-dependencies.md for per-platform instructions.\n\n` +
          `Underlying error: ${e.message}`
        );
        (err as Error & { code?: string }).code = "TOOL_MISSING";
        throw err;
      }
      throw e;
    }
  }
);

// ──────────────────────────────────────────────────────────────────────────
// App lifecycle
// ──────────────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  registerAppProtocol();
  createWindow();

  // Pre-warm the lib graph in parallel with SPA boot. The first call to
  // window.electron.startPreview otherwise pays a 300–900ms cold-import
  // cost (node resolving + parsing the lib's dist + transitive deps).
  // Kicking it off now means the lib is already in memory by the time
  // the user finishes picking a folder in the OS dialog. Non-fatal:
  // genuine load failures will surface when the user actually invokes
  // startPreview via IPC.
  loadLib().catch((err) => {
    console.warn("[prewarm] loadLib failed (non-fatal):", err);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", async () => {
  if (activePreview) {
    await activePreview.stop().catch(() => {});
    activePreview = null;
  }
  if (process.platform !== "darwin") app.quit();
});
