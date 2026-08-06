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

/**
 * Folio targets exactly one engine.
 *
 * Chromium's Paged Media behaviour is not stable across milestones, and it
 * changes in ways that produce NO error: 151 began parsing `target-counter()`
 * while still computing it to `none`, which made the author's declaration
 * survive the cascade and silently outrank Folio's override — every
 * cross-reference in the document disappeared, quietly. A shim cannot defend
 * against that class of change by feature-detection, because the feature
 * reports itself as present.
 *
 * So the version is pinned rather than probed, and running on anything else is
 * an error rather than a guess. Raising this floor means re-running
 * `bun run spikes` and treating every changed measurement as a finding.
 */
export const REQUIRED_MILESTONE = 151;

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

  /**
   * Shut the browser down, then remove its user-data dir.
   *
   * `Browser.close` asks Chromium to exit cleanly so it reaps its own
   * renderer/gpu/zygote children; SIGKILL is the fallback if it does not. The
   * directory is removed only after the process is gone, because Chromium
   * writes on the way down and an earlier rmSync races it.
   *
   * One implementation, used by both the version-reject path and close().
   */
  const teardown = async () => {
    const exited = new Promise<void>((r) => proc.once("exit", () => r()));
    try {
      await Promise.race([
        conn.send("Browser.close").then(() => exited),
        new Promise<void>((_, rej) =>
          setTimeout(() => rej(new Error("Browser.close timed out")), 5_000),
        ),
      ]);
    } catch {
      proc.kill("SIGKILL");
      await exited;
    }
    conn.close();
    rmSync(userDataDir, { recursive: true, force: true });
  };

  return checkMilestoneAndWrap(conn, wsUrl, `at ${bin}`, teardown);
}

/**
 * Attach to an ALREADY-RUNNING Chromium (a pooled/pre-warmed browser owned by
 * the caller, e.g. `browser-pool.ts`'s puppeteer instance via
 * `browser.wsEndpoint()`) instead of spawning a new process.
 *
 * Deliberately the mirror image of `launchChromium`: same version pin, same
 * `Session`/`newPage` machinery (`checkMilestoneAndWrap`, shared below), but
 * `close()` only drops OUR websocket connection — it never sends
 * `Browser.close`, kills a process, or removes a profile dir, because this
 * function didn't create any of those. Ownership of the underlying browser's
 * lifecycle stays entirely with whoever handed us `wsUrl`.
 */
export async function connectChromium(wsUrl: string): Promise<Browser> {
  const conn = await Connection.open(wsUrl);
  return checkMilestoneAndWrap(conn, wsUrl, "via connected browser", async () => {
    conn.close();
  });
}

/**
 * Shared by `launchChromium` and `connectChromium`: verify the pin (same
 * error message shape either way, per ARCHITECTURE.md §1 — one function owns
 * the check), then wrap the raw `Connection` in the public `Browser` shape.
 * `teardown` is the only thing that differs between the two callers.
 */
async function checkMilestoneAndWrap(
  conn: Connection,
  wsUrl: string,
  origin: string,
  teardown: () => Promise<void>,
): Promise<Browser> {
  const version = await conn.send<{ product: string }>("Browser.getVersion", {});
  const milestone = Number(/Chrome\/(\d+)/.exec(version.product)?.[1] ?? 0);

  if (milestone < REQUIRED_MILESTONE) {
    await teardown();
    throw new Error(
      `Folio requires Chromium ${REQUIRED_MILESTONE}+; found ${version.product} ${origin}.\n` +
        `Set FOLIO_CHROMIUM to a ${REQUIRED_MILESTONE}+ binary.`,
    );
  }

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
    close: teardown,
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

  /**
   * Print to PDF, streaming the result back.
   *
   * `ReturnAsStream` rather than `ReturnAsBase64` because base64 does not scale:
   * the whole PDF comes back inside ONE CDP message, so a 141 MB book arrives as
   * a ~188 MB base64 string that has to be buffered and `JSON.parse`d in one go.
   * Measured on a real art-heavy book (301pp): streaming took 203 s end to end,
   * while the identical base64 print had not returned after 600 s. It reads as a
   * hang, not as slowness — there is no progress and no error.
   *
   * Streaming costs almost nothing: of those 203 s, generation is 197 s and
   * draining the stream is 5.5 s. The transfer was never the expensive part;
   * base64 just made it pathological at size.
   */
  async printToPDF(opts: Record<string, unknown> = {}): Promise<Uint8Array> {
    const res = await this.send<{ data: string; stream?: string }>(
      "Page.printToPDF",
      {
        printBackground: true,
        preferCSSPageSize: true,
        generateTaggedPDF: true,
        generateDocumentOutline: true,
        transferMode: "ReturnAsStream",
        ...opts,
      },
    );
    // A caller that overrides transferMode still gets the inline path.
    if (!res.stream) return Uint8Array.from(Buffer.from(res.data, "base64"));

    const chunks: Buffer[] = [];
    try {
      for (;;) {
        const c = await this.send<{
          data: string;
          base64Encoded?: boolean;
          eof: boolean;
        }>("IO.read", { handle: res.stream, size: 8 * 1024 * 1024 });
        if (c.data)
          chunks.push(Buffer.from(c.data, c.base64Encoded ? "base64" : "binary"));
        if (c.eof) break;
      }
    } finally {
      await this.send("IO.close", { handle: res.stream }).catch(() => {});
    }
    return new Uint8Array(Buffer.concat(chunks));
  }

  async close() {
    await this.conn.send("Target.closeTarget", { targetId: this.targetId });
  }
}
