/**
 * GitHub CLI Utilities
 * 
 * Provides utilities to interact with the GitHub CLI (gh) for authentication
 * and repository cloning. Uses subprocess wrapper for gh commands.
 */

import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { mkdir, fileExists } from "./file-utils";
import { info, debug, error as logError } from "./logger";

const execAsync = promisify(exec);

/**
 * Check if GitHub CLI is installed
 * @returns True if gh CLI is available
 */
export async function isGhCliInstalled(): Promise<boolean> {
  try {
    const { stdout } = await execAsync("gh --version");
    debug(`GitHub CLI version: ${stdout.trim()}`);
    return true;
  } catch (error) {
    debug("GitHub CLI not found");
    return false;
  }
}

/**
 * Check GitHub CLI authentication status
 * @returns Object with auth status and username if authenticated
 */
export async function checkGhAuthStatus(): Promise<{
  authenticated: boolean;
  username?: string;
  error?: string;
}> {
  try {
    const { stdout, stderr } = await execAsync("gh auth status", {
      env: { ...process.env, GH_PAGER: "" },
    });
    
    // gh auth status writes to stderr even on success
    const output = stderr + stdout;
    
    // Check if logged in
    const isAuthenticated = output.includes("Logged in to github.com");
    
    if (!isAuthenticated) {
      return { authenticated: false };
    }
    
    // Extract username from output
    // Format: "Logged in to github.com as username (..."
    const match = output.match(/Logged in to github\.com as ([^\s(]+)/);
    const username = match ? match[1] : undefined;
    
    return {
      authenticated: true,
      username,
    };
  } catch (error: any) {
    // gh auth status exits with error code if not authenticated
    const output = error.stderr || error.stdout || "";
    
    if (output.includes("not logged in") || output.includes("You are not logged in")) {
      return { authenticated: false };
    }
    
    return {
      authenticated: false,
      error: `Failed to check auth status: ${error.message}`,
    };
  }
}

/**
 * Initiate GitHub CLI authentication using web browser flow
 * @returns Success status and any error message
 */
export async function loginWithGh(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    info("Initiating GitHub authentication...");
    
    // Use --web flag for browser-based authentication
    // This opens the user's browser and provides a code to enter
    const { stdout, stderr } = await execAsync("gh auth login --web --git-protocol https", {
      env: { ...process.env, GH_PAGER: "" },
      timeout: 120000, // 2 minute timeout for user to complete auth
    });
    
    debug(`gh auth login output: ${stdout} ${stderr}`);
    
    return { success: true };
  } catch (error: any) {
    logError("GitHub authentication failed:", error);
    
    // Parse error message for user-friendly feedback
    const errorMsg = error.message || String(error);
    
    if (errorMsg.includes("timeout") || errorMsg.includes("timed out")) {
      return {
        success: false,
        error: "Authentication timed out. Please try again and complete the authentication in your browser within 2 minutes.",
      };
    }
    
    if (errorMsg.includes("Cancelled")) {
      return {
        success: false,
        error: "Authentication was cancelled.",
      };
    }
    
    return {
      success: false,
      error: `Authentication failed: ${errorMsg}`,
    };
  }
}

/**
 * Get the directory where cloned repositories are stored
 * @returns Path to cloned repos directory
 */
export function getClonedReposDirectory(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "/tmp";
  return path.join(homeDir, ".print-md", "cloned-repos");
}

/**
 * Parse GitHub repository URL and extract owner and repo name
 * @param url - GitHub repository URL
 * @returns Object with owner and repo name, or null if invalid
 */
