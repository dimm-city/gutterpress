/**
 * API Route Handlers for Preview Server
 *
 * Provides HTTP route handlers for directory listing, folder switching,
 * and GitHub repository cloning.
 * All routes enforce home directory security boundaries.
 *
 * Route handlers:
 * - handleListDirectories: GET /api/directories - List subdirectories with navigation
 * - handleChangeFolder: POST /api/change-folder - Switch working directory
 * - handleGitHubStatus: GET /api/gh/status - Check GitHub CLI status and authentication
 * - handleGitHubLogin: POST /api/gh/login - Initiate GitHub authentication
 * - handleGitHubClone: POST /api/gh/clone - Clone repository and switch to it
 * - handleGitHubUser: GET /api/gh/user - Get current GitHub user info
 */

import { readdir, stat } from "fs/promises";
import { join, resolve, dirname } from "path";
import type {
  DirectoryListResponse,
  FolderChangeResponse,
  DirectoryEntry,
} from "../types";
import {
  isWithinHomeDirectory,
  getHomeDirectory,
} from "../utils/path-security";
import { error as logError, info } from "../utils/logger";
import { isErrorWithCode } from "../utils/errors";
import {
  isGhCliInstalled,
  checkGhAuthStatus,
  loginWithGh,
  cloneRepository,
  getCurrentUser,
} from "../utils/gh-cli-utils";
import { homedir } from "os";
import { resolve as resolvePath } from "path";

// GitHub-related types (previously in types.ts)
interface GitHubAuthStatus {
  ghCliInstalled: boolean;
  authenticated: boolean;
  username?: string;
  error?: string;
}

interface GitHubCloneResponse {
  success: boolean;
  localPath?: string;
  error?: string;
}

interface GitHubLoginResponse {
  success: boolean;
  error?: string;
}

interface GitHubUserInfo {
  username: string;
  name?: string;
}

/**
 * Validate folder change request body
 */
function validateFolderChangeRequest(body: unknown): { valid: true; path: string } | { valid: false; error: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Invalid request body" };
  }
  const { path } = body as Record<string, unknown>;
  if (typeof path !== "string" || path.trim().length === 0) {
    return { valid: false, error: "Path is required and must be a non-empty string" };
  }
  const absPath = resolvePath(path);
  const homeDir = homedir();
  if (!absPath.startsWith(homeDir)) {
    return { valid: false, error: "Path must be within your home directory" };
  }
  return { valid: true, path };
}

/**
 * Validate GitHub clone request body
 */
function validateGitHubCloneRequest(body: unknown): { valid: true; url: string; targetDir?: string } | { valid: false; error: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Invalid request body" };
  }
  const { url, targetDir } = body as Record<string, unknown>;
  if (typeof url !== "string" || url.length === 0) {
    return { valid: false, error: "Repository URL is required" };
  }
  const githubPatterns = [
    /^https?:\/\/github\.com\/[\w-]+\/[\w.-]+/,
    /^git@github\.com:[\w-]+\/[\w.-]+\.git$/,
    /^[\w-]+\/[\w.-]+$/,
  ];
  if (!githubPatterns.some((pattern) => pattern.test(url))) {
    return { valid: false, error: "Invalid GitHub URL. Use: https://github.com/owner/repo, git@github.com:owner/repo.git, or owner/repo" };
  }
  return { valid: true, url, targetDir: typeof targetDir === "string" ? targetDir : undefined };
}

/**
 * Helper function to check if a path is a directory
 *
 * @param path - Path to check
 * @returns True if path exists and is a directory
 */
