/**
 * Unit tests for server context and state management
 */

import { describe, test, expect } from 'bun:test';
import { createServerState } from './server-context';
import { resolveConfig } from '../lib/manifest';
import type { PreviewServerOptions } from '../types';

describe('Server Context', () => {
  describe('createServerState', () => {
    test('creates server state with correct initial values', () => {
      const inputPath = '/test/input';
      const tempDir = '/tmp/test';
      const assetsDir = '/assets';
      const config = resolveConfig({}, {});
      const options: PreviewServerOptions = {
        port: 3000,
        host: '127.0.0.1',
        verbose: false,
        noWatch: false,
        openBrowser: true,
      };

      const state = createServerState(inputPath, tempDir, assetsDir, config, options);

      expect(state.currentInputPath).toBe(inputPath);
      expect(state.tempDir).toBe(tempDir);
      expect(state.assetsSourceDir).toBe(assetsDir);
      expect(state.config).toBe(config);
      expect(state.options).toBe(options);
      expect(state.currentWatcher).toBeNull();
      expect(state.isRebuilding).toBe(false);
      expect(state.previewServer).toBeNull();
      expect(state.isShuttingDown).toBe(false);
    });
  });
});
