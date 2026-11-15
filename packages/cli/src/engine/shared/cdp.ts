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
import { BuildError } from "../../lib/build-error.ts";
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
 * 148 vs 151 head-to-head: the parity gate output is byte-identical, and real
 * 34pp/53pp book builds produce identical page counts and sizes on both
 * milestones. So 151 was a *floor for the incident's
 * discovery*, not a requirement of the fix. It is pinned rather than probed —
 * running on anything below 148 is still an error rather than a guess — but
 * 148 is the honestly-supported floor because it's also what Electron's
 * bundled Chromium ships (42.1.0 → 148.0.7778.97 as of 2026-08-08), and the
 * desktop app needs to drive its own Chromium for native-engine PDF export
 * (see packages/desktop/electron's engine-browser module). Raising or
 * lowering this floor again means re-measuring and treating every changed
 * measurement as a finding. No command in this repo re-runs that
 * measurement, so it would have to be rebuilt first. See the provenance note
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
  // Resolves true when everything was ready, false when fonts or the
  // `gp:ready` handshake had not settled within `timeoutMs` (the document is
  // then used as it is — a host that wants to say so reads the result).
  return `(async () => {
      const within = (p) => new Promise((res) => {
        const t = setTimeout(() => res(false), ${timeoutMs});
        p.then(() => { clearTimeout(t); res(true); });
      });
      let ok = await within(document.fonts.ready);
      if (window.__gpReadyPending) {
        ok = (await within(new Promise((r) => document.addEventListener('gp:ready', r, { once: true })))) && ok;
      }
      // two rAFs: let layout settle after fonts swap
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return ok;
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
  /** Rejects, naming what is still loading, if the load event has not fired within `loadTimeoutMs`. */
  navigate(url: string, loadTimeoutMs?: number): Promise<void>;
  /**
   * Wait for fonts + optional `gp:ready`, per §6 of the proposal. Resolves
   * `false` when the wait ran out (the build goes on without saying so
   * unless the caller reports it).
   */
  waitForReady(timeoutMs?: number): Promise<boolean>;
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
  const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
  // Any failure before a Browser exists (it died while starting, never
  // answered, was too old) must not leave the process or its profile behind.
  let conn: Connection | undefined;
  let wsUrl: string;
  let version: { product: string };
  try {
    const found = await readDevToolsUrl(proc);
    wsUrl = found.wsUrl;
    conn = await Connection.open(wsUrl, found.stderrTail);
    version = await conn.send<{ product: string }>("Browser.getVersion", {});
  } catch (e) {
    conn?.close();
    await removeProfile(proc, userDataDir);
    throw e;
  }
  const connection = conn;

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
    try {
      await Promise.race([
        connection.send("Browser.close").then(() => processExited(proc)),
        new Promise<void>((_, rej) =>
          setTimeout(() => rej(new Error("Browser.close timed out")), 5_000),
        ),
      ]);
    } catch {
      // fall through: killed below
    }
    connection.close();
    await removeProfile(proc, userDataDir);
  };

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
      const { targetId } = await connection.send<{ targetId: string }>(
        "Target.createTarget",
        { url: "about:blank" },
      );
      const { sessionId } = await connection.send<{ sessionId: string }>(
        "Target.attachToTarget",
        { targetId, flatten: true },
      );
      const s = new SessionImpl(connection, sessionId, targetId);
      await s.send("Inspector.enable");
      await s.send("Page.enable");
      await s.send("Runtime.enable");
      return s;
    },
    close: teardown,
  };
}

/** Resolves when the process is gone (at once if it already is: a crash leaves no 'exit' to wait for). */
function processExited(proc: ChildProcess): Promise<void> {
  return new Promise((r) =>
    proc.exitCode !== null || proc.signalCode !== null ? r() : proc.once("exit", () => r()),
  );
}

/** Make sure the process is gone (SIGKILL if not), then remove its profile directory. */
async function removeProfile(proc: ChildProcess, userDataDir: string) {
  const exited = processExited(proc);
  proc.kill("SIGKILL");
  await exited;
  rmSync(userDataDir, { recursive: true, force: true });
}

/** How much of Chromium's error output is kept once it is listening. */
const STDERR_TAIL_BYTES = 8 * 1024;

/**
 * Wait for Chromium's DevTools URL. Resolves with it and a reader for the last
 * {@link STDERR_TAIL_BYTES} of Chromium's error output, which a crash message
 * quotes; the rest is dropped so a long build does not accumulate it.
 */
function readDevToolsUrl(proc: ChildProcess): Promise<{ wsUrl: string; stderrTail: () => string }> {
  return new Promise((resolve, reject) => {
    let buf = "";
    let listening = false;
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
      if (listening) {
        buf = buf.slice(-STDERR_TAIL_BYTES);
        return;
      }
      const m = /ws:\/\/[^\s]+/.exec(buf);
      if (m) {
        listening = true;
        clearTimeout(timer);
        resolve({
          wsUrl: m[0],
          // The "DevTools listening" banner says nothing about why it died.
          stderrTail: () => buf.replace(/^DevTools listening.*$/m, "").trim(),
        });
      }
    });
    proc.once("exit", (code) => {
      clearTimeout(timer);
      if (listening) return;
      reject(new Error(`Chromium exited (${code}) before listening:\n${buf}`));
    });
  });
}

class Connection {
  private ws: WebSocket;
  private id = 0;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void; sessionId?: string }
  >();
  private listeners = new Map<string, Set<(p: any) => void>>();
  /** Why the whole connection is gone, once it is; later calls reject with it. */
  private closedBecause?: Error;
  /** Sessions whose page crashed or detached, and why; later calls on them reject with it. */
  private deadSessions = new Map<string, Error>();
  /** Waiters on something other than a call (a load event), told when a session is lost. */
  private lostWaiters = new Set<{ sessionId: string; fn: (e: Error) => void }>();

  private constructor(
    ws: WebSocket,
    private stderrTail: () => string,
  ) {
    this.ws = ws;
    ws.on("message", (raw) => this.dispatch(JSON.parse(String(raw))));
    // A Chromium that dies (the out-of-memory killer, a crash) closes this
    // socket; without this, every pending call waits forever.
    const gone = () =>
      this.failAll(
        this.chromiumError("Chromium closed the connection while building (it may have run out of memory)"),
      );
    ws.on("close", gone);
    ws.on("error", gone);
  }

  static async open(url: string, stderrTail: () => string = () => ""): Promise<Connection> {
    const ws = new WebSocket(url, { maxPayload: 512 * 1024 * 1024 });
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.on("error", rej); // a dying browser emits it more than once
    });
    return new Connection(ws, stderrTail);
  }

  chromiumError(message: string): BuildError {
    const tail = this.stderrTail();
    return new BuildError(tail ? `${message}.\nChromium's last output:\n${tail}` : message);
  }

  private failAll(err: Error) {
    this.closedBecause ??= err;
    for (const w of this.lostWaiters) w.fn(this.closedBecause);
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      p.reject(err);
    }
  }

  /** The page behind `sessionId` is gone: reject its pending calls and every later one. */
  failSession(sessionId: string, err: Error) {
    if (this.deadSessions.has(sessionId)) return;
    this.deadSessions.set(sessionId, err);
    for (const w of this.lostWaiters) if (w.sessionId === sessionId) w.fn(err);
    for (const [id, p] of this.pending) {
      if (p.sessionId !== sessionId) continue;
      this.pending.delete(id);
      p.reject(err);
    }
  }

  /** Why this session (or the whole browser) is gone, if it is. */
  lostError(sessionId: string): Error | undefined {
    return this.closedBecause ?? this.deadSessions.get(sessionId);
  }

  /**
   * A promise that rejects when the session or browser is lost. For waits on
   * an event rather than a call: a call is rejected by the loss itself, an
   * event that will now never come is not.
   */
  lost(sessionId: string): { promise: Promise<never>; stop: () => void } {
    let waiter!: { sessionId: string; fn: (e: Error) => void };
    const promise = new Promise<never>((_, reject) => {
      waiter = { sessionId, fn: reject };
      const already = this.lostError(sessionId);
      if (already) reject(already);
      else this.lostWaiters.add(waiter);
    });
    promise.catch(() => {}); // only the racing caller reports it
    return { promise, stop: () => void this.lostWaiters.delete(waiter) };
  }

  get isClosed() {
    return this.closedBecause !== undefined;
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
    const dead = this.closedBecause ?? (sessionId ? this.deadSessions.get(sessionId) : undefined);
    if (dead) return Promise.reject(dead);
    const id = ++this.id;
    const payload: any = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, sessionId });
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

