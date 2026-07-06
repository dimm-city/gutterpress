/**
 * Unit tests for logger utility
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  setLogLevel,
  getLogLevel,
  log,
  debug,
  info,
  warn,
  error,
  success,
  silence,
  reset,
} from './logger.ts';

describe('Logger', () => {
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let logMessages: string[];
  let errorMessages: string[];

  beforeEach(() => {
    // Capture console output
    logMessages = [];
    errorMessages = [];

    originalConsoleLog = console.log;
    originalConsoleError = console.error;

    console.log = (...args: unknown[]) => {
      logMessages.push(args.join(' '));
    };

    console.error = (...args: unknown[]) => {
      errorMessages.push(args.join(' '));
    };

    // Reset to default level
    reset();
  });

  afterEach(() => {
    // Restore console
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe('setLogLevel and getLogLevel', () => {
    test('sets and gets log level', () => {
      setLogLevel('DEBUG');
      expect(getLogLevel()).toBe('DEBUG');

      setLogLevel('ERROR');
      expect(getLogLevel()).toBe('ERROR');
    });

    test('defaults to INFO level', () => {
      expect(getLogLevel()).toBe('INFO');
    });
  });

  describe('log filtering by level', () => {
    test('INFO level shows INFO, WARN, ERROR', () => {
      setLogLevel('INFO');

      debug('debug message');
      info('info message');
      warn('warn message');
      error('error message');

      expect(logMessages.some((msg) => msg.includes('debug message'))).toBe(false);
      expect(logMessages.some((msg) => msg.includes('info message'))).toBe(true);
      expect(logMessages.some((msg) => msg.includes('warn message'))).toBe(true);
      expect(errorMessages.some((msg) => msg.includes('error message'))).toBe(true);
    });

    test('DEBUG level shows all messages', () => {
      setLogLevel('DEBUG');

      debug('debug message');
      info('info message');
      warn('warn message');
      error('error message');

      expect(logMessages.some((msg) => msg.includes('debug message'))).toBe(true);
      expect(logMessages.some((msg) => msg.includes('info message'))).toBe(true);
      expect(logMessages.some((msg) => msg.includes('warn message'))).toBe(true);
      expect(errorMessages.some((msg) => msg.includes('error message'))).toBe(true);
    });

    test('ERROR level only shows ERROR', () => {
      setLogLevel('ERROR');

      debug('debug message');
      info('info message');
      warn('warn message');
      error('error message');

      expect(logMessages.some((msg) => msg.includes('debug message'))).toBe(false);
      expect(logMessages.some((msg) => msg.includes('info message'))).toBe(false);
      expect(logMessages.some((msg) => msg.includes('warn message'))).toBe(false);
      expect(errorMessages.some((msg) => msg.includes('error message'))).toBe(true);
    });
  });

  describe('log formatting', () => {
    test('includes log level in output', () => {
      info('test message');

      expect(logMessages.some((msg) => msg.includes('INFO'))).toBe(true);
    });

    test('includes timestamp in output', () => {
      info('test message');

      // Timestamp format: [HH:MM:SS]
      expect(logMessages.some((msg) => /\[\d{2}:\d{2}:\d{2}\]/.test(msg))).toBe(true);
    });

    test('handles multiple arguments', () => {
      info('message', 'arg1', 'arg2');

      expect(logMessages.some((msg) => msg.includes('message') && msg.includes('arg1') && msg.includes('arg2'))).toBe(true);
    });
  });

  describe('error logging', () => {
    test('error messages go to console.error', () => {
      error('error message');

      expect(errorMessages.some((msg) => msg.includes('error message'))).toBe(true);
      expect(logMessages.some((msg) => msg.includes('error message'))).toBe(false);
    });

    test('other levels go to console.log', () => {
      info('info message');
      warn('warn message');
      debug('debug message');

      expect(logMessages.length).toBeGreaterThan(0);
      expect(errorMessages.length).toBe(0);
    });
  });

  describe('silence', () => {
    test('silences all logs except ERROR', () => {
      silence();

      debug('debug');
      info('info');
      warn('warn');
      error('error');

      // DEBUG, INFO, WARN should be suppressed
      expect(logMessages.length).toBe(0);
      // ERROR still shows (silence sets level to ERROR, not above it)
      // This is by design for testing - errors should always be visible
    });
  });

  describe('success helper', () => {
    test('emits a success message to console.log', () => {
      success('made a thing');

      expect(logMessages.some((msg) => msg.includes('made a thing'))).toBe(true);
      expect(errorMessages.length).toBe(0);
    });
  });

  describe('log facade (command call-sites)', () => {
    test('exposes info/warn/error/success methods', () => {
      expect(typeof log.info).toBe('function');
      expect(typeof log.warn).toBe('function');
      expect(typeof log.error).toBe('function');
      expect(typeof log.success).toBe('function');
    });

    test('routes info/success to console.log, warn to console.warn, error to console.error', () => {
      const warnMessages: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warnMessages.push(args.join(' '));
      };
      try {
        log.info('facade info');
        log.warn('facade warn');
        log.success('facade ok');
        log.error('facade error');
      } finally {
        console.warn = originalWarn;
      }

      expect(logMessages.some((m) => m.includes('facade info'))).toBe(true);
      expect(warnMessages.some((m) => m.includes('facade warn'))).toBe(true);
      expect(logMessages.some((m) => m.includes('facade ok'))).toBe(true);
      expect(errorMessages.some((m) => m.includes('facade error'))).toBe(true);
      expect(logMessages.some((m) => m.includes('facade error'))).toBe(false);
    });
  });

  describe('reset', () => {
    test('resets to INFO level', () => {
      setLogLevel('DEBUG');
      reset();

      expect(getLogLevel()).toBe('INFO');
    });

    test('restores default logging behavior', () => {
      silence();
      reset();

      info('test message');

      expect(logMessages.some((msg) => msg.includes('test message'))).toBe(true);
    });
  });
});