export function parseGitHubUrl(url: string): {
  owner: string;
  repo: string;
} | null {
  try {
    // Support various GitHub URL formats:
    // - https://github.com/owner/repo
    // - https://github.com/owner/repo.git
    // - git@github.com:owner/repo.git
    // - owner/repo (shorthand)
    
    // Remove trailing .git if present
    let cleanUrl = url.trim().replace(/\.git$/, "");
    
    // Handle SSH format (git@github.com:owner/repo)
    if (cleanUrl.startsWith("git@github.com:")) {
      cleanUrl = cleanUrl.replace("git@github.com:", "");
    } 
    // Handle HTTPS format (https://github.com/owner/repo or http://github.com/owner/repo)
    // Only accept github.com as the domain, not as a substring
    else if (cleanUrl.startsWith("http://") || cleanUrl.startsWith("https://")) {
      const httpsMatch = cleanUrl.match(/^https?:\/\/github\.com\/(.+)$/);
      if (httpsMatch && httpsMatch[1]) {
        cleanUrl = httpsMatch[1];
      } else {
        // It's an HTTP(S) URL but not github.com - reject it
        return null;
      }
    }
    // Otherwise assume it's shorthand format (owner/repo)
    
    // Remove trailing slashes
    cleanUrl = cleanUrl.replace(/\/+$/, "");
    
    // Now we should have owner/repo format (possibly with extra path components)
    // Split by / and take first two components
    const parts = cleanUrl.split("/").filter(p => p.length > 0);
    
    if (parts.length >= 2) {
      const owner = parts[0];
      const repo = parts[1];
      
      // Validate owner and repo are non-empty and don't contain protocol markers
      if (owner && repo && owner.length > 0 && repo.length > 0 && 
          !owner.includes(":") && !repo.includes(":")) {
        return { owner, repo };
      }
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Clone a GitHub repository using gh CLI
 * @param repoUrl - GitHub repository URL
 * @param targetDirectory - Optional target directory path (defaults to ~/.print-md/cloned-repos/owner/repo)
 * @returns Object with success status, local path, and any error
 */
export async function cloneRepository(
  repoUrl: string,
  targetDirectory?: string
): Promise<{
  success: boolean;
  localPath?: string;
  error?: string;
}> {
  try {
    // Parse repository URL
    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) {
      return {
        success: false,
        error: "Invalid GitHub repository URL. Expected format: https://github.com/owner/repo or owner/repo",
      };
    }
    
    const { owner, repo } = parsed;
    info(`Cloning repository: ${owner}/${repo}`);
    
    // Determine target directory
    let targetDir: string;
    if (targetDirectory) {
      // Use provided directory
      targetDir = path.join(targetDirectory, repo);
    } else {
      // Use default cloned repos directory
      const clonedReposDir = getClonedReposDirectory();
      await mkdir(clonedReposDir);
      targetDir = path.join(clonedReposDir, owner, repo);
      
      // Ensure owner directory exists
      const ownerDir = path.join(clonedReposDir, owner);
      await mkdir(ownerDir);
    }
    
    // Check if repository already exists
    if (await fileExists(targetDir)) {
      info(`Repository already exists at ${targetDir}`);
      return {
        success: true,
        localPath: targetDir,
      };
    }
    
    // Ensure parent directory exists
    await mkdir(path.dirname(targetDir));
    
    // Clone using gh CLI
    // Using gh repo clone ensures authentication is handled properly
    const cloneCommand = `gh repo clone ${owner}/${repo} "${targetDir}"`;
    debug(`Executing: ${cloneCommand}`);
    
    const { stdout, stderr } = await execAsync(cloneCommand, {
      env: { ...process.env, GH_PAGER: "" },
      timeout: 300000, // 5 minute timeout for large repos
    });
    
    debug(`Clone output: ${stdout} ${stderr}`);
    
    // Verify the clone succeeded
    if (!(await fileExists(targetDir))) {
      throw new Error("Clone completed but directory not found");
    }
    
    info(`Successfully cloned to ${targetDir}`);
    return {
      success: true,
      localPath: targetDir,
    };
  } catch (error: any) {
    logError("Repository clone failed:", error);
    
    const errorMsg = error.message || String(error);
    
    // Parse error for user-friendly messages
    if (errorMsg.includes("not found") || errorMsg.includes("404")) {
      return {
        success: false,
        error: "Repository not found. Check the URL and ensure you have access to this repository.",
      };
    }
    
    if (errorMsg.includes("authentication") || errorMsg.includes("401") || errorMsg.includes("403")) {
      return {
        success: false,
        error: "Authentication failed. Please log in to GitHub and ensure you have access to this repository.",
      };
    }
    
    if (errorMsg.includes("timeout") || errorMsg.includes("timed out")) {
      return {
        success: false,
        error: "Clone operation timed out. The repository may be too large or your connection may be slow.",
      };
    }
    
    return {
      success: false,
      error: `Failed to clone repository: ${errorMsg}`,
    };
  }
}

/**
 * Get information about the currently authenticated GitHub user
 * @returns User info or null if not authenticated
 */
export async function getCurrentUser(): Promise<{
  username: string;
  name?: string;
} | null> {
  try {
    const { stdout } = await execAsync("gh api user", {
      env: { ...process.env, GH_PAGER: "" },
    });
    
    const user = JSON.parse(stdout);
    
    return {
      username: user.login,
      name: user.name,
    };
  } catch (error) {
    debug("Failed to get current user:", error);
    return null;
  }
}
