/**
 * Minimal CDP client for the Folio spike.
 *
 * Deliberately NOT puppeteer: the proposal's compiler contract is "drive the
 * *system* Chromium over raw CDP (chrome-launcher + WebSocket)". This file is
 * the whole browser dependency surface — ~150 lines, one runtime dep (`ws`).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const CANDIDATES = [
  process.env.FOLIO_CHROMIUM,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/opt/pw-browsers/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean) as string[];

export function findChromium(): string {
  for (const c of CANDIDATES) if (existsSync(c)) return c;
  throw new Error(
    `No Chromium found. Set FOLIO_CHROMIUM. Looked in:\n  ${CANDIDATES.join("\n  ")}`,
  );
}

export interface Browser {
  wsUrl: string;
  version: string;
  milestone: number;
  newPage(): Promise<Session>;
  close(): Promise<void>;
}

/** One CDP connection multiplexed over sessionIds (flat mode). */
export interface Session {
  send<T = any>(method: string, params?: object): Promise<T>;
  on(event: string, fn: (params: any) => void): () => void;
  /** Convenience: Runtime.evaluate with awaitPromise + value return. */
  evaluate<T = any>(expression: string): Promise<T>;
  setContent(html: string, baseUrl?: string): Promise<void>;
  navigate(url: string): Promise<void>;
  /** Wait for fonts + optional `folio:ready`, per §6 of the proposal. */
  waitForReady(timeoutMs?: number): Promise<void>;
  printToPDF(opts?: Record<string, unknown>): Promise<Uint8Array>;
  close(): Promise<void>;
}

export async function launchChromium(
  opts: { headless?: boolean; args?: string[] } = {},
): Promise<Browser> {
  const bin = findChromium();
  const userDataDir = mkdtempSync(join(tmpdir(), "folio-cdp-"));
  const args = [
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    "--font-render-hinting=none",
    ...(opts.headless === false ? [] : ["--headless=new"]),
    ...(opts.args ?? []),
    "about:blank",
  ];
  const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
  const wsUrl = await readDevToolsUrl(proc);
  const conn = await Connection.open(wsUrl);
  const version = await conn.send<{ product: string }>("Browser.getVersion", {});
  const milestone = Number(/Chrome\/(\d+)/.exec(version.product)?.[1] ?? 0);

  return {
    wsUrl,
    version: version.product,
    milestone,
    async newPage() {
      const { targetId } = await conn.send<{ targetId: string }>(
        "Target.createTarget",
        { url: "about:blank" },
      );
      const { sessionId } = await conn.send<{ sessionId: string }>(
        "Target.attachToTarget",
        { targetId, flatten: true },
      );
      const s = new SessionImpl(conn, sessionId, targetId);
      await s.send("Page.enable");
      await s.send("Runtime.enable");
      return s;
    },
    async close() {
      conn.close();
      proc.kill("SIGKILL");
      await new Promise((r) => proc.once("exit", r));
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

function readDevToolsUrl(proc: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(
      () => reject(new Error(`Chromium did not report a DevTools URL:\n${buf}`)),
      20_000,
    );
    proc.stderr!.on("data", (d) => {
      buf += String(d);
      const m = /ws:\/\/[^\s]+/.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    });
    proc.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chromium exited (${code}) before listening:\n${buf}`));
    });
  });
}

class Connection {
  private ws: WebSocket;
  private id = 0;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  private listeners = new Map<string, Set<(p: any) => void>>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (raw) => this.dispatch(JSON.parse(String(raw))));
  }

  static async open(url: string): Promise<Connection> {
    const ws = new WebSocket(url, { maxPayload: 512 * 1024 * 1024 });
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", rej);
    });
    return new Connection(ws);
  }

  private dispatch(msg: any) {
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error)
        p.reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else p.resolve(msg.result);
      return;
    }
    const key = msg.sessionId ? `${msg.sessionId}:${msg.method}` : msg.method;
    for (const fn of this.listeners.get(key) ?? []) fn(msg.params);
    for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
  }

  send<T>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    const id = ++this.id;
    const payload: any = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  on(key: string, fn: (p: any) => void): () => void {
    let set = this.listeners.get(key);
    if (!set) this.listeners.set(key, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  close() {
    this.ws.close();
  }
}

class SessionImpl implements Session {
  constructor(
    private conn: Connection,
    private sessionId: string,
    private targetId: string,
  ) {}

  send<T = any>(method: string, params: object = {}): Promise<T> {
    return this.conn.send<T>(method, params, this.sessionId);
  }

  on(event: string, fn: (p: any) => void) {
    return this.conn.on(`${this.sessionId}:${event}`, fn);
  }

  async evaluate<T = any>(expression: string): Promise<T> {
    const res = await this.send<any>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      const e = res.exceptionDetails;
      throw new Error(
        `evaluate failed: ${e.exception?.description ?? e.text}`,
      );
    }
    return res.result.value as T;
  }

  private async waitForLoad(fn: () => Promise<void>) {
    const done = new Promise<void>((resolve) => {
      const off = this.on("Page.loadEventFired", () => {
        off();
        resolve();
      });
    });
    await fn();
    await done;
  }

  async setContent(html: string, baseUrl = "http://folio.spike/") {
    await this.waitForLoad(async () => {
      const { frameTree } = await this.send<any>("Page.getFrameTree");
      await this.send("Page.setDocumentContent", {
        frameId: frameTree.frame.id,
        html,
      });
      void baseUrl;
    });
  }

  async navigate(url: string) {
    await this.waitForLoad(async () => {
      await this.send("Page.navigate", { url });
    });
  }

  async waitForReady(timeoutMs = 15_000) {
    await this.evaluate(`(async () => {
      await document.fonts.ready;
      if (window.__folioReadyPending) {
        await new Promise((res) => {
          const t = setTimeout(res, ${timeoutMs});
          document.addEventListener('folio:ready', () => { clearTimeout(t); res(); }, { once: true });
        });
      }
      // two rAFs: let layout settle after fonts swap
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return true;
    })()`);
  }

  async printToPDF(opts: Record<string, unknown> = {}): Promise<Uint8Array> {
    const res = await this.send<{ data: string; stream?: string }>(
      "Page.printToPDF",
      {
        printBackground: true,
        preferCSSPageSize: true,
        generateTaggedPDF: true,
        generateDocumentOutline: true,
        transferMode: "ReturnAsBase64",
        ...opts,
      },
    );
    return Uint8Array.from(Buffer.from(res.data, "base64"));
  }

  async close() {
    await this.conn.send("Target.closeTarget", { targetId: this.targetId });
  }
}