/**
 * How long a page may take to fire its load event. Not a build timeout: a
 * large book of local art loads slowly, so this is far beyond any real load
 * and only turns a load that can never finish into an error.
 */
const DEFAULT_LOAD_TIMEOUT_MS = 5 * 60_000;

class SessionImpl implements Session {
  private offs: Array<() => void> = [];

  constructor(
    private conn: Connection,
    private sessionId: string,
    private targetId: string,
  ) {
    // A page whose renderer dies answers nothing again; fail its calls now
    // rather than leaving the build waiting.
    const lost = (why: string) => conn.failSession(sessionId, conn.chromiumError(why));
    this.offs.push(
      conn.on(`${sessionId}:Inspector.targetCrashed`, () =>
        lost("Chromium's renderer for this page crashed (it may have run out of memory)"),
      ),
      conn.on("Target.detachedFromTarget", (p) => {
        if (p?.sessionId === sessionId)
          lost("Chromium closed this page while building (it may have run out of memory)");
      }),
    );
  }

  async send<T = any>(method: string, params: object = {}): Promise<T> {
    try {
      return await this.conn.send<T>(method, params, this.sessionId);
    } catch (e) {
      // A renderer that dies mid-call can answer the call with its own error
      // ("Printing failed") a moment before the crash event arrives. The crash
      // is the cause, so give it a moment to arrive and report it instead.
      if (!this.conn.lostError(this.sessionId)) await new Promise((r) => setTimeout(r, 100));
      throw this.conn.lostError(this.sessionId) ?? e;
    }
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

  private async waitForLoad(fn: () => Promise<void>, loadTimeoutMs: number) {
    let off = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const lost = this.conn.lost(this.sessionId);
    const done = new Promise<void>((resolve, reject) => {
      off = this.on("Page.loadEventFired", () => resolve());
      // A load that never finishes (an image whose server never answers) is
      // not slow, it is stuck: name what is still loading.
      timer = setTimeout(async () => {
        const pending = await Promise.race([
          this.evaluate<string[]>(
            `[...document.images].filter((i) => !i.complete).map((i) => i.currentSrc || i.src)
            .concat([...document.querySelectorAll('link[rel~=stylesheet]')].filter((l) => !l.sheet).map((l) => l.href))`,
          ),
          new Promise<string[]>((r) => setTimeout(() => r([]), 5_000)),
        ]).catch(() => [] as string[]);
        reject(
          new BuildError(
            `The page had not finished loading after ${Math.round(loadTimeoutMs / 1000)} s` +
              (pending.length
                ? `; still waiting for: ${pending.slice(0, 10).join(", ")}. A remote image or file that never answers keeps a build waiting; use local files.`
                : "."),
          ),
        );
      }, loadTimeoutMs);
    });
    done.catch(() => {}); // the deadline may fire while `fn` is still running
    try {
      await Promise.race([fn(), lost.promise]);
      await Promise.race([done, lost.promise]);
    } finally {
      off();
      lost.stop();
      clearTimeout(timer);
    }
  }

  async setContent(html: string, baseUrl = "http://gutterpress.spike/") {
    await this.waitForLoad(async () => {
      const { frameTree } = await this.send<any>("Page.getFrameTree");
      await this.send("Page.setDocumentContent", {
        frameId: frameTree.frame.id,
        html,
      });
      void baseUrl;
    }, DEFAULT_LOAD_TIMEOUT_MS);
  }

  async navigate(url: string, loadTimeoutMs = DEFAULT_LOAD_TIMEOUT_MS) {
    await this.waitForLoad(async () => {
      // A navigation that fails (bad URL, unreachable file) never fires a load event.
      const { errorText } = await this.send<{ errorText?: string }>("Page.navigate", { url });
      if (errorText) throw new BuildError(`Could not load ${url}: ${errorText}`);
    }, loadTimeoutMs);
  }

  async waitForReady(timeoutMs = 15_000) {
    return this.evaluate<boolean>(readyProbeExpr(timeoutMs));
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
    return Buffer.concat(chunks);
  }

  async close() {
    for (const off of this.offs.splice(0)) off();
    // Nothing to close on a browser that is already gone.
    await this.conn.send("Target.closeTarget", { targetId: this.targetId }).catch((e) => {
      if (!this.conn.isClosed) throw e;
    });
  }
}
