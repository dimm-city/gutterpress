/**
 * Unit tests for file utilities
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  readFile,
  writeFile,
  fileExists,
  mkdir,
  remove,
  isDirectory,
  readDirectory,
  copyDirectory,
  waitForFile,
} from './file-utils.ts';
import path from 'path';

describe('File Utilities', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(process.cwd(), '.tmp', `file-utils-tests-${Date.now()}`);
    await mkdir(testDir);
  });

  afterEach(async () => {
    await remove(testDir);
  });

  describe('writeFile and readFile', () => {
    test('writes and reads file content', async () => {
      const filePath = path.join(testDir, 'test.txt');
      const content = 'Hello, world!';

      await writeFile(filePath, content);
      const result = await readFile(filePath);

      expect(result).toBe(content);
    });

    test('creates parent directories automatically', async () => {
      const filePath = path.join(testDir, 'nested', 'deep', 'file.txt');
      const content = 'Nested content';

      await writeFile(filePath, content);
      const result = await readFile(filePath);

      expect(result).toBe(content);
      expect(await fileExists(path.join(testDir, 'nested', 'deep'))).toBe(true);
    });

    test('overwrites existing file', async () => {
      const filePath = path.join(testDir, 'test.txt');

      await writeFile(filePath, 'First');
      await writeFile(filePath, 'Second');
      const result = await readFile(filePath);

      expect(result).toBe('Second');
    });
  });

  describe('fileExists', () => {
    test('returns true for existing file', async () => {
      const filePath = path.join(testDir, 'exists.txt');
      await writeFile(filePath, 'content');

      expect(await fileExists(filePath)).toBe(true);
    });

    test('returns false for non-existent file', async () => {
      const filePath = path.join(testDir, 'does-not-exist.txt');

      expect(await fileExists(filePath)).toBe(false);
    });

    test('returns true for existing directory', async () => {
      expect(await fileExists(testDir)).toBe(true);
    });
  });

  describe('mkdir', () => {
    test('creates directory', async () => {
      const dirPath = path.join(testDir, 'newdir');

      await mkdir(dirPath);

      expect(await fileExists(dirPath)).toBe(true);
      expect(await isDirectory(dirPath)).toBe(true);
    });

    test('creates nested directories', async () => {
      const dirPath = path.join(testDir, 'a', 'b', 'c');

      await mkdir(dirPath);

      expect(await fileExists(dirPath)).toBe(true);
      expect(await isDirectory(dirPath)).toBe(true);
    });

    test('does not throw if directory already exists', async () => {
      const dirPath = path.join(testDir, 'existing');

      await mkdir(dirPath);
      await expect(mkdir(dirPath)).resolves.toBeUndefined();
    });
  });

  describe('isDirectory', () => {
    test('returns true for directory', async () => {
      expect(await isDirectory(testDir)).toBe(true);
    });

    test('returns false for file', async () => {
      const filePath = path.join(testDir, 'file.txt');
      await writeFile(filePath, 'content');

      expect(await isDirectory(filePath)).toBe(false);
    });

    test('returns false for non-existent path', async () => {
      const nonExistent = path.join(testDir, 'does-not-exist');

      expect(await isDirectory(nonExistent)).toBe(false);
    });
  });

  describe('readDirectory', () => {
    test('reads directory entries', async () => {
      await writeFile(path.join(testDir, 'file1.txt'), 'content1');
      await writeFile(path.join(testDir, 'file2.txt'), 'content2');
      await mkdir(path.join(testDir, 'subdir'));

      const entries = await readDirectory(testDir);
      const names = entries.map((e) => e.name).sort();

      expect(names).toEqual(['file1.txt', 'file2.txt', 'subdir']);
      expect(entries.every((e) => e.isFile() || e.isDirectory())).toBe(true);
    });
  });

  describe('copyDirectory', () => {
    test('copies directory and contents', async () => {
      const srcDir = path.join(testDir, 'source');
      const destDir = path.join(testDir, 'dest');

      await mkdir(srcDir);
      await writeFile(path.join(srcDir, 'file1.txt'), 'content1');
      await writeFile(path.join(srcDir, 'file2.txt'), 'content2');
      await mkdir(path.join(srcDir, 'subdir'));
      await writeFile(path.join(srcDir, 'subdir', 'file3.txt'), 'content3');

      await copyDirectory(srcDir, destDir);

      expect(await fileExists(path.join(destDir, 'file1.txt'))).toBe(true);
      expect(await fileExists(path.join(destDir, 'file2.txt'))).toBe(true);
      expect(await fileExists(path.join(destDir, 'subdir', 'file3.txt'))).toBe(true);
      expect(await readFile(path.join(destDir, 'file1.txt'))).toBe('content1');
    });

    test('throws error if source does not exist', async () => {
      const srcDir = path.join(testDir, 'nonexistent');
      const destDir = path.join(testDir, 'dest');

      await expect(copyDirectory(srcDir, destDir)).rejects.toThrow(/does not exist/);
    });

    test('throws error if source is not a directory', async () => {
      const srcFile = path.join(testDir, 'file.txt');
      const destDir = path.join(testDir, 'dest');

      await writeFile(srcFile, 'content');

      await expect(copyDirectory(srcFile, destDir)).rejects.toThrow(/not a directory/);
    });
  });

  describe('remove', () => {
    test('removes file', async () => {
      const filePath = path.join(testDir, 'remove-me.txt');
      await writeFile(filePath, 'content');

      await remove(filePath);

      expect(await fileExists(filePath)).toBe(false);
    });

    test('removes directory recursively', async () => {
      const dirPath = path.join(testDir, 'remove-dir');
      await mkdir(dirPath);
      await writeFile(path.join(dirPath, 'file.txt'), 'content');
      await mkdir(path.join(dirPath, 'subdir'));

      await remove(dirPath);

      expect(await fileExists(dirPath)).toBe(false);
    });

    test('does not throw if path does not exist', async () => {
      const nonExistent = path.join(testDir, 'does-not-exist');

      await expect(remove(nonExistent)).resolves.toBeUndefined();
    });
  });

  describe('waitForFile', () => {
    test('resolves when file is created', async () => {
      const filePath = path.join(testDir, 'wait-for-me.txt');

      // Create file after a delay
      setTimeout(async () => {
        await writeFile(filePath, 'content');
      }, 100);

      await expect(waitForFile(filePath, { timeout: 1000 })).resolves.toBeUndefined();
    });

    test('throws error if timeout is reached', async () => {
      const filePath = path.join(testDir, 'never-created.txt');

      await expect(waitForFile(filePath, { timeout: 100 })).rejects.toThrow(/Timeout waiting for file/);
    });

    test('resolves immediately if file already exists', async () => {
      const filePath = path.join(testDir, 'already-exists.txt');
      await writeFile(filePath, 'content');

      await expect(waitForFile(filePath, { timeout: 1000 })).resolves.toBeUndefined();
    });
  });
});
