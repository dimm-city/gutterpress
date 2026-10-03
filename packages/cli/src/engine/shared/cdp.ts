/**
 * Minimal CDP client for the Gutterpress engine, and THE ONE Chrome launcher.
 *
 * The compiler contract is "drive the *system* Chromium over raw CDP (spawn +
 * WebSocket)". This file is the whole browser dependency surface — one
 * runtime dep (`ws`). Every product path that needs a Chromium process — the
 * CLI's PDF build (`lib/build-runner.ts`), the engine dev CLI, the
 * preview↔print parity gate and the engine's own tests — launches it through
 * `launchChromium()` below, so they all get the same binary resolution
 * (`lib/chromium.ts`, governed by `CHROMIUM_PATH`), the same flags, and the
 * same milestone floor. There is deliberately no second launcher and no
 * "attach to a browser someone else started" path: a gate that launched
 * Chrome differently from the shipped CLI would be testing a different
 * product.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { requireChromiumExecutable } from "../../lib/chromium.ts";

/**
 * Gutterpress targets exactly one engine.
 *
 * THE 151 INCIDENT: Chromium's Paged Media behaviour is not stable across
 * milestones, and it changed once in a way that produced NO error. 151 began
 * PARSING `target-counter()` while still computing it to `none`. Before 151,
 * an unsupported `target-counter()` declaration was dropped by the cascade
 * (invalid at parse time), so Gutterpress's `generatedContentCss()` override, which
 * targets the SAME property on the SAME selector, was the only rule left
 * standing. At 151, the author's declaration started parsing as valid — so
 * it stayed in the cascade, and on equal specificity, source order (the
 * author's stylesheet loads after Gutterpress's) let it win. Every cross-reference
 * in the document disappeared, quietly.
 *
 * WHY THE FLOOR MOVED BACK TO 148 (measured, not assumed): the fix was never
 * "run on 151" — it was `generatedContentCss()` OUT-SPECIFYING the author's
 * selector, which wins the cascade whether the author's declaration is
 * dropped (pre-151 regime) or retained (151+ regime). That was already
 * verified by a RENDER PROBE (below) that reads back
 * `getComputedStyle(el, '::after').content` instead of trusting
 * `CSS.supports` — i.e. the thing that actually defends against this class of
 * silent-content-loss regression is the probe, not the milestone pin. Measured
 * 148 vs 151 head-to-head: the spike suite differs in exactly 2 checks (both
 * assertions ABOUT Chromium's parse-vs-drop behaviour, now written to accept
 * either regime — see spike/native-engine s0/s2), the parity gate output is
 * byte-identical, and real 34pp/53pp book builds produce identical page counts
 * and sizes on both milestones. So 151 was a *floor for the incident's
 * discovery*, not a requirement of the fix. It is pinned rather than probed —
 * running on anything below 148 is still an error rather than a guess — but
 * 148 is the honestly-supported floor because it's also what Electron's
 * bundled Chromium ships (42.1.0 → 148.0.7778.97 as of 2026-08-08), and the
 * desktop app needs to drive its own Chromium for native-engine PDF export
 * (see packages/desktop/electron's engine-browser module). Raising or
 * lowering this floor again means re-measuring and treating every changed
 * measurement as a finding, same as before — but the `spike/folio/spikes/`
 * harness that produced these numbers (`bun run spikes`) was deleted with
 * the rest of the pre-native-engine scaffolding and no command in this repo
 * re-runs it, so it would have to be rebuilt first. See the provenance note
 * at the top of docs/engine/ENGINE.md.
 */
export const REQUIRED_MILESTONE = 148;

/**
 * Refuse to paginate on a browser below the floor. The invariant belongs to
 * the `Browser` CONTRACT, not to any one way of obtaining a browser — every
 * producer of a `Browser` enforces it once, at construction: `launchChromium`
 * below for the CLI's external Chromium, and the desktop's
 * `createElectronEngineBrowser` (packages/desktop/electron/engine-browser.ts)
 * for Electron's bundled one. Consumers (`lib/build-runner.ts`, the compiler)
 * trust a `Browser` they are handed; a second check downstream is drift
 * waiting to happen (the two messages had already diverged once).
 */
export function assertMilestone(product: string, origin: string, hint = ""): void {
  const milestone = Number(/Chrome\/(\d+)/.exec(product)?.[1] ?? 0);
  if (milestone < REQUIRED_MILESTONE) {
    throw new Error(
      `The Gutterpress engine requires Chromium ${REQUIRED_MILESTONE}+; found ${product} ${origin}.` +
        (hint ? `\n${hint}` : ""),
    );
  }
}

