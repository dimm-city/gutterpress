import { readFile, writeFile } from "node:fs/promises";

/**
 * Inject the Paged.js polyfill + render-complete marker into an HTML file.
 * Modifies the file in-place.
 */
export async function patchHtmlForPagedjs(
  htmlPath: string,
  vendorPath: string
): Promise<void> {
  const html = await readFile(htmlPath, "utf8");
  const hasPaged =
    /paged\.(polyfill|js)/i.test(html) || /pagedjs/i.test(html);

  const markerScript = `
<script>
  // lets the build pipeline know pagination finished
  document.addEventListener("pagedjs:rendered", () => { window.__PAGED_RENDERED__ = true; });
</script>`.trim();

  let patched = html;

  if (!hasPaged) {
    const inject = `
<script src="${vendorPath.replace(/\\/g, "/")}"></script>
${markerScript}`.trim();

    if (patched.includes("</head>")) {
      patched = patched.replace("</head>", `${inject}\n</head>`);
    } else {
      patched = inject + "\n" + patched;
    }
  } else if (!patched.includes("__PAGED_RENDERED__")) {
    if (patched.includes("</head>")) {
      patched = patched.replace("</head>", `${markerScript}\n</head>`);
    } else {
      patched = markerScript + "\n" + patched;
    }
  }

  await writeFile(htmlPath, patched, "utf8");
}
