import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (typeof addr === "object" && addr) {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("no address")));
      }
    });
  });
}

// Resolve the SvelteKit Node-style server bundle.
const SVELTEKIT_ENTRY = path.resolve(__dirname, "../build/index.js");

let serverUrl: string | null = null;
let mainWindow: BrowserWindow | null = null;

/**
 * Poll until a TCP port on 127.0.0.1 is accepting connections.
 */
async function waitForServer(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ port, host: "127.0.0.1" });
      socket.on("connect", () => { socket.destroy(); resolve(true); });
      socket.on("error", () => resolve(false));
    });
    if (ready) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`SvelteKit server did not start within ${timeoutMs / 1000}s`);
}

/**
 * Start the SvelteKit server in-process using Electron's built-in Node.js.
 *
 * @dimm-city/print-md is now Node.js-compatible (no Bun-specific APIs), so
 * there is no longer any need to spawn a separate Bun subprocess.  The
 * adapter-node bundle reads PORT / HOST / ORIGIN from the environment, starts
 * its HTTP server, and returns — we poll until the port is accepting
 * connections before loading the URL into the BrowserWindow.
 *
 * `new Function(...)` is used so TypeScript's `module: CommonJS` transform
 * does not downgrade the dynamic import() to require(), which would break ESM
 * adapter-node output.
 */
async function startSvelteKitServer(): Promise<string> {
  const t0 = Date.now();
  const port = await pickFreePort();
  const url = `http://127.0.0.1:${port}`;

  process.env.PORT = String(port);
  process.env.HOST = "127.0.0.1";
  process.env.ORIGIN = url;

  const load = new Function("specifier", "return import(specifier)") as (
    s: string
  ) => Promise<unknown>;
  // Node's ESM loader requires file:// URLs on Windows — a raw absolute path
  // like "C:\\..." is rejected as "protocol 'c:'". pathToFileURL produces
  // the correct file:///C:/... form and is a no-op on POSIX.
  const tImport = Date.now();
  await load(pathToFileURL(SVELTEKIT_ENTRY).href);
  const tListen = Date.now();

  await waitForServer(port);
  const tReady = Date.now();
  console.log(
    `[startup] pickPort=${tImport - t0}ms import=${tListen - tImport}ms listen=${tReady - tListen}ms total=${tReady - t0}ms`
  );
  serverUrl = url;
  return url;
}

const LOADING_HTML = `data:text/html,<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#1e1e1e;color:#9ca3af;display:flex;flex-direction:column;align-items:center;
justify-content:center;height:100vh;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif}
p{font-size:15px;margin:0 0 8px}small{font-size:12px;color:#555}
</style></head><body><p>Starting print-md viewer…</p><small>Loading server</small></body></html>`;

function createWindow(url?: string) {
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
  mainWindow.loadURL(url ?? LOADING_HTML);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  return mainWindow;
}

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

app.whenReady().then(async () => {
  // Show the window immediately with a loading screen so the user gets
  // visual feedback while the SvelteKit server warms up.
  const win = createWindow();

  try {
    const url = await startSvelteKitServer();
    win.loadURL(url);
  } catch (err) {
    console.error("Failed to start SvelteKit server:", err);
    dialog.showErrorBox(
      "Server failed to start",
      err instanceof Error ? err.message : String(err)
    );
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverUrl) {
      createWindow(serverUrl);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
