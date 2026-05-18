import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

// Resolve the SvelteKit Node-style server bundle. In dev: ../build/index.js
// (produced by `vite build`). In packaged mode: bundled into resources.
const SVELTEKIT_ENTRY = path.resolve(__dirname, "../build/index.js");

let serverProcess: ChildProcess | null = null;
let serverUrl: string | null = null;
let mainWindow: BrowserWindow | null = null;

async function startSvelteKitServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    // Spawn under Bun so @dimm-city/print-md's Bun-specific APIs work.
    const proc = spawn("bun", [SVELTEKIT_ENTRY], {
      env: {
        ...process.env,
        // Port 0 = OS-assigned. SvelteKit's @sveltejs/adapter-node logs the port on startup.
        PORT: "0",
        HOST: "127.0.0.1",
        ORIGIN: "http://127.0.0.1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    serverProcess = proc;
    let resolved = false;
    const onLine = (chunk: Buffer) => {
      const text = chunk.toString();
      process.stdout.write(`[server] ${text}`);
      // adapter-node logs e.g. "Listening on http://127.0.0.1:PORT"
      const m = text.match(/https?:\/\/[^\s]+/);
      if (m && !resolved) {
        resolved = true;
        serverUrl = m[0].replace(/[\s,.;)\]]+$/, "");
        resolve(serverUrl);
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

    // Safety timeout
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
