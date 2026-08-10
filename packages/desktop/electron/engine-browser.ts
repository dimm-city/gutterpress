/**
 * Electron-native `Browser`/`Session` for `--engine native` PDF export.
 *
 * The native engine (`packages/cli/src/engine/`) is driven over the `Browser`/
 * `Session` interfaces in `engine/shared/cdp.ts` — a raw-CDP client written
 * against an EXTERNAL Chromium (spawned or attached via `Target.createTarget`
 * / `Page.printToPDF` over a WebSocket). That surface cannot be satisfied by
 * attaching Electron's own devtools protocol to a live page session: measured
 * 2026-08-08, `Target.createTarget` returns "Not supported" (-32000) and
 * `Page.printToPDF` "wasn't found" (-32601) on an attached Electron CDP
 * session — Electron's CDP target hierarchy doesn't expose the tab-creation /
 * page-print surface the engine's client assumes. So this module does NOT
 * connect over CDP at all; it implements the SAME `Browser`/`Session`
 * contract directly against Electron's own APIs:
 *
 *   - `newPage()` / navigate      -> a hidden `BrowserWindow` + `loadURL`
 *   - `evaluate()`                -> `webContents.executeJavaScript`
 *     (Electron awaits a returned Promise itself, same as CDP's
 *     `awaitPromise: true`)
 *   - `send()` (Emulation domain) -> `webContents.debugger.sendCommand` —
 *     Electron's debugger IS usable for arbitrary CDP *domain* commands
 *     against ITS OWN attached page (`Emulation.setDeviceMetricsOverride`,
 *     `Emulation.setEmulatedMedia`); it's specifically the Target/Page.print
 *     surface on a foreign-attached session that fails, not CDP in general.
 *   - `printToPDF()`              -> `webContents.printToPDF` (returns a
 *     `Buffer`; the CDP client's `transferMode` streaming option is dropped —
 *     it exists only to work around one message carrying the whole PDF as
 *     base64 over a WebSocket, which does not apply here: printToPDF returns
 *     an in-process Buffer directly, no serialization round-trip at all)
 *   - `close()`                   -> `win.destroy()`
 *
 * Proven against a scratch app (2026-08-08): `webContents.printToPDF({
 * preferCSSPageSize, printBackground, generateTaggedPDF,
 * generateDocumentOutline })` produced a correct 4-page tagged PDF whose named
 * destinations survived (`{ch1:1, ch2:2, ch3:3}`) — the exact page-map
 * mechanism Tier 3 cross-references and the native-parity gate depend on.
 *
 * ONE Browser per build (`packages/cli/src/lib/engine.ts`'s `buildNativePdf`
 * doc comment): a fresh hidden `BrowserWindow` per call to
 * `createElectronEngineBrowser()`, and `buildNativePdf` always closes
 * whatever browser it ends up with — injected or pooled — in a `finally`, so
 * this window's lifecycle never leaks. Main process only; the SPA must stay
 * PWA-clean (CLAUDE.md §8) — nothing here is reachable from
 * `packages/desktop/src/`.
 *
 * RESIDUAL RISK — font rendering — MEASURED, not left open: the CDP path
 * (`engine/shared/cdp.ts`'s `launchChromium`) launches its external Chromium
 * with `--font-render-hinting=none` and `--disable-gpu`; a `BrowserWindow`
 * gets neither by default. Measured 2026-08-09 with a scratch Electron app
 * (same Electron 42.1.0 / Chromium 148 this app ships): printing identical
 * serif-heavy HTML to PDF with those two switches set via
 * `app.commandLine.appendSwitch` before `app.whenReady()`, vs. not set at
 * all, produced PDFs whose ONLY byte difference was the `/CreationDate` /
 * `/ModDate` timestamp — rendering both to PNG at 150dpi (`pdftoppm`) gave
 * byte-identical raster output. So in this environment the switches make no
 * observable difference, and they are deliberately NOT set here: `disable-gpu`
 * is an app-wide Chromium flag (it cannot be scoped to one hidden export
 * window) and would also affect the visible UI's compositing for every other
 * window, which is a real cost with no measured export-quality benefit to
 * justify it. If a future report shows font-rendering divergence in exported
 * PDFs on a real GPU-backed desktop (this measurement ran on a headless/
 * software-rendered container), re-run this comparison there before adding
 * the switches — don't assume the container result generalizes to every host.
 */
import { BrowserWindow } from "electron";
import { DEFAULT_PRINT_OPTS, readyProbeExpr } from "gutterpress";
import type { EngineBrowser, EngineSession } from "gutterpress";

function milestoneFromChromeVersion(v: string): number {
  return Number(/^(\d+)/.exec(v)?.[1] ?? 0);
}

class ElectronEngineSession implements EngineSession {
  private closed = false;

  constructor(private win: BrowserWindow) {}

  private get wc() {
    return this.win.webContents;
  }

  send<T = any>(method: string, params: object = {}): Promise<T> {
    return this.wc.debugger.sendCommand(method, params) as Promise<T>;
  }

