/**
 * Shared staging for "guided" providers (#35) — platforms with no publisher
 * upload API (DriveThruRPG, Amazon KDP). We copy the built artifact plus a
 * human-readable listing sheet into `<outputDir>/publish/<provider>/`, then
 * hand the author the platform's upload URL and a checklist.
 */
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PublishRequest } from "../types.ts";

/** Copy the artifact + a LISTING.md metadata sheet into the staging dir. */
export async function stageGuidedPackage(
  req: PublishRequest,
  providerId: string,
  listingLines: string[],
): Promise<string> {
  const packageDir = path.join(
    path.dirname(req.artifact.path),
    "publish",
    providerId,
  );
  await mkdir(packageDir, { recursive: true });
  await copyFile(
    req.artifact.path,
    path.join(packageDir, path.basename(req.artifact.path)),
  );

  const { title, authors } = req.project;
  const sheet = [
    `# ${title || "Untitled"}`,
    "",
    `- **Authors:** ${authors.length ? authors.join(", ") : "(not set)"}`,
    `- **File:** ${path.basename(req.artifact.path)}`,
    ...listingLines,
    "",
    "Copy these details into the platform's listing form when uploading.",
    "",
  ].join("\n");
  await writeFile(path.join(packageDir, "LISTING.md"), sheet, "utf8");
  return packageDir;
}
