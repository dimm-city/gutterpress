/**
 * electron/version-preview.ts — Version history's Pages (#408): one read-only
 * preview of a past version at a time, from a scratch copy of its files,
 * rendered through a second preview server; closing stops the server and
 * drops the copy, a failed open leaves nothing behind, and an open still
 * waiting when a later open or close arrives is skipped.
 */
import { describe, expect, test } from "bun:test";
import { VersionPreviewHost, type VersionPreviewDeps } from "../../electron/version-preview";

interface Log {
  exports: Array<[string, string, string]>;
  starts: Array<{ input: string; noWatch: boolean }>;
  stops: string[];
  removed: string[];
  linked: Array<[string, string]>;
}

function make(opts: { exportThrows?: boolean } = {}) {
  const log: Log = { exports: [], starts: [], stops: [], removed: [], linked: [] };
  let n = 0;
  const deps: VersionPreviewDeps = {
    loadLib: async () =>
      ({
        exportVersionTree: async (projectDir: string, id: string, dest: string) => {
          log.exports.push([projectDir, id, dest]);
          if (opts.exportThrows) throw new Error("no such version");
          return { inputDir: `${dest}/book` };
        },
        startPreviewServer: async (options: { input: string; noWatch: boolean }) => {
          log.starts.push({ input: options.input, noWatch: options.noWatch });
          const url = `http://127.0.0.1:${4000 + log.starts.length}`;
          return { url, stop: async () => void log.stops.push(url) };
        },
      }) as unknown as Awaited<ReturnType<VersionPreviewDeps["loadLib"]>>,
    makeExportDir: async (id) => `/tmp/versions/${id}-${++n}`,
    removeDir: async (dir) => void log.removed.push(dir),
    linkExtensions: async (projectDir, inputDir) => void log.linked.push([projectDir, inputDir]),
  };
  return { host: new VersionPreviewHost(deps), log };
}

describe("VersionPreviewHost", () => {
  test("open exports the version, links extensions, starts a non-watching server and returns its URL", async () => {
    const { host, log } = make();
    const { url } = await host.open("/book", "a".repeat(40));
    expect(url).toBe("http://127.0.0.1:4001");
    expect(log.exports).toEqual([["/book", "a".repeat(40), `/tmp/versions/${"a".repeat(40)}-1`]]);
    expect(log.linked).toEqual([["/book", `/tmp/versions/${"a".repeat(40)}-1/book`]]);
    expect(log.starts).toEqual([{ input: `/tmp/versions/${"a".repeat(40)}-1/book`, noWatch: true }]);
  });

  test("opening the same version again reuses it; another version replaces it", async () => {
    const { host, log } = make();
    const first = await host.open("/book", "a".repeat(40));
    const again = await host.open("/book", "a".repeat(40));
    expect(again.url).toBe(first.url);
    expect(log.starts).toHaveLength(1);
    const second = await host.open("/book", "b".repeat(40));
    expect(second.url).not.toBe(first.url);
    expect(log.stops).toEqual([first.url]);
    expect(log.removed).toEqual([`/tmp/versions/${"a".repeat(40)}-1`]);
  });

  test("close stops the server and removes the copy; a second close is a no-op", async () => {
    const { host, log } = make();
    const { url } = await host.open("/book", "a".repeat(40));
    await host.close();
    await host.close();
    expect(log.stops).toEqual([url]);
    expect(log.removed).toHaveLength(1);
  });

  test("an open still waiting its turn when a later call arrives is skipped: no copy, no server", async () => {
    const { host, log } = make();
    const first = host.open("/book", "a".repeat(40));
    await Promise.resolve(); // the first open has started
    const stale = host.open("/book", "b".repeat(40));
    const closed = host.close();
    const latest = host.open("/book", "c".repeat(40));
    expect(await first).toEqual({ url: "http://127.0.0.1:4001" });
    expect(await stale).toBeNull();
    await closed;
    expect(await latest).toEqual({ url: "http://127.0.0.1:4002" });
    expect(log.exports.map(([, id]) => id[0])).toEqual(["a", "c"]);
    expect(log.stops).toEqual(["http://127.0.0.1:4001"]);
    // An open that a close replaced before it started is skipped too.
    const dropped = host.open("/book", "d".repeat(40));
    await host.close();
    expect(await dropped).toBeNull();
    expect(log.exports).toHaveLength(2);
    expect(log.stops).toEqual(["http://127.0.0.1:4001", "http://127.0.0.1:4002"]);
  });

  test("a failed export leaves no folder behind and no server running", async () => {
    const { host, log } = make({ exportThrows: true });
    await expect(host.open("/book", "a".repeat(40))).rejects.toThrow("no such version");
    expect(log.starts).toEqual([]);
    expect(log.removed).toHaveLength(1);
    await host.close();
    expect(log.stops).toEqual([]);
  });
});
