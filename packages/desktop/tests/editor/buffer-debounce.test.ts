import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import {
  DEFAULT_SAVE_DELAY_MS,
  DEFAULT_SAVE_MAX_WAIT_MS,
  EditorBuffer,
} from "../../src/lib/editor/buffer-state.svelte";
import type { Platform } from "../../src/lib/platform/contract";

(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

// Fake timers (they also drive Date.now(), which the max-wait cap reads).
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});
function advance(ms: number): void {
  jest.advanceTimersByTime(ms);
}
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function makePlatform(initial: string, writeGate?: { p: Promise<void> | null }) {
  let disk = initial;
  let mtime = 1;
  const writes: string[] = [];
  const platform = {
    platform: "electron",
    async readFile() { return disk; },
    async statFile() { return { exists: true, size: disk.length, mtimeMs: mtime }; },
    async writeFile(_p: string, content: string) {
      writes.push(content);
      if (writeGate?.p) await writeGate.p;
      disk = content;
      mtime += 1;
      return { mtimeMs: mtime };
    },
  };
  return { platform: platform as unknown as Platform, writes, disk: () => disk };
}

async function open(initial = "orig", writeGate?: { p: Promise<void> | null }, opts = {}) {
  const m = makePlatform(initial, writeGate);
  const buffer = new EditorBuffer({ platform: m.platform, recoveryEnabled: false, ...opts });
  await buffer.load("/book/c.md");
  return { buffer, ...m };
}

test("defaults: 2s idle delay, 12s max wait", () => {
  expect(DEFAULT_SAVE_DELAY_MS).toBe(2000);
  expect(DEFAULT_SAVE_MAX_WAIT_MS).toBe(12_000);
});

test("no save while keystrokes keep arriving inside the idle delay; saves after the pause", async () => {
  const { buffer, writes } = await open();
  for (let i = 1; i <= 5; i++) {
    buffer.edit("t".repeat(i));
    advance(1500); // gaps shorter than 2s keep resetting the timer
  }
  await settle();
  expect(writes).toEqual([]);
  advance(500);
  await settle();
  expect(writes).toEqual(["ttttt"]);
});

test("max wait: continuous typing still saves at the cap, then again after the next run", async () => {
  const { buffer, writes } = await open();
  let n = 0;
  for (let t = 0; t < 12_000; t += 1000) {
    buffer.edit(`v${++n}`);
    advance(1000);
  }
  await settle();
  expect(writes.length).toBe(1);
  expect(writes[0]).toBe("v12");
  // A fresh run of typing gets a fresh cap, not an immediate save.
  buffer.edit("next");
  advance(1999);
  await settle();
  expect(writes.length).toBe(1);
  advance(1);
  await settle();
  expect(writes).toEqual(["v12", "next"]);
});

test("flush saves immediately and cancels the pending timer", async () => {
  const { buffer, writes } = await open();
  buffer.edit("edited");
  await buffer.flush();
  expect(writes).toEqual(["edited"]);
  advance(20_000);
  await settle();
  expect(writes).toEqual(["edited"]);
});

test("typing during an in-flight save: the latest content ends up on disk", async () => {
  const gate = { p: null as Promise<void> | null };
  const { buffer, writes, disk } = await open("orig", gate);
  let release!: () => void;
  gate.p = new Promise<void>((r) => { release = r; });
  buffer.edit("first");
  const flushing = buffer.flush();
  await settle();
  expect(writes).toEqual(["first"]);
  buffer.edit("first and more"); // lands mid-write
  gate.p = null;
  release();
  await flushing; // flush loops until the buffer matches disk
  expect(disk()).toBe("first and more");
  expect(buffer.phase).toBe("clean");
});

test("edit during an autosave write reschedules a trailing save of the newest text", async () => {
  const gate = { p: null as Promise<void> | null };
  const { buffer, disk } = await open("orig", gate);
  let release!: () => void;
  gate.p = new Promise<void>((r) => { release = r; });
  buffer.edit("a");
  advance(2000);
  await settle();
  buffer.edit("ab");
  gate.p = null;
  release();
  await settle();
  expect(buffer.phase).toBe("dirty");
  advance(2000);
  await settle();
  expect(disk()).toBe("ab");
  expect(buffer.phase).toBe("clean");
});