/**
 * The document-settled probe both hosts run before measuring or printing:
 * fonts ready, any pending `gp:ready` handshake, then two rAFs so layout
 * settles after the font swap. ONE definition — the Electron host
 * (packages/desktop/electron/engine-browser.ts) evaluates the same
 * expression, and a drift between hosts would be an invisible divergence in
 * when "ready" means ready.
 */
export function readyProbeExpr(timeoutMs: number): string {
  return `(async () => {
      await document.fonts.ready;
      if (window.__gpReadyPending) {
        await new Promise((res) => {
          const t = setTimeout(res, ${timeoutMs});
          document.addEventListener('gp:ready', () => { clearTimeout(t); res(); }, { once: true });
        });
      }
      // two rAFs: let layout settle after fonts swap
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return true;
    })()`;
}

/**
 * The print-quality contract both hosts pass to their print call: tagged PDF
 * + document outline (named destinations — Tier 3 and the parity gate read
 * them back) + CSS page size + backgrounds. ONE object, spread by both
 * `SessionImpl.printToPDF` and the Electron host's `printToPDF`.
 */
export const DEFAULT_PRINT_OPTS = {
  printBackground: true,
  preferCSSPageSize: true,
  generateTaggedPDF: true,
  generateDocumentOutline: true,
} as const;

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
  /** Wait for fonts + optional `gp:ready`, per §6 of the proposal. */
  waitForReady(timeoutMs?: number): Promise<void>;
  printToPDF(opts?: Record<string, unknown>): Promise<Uint8Array>;
  close(): Promise<void>;
}

/**
 * The flags every Gutterpress-launched Chromium gets. One list: the CLI build,
 * the parity gate and the tests must not drift from each other, because the
 * gate's whole job is to measure the browser the product ships with.
 */
const DEFAULT_ARGS = [
  "--headless=new",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  "--no-sandbox",
  "--hide-scrollbars",
  "--allow-file-access-from-files",
  "--font-render-hinting=none",
];

/**
 * Launch the system Chromium and verify it meets {@link REQUIRED_MILESTONE}.
 *
 * Binary resolution is `lib/chromium.ts`'s (`CHROMIUM_PATH`, then standard
 * install locations, then a PATH probe) — the same resolver the preflight
 * presence check and `gutterpress doctor` use, so what they report is what
 * gets launched. Extra flags come from `GUTTERPRESS_CHROMIUM_ARGS`
 * (containers/CI, e.g. `--disable-dev-shm-usage`; see docs/docker.md) and
 * `opts.args`; `opts.ignoreDefaultArgs` removes entries from
 * {@link DEFAULT_ARGS} for a test that needs a host WITHOUT one of them.
 *
 * The launch is also the one and only milestone check: a too-old browser is
 * torn down and rejected here, with the override hint, before any caller
 * gets a `Browser`.
 */
export async function launchChromium(
  opts: { args?: string[]; ignoreDefaultArgs?: string[] } = {},
): Promise<Browser> {
  const bin = await requireChromiumExecutable();
  const userDataDir = mkdtempSync(join(tmpdir(), "gp-cdp-"));
  const envArgs = (process.env.GUTTERPRESS_CHROMIUM_ARGS ?? "").split(/\s+/).filter(Boolean);
  const ignored = new Set(opts.ignoreDefaultArgs ?? []);
  const args = [
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    ...DEFAULT_ARGS.filter((a) => !ignored.has(a)),
    ...envArgs,
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

  const version = await conn.send<{ product: string }>("Browser.getVersion", {});
  try {
    assertMilestone(
      version.product,
      `at ${bin}`,
      `Install a newer Chrome, Chromium, or Edge, or point CHROMIUM_PATH at a ${REQUIRED_MILESTONE}+ binary.`,
    );
  } catch (e) {
    await teardown();
    throw e;
  }
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
    close: teardown,
  };
}

function readDevToolsUrl(proc: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    // How long to wait for Chromium to print its DevTools websocket URL.
    //
    // This was 20s and was too tight on a loaded CI runner — a budget for
    // "has the browser booted", not a correctness bound, so failing fast buys
    // nothing. MEASURED: agent.first-letter.test.ts took 18709ms in the
    // v0.10.3 release run (94% of the old budget) and then blew it at
    // 20013ms in the next one, failing a release at the gate with the browser
    // merely slow. The runner's own noise eats a visible slice of it: each
    // "Failed to connect to the bus" retry in that log costs ~2s before
    // startup proceeds.
    const timer = setTimeout(
      () => reject(new Error(`Chromium did not report a DevTools URL:\n${buf}`)),
      60_000,
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

  async setContent(html: string, baseUrl = "http://gutterpress.spike/") {
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
    await this.evaluate(readyProbeExpr(timeoutMs));
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
        ...DEFAULT_PRINT_OPTS,
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
