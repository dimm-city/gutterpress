import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import net from "node:net";
import path from "node:path";

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

// Wait until something is listening on the given port (polls every 100 ms).
function waitForPort(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.createConnection({ port, host: "127.0.0.1" });
      sock.once("connect", () => { sock.destroy(); resolve(); });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline) return reject(new Error("Server did not start within 15s"));
        setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

// Resolve the SvelteKit Node-style server bundle.
const SVELTEKIT_ENTRY = path.resolve(__dirname, "../build/index.js");

let serverUrl: string | null = null;
let mainWindow: BrowserWindow | null = null;

async function startSvelteKitServer(): Promise<string> {
  const port = await pickFreePort();
  const url = `http://127.0.0.1:${port}`;

  // Run the SvelteKit adapter-node server in-process — no external runtime
  // (bun, node) required on the host. Electron's main process IS Node.js;
  // dynamic import() loads the ESM server bundle directly into the same event
  // loop. The HTTP server is non-blocking so the Electron UI is unaffected.
  process.env.PORT = String(port);
  process.env.HOST = "127.0.0.1";
  process.env.ORIGIN = url;

  await import(SVELTEKIT_ENTRY);
  await waitForPort(port);

  serverUrl = url;
  return url;
}

function createWindow(url: string) {
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
  mainWindow.loadURL(url);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
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
  try {
    const url = await startSvelteKitServer();
    createWindow(url);
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
