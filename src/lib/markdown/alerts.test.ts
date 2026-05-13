import { describe, expect, test } from "bun:test";
import MarkdownIt from "markdown-it";
import { dcAlertsPlugin } from "./alerts";

describe("dcAlertsPlugin", () => {
  test("emits shared base class alongside alert variant classes", () => {
    const md = new MarkdownIt({ html: true });
    md.use(dcAlertsPlugin);

    const html = md.render([
      "> [!NOTE]",
      "> note body",
      "",
      "> [!WARNING]",
      "> warning body",
      "",
      "> [!DM]",
      "> dm body",
      "",
      "> [!VIBE]",
      "> vibe body",
      "",
      "> [!ORIGIN]",
      "> origin body",
      "",
      "> [!VISIT]",
      "> visit body",
      "",
      "> [!GEAR]",
      "> gear body",
    ].join("\n"));

    expect(html).toContain('<div class="dc-alert dc-note"><span class="dc-alert-label">Note</span>');
    expect(html).toContain('<div class="dc-alert dc-note warning"><span class="dc-alert-label">Warning</span>');
    expect(html).toContain('<div class="dc-alert dc-dm-note"><span class="dc-alert-label">Dream Master Note</span>');
    expect(html).toContain('<div class="dc-alert dc-vibe-callout"><span class="dc-alert-label">Vibe</span>');
    expect(html).toContain('<div class="dc-alert dc-origin-callout"><span class="dc-alert-label">Origin</span>');
    expect(html).toContain('<div class="dc-alert dc-visit-callout"><span class="dc-alert-label">Visit</span>');
    expect(html).toContain('<div class="dc-alert dc-gear-callout"><span class="dc-alert-label">Gear</span>');
  });
});
