import type MarkdownIt from "markdown-it";

export type ContainerMeta = {
  classes: string[];
  attrs: Record<string, string>;
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripOuterQuotes = (value: string): string => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
};

export const parseContainerMeta = (
  params: string | undefined
): ContainerMeta => {
  if (!params) return { classes: [], attrs: {} };

  const braceMatch = params.match(/\{([\s\S]*)\}/);
  const raw = (braceMatch ? braceMatch[1]! : params).trim();
  if (!raw) return { classes: [], attrs: {} };

  const classes: string[] = [];
  const attrs: Record<string, string> = {};
  const tokens = raw.split(/\s+/).filter(Boolean);

  for (const token of tokens) {
    const cleaned = stripOuterQuotes(token.trim());
    if (!cleaned) continue;

    if (cleaned.startsWith(".")) {
      classes.push(...cleaned.split(".").filter(Boolean));
      continue;
    }

    const classMatch = cleaned.match(/^class=(['"])(.*?)\1$/);
    if (classMatch) {
      classes.push(
        ...classMatch[2]!
          .split(/\s+/)
          .map((c) => c.trim())
          .filter(Boolean)
      );
      continue;
    }

    const attrMatch = cleaned.match(/^([a-zA-Z_][\w:-]*)=(['"])(.*?)\2$/);
    if (attrMatch) {
      const key = attrMatch[1]!;
      if (key === "style") continue;
      attrs[key] = attrMatch[3]!;
    }
  }

  return { classes, attrs };
};

const mergeClasses = (...values: Array<string | undefined>): string =>
  values
    .flatMap((value) => (value ? value.split(/\s+/) : []))
    .map((v) => v.trim())
    .filter(Boolean)
    .join(" ");

export const renderContainerOpen = (
  baseClass: string,
  token: any,
  paramsRemainder: string | undefined
): string => {
  const meta = parseContainerMeta(paramsRemainder);
  const rawTokenClass: string = token.attrGet ? (token.attrGet("class") ?? "") : "";
  // markdown-it-attrs may deliver dot-chained tokens (e.g. "dc-prose.flavor") as a
  // single class string. Expand every space-separated token by splitting on dots so
  // {.dc-note.warning} becomes ["dc-note", "warning"] rather than ["dc-note.warning"].
  const tokenClass = rawTokenClass
    .split(/\s+/)
    .flatMap((tok) => (tok.includes(".") ? tok.split(".").filter(Boolean) : tok ? [tok] : []))
    .join(" ");
  const classes = mergeClasses(baseClass, meta.classes.join(" "), tokenClass);

  const tokenAttrs: Array<[string, string]> = Array.isArray(token.attrs)
    ? token.attrs
    : [];
  const attrMap: Record<string, string> = {};
  for (const [k, v] of tokenAttrs) {
    if (k === "style") continue;
    attrMap[k] = v;
  }
  for (const [k, v] of Object.entries(meta.attrs)) {
    if (!(k in attrMap)) attrMap[k] = v;
  }
  attrMap.class = classes;

  const extra = Object.entries(attrMap)
    .filter(([k]) => k !== "class")
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`)
    .join(" ");

  return `<div class="${attrMap.class}"${extra ? ` ${extra}` : ""}>\n`;
};

export const createNamedContainer = (name: string) => {
  const safeName = escapeRegExp(name);
  return {
    marker: ":",
    validate: (params: string) =>
      new RegExp(`^${safeName}\\b`).test(params.trim()),
    render: (tokens: any, idx: number) => {
      const token = tokens[idx];
      if (token.nesting === 1) {
        const info = token.info.trim();
        const match = info.match(new RegExp(`^${safeName}\\s*(.*)$`));
        return renderContainerOpen(name, token, match?.[1]);
      }
      return "</div>\n";
    },
  };
};


export const createSidebarContainer = (md: MarkdownIt) => {
  const validate = (params: string) =>
    /^(sidebar|Sidebar|SIDEBAR)\b/.test(params.trim());

  const render = (tokens: any, idx: number) => {
    const token = tokens[idx];
    if (token.nesting === 1) {
      const info = token.info.trim();
      const m = info.match(/^(sidebar|Sidebar|SIDEBAR)\s*:?\s*(.*)$/);
      const title = (m?.[2] || "").trim();
      const metaRemainder = info.replace(
        /^(sidebar|Sidebar|SIDEBAR)\b\s*:?\s*[^\{]*/,
        ""
      );
      const open = renderContainerOpen("sidebar", token, metaRemainder);
      if (!title) return open;
      return `${open}<p class="sidebar-title">${md.utils.escapeHtml(title)}</p>\n`;
    }
    return "</div>\n";
  };

  return { marker: ":", validate, render };
};
