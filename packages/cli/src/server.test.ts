/**
 * Integration tests for startPreviewServer.
 *
 * Covers:
 *   - Handle shape: url, port, host, inputPath all populated
 *   - stop() tears down the server (port becomes reachable → unreachable)
 *   - stop() does NOT call process.exit() (library callers must not be killed)
 *   - No-input mode: server boots and returns a non-zero port
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { startPreviewServer, type PreviewServerHandle } from './server';

let handle: PreviewServerHandle | null = null;
let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'print-md-server-test-'));
  await writeFile(join(tempDir, 'index.md'), '# Test\n\nHello world.\n');
});

afterEach(async () => {
  if (handle) {
    await handle.stop();
    handle = null;
  }
  await rm(tempDir, { recursive: true, force: true });
});

describe('startPreviewServer handle', () => {
  test('returns a non-zero port and a valid http URL', async () => {
    handle = await startPreviewServer({
      input: tempDir,
      port: 0,
      host: '127.0.0.1',
      noWatch: true,
      openBrowser: false,
      installSignalHandlers: false,
    });

    expect(handle.port).toBeGreaterThan(0);
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(handle.host).toBe('127.0.0.1');
    expect(handle.inputPath).toBe(tempDir);
  });

  test('server responds to HTTP requests while running', async () => {
    handle = await startPreviewServer({
      input: tempDir,
      port: 0,
      host: '127.0.0.1',
      noWatch: true,
      openBrowser: false,
      installSignalHandlers: false,
    });

    const res = await fetch(`${handle.url}/api/status`);
    expect(res.status).toBe(200);
  });

  test('stop() makes the port unreachable', async () => {
    handle = await startPreviewServer({
      input: tempDir,
      port: 0,
      host: '127.0.0.1',
      noWatch: true,
      openBrowser: false,
      installSignalHandlers: false,
    });

    const { url } = handle;
    await handle.stop();
    handle = null;

    // Allow Bun to release the port.
    await new Promise((r) => setTimeout(r, 50));

    await expect(fetch(`${url}/api/status`)).rejects.toThrow();
  });

  test('stop() does not call process.exit', async () => {
    const originalExit = process.exit;
    let exitCalled = false;
    // @ts-expect-error — intentional override for test
    process.exit = () => { exitCalled = true; };

    try {
      handle = await startPreviewServer({
        input: tempDir,
        port: 0,
        host: '127.0.0.1',
        noWatch: true,
        openBrowser: false,
        installSignalHandlers: false,
      });

      await handle.stop();
      handle = null;

      expect(exitCalled).toBe(false);
    } finally {
      process.exit = originalExit;
    }
  });

  test('no-input mode: server boots without an input directory', async () => {
    handle = await startPreviewServer({
      input: '',
      port: 0,
      host: '127.0.0.1',
      noWatch: true,
      openBrowser: false,
      installSignalHandlers: false,
    });

    expect(handle.port).toBeGreaterThan(0);
    expect(handle.inputPath).toBe('');

    const res = await fetch(`${handle.url}/api/status`);
    expect(res.status).toBe(200);
  });
});
