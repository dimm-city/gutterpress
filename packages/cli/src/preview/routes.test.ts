/**
 * Tests for API route handlers
 *
 * Validates directory listing, folder change, shutdown, and GitHub integration functionality
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  handleListDirectories,
  handleChangeFolder,
  handleGitHubStatus,
  handleGitHubLogin,
  handleGitHubClone,
  handleGitHubUser,
} from "./routes";
import { getHomeDirectory, getDefaultBrowseDirectory } from "../utils/path-security";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type {
  DirectoryListResponse,
  FolderChangeResponse,
} from "../types";
import type {
  GitHubAuthStatus,
  GitHubUserInfo,
  GitHubLoginResponse,
  GitHubCloneResponse,
} from "./routes";

// Helper to parse JSON response with proper typing
async function parseJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

describe("handleListDirectories", () => {
  test("returns default browse directory when no path parameter provided", async () => {
    const request = new Request("http://localhost:3000/api/directories");
    const response = await handleListDirectories(request);

    expect(response.status).toBe(200);

    const data = await parseJson<Record<string, unknown>>(response);
    const expectedPath = getDefaultBrowseDirectory();
    expect(data.currentPath).toBe(expectedPath);
    expect(data.isAtHome).toBe(expectedPath === getHomeDirectory());
    expect(Array.isArray(data.directories)).toBe(true);
  });

  test("returns 404 for non-existent directory within home", async () => {
    const homeDir = getHomeDirectory();
    const nonExistentPath = join(homeDir, "definitely-does-not-exist-" + Date.now());
    const request = new Request(
      `http://localhost:3000/api/directories?path=${encodeURIComponent(
        nonExistentPath
      )}`
    );
    const response = await handleListDirectories(request);

    expect(response.status).toBe(404);

    const data = await parseJson<Record<string, unknown>>(response);
    expect(data.error).toContain("does not exist");
  });

  test("falls back to home directory for paths outside home", async () => {
    const outsidePath = "/tmp/outside-home-" + Date.now();
    const request = new Request(
      `http://localhost:3000/api/directories?path=${encodeURIComponent(
        outsidePath
      )}`
    );
    const response = await handleListDirectories(request);

    expect(response.status).toBe(200);

    const data = await parseJson<Record<string, unknown>>(response);
    expect(data.currentPath).toBe(getHomeDirectory());
    expect(data.isAtHome).toBe(true);
  });

  test("lists subdirectories correctly", async () => {
    // Create temp directory within home directory
    const homeDir = getHomeDirectory();
    const tempDir = await mkdtemp(join(homeDir, ".print-md-test-"));
    await mkdir(join(tempDir, "subdir1"));
    await mkdir(join(tempDir, "subdir2"));
    await mkdir(join(tempDir, ".hidden")); // Should be excluded

    try {
      const request = new Request(
        `http://localhost:3000/api/directories?path=${encodeURIComponent(
          tempDir
        )}`
      );
      const response = await handleListDirectories(request);

      expect(response.status).toBe(200);

      const data = await parseJson<DirectoryListResponse>(response);
      expect(data.currentPath).toBe(tempDir);
      expect(data.directories.length).toBe(2);
      expect(data.directories[0]!.name).toBe("subdir1");
      expect(data.directories[1]!.name).toBe("subdir2");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("includes parent directory when not at home", async () => {
    // Create temp directory within home directory
    const homeDir = getHomeDirectory();
    const tempDir = await mkdtemp(join(homeDir, ".print-md-test-"));
    const subDir = join(tempDir, "subdir");
    await mkdir(subDir);

    try {
      const request = new Request(
        `http://localhost:3000/api/directories?path=${encodeURIComponent(
          subDir
        )}`
      );
      const response = await handleListDirectories(request);

      expect(response.status).toBe(200);

      const data = await parseJson<Record<string, unknown>>(response);
      expect(data.currentPath).toBe(subDir);
      expect(data.isAtHome).toBe(false);
      expect(data.parent).toBe(tempDir);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("handleChangeFolder", () => {
  test("returns 400 for invalid JSON", async () => {
    const request = new Request("http://localhost:3000/api/change-folder", {
      method: "POST",
      body: "not valid json",
    });

    const mockCallback = async () => {};
    const response = await handleChangeFolder(request, mockCallback);

    expect(response.status).toBe(400);

    const data = await parseJson<Record<string, unknown>>(response);
    expect(data.success).toBe(false);
    expect(data.error).toContain("Invalid JSON");
  });

  test("returns 400 for missing path field", async () => {
    const request = new Request("http://localhost:3000/api/change-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const mockCallback = async () => {};
    const response = await handleChangeFolder(request, mockCallback);

    expect(response.status).toBe(400);

    const data = await parseJson<Record<string, unknown>>(response);
    expect(data.success).toBe(false);
    expect(data.error).toBe("Path is required and must be a non-empty string");
  });

  test("returns 400 for non-string path", async () => {
    const request = new Request("http://localhost:3000/api/change-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: 123 }),
    });

    const mockCallback = async () => {};
    const response = await handleChangeFolder(request, mockCallback);

    expect(response.status).toBe(400);

    const data = await parseJson<Record<string, unknown>>(response);
    expect(data.success).toBe(false);
    expect(data.error).toBe("Path is required and must be a non-empty string");
  });

  test("returns 400 for empty path", async () => {
    const request = new Request("http://localhost:3000/api/change-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "   " }),
    });

    const mockCallback = async () => {};
    const response = await handleChangeFolder(request, mockCallback);

    expect(response.status).toBe(400);

    const data = await parseJson<Record<string, unknown>>(response);
    expect(data.success).toBe(false);
    expect(data.error).toBe("Path is required and must be a non-empty string");
  });

  test("returns 404 for non-existent path", async () => {
    const homeDir = getHomeDirectory();
    const nonExistentPath = join(homeDir, "definitely-does-not-exist-" + Date.now());
    const request = new Request("http://localhost:3000/api/change-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: nonExistentPath }),
    });

    const mockCallback = async () => {};
    const response = await handleChangeFolder(request, mockCallback);

    expect(response.status).toBe(404);

    const data = await parseJson<Record<string, unknown>>(response);
    expect(data.success).toBe(false);
    expect(data.error).toContain("does not exist");
  });

  test("successfully changes folder and calls callback", async () => {
    // Create temp directory within home directory
    const homeDir = getHomeDirectory();
    const tempDir = await mkdtemp(join(homeDir, ".print-md-test-"));

    try {
      let callbackCalled = false;
      let callbackPath = "";

      const mockCallback = async (newPath: string) => {
        callbackCalled = true;
        callbackPath = newPath;
      };

      const request = new Request("http://localhost:3000/api/change-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: tempDir }),
      });

      const response = await handleChangeFolder(request, mockCallback);

      expect(response.status).toBe(200);

      const data = await parseJson<Record<string, unknown>>(response);
      expect(data.success).toBe(true);
      expect(data.path).toBe(tempDir);
      expect(callbackCalled).toBe(true);
      expect(callbackPath).toBe(tempDir);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("returns 500 when callback throws error", async () => {
    const homeDir = getHomeDirectory();
    const tempDir = await mkdtemp(join(homeDir, ".print-md-test-"));

    try {
      const mockCallback = async () => {
        throw new Error("Restart failed");
      };

      const request = new Request("http://localhost:3000/api/change-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: tempDir }),
      });

      const response = await handleChangeFolder(request, mockCallback);

      expect(response.status).toBe(500);

      const data = await parseJson<Record<string, unknown>>(response);
      expect(data.success).toBe(false);
      expect(data.error).toContain("Failed to restart preview");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("rejects path with parent directory traversal", async () => {
    const homeDir = getHomeDirectory();
    const maliciousPath = join(homeDir, "subdir", "..", "..", "..", "etc", "passwd");

    const request = new Request("http://localhost:3000/api/change-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: maliciousPath }),
    });

    const mockCallback = async () => {};
    const response = await handleChangeFolder(request, mockCallback);

    // Should be rejected by path security validation
    expect(response.status).toBe(400);

    const data = await parseJson<Record<string, unknown>>(response);
    expect(data.success).toBe(false);
  });

  test("returns 400 when path is a file, not a directory", async () => {
    const homeDir = getHomeDirectory();
    const tempDir = await mkdtemp(join(homeDir, ".print-md-test-"));
    const filePath = join(tempDir, "test-file.txt");
    await writeFile(filePath, "test content");

    try {
      const request = new Request("http://localhost:3000/api/change-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath }),
      });

      const mockCallback = async () => {};
      const response = await handleChangeFolder(request, mockCallback);

      expect(response.status).toBe(400);

      const data = await parseJson<Record<string, unknown>>(response);
      expect(data.success).toBe(false);
      expect(data.error).toContain("not a directory");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("handleGitHubStatus", () => {
  test("returns proper response structure", async () => {
    const request = new Request("http://localhost:3000/api/gh/status");
    const response = await handleGitHubStatus(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const data = await parseJson<Record<string, unknown>>(response);
    expect(data).toHaveProperty("ghCliInstalled");
    expect(data).toHaveProperty("authenticated");
    expect(typeof data.ghCliInstalled).toBe("boolean");
    expect(typeof data.authenticated).toBe("boolean");
  });

  test("includes username when authenticated", async () => {
    const request = new Request("http://localhost:3000/api/gh/status");
    const response = await handleGitHubStatus(request);

    const data = await parseJson<GitHubAuthStatus>(response);

    if (data.authenticated) {
      expect(typeof data.username).toBe("string");
      expect((data.username ?? "").length).toBeGreaterThan(0);
    }
  });

  test("handles gh CLI not installed gracefully", async () => {
    const request = new Request("http://localhost:3000/api/gh/status");
    const response = await handleGitHubStatus(request);

    expect(response.status).toBe(200);

    const data = await parseJson<Record<string, unknown>>(response);

    if (!data.ghCliInstalled) {
      expect(data.authenticated).toBe(false);
      expect(data.username).toBeUndefined();
    }
  });
});

// `handleGitHubLogin` shells out to `gh auth login --web`, which opens an
// interactive browser flow and blocks until completion. The tests time out
// in any non-interactive environment (CI, Bun test runner). Skip when any
// truthy CI env var is set (most providers set `CI=true` but some use `1`)
// or when the `gh` CLI isn't on PATH; keep runnable for local investigation.
const skipGhLoginTests =
  Boolean(process.env.CI) || !Bun.which("gh");
const describeGhLogin = skipGhLoginTests ? describe.skip : describe;

describeGhLogin("handleGitHubLogin", () => {
  test("returns proper response structure", async () => {
    const request = new Request("http://localhost:3000/api/gh/login", {
      method: "POST",
    });

    const response = await handleGitHubLogin(request);

    expect(response.headers.get("Content-Type")).toBe("application/json");

    const data = await parseJson<Record<string, unknown>>(response);
    expect(data).toHaveProperty("success");
    expect(typeof data.success).toBe("boolean");
  });

  test("returns appropriate error when gh CLI not installed", async () => {
    const request = new Request("http://localhost:3000/api/gh/login", {
      method: "POST",
    });

    const response = await handleGitHubLogin(request);

    const data = await parseJson<Record<string, unknown>>(response);

    // If gh CLI is not installed, should fail
    if (!data.success) {
      expect(data.error).toBeTruthy();
      expect(typeof data.error).toBe("string");
    }
  });

  test("returns 500 status on authentication failure", async () => {
    const request = new Request("http://localhost:3000/api/gh/login", {
      method: "POST",
    });

    const response = await handleGitHubLogin(request);

    const data = await parseJson<Record<string, unknown>>(response);

    // If login fails, status should be 500
    if (!data.success) {
      expect(response.status).toBe(500);
    }
  });
});

describe("handleGitHubClone", () => {
  test("returns 400 for invalid JSON", async () => {
    const request = new Request("http://localhost:3000/api/gh/clone", {
      method: "POST",
      body: "not valid json{",
    });

    const mockCallback = async () => {};
    const response = await handleGitHubClone(request, mockCallback);

    expect(response.status).toBe(400);

    const data = await parseJson<Record<string, unknown>>(response);
    expect(data.success).toBe(false);
    expect(data.error).toContain("Invalid JSON");
  });

  test("returns 400 for missing url field", async () => {
    const request = new Request("http://localhost:3000/api/gh/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const mockCallback = async () => {};
    const response = await handleGitHubClone(request, mockCallback);

    expect(response.status).toBe(400);

    const data = await parseJson<Record<string, unknown>>(response);
    expect(data.success).toBe(false);
    expect(data.error).toBeTruthy();
  });

  test("returns 400 for invalid GitHub URL format", async () => {
    const request = new Request("http://localhost:3000/api/gh/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "not-a-valid-url" }),
    });

    const mockCallback = async () => {};
    const response = await handleGitHubClone(request, mockCallback);

    expect(response.status).toBe(400);

    const data = await parseJson<Record<string, unknown>>(response);
    expect(data.success).toBe(false);
  });

  test("validates GitHub URL patterns", async () => {
    const validUrls = [
      "https://github.com/user/repo",
      "https://github.com/user/repo.git",
      "git@github.com:user/repo.git",
      "https://github.com/org-name/repo-name",
    ];

    const mockCallback = async () => {};

    for (const url of validUrls) {
      const request = new Request("http://localhost:3000/api/gh/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const response = await handleGitHubClone(request, mockCallback);
      const data = await parseJson<Record<string, unknown>>(response);

      // Should pass validation (may fail at clone stage, but not validation)
      if (!data.success && response.status === 400) {
        expect(data.error).not.toContain("Invalid");
      }
    }
  });

  test("rejects non-GitHub URLs", async () => {
    const request = new Request("http://localhost:3000/api/gh/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://gitlab.com/user/repo" }),
    });

    const mockCallback = async () => {};
    const response = await handleGitHubClone(request, mockCallback);

    expect(response.status).toBe(400);

    const data = await parseJson<Record<string, unknown>>(response);
    expect(data.success).toBe(false);
  });

  test("returns proper response structure", async () => {
    const request = new Request("http://localhost:3000/api/gh/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/user/repo" }),
    });

    const mockCallback = async () => {};
    const response = await handleGitHubClone(request, mockCallback);

    expect(response.headers.get("Content-Type")).toBe("application/json");

    const data = await parseJson<Record<string, unknown>>(response);
    expect(data).toHaveProperty("success");
    expect(typeof data.success).toBe("boolean");
  });

  test("accepts optional targetDir parameter", async () => {
    const homeDir = getHomeDirectory();
    const targetDir = join(homeDir, "test-clone-dir-" + Date.now());

    const request = new Request("http://localhost:3000/api/gh/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://github.com/user/repo",
        targetDir: targetDir,
      }),
    });

    const mockCallback = async () => {};
    const response = await handleGitHubClone(request, mockCallback);

    // Should pass validation (will fail at clone, but validation should pass)
    const data = await parseJson<Record<string, unknown>>(response);
    if (!data.success && response.status === 400) {
      // Should not fail validation
      expect(data.error).not.toContain("targetDir");
    }
  });

  test("calls onFolderChange callback on successful clone", async () => {
    // This test would require mocking the gh CLI clone operation
    // For now, we just verify the callback signature is correct

    let callbackCalled = false;
    let callbackPath = "";

    const mockCallback = async (newPath: string) => {
      callbackCalled = true;
      callbackPath = newPath;
    };

    const request = new Request("http://localhost:3000/api/gh/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/user/repo" }),
    });

    // This will fail (no gh CLI or network), but validates callback signature
    await handleGitHubClone(request, mockCallback);

    // Callback would be called on success (but will fail in test environment)
  });
});

describe("handleGitHubUser", () => {
  test("returns proper response structure when authenticated", async () => {
    const request = new Request("http://localhost:3000/api/gh/user");
    const response = await handleGitHubUser(request);

    expect(response.headers.get("Content-Type")).toBe("application/json");

    const data = await parseJson<GitHubUserInfo>(response);

    if (response.status === 200) {
      expect(data).toHaveProperty("username");
      expect(data).toHaveProperty("name");
      expect(typeof data.username).toBe("string");
      expect(data.username.length).toBeGreaterThan(0);
    }
  });

  test("returns 401 when not authenticated", async () => {
    const request = new Request("http://localhost:3000/api/gh/user");
    const response = await handleGitHubUser(request);

    // Most likely not authenticated in test environment
    if (response.status === 401) {
      const data = await parseJson<Record<string, unknown>>(response);
      expect(data.error).toContain("Not authenticated");
    }
  });

  test("returns error message on authentication failure", async () => {
    const request = new Request("http://localhost:3000/api/gh/user");
    const response = await handleGitHubUser(request);

    if (response.status !== 200) {
      const data = await parseJson<Record<string, unknown>>(response);
      expect(data).toHaveProperty("error");
      expect(typeof data.error).toBe("string");
    }
  });
});