  on(event: string, fn: (params: any) => void): () => void {
    const handler = (_e: unknown, method: string, params: any) => {
      if (method === event) fn(params);
    };
    this.wc.debugger.on("message", handler);
    return () => this.wc.debugger.removeListener("message", handler);
  }

  async evaluate<T = any>(expression: string): Promise<T> {
    return (await this.wc.executeJavaScript(expression)) as T;
  }

  /** Reuses the already-attached debugger — same CDP call cdp.ts's own
   * setContent makes, so behaviour matches the external-Chromium path
   * exactly. Not on the native engine's real build path (which only ever
   * calls `navigate`), kept for interface parity + spike/tooling callers. */
  async setContent(html: string, _baseUrl = "http://gutterpress.spike/"): Promise<void> {
    const { frameTree } = await this.send<any>("Page.getFrameTree");
    await this.send("Page.setDocumentContent", { frameId: frameTree.frame.id, html });
  }

  async navigate(url: string): Promise<void> {
    await this.win.loadURL(url);
  }

  async waitForReady(timeoutMs = 15_000): Promise<void> {
    await this.evaluate(readyProbeExpr(timeoutMs));
  }

  async printToPDF(opts: Record<string, unknown> = {}): Promise<Uint8Array> {
    // `transferMode` is cdp.ts's CDP-streaming knob (see this file's header
    // doc) — meaningless against `webContents.printToPDF`, which returns an
    // in-process Buffer with no serialization step to stream around.
    const { transferMode: _drop, ...rest } = opts;
    const buf = await this.wc.printToPDF({ ...DEFAULT_PRINT_OPTS, ...rest });
    return new Uint8Array(buf);
  }

  /**
   * Mirrors `cdp.ts`'s `Target.closeTarget` — really closes THIS page, not
   * just the debugger connection to it, since (per this module's `newPage()`
   * doc comment) every session now owns its own window, not a shared one.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.wc.debugger.detach();
    } catch {
      /* already detached, or the window is already gone */
    }
    if (!this.win.isDestroyed()) this.win.destroy();
  }
}

/**
 * Build a fresh Electron-native engine `Browser`, scoped to one build.
 *
 * `newPage()` creates a NEW hidden `BrowserWindow` on every call, mirroring
 * `cdp.ts`'s own `Browser.newPage()` (which creates a new CDP target every
 * time) — NOT a single memoized window. Measured why this matters
 * (2026-08-09): the compiler's §10 predict-then-verify pass
 * (`compiler/build.ts`'s `predictPageMap`) calls `browser.newPage()` a
 * SECOND time while the FIRST page (the one about to print) is still open,
 * specifically so the prediction runs "on a separate page/tab... so it
 * cannot perturb the document the compiler ships" (that function's own doc
 * comment). An earlier version of this module memoized a single session and
 * returned it for every `newPage()` call — the predict pass then navigated
 * and ran `Emulation.*`/`Page.*` commands against the SAME window the main
 * pass was using, and its `finally { page.close() }` detached that shared
 * debugger out from under the still-running main pass, which then hung
 * forever waiting on a CDP response that was never coming (reproduced with a
 * real 34pp book: `Rendering HTML to PDF via the Gutterpress engine` printed,
 * then nothing — no error, no completion, indefinitely). Each `newPage()`
 * getting its OWN window/debugger fixes this: the two pages genuinely don't
 * share any state, same as two CDP targets under `cdp.ts` don't.
 *
 * `close()` destroys every window this Browser ever opened.
 */
export async function createElectronEngineBrowser(): Promise<EngineBrowser> {
  const windows: BrowserWindow[] = [];

  function newWindow(): BrowserWindow {
    const win = new BrowserWindow({
      show: false,
      // Same reasoning as electron/pdf-export.ts's Paged.js renderer: a
      // hidden window is throttled by Chromium unless told otherwise, which
      // would slow native pagination the same way it slows Paged.js.
      paintWhenInitiallyHidden: true,
      width: 1280,
      height: 1024,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        javascript: true,
        backgroundThrottling: false,
      },
    });
    windows.push(win);
    return win;
  }

  return {
    wsUrl: "electron://engine-browser",
    version: `Chrome/${process.versions.chrome}`,
    milestone: milestoneFromChromeVersion(process.versions.chrome),
    async newPage() {
      const win = newWindow();
      // A freshly constructed BrowserWindow has no committed navigation entry
      // yet, and its webContents target isn't ready to answer CDP commands in
      // that state — measured: attaching the debugger and sending
      // `Page.enable` before ANY navigation rejects with "target closed while
      // handling command" every time, even though the window itself is very
      // much alive. `cdp.ts`'s equivalent (`checkMilestoneAndWrap.newPage()`)
      // gets away with the same enable-before-navigate order because
      // `Target.createTarget` hands back a target that already committed
      // `about:blank`; a bare `new BrowserWindow()` has not. So do that
      // navigation explicitly, before attaching, to reach the same state.
      await win.loadURL("about:blank");
      win.webContents.debugger.attach();
      const session = new ElectronEngineSession(win);
      await Promise.all([session.send("Page.enable"), session.send("Runtime.enable")]);
      return session;
    },
    async close() {
      for (const win of windows) {
        if (!win.isDestroyed()) win.destroy();
      }
    },
  };
}
