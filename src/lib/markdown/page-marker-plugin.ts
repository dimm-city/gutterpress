import type MarkdownIt from "markdown-it";

type PageMarkerOptions = {
  markerClass?: string;
  markerAttr?: string;
  sectionTag?: string;
};

type MarkerMatch = {
  modifiers: string[];
};

const DEFAULTS: Required<PageMarkerOptions> = {
  markerClass: "page",
  markerAttr: "page",
  sectionTag: "section",
};

const splitClasses = (value: string | null) =>
  (value || "")
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const uniq = (entries: string[]) => Array.from(new Set(entries));

const getMarkerMatch = (
  token: { attrGet: (name: string) => string | null },
  opts: Required<PageMarkerOptions>,
): MarkerMatch | null => {
  const classAttr = token.attrGet("class");
  const classes = splitClasses(classAttr);
  const markerAttrValue = token.attrGet(opts.markerAttr);
  const hasMarkerClass = classes.includes(opts.markerClass);
  const hasMarkerAttr = markerAttrValue !== null;

  if (!hasMarkerClass && !hasMarkerAttr) {
    return null;
  }

  const modifiers = classes.filter((entry) => entry !== opts.markerClass);
  if (
    markerAttrValue &&
    markerAttrValue !== opts.markerAttr &&
    markerAttrValue !== "true"
  ) {
    modifiers.push(...splitClasses(markerAttrValue));
  }

  return {
    modifiers: uniq(modifiers),
  };
};

const registerRenderers = (md: MarkdownIt) => {
  if (!md.renderer.rules.page_section_open) {
    md.renderer.rules.page_section_open = (tokens, idx) => {
      const token = tokens[idx];
      const classAttr = token.attrGet("class");
      const tag = token.tag || "section";
      if (!classAttr) {
        return `<${tag}>`;
      }
      return `<${tag} class="${md.utils.escapeHtml(classAttr)}">`;
    };
  }

  if (!md.renderer.rules.page_section_close) {
    md.renderer.rules.page_section_close = (tokens, idx) => {
      const tag = tokens[idx].tag || "section";
      return `</${tag}>`;
    };
  }
};

const pageMarkerPlugin = (md: MarkdownIt, options: PageMarkerOptions = {}) => {
  const opts = { ...DEFAULTS, ...options };

  registerRenderers(md);

  md.core.ruler.after("block", "page_marker", (state) => {
    const tokens = state.tokens;
    const output = [];
    let pageOpen = false;

    for (const token of tokens) {
      if (token.type !== "hr") {
        output.push(token);
        continue;
      }

      const match = getMarkerMatch(token, opts);
      if (!match) {
        output.push(token);
        continue;
      }

      if (pageOpen) {
        const closeToken = new state.Token(
          "page_section_close",
          opts.sectionTag,
          -1,
        );
        output.push(closeToken);
        pageOpen = false;
      }

      const openToken = new state.Token(
        "page_section_open",
        opts.sectionTag,
        1,
      );
      const classList = uniq([opts.markerClass, ...match.modifiers]);
      openToken.attrSet("class", classList.join(" "));
      output.push(openToken);
      pageOpen = true;
    }

    if (pageOpen) {
      const closeToken = new state.Token(
        "page_section_close",
        opts.sectionTag,
        -1,
      );
      output.push(closeToken);
    }

    state.tokens = output;
  });
};

export { pageMarkerPlugin };
export type { PageMarkerOptions };