async function isDirectory(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Helper function to check if a file or directory exists
 *
 * @param path - Path to check
 * @returns True if path exists
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a JSON response with proper headers
 *
 * @param data - Data to serialize as JSON
 * @param status - HTTP status code (default: 200)
 * @returns Response with JSON content type
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Create an error response with JSON body
 *
 * @param message - Error message
 * @param status - HTTP status code (default: 500)
 * @returns Response with error JSON
 */
function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

/**
 * List directories under a given path
 *
 * Reads directory contents and filters to only include subdirectories.
 * Hidden directories (starting with '.') are excluded.
 *
 * @param basePath - Directory to list
 * @returns Array of directory entries sorted alphabetically
 */
async function listDirectories(basePath: string): Promise<DirectoryEntry[]> {
  try {
    // Read directory with file type information
    const entries = await readdir(basePath, { withFileTypes: true });

    // Filter to directories only, exclude hidden directories
    const directories = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => ({
        name: entry.name,
        path: join(basePath, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return directories;
  } catch (error) {
    // Return empty array on error (likely permission denied or path doesn't exist)
    return [];
  }
}

/**
 * Handle GET /api/directories - List subdirectories with navigation
 *
 * Query parameters:
 * - path: Directory to list (optional, defaults to home directory)
 *
 * Security:
 * - Path must be within home directory boundary
 * - If path is outside home, falls back to home directory
 * - Hidden directories (starting with '.') are excluded
 *
 * Response includes:
 * - currentPath: Resolved path being listed
 * - homeDirectory: User's home directory
 * - isAtHome: Whether current path equals home directory
 * - parent: Parent directory path (undefined if at home or if parent is outside home)
 * - directories: Array of subdirectories sorted alphabetically
 *
 * Error handling:
 * - ENOENT (path doesn't exist): 404 with error message
 * - EACCES (permission denied): 403 with error message
 * - Other errors: 500 with error message
 *
 * @param request - HTTP request with optional 'path' query parameter
 * @returns JSON response with DirectoryListResponse
 */
export async function handleListDirectories(
  request: Request
): Promise<Response> {
  try {
    // Extract path from query parameters
    const url = new URL(request.url);
    let basePath = url.searchParams.get("path") || getHomeDirectory();

    // Security check: ensure path is within home directory
    const homeDir = getHomeDirectory();
    if (!isWithinHomeDirectory(basePath, homeDir)) {
      basePath = homeDir;
    }

    // Validate path exists
    if (!(await fileExists(basePath))) {
      return errorResponse("Directory does not exist", 404);
    }

    // Validate path is a directory
    if (!(await isDirectory(basePath))) {
      return errorResponse("Path is not a directory", 400);
    }

    // List subdirectories
    const directories = await listDirectories(basePath);
    const isAtHome = resolve(basePath) === resolve(homeDir);

    // Calculate parent directory (only if not at home)
    let parentPath: string | undefined;
    if (!isAtHome) {
      const parent = dirname(basePath);
      // Only include parent if it's within home directory
      if (isWithinHomeDirectory(parent, homeDir)) {
        parentPath = parent;
      }
    }

    // Build response
    const response: DirectoryListResponse = {
      currentPath: basePath,
      homeDirectory: homeDir,
      isAtHome,
      parent: parentPath,
      directories,
    };

    return jsonResponse(response);
  } catch (error) {
    // Handle specific error codes with type-safe access
    if (isErrorWithCode(error)) {
      if (error.code === "ENOENT") {
        return errorResponse("Directory does not exist", 404);
      }

      if (error.code === "EACCES") {
        return errorResponse("Permission denied", 403);
      }
    }

    // Generic error
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed to list directories: ${message}`, 500);
  }
}

/**
 * Handle POST /api/change-folder - Switch working directory
 *
 * Request body:
 * - path: New directory path (required)
 *
 * Security:
 * - Path must be within home directory boundary
 * - Path must exist and be a directory
 *
 * Callback:
 * - Calls onFolderChange(path) to restart preview with new directory
 *
 * Success response:
 * - success: true
 * - path: Resolved path to new directory
 *
 * Error handling:
 * - Invalid JSON: 400 with error message
 * - Missing path field: 400 with error message
 * - Path not a string: 400 with error message
 * - Empty path: 400 with error message
 * - Path outside home: 403 with error message
 * - Path doesn't exist: 404 with error message
 * - Path not a directory: 400 with error message
 * - Restart failure: 500 with error message
 *
 * @param request - HTTP POST request with JSON body
 * @param onFolderChange - Callback to restart preview with new directory
 * @returns JSON response with FolderChangeResponse
 */
export async function handleChangeFolder(
  request: Request,
  onFolderChange: (newPath: string) => Promise<void>
): Promise<Response> {
  try {
    // Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      const response: FolderChangeResponse = {
        success: false,
        error: "Invalid JSON in request body",
      };
      return jsonResponse(response, 400);
    }

    // Validate request body
    const validationResult = validateFolderChangeRequest(body);

    if (!validationResult.valid) {
      const response: FolderChangeResponse = {
        success: false,
        error: validationResult.error,
      };
      return jsonResponse(response, 400);
    }

    const newPath = validationResult.path;

    // Validate path exists and is a directory
    if (!(await fileExists(newPath))) {
      const response: FolderChangeResponse = {
        success: false,
        error: "Path does not exist",
      };
      return jsonResponse(response, 404);
    }

    if (!(await isDirectory(newPath))) {
      const response: FolderChangeResponse = {
        success: false,
        error: "Path is not a directory",
      };
      return jsonResponse(response, 400);
    }

    // Call the restart callback
    try {
      await onFolderChange(newPath);
    } catch (error) {
      const response: FolderChangeResponse = {
        success: false,
        error: `Failed to restart preview: ${(error as Error).message}`,
      };
      return jsonResponse(response, 500);
    }

    // Success response
    const response: FolderChangeResponse = {
      success: true,
      path: newPath,
    };
    return jsonResponse(response);
  } catch (error) {
    // Generic error handler with type-safe access
    const message = error instanceof Error ? error.message : String(error);
    logError(`Error in handleChangeFolder: ${message}`);
    const response: FolderChangeResponse = {
      success: false,
      error: `Failed to change folder: ${message}`,
    };
    return jsonResponse(response, 500);
  }
}

/**
 * Handle GET /api/gh/status - Check GitHub CLI installation and authentication
 * 
 * No request parameters required.
 * 
 * Response includes:
 * - ghCliInstalled: Whether gh CLI is installed
 * - authenticated: Whether user is authenticated with GitHub
 * - username: GitHub username if authenticated
 * - error: Error message if status check failed
 * 
 * @param request - HTTP GET request
 * @returns JSON response with GitHubAuthStatus
 */
export async function handleGitHubStatus(
  request: Request
): Promise<Response> {
  try {
    info("Checking GitHub CLI status...");
    
    // Check if gh CLI is installed
    const ghInstalled = await isGhCliInstalled();
    
    if (!ghInstalled) {
      const response: GitHubAuthStatus = {
        ghCliInstalled: false,
        authenticated: false,
      };
      return jsonResponse(response);
    }
    
    // Check authentication status
    const authStatus = await checkGhAuthStatus();
    
    const response: GitHubAuthStatus = {
      ghCliInstalled: true,
      authenticated: authStatus.authenticated,
      username: authStatus.username,
      error: authStatus.error,
    };
    
    return jsonResponse(response);
  } catch (error) {
    // Type-safe error handling
    const message = error instanceof Error ? error.message : String(error);
    logError(`Error in handleGitHubStatus: ${message}`);
    
    const response: GitHubAuthStatus = {
      ghCliInstalled: false,
      authenticated: false,
      error: `Failed to check GitHub status: ${message}`,
    };
    return jsonResponse(response, 500);
  }
}

/**
 * Handle POST /api/gh/login - Initiate GitHub authentication
 * 
 * No request body required. This will open the user's browser for authentication.
 * 
 * Response includes:
 * - success: Whether authentication was successful
 * - error: Error message if authentication failed
 * 
 * @param request - HTTP POST request
 * @returns JSON response with GitHubLoginResponse
 */
export async function handleGitHubLogin(
  request: Request
): Promise<Response> {
  try {
    info("Initiating GitHub authentication...");
    
    const result = await loginWithGh();
    
    const response: GitHubLoginResponse = {
      success: result.success,
      error: result.error,
    };
    
    return jsonResponse(response, result.success ? 200 : 500);
  } catch (error) {
    // Type-safe error handling
    const message = error instanceof Error ? error.message : String(error);
    logError(`Error in handleGitHubLogin: ${message}`);
    
    const response: GitHubLoginResponse = {
      success: false,
      error: `Failed to authenticate: ${message}`,
    };
    return jsonResponse(response, 500);
  }
}

/**
 * Handle POST /api/gh/clone - Clone GitHub repository and switch to it
 * 
 * Request body:
 * - repoUrl: GitHub repository URL (required)
 * 
 * Response includes:
 * - success: Whether clone was successful
 * - localPath: Local path to cloned repository
 * - error: Error message if clone failed
 * 
 * After successful clone, the preview will automatically switch to the cloned directory.
 * 
 * @param request - HTTP POST request with JSON body
 * @param onFolderChange - Callback to restart preview with cloned directory
 * @returns JSON response with GitHubCloneResponse
 */
export async function handleGitHubClone(
  request: Request,
  onFolderChange: (newPath: string) => Promise<void>
): Promise<Response> {
  try {
    // Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      const response: GitHubCloneResponse = {
        success: false,
        error: "Invalid JSON in request body",
      };
      return jsonResponse(response, 400);
    }

    // Validate request body
    const validationResult = validateGitHubCloneRequest(body);

    if (!validationResult.valid) {
      const response: GitHubCloneResponse = {
        success: false,
        error: validationResult.error,
      };
      return jsonResponse(response, 400);
    }

    const { url: repoUrl, targetDir: targetDirectory } = validationResult;

    info(`Cloning GitHub repository: ${repoUrl}${targetDirectory ? ` to ${targetDirectory}` : ''}`);

    // Clone the repository
    const cloneResult = await cloneRepository(
      repoUrl,
      targetDirectory
    );
    
    if (!cloneResult.success || !cloneResult.localPath) {
      const response: GitHubCloneResponse = {
        success: false,
        error: cloneResult.error || "Clone failed with unknown error",
      };
      return jsonResponse(response, 500);
    }
    
    // Switch to the cloned directory
    try {
      await onFolderChange(cloneResult.localPath);
    } catch (error) {
      const response: GitHubCloneResponse = {
        success: false,
        error: `Repository cloned but failed to switch to it: ${(error as Error).message}`,
        localPath: cloneResult.localPath,
      };
      return jsonResponse(response, 500);
    }
    
    // Success response
    const response: GitHubCloneResponse = {
      success: true,
      localPath: cloneResult.localPath,
    };
    return jsonResponse(response);
  } catch (error) {
    // Type-safe error handling
    const message = error instanceof Error ? error.message : String(error);
    logError(`Error in handleGitHubClone: ${message}`);
    
    const response: GitHubCloneResponse = {
      success: false,
      error: `Failed to clone repository: ${message}`,
    };
    return jsonResponse(response, 500);
  }
}

/**
 * Handle GET /api/gh/user - Get current GitHub user info
 * 
 * No request parameters required.
 * 
 * Response includes:
 * - username: GitHub username
 * - name: Display name
 * 
 * Returns 401 if not authenticated.
 * 
 * @param request - HTTP GET request
 * @returns JSON response with GitHubUserInfo or error
 */
export async function handleGitHubUser(
  request: Request
): Promise<Response> {
  try {
    info("Fetching GitHub user info...");
    
    const user = await getCurrentUser();
    
    if (!user) {
      return errorResponse("Not authenticated with GitHub", 401);
    }
    
    const response: GitHubUserInfo = {
      username: user.username,
      name: user.name,
    };
    
    return jsonResponse(response);
  } catch (error) {
    // Type-safe error handling
    const message = error instanceof Error ? error.message : String(error);
    logError(`Error in handleGitHubUser: ${message}`);
    
    return errorResponse(`Failed to fetch user info: ${message}`, 500);
  }
}
