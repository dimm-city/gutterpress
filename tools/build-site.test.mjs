// Guards the Pages build: the landing page ships as-is, the root PRIVACY.md
// is rendered (not copied) into /privacy/, and nothing is left half-filled.
// Run with `node tools/build-site.test.mjs`; the Pages workflow runs it before
// building, so a broken build fails there instead of publishing a broken site.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, "build-site.mjs");
const PRIVACY_MD = readFileSync(join(here, "..", "PRIVACY.md"), "utf8");
let failures = 0;

function check(name, condition, detail = "") {
  if (condition) console.log(`ok - ${name}`);
  else {
    failures++;
    console.error(`NOT OK - ${name}${detail ? `: ${detail}` : ""}`);
  }
}

const out = mkdtempSync(join(tmpdir(), "gutterpress-site-"));
try {
  const run = spawnSync(process.execPath, [SCRIPT, "--out", out], { encoding: "utf8" });
  check("build exits 0", run.status === 0, run.stderr);

  check("landing page copied", existsSync(join(out, "index.html")));
  check("stylesheet copied", existsSync(join(out, "site.css")));
  check(".nojekyll written", existsSync(join(out, ".nojekyll")));
  check("template is not published", !existsSync(join(out, "_template.html")));

  const landing = existsSync(join(out, "index.html")) ? readFileSync(join(out, "index.html"), "utf8") : "";
  check("landing links to the privacy page relatively", landing.includes('href="./privacy/"'));
  check("landing links to the stylesheet relatively", landing.includes('href="./site.css"'));

  // The brand mark: the desktop app's two-ink SVG monogram, copied into the
  // site and used both in the masthead and as the theme-aware favicon.
  check("light brand mark copied", existsSync(join(out, "icons", "gutterpress-icon-light.svg")));
  check("dark brand mark copied", existsSync(join(out, "icons", "gutterpress-icon-dark.svg")));
  check(
    "landing masthead shows the brand mark with a dark-theme source",
    landing.includes('src="./icons/gutterpress-icon-light.svg"') &&
      landing.includes('srcset="./icons/gutterpress-icon-dark.svg"'),
  );
  check("landing declares theme-aware favicons", landing.includes('rel="icon"') && landing.includes("prefers-color-scheme: dark"));

  const privacyPath = join(out, "privacy", "index.html");
  check("privacy page rendered at /privacy/", existsSync(privacyPath));
  const privacy = existsSync(privacyPath) ? readFileSync(privacyPath, "utf8") : "";
  check("privacy title comes from PRIVACY.md's H1", privacy.includes("<title>Privacy Policy — Gutterpress</title>"));
  check("privacy body is rendered HTML, not markdown", privacy.includes("<h2>") && !/^## /m.test(privacy));
  check("privacy page names the one scope", privacy.includes("drive.file"));
  const effective = PRIVACY_MD.match(/\*\*Effective date:\*\*\s*(\S+)/)?.[1] ?? "";
  check("privacy page carries the effective date", effective !== "" && privacy.includes(effective));
  check("privacy page has no unfilled placeholders", !privacy.includes("{{"));
  check("privacy page reaches the stylesheet one level up", privacy.includes('href="../site.css"'));
  check("privacy page reaches the brand mark one level up", privacy.includes('src="../icons/gutterpress-icon-light.svg"'));
  check("privacy nav marks itself current", privacy.includes('aria-current="page"'));
  check(
    "markdown links became anchors",
    privacy.includes('href="https://myaccount.google.com/permissions"') &&
      privacy.includes('href="https://github.com/dimm-city/gutterpress/issues"'),
  );
  check("the example address stays plain text, not a mailto link", !privacy.includes("mailto:"));
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall site build checks passed");
