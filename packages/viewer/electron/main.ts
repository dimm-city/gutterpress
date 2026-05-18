import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
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

// Resolve the SvelteKit Node-style server bundle. In dev: ../build/index.js
// (produced by `vite build`). In packaged mode: bundled into resources.
const SVELTEKIT_ENTRY = path.resolve(__dirname, "../build/index.js");

let serverProcess: ChildProcess | null = null;
let serverUrl: string | null = null;
let mainWindow: BrowserWindow | null = null;

async function startSvelteKitServer(): Promise<string> {
  // Pre-pick a free port so we know the URL up front; adapter-node's stdout
  // line ("Listening on http://HOST:PORT") echoes whatever PORT we pass,
  // which is unhelpful when PORT=0.
  const port = await pickFreePort();
  const url = `http://127.0.0.1:${port}`;

  return new Promise((resolve, reject) => {
    const proc = spawn("bun", [SVELTEKIT_ENTRY], {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        ORIGIN: url,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    serverProcess = proc;
    let resolved = false;
    const onLine = (chunk: Buffer) => {
      const text = chunk.toString();
      process.stdout.write(`[server] ${text}`);
      // Adapter-node logs "Listening on <url>" once bound; ready to load.
      if (!resolved && text.includes("Listening on")) {
        resolved = true;
        serverUrl = url;
        resolve(url);
      }
    };
    proc.stdout?.on("data", onLine);
    proc.stderr?.on("data", (c) => process.stderr.write(`[server err] ${c}`));

    proc.on("exit", (code) => {
      console.log(`[server] exited with code ${code}`);
      serverProcess = null;
      if (!resolved) reject(new Error(`server exited (code ${code}) before listening`));
    });
    proc.on("error", (e) => {
      if (!resolved) reject(e);
    });

    setTimeout(() => {
      if (!resolved) reject(new Error("SvelteKit server did not start within 15s"));
    }, 15_000);
  });
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

app.on("before-quit", () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
  }
});
