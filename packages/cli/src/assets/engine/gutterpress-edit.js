(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  function __accessProp(key) {
    return this[key];
  }
  var __toCommonJS = (from) => {
    var entry = (__moduleCache ??= new WeakMap).get(from), desc;
    if (entry)
      return entry;
    entry = __defProp({}, "__esModule", { value: true });
    if (from && typeof from === "object" || typeof from === "function") {
      for (var key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(entry, key))
          __defProp(entry, key, {
            get: __accessProp.bind(from, key),
            enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
          });
    }
    __moduleCache.set(from, entry);
    return entry;
  };
  var __moduleCache;
  var __returnValue = (v) => v;
  function __exportSetter(name, newValue) {
    this[name] = __returnValue.bind(null, newValue);
  }
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, {
        get: all[name],
        enumerable: true,
        configurable: true,
        set: __exportSetter.bind(all, name)
      });
  };

  // src/engine/edit/index.ts
  var exports_edit = {};
  __export(exports_edit, {
    verifyChapter: () => verifyChapter,
    isEnabled: () => isEnabled,
    getSelectionState: () => getSelectionState,
    flushPatches: () => flushPatches,
    enable: () => enable,
    disable: () => disable,
    applyInlineFormat: () => applyInlineFormat,
    ackPatches: () => ackPatches
  });

  // src/lib/markdown/serialize.ts
  var ELEMENT_NODE = 1;
  var TEXT_NODE = 3;
  var COMMENT_NODE = 8;
  function isElement(n) {
    return n.nodeType === ELEMENT_NODE;
  }

  class UnextractableBlock extends Error {
    constructor(reason) {
      super(reason);
      this.name = "UnextractableBlock";
    }
  }
  var ARTIFACT_ATTRS = new Set([
    "data-source-range",
    "data-source-line",
    "data-chapter-src",
    "data-chapter-label",
    "data-gp-source-token",
    "data-gp-source-occurrence",
    "data-gp-edit-degraded",
    "data-gutterpress-hl-group",
    "contenteditable",
    "spellcheck"
  ]);
  var ARTIFACT_CLASS_RE = /^(?:gutterpress-(?:hl|edit-mask)|gp-(?:overflowing|editing))$/;
  function authorAttrs(el, opts) {
    const out = [];
    for (const name of el.getAttributeNames()) {
      const lower = name.toLowerCase();
      if (ARTIFACT_ATTRS.has(lower))
        continue;
      let value = el.getAttribute(name);
      if (value == null)
        continue;
      if (lower === "class") {
        const classes = value.split(/\s+/).filter((c) => c && !ARTIFACT_CLASS_RE.test(c));
        if (!classes.length)
          continue;
        value = classes.join(" ");
      }
      if (lower === "style" && opts?.dropStyleDecl) {
        const decls = value.split(";").map((d) => d.trim()).filter((d) => d && !opts.dropStyleDecl.test(d));
        if (!decls.length)
          continue;
        value = decls.join("; ");
      }
      out.push([name, value]);
    }
    return out;
  }
  function takeAttr(attrs, name) {
    const idx = attrs.findIndex(([n]) => n.toLowerCase() === name);
    if (idx === -1)
      return null;
    const [, value] = attrs[idx];
    attrs.splice(idx, 1);
    return value;
  }
  var INLINE_WRAP_TAGS = {
    em: "em",
    i: "em",
    strong: "strong",
    b: "strong",
    s: "s",
    del: "s",
    strike: "s",
    sup: "sup",
    sub: "sub",
    mark: "mark"
  };
  function normalizeProseText(raw) {
    return raw.replace(/[\u00a0\s]+/g, " ");
  }
  function tagOf(el) {
    return el.tagName.toLowerCase();
  }
  function classListOf(el) {
    return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
  }
  function textContentOf(el) {
    let out = "";
    const children = el.childNodes;
    for (let i = 0;i < children.length; i++) {
      const child = children[i];
      if (isElement(child))
        out += textContentOf(child);
      else if (child.nodeType === TEXT_NODE)
        out += child.data;
    }
    return out;
  }
  function inlineText(nodes) {
    let out = "";
    for (const n of nodes) {
      switch (n.t) {
        case "text":
        case "code":
        case "abbr":
          out += n.text;
          break;
        case "em":
        case "strong":
        case "s":
        case "sup":
        case "sub":
        case "mark":
        case "link":
          out += inlineText(n.children);
          break;
        case "image":
          out += n.alt;
          break;
        default:
          break;
      }
    }
    return out;
  }
  function extractInlineChildren(children, features) {
    const out = [];
    const push = (node) => {
      const prev = out[out.length - 1];
      if (node.t === "text" && prev?.t === "text") {
        prev.text += node.text;
        return;
      }
      out.push(node);
    };
    for (let i = 0;i < children.length; i++) {
      const child = children[i];
      if (!isElement(child)) {
        if (child.nodeType === COMMENT_NODE)
          continue;
        if (child.nodeType !== TEXT_NODE) {
          throw new UnextractableBlock(`unsupported node type ${child.nodeType}`);
        }
        const text = normalizeProseText(child.data);
        if (text)
          push({ t: "text", text });
        continue;
      }
      const tag = tagOf(child);
      if (tag === "br") {
        push({ t: "hardbreak" });
        continue;
      }
      if (tag === "code") {
        push({ t: "code", text: textContentOf(child), attrs: authorAttrs(child) });
        continue;
      }
      if (tag === "sup" && classListOf(child).includes("footnote-ref")) {
        push({ t: "footnoteRef" });
        continue;
      }
      const wrap = INLINE_WRAP_TAGS[tag];
      if (wrap) {
        if (wrap === "sup" && !features.sup || wrap === "sub" && !features.sub || wrap === "mark" && !features.mark) {
          throw new UnextractableBlock(`<${tag}> without the matching plugin enabled`);
        }
        push({
          t: wrap,
          children: extractInlineChildren(child.childNodes, features),
          attrs: authorAttrs(child)
        });
        continue;
      }
      if (tag === "abbr") {
        if (!features.abbr) {
          throw new UnextractableBlock("<abbr> without the abbr plugin enabled");
        }
        push({
          t: "abbr",
          title: child.getAttribute("title") ?? "",
          text: textContentOf(child)
        });
        continue;
      }
      if (tag === "a") {
        const cls = classListOf(child);
        if (cls.includes("footnote-backref"))
          continue;
        const attrs = authorAttrs(child);
        const href = takeAttr(attrs, "href");
        const title = takeAttr(attrs, "title");
        if (href == null)
          throw new UnextractableBlock("<a> without href");
        const hadSourceToken = child.getAttribute("data-gp-source-token") != null;
        const linkChildren = extractInlineChildren(child.childNodes, features);
        const text = inlineText(linkChildren);
        const bare = !hadSourceToken && title == null && attrs.length === 0 && (href === text || href === `mailto:${text}` || href === `http://${text}`);
        push({ t: "link", href, title, children: linkChildren, attrs, bare });
        continue;
      }
      if (tag === "img") {
        const attrs = authorAttrs(child, {
          dropStyleDecl: /^--gp-shape\s*:/
        });
        const src = takeAttr(attrs, "src");
        const alt = takeAttr(attrs, "alt") ?? "";
        const title = takeAttr(attrs, "title");
        if (src == null)
          throw new UnextractableBlock("<img> without src");
        push({ t: "image", src, alt, title, attrs });
        continue;
      }
      if (tag === "span") {
        if (child.getAttributeNames().length === 0) {
          for (const inner of extractInlineChildren(child.childNodes, features))
            push(inner);
          continue;
        }
        throw new UnextractableBlock("<span> with attributes");
      }
      throw new UnextractableBlock(`unsupported inline element <${tag}>`);
    }
    return out;
  }
  function trimInline(nodes) {
    const first = nodes[0];
    if (first?.t === "text") {
      first.text = first.text.replace(/^ +/, "");
      if (!first.text)
        nodes.shift();
    }
    const last = nodes[nodes.length - 1];
    if (last?.t === "text") {
      last.text = last.text.replace(/ +$/, "");
      if (!last.text)
        nodes.pop();
    }
    return nodes;
  }
  function blockChildren(el) {
    const out = [];
    const children = el.childNodes;
    for (let i = 0;i < children.length; i++) {
      const child = children[i];
      if (isElement(child)) {
        out.push(child);
        continue;
      }
      if (child.nodeType === COMMENT_NODE)
        continue;
      if (child.nodeType === TEXT_NODE && child.data.trim() === "")
        continue;
      throw new UnextractableBlock("unexpected text between block elements");
    }
    return out;
  }
  var HEADING_RE = /^h([1-6])$/;
  var CONTENT_BLOCK_TAGS = new Set([
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "ul",
    "ol",
    "table",
    "pre",
    "hr",
    "dl"
  ]);
  var BLOCK_TAGS = CONTENT_BLOCK_TAGS;
  function extractBlockModel(el, options = {}) {
    const features = options.features ?? {};
    const tag = tagOf(el);
    if (tag === "p") {
      return {
        t: "p",
        inline: trimInline(extractInlineChildren(el.childNodes, features)),
        attrs: authorAttrs(el)
      };
    }
    const h = HEADING_RE.exec(tag);
    if (h) {
      return {
        t: "h",
        level: Number(h[1]),
        inline: trimInline(extractInlineChildren(el.childNodes, features)),
        attrs: authorAttrs(el)
      };
    }
    if (tag === "blockquote") {
      if (authorAttrs(el).length)
        throw new UnextractableBlock("author attrs on <blockquote>");
      return {
        t: "blockquote",
        blocks: blockChildren(el).map((c) => extractBlockModel(c, options))
      };
    }
    if (tag === "ul" || tag === "ol") {
      const attrs = authorAttrs(el);
      const startRaw = tag === "ol" ? takeAttr(attrs, "start") : null;
      if (attrs.length)
        throw new UnextractableBlock("author attrs on list");
      const items = [];
      let loose = false;
      for (const li of blockChildren(el)) {
        if (tagOf(li) !== "li")
          throw new UnextractableBlock(`<${tagOf(li)}> inside <${tag}>`);
        if (authorAttrs(li).length)
          throw new UnextractableBlock("author attrs on <li>");
        const item = extractListItem(li, options);
        if (item.lead === null)
          loose = true;
        items.push(item);
      }
      return {
        t: "list",
        ordered: tag === "ol",
        start: startRaw != null ? Number(startRaw) : null,
        loose,
        items
      };
    }
    if (tag === "table")
      return extractTable(el, options);
    if (tag === "pre") {
      if (authorAttrs(el).length)
        throw new UnextractableBlock("author attrs on <pre>");
      const kids = blockChildren(el);
      if (kids.length !== 1 || tagOf(kids[0]) !== "code") {
        throw new UnextractableBlock("<pre> without a single <code> child");
      }
      const code = kids[0];
      const attrs = authorAttrs(code);
      const cls = takeAttr(attrs, "class");
      let language = "";
      const extraClasses = [];
      for (const c of (cls ?? "").split(/\s+/).filter(Boolean)) {
        if (c.startsWith("language-") && !language)
          language = c.slice("language-".length);
        else
          extraClasses.push(c);
      }
      if (extraClasses.length)
        attrs.unshift(["class", extraClasses.join(" ")]);
      let codeText = textContentOf(code);
      if (codeText.endsWith(`
`))
        codeText = codeText.slice(0, -1);
      return { t: "fence", language, code: codeText, attrs };
    }
    if (tag === "hr") {
      if (authorAttrs(el).length)
        throw new UnextractableBlock("author attrs on <hr>");
      return { t: "hr" };
    }
    if (tag === "dl")
      return extractDeflist(el, options);
    throw new UnextractableBlock(`unsupported block element <${tag}>`);
  }
  function extractListItem(li, options) {
    const features = options.features ?? {};
    const children = li.childNodes;
    let firstBlockIdx = -1;
    for (let i = 0;i < children.length; i++) {
      const child = children[i];
      if (isElement(child) && BLOCK_TAGS.has(tagOf(child))) {
        firstBlockIdx = i;
        break;
      }
    }
    if (firstBlockIdx === -1) {
      return { lead: trimInline(extractInlineChildren(li.childNodes, features)), blocks: null };
    }
    const leadNodes = [];
    const blocks = [];
    let sawBlock = false;
    for (let i = 0;i < children.length; i++) {
      const child = children[i];
      const isBlockEl = isElement(child) && BLOCK_TAGS.has(tagOf(child));
      if (!sawBlock && !isBlockEl) {
        if (!isElement(child)) {
          if (child.nodeType === COMMENT_NODE)
            continue;
          const text = normalizeProseText(child.data);
          if (text.trim())
            leadNodes.push({ t: "text", text });
          continue;
        }
        leadNodes.push(...extractInlineChildren([child], features));
        continue;
      }
      if (!isBlockEl) {
        if (!isElement(child)) {
          if (child.nodeType === COMMENT_NODE)
            continue;
          if (child.nodeType === TEXT_NODE && child.data.trim() === "")
            continue;
        }
        throw new UnextractableBlock("inline content between blocks in list item");
      }
      sawBlock = true;
      blocks.push(extractBlockModel(child, options));
    }
    const lead = trimInline(leadNodes);
    if (lead.length === 0) {
      return { lead: null, blocks };
    }
    if (blocks.some((b) => b.t === "p")) {
      throw new UnextractableBlock("mixed inline lead and <p> in list item");
    }
    return { lead, blocks };
  }
  var ALIGN_RE = /^text-align:\s*(left|center|right)$/;
  function extractTable(el, options) {
    const features = options.features ?? {};
    if (authorAttrs(el).length)
      throw new UnextractableBlock("author attrs on <table>");
    let head = null;
    const body = [];
    const align = [];
    const readRow = (tr, cellTag, firstRow) => {
      if (authorAttrs(tr).length)
        throw new UnextractableBlock("author attrs on <tr>");
      const cells = [];
      let col = 0;
      for (const cell of blockChildren(tr)) {
        if (tagOf(cell) !== cellTag) {
          throw new UnextractableBlock(`<${tagOf(cell)}> where <${cellTag}> expected`);
        }
        const cellAttrs = authorAttrs(cell);
        const style = takeAttr(cellAttrs, "style");
        if (cellAttrs.length)
          throw new UnextractableBlock("author attrs on table cell");
        let cellAlign = null;
        if (style != null) {
          const m = ALIGN_RE.exec(style.trim());
          if (!m)
            throw new UnextractableBlock("unexpected style on table cell");
          cellAlign = m[1];
        }
        if (firstRow)
          align.push(cellAlign);
        else if (align[col] !== cellAlign) {
          throw new UnextractableBlock("inconsistent column alignment");
        }
        cells.push(trimInline(extractInlineChildren(cell.childNodes, features)));
        col++;
      }
      if (!firstRow && cells.length !== align.length) {
        throw new UnextractableBlock("ragged table row");
      }
      return cells;
    };
    for (const part of blockChildren(el)) {
      const partTag = tagOf(part);
      if (partTag === "thead") {
        if (authorAttrs(part).length)
          throw new UnextractableBlock("attrs on <thead>");
        const rows = blockChildren(part);
        if (rows.length !== 1 || tagOf(rows[0]) !== "tr") {
          throw new UnextractableBlock("thead without exactly one <tr>");
        }
        head = readRow(rows[0], "th", true);
      } else if (partTag === "tbody") {
        if (authorAttrs(part).length)
          throw new UnextractableBlock("attrs on <tbody>");
        for (const tr of blockChildren(part)) {
          if (tagOf(tr) !== "tr")
            throw new UnextractableBlock("non-<tr> in tbody");
          body.push(readRow(tr, "td", false));
        }
      } else {
        throw new UnextractableBlock(`unsupported table part <${partTag}>`);
      }
    }
    if (!head)
      throw new UnextractableBlock("table without thead");
    return { t: "table", align, head, body };
  }
  function extractDeflist(el, options) {
    const features = options.features ?? {};
    if (authorAttrs(el).length)
      throw new UnextractableBlock("author attrs on <dl>");
    const groups = [];
    let current = null;
    for (const child of blockChildren(el)) {
      const tag = tagOf(child);
      if (tag === "dt") {
        if (authorAttrs(child).length)
          throw new UnextractableBlock("attrs on <dt>");
        current = { dt: trimInline(extractInlineChildren(child.childNodes, features)), dds: [] };
        groups.push(current);
      } else if (tag === "dd") {
        if (!current)
          throw new UnextractableBlock("<dd> before <dt>");
        if (authorAttrs(child).length)
          throw new UnextractableBlock("attrs on <dd>");
        const kids = child.childNodes;
        for (let i = 0;i < kids.length; i++) {
          const k = kids[i];
          if (isElement(k) && BLOCK_TAGS.has(tagOf(k))) {
            throw new UnextractableBlock("block content in <dd>");
          }
        }
        current.dds.push(trimInline(extractInlineChildren(child.childNodes, features)));
      } else {
        throw new UnextractableBlock(`<${tag}> inside <dl>`);
      }
    }
    return { t: "dl", groups };
  }
  function parseSourceRange(raw) {
    if (!raw)
      return null;
    const [a, b] = raw.split(":").map(Number);
    return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
  }
  function findBlockRangeAttr(el) {
    const own = el.getAttribute("data-source-range");
    if (own != null)
      return own;
    if (tagOf(el) === "pre") {
      const kids = el.childNodes;
      for (let i = 0;i < kids.length; i++) {
        const k = kids[i];
        if (isElement(k) && tagOf(k) === "code") {
          return k.getAttribute("data-source-range");
        }
      }
    }
    return null;
  }
  function discoverContentBlocks(root, opts) {
    const out = [];
    const visit = (el) => {
      const children = el.childNodes;
      for (let i = 0;i < children.length; i++) {
        const child = children[i];
        if (!isElement(child))
          continue;
        if (opts?.skip?.(child))
          continue;
        if (CONTENT_BLOCK_TAGS.has(tagOf(child)) && findBlockRangeAttr(child) != null) {
          out.push(child);
          continue;
        }
        visit(child);
      }
    };
    visit(root);
    return out;
  }
  function modelsEqual(a, b) {
    if (a === b)
      return true;
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
        return false;
      for (let i = 0;i < a.length; i++)
        if (!modelsEqual(a[i], b[i]))
          return false;
      return true;
    }
    if (typeof a === "object" && typeof b === "object" && a && b) {
      const ka = Object.keys(a);
      const kb = Object.keys(b);
      if (ka.length !== kb.length)
        return false;
      for (const k of ka) {
        if (!modelsEqual(a[k], b[k])) {
          return false;
        }
      }
      return true;
    }
    return false;
  }
  function escapeTextRun(text, opts) {
    let out = text.replace(/[\\*_[\]<`{}~^]/g, (m) => `\\${m}`).replace(/&(?=[a-zA-Z][a-zA-Z0-9]*;|#\d|#[xX])/g, "\\&").replace(/==/g, "\\==").replace(/:\/\//g, "\\://").replace(/\bwww\./gi, (m) => `${m.slice(0, 3)}\\.`).replace(/(\S)@(?=\S+\.\S)/g, "$1\\@");
    if (opts.atLineStart) {
      out = out.replace(/^([#>+\-=|]|\d+[.)])/, (lead) => lead.length === 1 ? `\\${lead}` : `${lead.slice(0, -1)}\\${lead.slice(-1)}`);
    }
    return out;
  }
  function emitAttrBraces(attrs) {
    if (!attrs.length)
      return "";
    const parts = [];
    for (const [name, value] of attrs) {
      const lower = name.toLowerCase();
      if (lower === "class") {
        for (const c of value.split(/\s+/).filter(Boolean))
          parts.push(`.${c}`);
      } else if (lower === "id") {
        parts.push(`#${value}`);
      } else if (value === "") {
        parts.push(name);
      } else if (/^[^\s"'=<>`{}]+$/.test(value)) {
        parts.push(`${name}=${value}`);
      } else if (!value.includes('"')) {
        parts.push(`${name}="${value}"`);
      } else {
        throw new UnextractableBlock(`attribute ${name} value contains a double quote`);
      }
    }
    return `{${parts.join(" ")}}`;
  }
  function emitInline(nodes, ctx, atLineStart) {
    let out = "";
    let lineStart = atLineStart;
    for (const n of nodes) {
      switch (n.t) {
        case "text":
          out += escapeTextRun(n.text, { atLineStart: lineStart });
          break;
        case "hardbreak":
          out += "\\\n";
          lineStart = true;
          continue;
        case "code": {
          const runs = n.text.match(/`+/g);
          const maxRun = runs ? Math.max(...runs.map((r) => r.length)) : 0;
          const fence = "`".repeat(maxRun + 1);
          const pad = n.text.startsWith("`") || n.text.endsWith("`") || n.text === "" ? " " : "";
          out += `${fence}${pad}${n.text}${pad}${fence}${emitAttrBraces(n.attrs)}`;
          break;
        }
        case "em":
          out += `*${emitInline(n.children, ctx, false)}*${emitAttrBraces(n.attrs)}`;
          break;
        case "strong":
          out += `**${emitInline(n.children, ctx, false)}**${emitAttrBraces(n.attrs)}`;
          break;
        case "s":
          out += `~~${emitInline(n.children, ctx, false)}~~${emitAttrBraces(n.attrs)}`;
          break;
        case "sup":
          out += `^${emitInline(n.children, ctx, false)}^${emitAttrBraces(n.attrs)}`;
          break;
        case "sub":
          out += `~${emitInline(n.children, ctx, false)}~${emitAttrBraces(n.attrs)}`;
          break;
        case "mark":
          out += `==${emitInline(n.children, ctx, false)}==${emitAttrBraces(n.attrs)}`;
          break;
        case "abbr":
          out += escapeTextRun(n.text, { atLineStart: lineStart });
          break;
        case "link": {
          if (n.bare) {
            out += inlineText(n.children);
            break;
          }
          const label = emitInline(n.children, ctx, false);
          const dest = emitLinkDest(n.href);
          const title = n.title != null ? ` "${n.title.replace(/"/g, "\\\"")}"` : "";
          out += `[${label}](${dest}${title})${emitAttrBraces(n.attrs)}`;
          break;
        }
        case "image": {
          const alt = n.alt.replace(/\\/g, "\\\\").replace(/[[\]]/g, (m) => `\\${m}`);
          const dest = emitLinkDest(n.src);
          const title = n.title != null ? ` "${n.title.replace(/"/g, "\\\"")}"` : "";
          out += `![${alt}](${dest}${title})${emitAttrBraces(n.attrs)}`;
          break;
        }
        case "footnoteRef": {
          const label = ctx.footnoteLabels[ctx.footnoteCursor++];
          if (label == null)
            throw new UnextractableBlock("footnote ref without a source label");
          out += `[^${label}]`;
          break;
        }
      }
      lineStart = false;
    }
    return out;
  }
  function emitLinkDest(url) {
    if (url === "")
      return "<>";
    if (/[\s()<>]/.test(url)) {
      return `<${url.replace(/([<>])/g, "\\$1")}>`;
    }
    return url;
  }
  function prefixLines(text, first, rest) {
    const restTrimmed = rest.replace(/ +$/, "");
    return text.split(`
`).map((line, i) => {
      if (i === 0)
        return `${first}${line}`;
      if (!line)
        return restTrimmed === "" ? "" : restTrimmed;
      return `${rest}${line}`;
    }).join(`
`);
  }
  function emitBlock(node, ctx) {
    switch (node.t) {
      case "p": {
        const braces = emitAttrBraces(node.attrs);
        const prefix = ctx.footnotePrefix;
        ctx.footnotePrefix = "";
        const body = emitInline(node.inline, ctx, prefix === "");
        return `${prefix}${body}${braces ? ` ${braces}` : ""}`;
      }
      case "h": {
        const braces = emitAttrBraces(node.attrs);
        return `${"#".repeat(node.level)} ${emitInline(node.inline, ctx, false)}${braces ? ` ${braces}` : ""}`;
      }
      case "blockquote":
        return prefixLines(emitBlocks(node.blocks, ctx), "> ", "> ");
      case "list":
        return emitList(node, ctx);
      case "table":
        return emitTable(node, ctx);
      case "fence": {
        const braces = emitAttrBraces(node.attrs);
        const runsRe = ctx.fenceChar === "~" ? /~{3,}/g : /`{3,}/g;
        const runs = node.code.match(runsRe);
        const maxRun = runs ? Math.max(...runs.map((r) => r.length)) : 0;
        const fence = ctx.fenceChar.repeat(Math.max(ctx.fenceLen, maxRun + 1, 3));
        const info = [node.language, braces].filter(Boolean).join(" ");
        return `${fence}${info}
${node.code ? `${node.code}
` : ""}${fence}`;
      }
      case "hr":
        return "---";
      case "dl": {
        const parts = [];
        for (const group of node.groups) {
          parts.push(emitInline(group.dt, ctx, true));
          for (const dd of group.dds) {
            parts.push(`: ${emitInline(dd, ctx, false)}`);
          }
        }
        return parts.join(`
`);
      }
    }
  }
  function emitBlocks(blocks, ctx) {
    return blocks.map((b) => emitBlock(b, ctx)).join(`

`);
  }
  function emitList(node, ctx) {
    const parts = [];
    node.items.forEach((item, idx) => {
      const marker = node.ordered ? `${(node.start ?? 1) + idx}.` : "-";
      const markerPad = `${marker} `;
      const cont = " ".repeat(markerPad.length);
      let body;
      if (item.lead != null && item.blocks == null) {
        body = emitInline(item.lead, ctx, true);
      } else if (item.lead != null) {
        body = `${emitInline(item.lead, ctx, true)}
${emitBlocks(item.blocks, ctx)}`;
      } else {
        body = emitBlocks(item.blocks ?? [], ctx);
      }
      parts.push(prefixLines(body, markerPad, cont));
      if (node.loose && idx < node.items.length - 1)
        parts.push("");
    });
    return parts.join(`
`);
  }
  function emitTable(node, ctx) {
    const cell = (inline) => emitInline(inline, ctx, false).replace(/\|/g, "\\|");
    const row = (cells) => `| ${cells.map(cell).join(" | ")} |`;
    const alignCell = (a) => {
      switch (a) {
        case "left":
          return ":--";
        case "center":
          return ":-:";
        case "right":
          return "--:";
        default:
          return "---";
      }
    };
    return [
      row(node.head),
      `| ${node.align.map(alignCell).join(" | ")} |`,
      ...node.body.map(row)
    ].join(`
`);
  }
  var REFERENCE_LINK_RE = /\[[^\]]*\]\s*\[[^\]]*\]/;
  var FOOTNOTE_CONTINUATION_RE = /\n[ \t]*\n?[ \t]{4}/;
  function scanSliceForRefusals(slice) {
    if (REFERENCE_LINK_RE.test(slice))
      return "reference-style link/image in source";
    if (/^[ \t]*\[(?!\^)[^\]]+\]:\s/m.test(slice))
      return "link reference definition in source";
    if (/^[ \t]*\[\^/.test(slice) && FOOTNOTE_CONTINUATION_RE.test(slice)) {
      return "multi-paragraph footnote definition";
    }
    return null;
  }
  var FOOTNOTE_LABEL_RE = /\[\^([^\]\s]+)\](?!:)/g;
  var FOOTNOTE_DEF_RE = /^([ \t]*\[\^[^\]\s]+\]:[ \t]*)/;
  var FENCE_OPEN_RE = /^[ \t]*(`{3,}|~{3,})/m;
  function harvestContext(originalSlice) {
    const footnoteLabels = [];
    const defMatch = FOOTNOTE_DEF_RE.exec(originalSlice);
    const scannable = originalSlice.slice(defMatch ? defMatch[0].length : 0).replace(/(`+)[^`]*\1/g, (m) => " ".repeat(m.length));
    for (const m of scannable.matchAll(FOOTNOTE_LABEL_RE)) {
      footnoteLabels.push(m[1]);
    }
    const fence = FENCE_OPEN_RE.exec(originalSlice);
    return {
      footnoteLabels,
      footnoteCursor: 0,
      footnotePrefix: defMatch ? defMatch[1] : "",
      fenceChar: fence ? fence[1][0] : "`",
      fenceLen: fence ? fence[1].length : 3
    };
  }
  function trailingBlankRun(slice) {
    return /(?:\n[ \t]*)+$/.exec(slice)?.[0] ?? "";
  }
  function preserveTrailingBlanks(originalSlice, text) {
    return text + trailingBlankRun(originalSlice);
  }
  function serializeBlock(input) {
    let model;
    try {
      model = extractBlockModel(input.edited, input.options);
    } catch (err) {
      if (err instanceof UnextractableBlock)
        return { kind: "refused", reason: err.message };
      throw err;
    }
    if (input.pristineModel && modelsEqual(model, input.pristineModel)) {
      return { kind: "unchanged" };
    }
    const refusal = scanSliceForRefusals(input.originalSlice);
    if (refusal)
      return { kind: "refused", reason: refusal };
    try {
      const ctx = harvestContext(input.originalSlice);
      const text = emitBlock(model, ctx);
      if (ctx.footnoteCursor !== ctx.footnoteLabels.length) {
        return { kind: "refused", reason: "footnote reference count changed" };
      }
      if (text.trim() === "")
        return { kind: "refused", reason: "block became empty" };
      return { kind: "replacement", text: preserveTrailingBlanks(input.originalSlice, text) };
    } catch (err) {
      if (err instanceof UnextractableBlock)
        return { kind: "refused", reason: err.message };
      throw err;
    }
  }
  function serializeBlockGroup(extent, pristineModel, originalSlice, options = {}) {
    if (extent.length === 0) {
      const run = trailingBlankRun(originalSlice);
      return { kind: "replacement", text: run.replace(/^\n/, "") };
    }
    if (extent.length === 1) {
      return serializeBlock({ edited: extent[0], pristineModel, originalSlice, options });
    }
    if (/\[\^/.test(originalSlice)) {
      return { kind: "refused", reason: "split a block containing footnote refs" };
    }
    const bare = originalSlice.replace(/(?:\n[ \t]*)+$/, "");
    const parts = [];
    for (let i = 0;i < extent.length; i++) {
      const res = serializeBlock({
        edited: extent[i],
        pristineModel: null,
        originalSlice: i === 0 ? bare : "",
        options
      });
      if (res.kind !== "replacement") {
        return res.kind === "refused" ? res : { kind: "refused", reason: "empty split piece" };
      }
      parts.push(res.text);
    }
    return { kind: "replacement", text: parts.join(`

`) + trailingBlankRun(originalSlice) };
  }

  // src/engine/edit/index.ts
  var keyOf = (chapter, range) => `${chapter}\x00${range[0]}:${range[1]}`;
  var enabled = false;
  var opts = { relayoutDelayMs: 300, autosyncDelayMs: 600 };
  var mirrors = new Map;
  var dirty = new Map;
  var committedModels = new WeakMap;
  var pendingBatches = new Map;
  var batchCounter = 0;
  var composing = false;
  var relayoutTimer;
  var autosyncTimer;
  var verifyTimers = new Map;
  var hadDirty = false;
  var healCounts = new Map;
  var DEGRADE_AFTER_HEALS = 3;
  var DEGRADED_ATTR = "data-gp-edit-degraded";
  var gp = () => window.Gutterpress;
  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
  function newlineSplit(text) {
    return text.split(/\r\n?|\n/);
  }
  var isContentTag = (el) => CONTENT_BLOCK_TAGS.has(el.tagName.toLowerCase());
  var elementOf = (node) => node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement ?? null;
  function parseRangeAttr(el) {
    return parseSourceRange(findBlockRangeAttr(el));
  }
  function commitUnitOf(node) {
    let unit = null;
    for (let el = elementOf(node);el; el = el.parentElement) {
      if (el.classList.contains("gp-strip"))
        break;
      if (isContentTag(el) && parseRangeAttr(el))
        unit = el;
    }
    return unit;
  }
  function chapterOf(el) {
    const holder = el.closest("[data-chapter-src]");
    return holder?.getAttribute("data-chapter-src") ?? null;
  }
  function extentOf(entry) {
    const sel = `[data-source-range="${entry.range[0]}:${entry.range[1]}"]` + `[data-chapter-src="${CSS.escape(entry.chapter)}"]`;
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      const unit = isContentTag(el) ? el : el.tagName === "CODE" && el.parentElement?.tagName === "PRE" ? el.parentElement : null;
      if (unit && !out.includes(unit))
        out.push(unit);
    }
    return out;
  }
  function extentModels(entry) {
    const options = { features: opts.features };
    const models = [];
    for (const el of extentOf(entry)) {
      try {
        models.push(extractBlockModel(el, options));
      } catch {
        return null;
      }
    }
    return models;
  }
  function captureCaret() {
    const sel = getSelection();
    if (!sel || !sel.anchorNode || !sel.focusNode)
      return null;
    return {
      anchorNode: sel.anchorNode,
      anchorOffset: sel.anchorOffset,
      focusNode: sel.focusNode,
      focusOffset: sel.focusOffset
    };
  }
  function restoreCaret(c) {
    if (!c || !c.anchorNode.isConnected || !c.focusNode.isConnected)
      return;
    try {
      getSelection()?.setBaseAndExtent(c.anchorNode, Math.min(c.anchorOffset, lengthOf(c.anchorNode)), c.focusNode, Math.min(c.focusOffset, lengthOf(c.focusNode)));
    } catch {}
  }
  function lengthOf(n) {
    return n.nodeType === Node.TEXT_NODE ? n.length : n.childNodes.length;
  }
  function applyEditability() {
    for (const strip of document.querySelectorAll(".gp-strip")) {
      strip.contentEditable = enabled ? "true" : "inherit";
      if (enabled)
        strip.spellcheck = false;
    }
  }
  function safeRelayout() {
    if (composing) {
      scheduleRelayout();
      return;
    }
    const caret = captureCaret();
    gp()?.refresh();
    restoreCaret(caret);
  }
  function scheduleRelayout() {
    clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(safeRelayout, opts.relayoutDelayMs);
  }
  var mirrorFetches = new Map;
  async function mirrorOf(chapter) {
    const cached = mirrors.get(chapter);
    if (cached)
      return cached;
    const inflight = mirrorFetches.get(chapter);
    if (inflight)
      return inflight;
    const url = opts.sourceUrl?.(chapter) ?? `/${chapter}`;
    const fetching = (async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok)
          return null;
        const lines = newlineSplit(await res.text());
        mirrors.set(chapter, lines);
        return lines;
      } catch {
        return null;
      } finally {
        mirrorFetches.delete(chapter);
      }
    })();
    mirrorFetches.set(chapter, fetching);
    return fetching;
  }
  function sliceOf(lines, range) {
    return lines.slice(range[0], range[1]).join(`
`);
  }
  function ensureTracked(el) {
    const chapter = chapterOf(el);
    const range = parseRangeAttr(el);
    if (!chapter || !range)
      return;
    const key = keyOf(chapter, range);
    if (dirty.has(key))
      return;
    let pristine = committedModels.get(el) ?? null;
    if (!pristine) {
      try {
        pristine = extractBlockModel(el, { features: opts.features });
      } catch {
        pristine = null;
      }
    }
    dirty.set(key, { chapter, range, pristine, proposed: null });
    mirrorOf(chapter);
  }
  function markDirtyFromSelection() {
    const unit = commitUnitOf(getSelection()?.anchorNode ?? null);
    if (unit)
      ensureTracked(unit);
  }
  function unitsOfEvent(ev) {
    const ranges = ev.getTargetRanges();
    const nodes = ranges.length ? ranges.flatMap((r) => [r.startContainer, r.endContainer]) : [getSelection()?.anchorNode ?? null, getSelection()?.focusNode ?? null];
    const units = [];
    for (const node of nodes) {
      const unit = commitUnitOf(node);
      if (!unit)
        return null;
      if (unit.hasAttribute(DEGRADED_ATTR))
        return null;
      if (!units.includes(unit))
        units.push(unit);
    }
    return units;
  }
  function onBeforeInput(ev) {
    if (!enabled)
      return;
    if (ev.inputType === "insertFromDrop") {
      ev.preventDefault();
      return;
    }
    const units = unitsOfEvent(ev);
    if (!units || units.length === 0) {
      ev.preventDefault();
      return;
    }
    const chapters = new Set(units.map((u) => chapterOf(u)));
    if (chapters.size > 1) {
      ev.preventDefault();
      return;
    }
    for (const unit of units)
      ensureTracked(unit);
    if (ev.inputType === "insertFromPaste") {
      ev.preventDefault();
      const text = ev.dataTransfer?.getData("text/plain");
      if (text)
        document.execCommand("insertText", false, text);
    }
  }
  function onInput(ev) {
    if (!enabled)
      return;
    if (ev.inputType === "historyUndo" || ev.inputType === "historyRedo") {
      markDirtyFromSelection();
    }
    if (!hadDirty && dirty.size) {
      hadDirty = true;
      emit("editStateChanged", { dirty: true });
    }
    scheduleRelayout();
    scheduleAutosync();
  }
  function scheduleAutosync() {
    clearTimeout(autosyncTimer);
    autosyncTimer = setTimeout(() => void autosync(), opts.autosyncDelayMs);
  }
  function serializeEntry(entry, slice) {
    return serializeBlockGroup(extentOf(entry), entry.pristine, slice, { features: opts.features });
  }
  async function autosync() {
    if (!enabled || composing) {
      if (composing)
        scheduleAutosync();
      return;
    }
    const patches = [];
    const refusals = [];
    for (const [key, entry] of [...dirty.entries()]) {
      const lines = await mirrorOf(entry.chapter);
      if (!lines) {
        refusals.push({ chapter: entry.chapter, range: entry.range, reason: "source unavailable" });
        dirty.delete(key);
        continue;
      }
      const slice = sliceOf(lines, entry.range);
      const res = serializeEntry(entry, slice);
      if (res.kind === "unchanged") {
        dirty.delete(key);
        continue;
      }
      if (res.kind === "refused") {
        dirty.delete(key);
        refusals.push({ chapter: entry.chapter, range: entry.range, reason: res.reason });
        continue;
      }
      if (res.text === slice) {
        dirty.delete(key);
        continue;
      }
      entry.proposed = extentModels(entry);
      patches.push({
        chapter: entry.chapter,
        range: entry.range,
        expected: slice,
        replacement: res.text
      });
    }
    if (!patches.length && !refusals.length) {
      if (hadDirty && dirty.size === 0) {
        hadDirty = false;
        emit("editStateChanged", { dirty: false });
      }
      return;
    }
    const batchId = ++batchCounter;
    if (patches.length)
      pendingBatches.set(batchId, patches);
    emit("editPatches", { batchId, patches, refusals });
  }
  function shiftRangesBelow(chapter, fromLine, delta) {
    if (!delta)
      return;
    for (const el of document.querySelectorAll(`[data-source-range][data-chapter-src="${CSS.escape(chapter)}"]`)) {
      const range = parseRangeAttr(el);
      if (!range || range[0] < fromLine)
        continue;
      el.setAttribute("data-source-range", `${range[0] + delta}:${range[1] + delta}`);
    }
    for (const [key, entry] of [...dirty.entries()]) {
      if (entry.chapter !== chapter || entry.range[0] < fromLine)
        continue;
      dirty.delete(key);
      entry.range = [entry.range[0] + delta, entry.range[1] + delta];
      dirty.set(keyOf(chapter, entry.range), entry);
    }
  }
  function ackPatches(spec) {
    const batch = pendingBatches.get(spec.batchId) ?? [];
    pendingBatches.delete(spec.batchId);
    const ordered = [...spec.results].sort((a, b) => a.chapter === b.chapter ? b.range[0] - a.range[0] : a.chapter < b.chapter ? -1 : 1);
    for (const result of ordered) {
      const patch = batch.find((p) => p.chapter === result.chapter && p.range[0] === result.range[0] && p.range[1] === result.range[1]);
      if (!patch || result.status !== "applied")
        continue;
      const lines = mirrors.get(patch.chapter);
      if (lines) {
        const replacementLines = patch.replacement === "" ? [] : newlineSplit(patch.replacement);
        lines.splice(patch.range[0], patch.range[1] - patch.range[0], ...replacementLines);
        const delta = replacementLines.length - (patch.range[1] - patch.range[0]);
        const extent = document.querySelectorAll(`[data-source-range="${patch.range[0]}:${patch.range[1]}"]` + `[data-chapter-src="${CSS.escape(patch.chapter)}"]`);
        const key = keyOf(patch.chapter, patch.range);
        const entry = dirty.get(key);
        const advanced = entry ? !modelsEqual(extentModels(entry), entry.proposed) : false;
        shiftRangesBelow(patch.chapter, patch.range[1], delta);
        const newEnd = patch.range[0] + replacementLines.length;
        const newRange = [patch.range[0], newEnd];
        for (const el of extent) {
          el.setAttribute("data-source-range", `${patch.range[0]}:${newEnd}`);
          if (isContentTag(el)) {
            try {
              committedModels.set(el, extractBlockModel(el, { features: opts.features }));
            } catch {
              committedModels.delete(el);
            }
          }
        }
        dirty.delete(key);
        if (entry && advanced) {
          entry.range = newRange;
          entry.pristine = entry.proposed?.[0] ?? null;
          entry.proposed = null;
          dirty.set(keyOf(patch.chapter, newRange), entry);
          scheduleAutosync();
        }
      }
      scheduleVerify(patch.chapter);
    }
    if (hadDirty && dirty.size === 0) {
      hadDirty = false;
      emit("editStateChanged", { dirty: false });
    }
  }
  function scheduleVerify(chapter) {
    clearTimeout(verifyTimers.get(chapter));
    verifyTimers.set(chapter, setTimeout(() => void verifyChapter({ chapter }), 1500));
  }
  async function verifyChapter(spec) {
    const chapter = spec.chapter;
    verifyTimers.delete(chapter);
    if (!enabled)
      return { healed: 0 };
    mirrors.delete(chapter);
    const [lines, res] = await Promise.all([
      mirrorOf(chapter),
      fetch(opts.chapterUrl?.(chapter) ?? `/__chapter?file=${encodeURIComponent(chapter)}`, {
        cache: "no-store"
      }).catch(() => null)
    ]);
    if (!lines || !res?.ok)
      return { healed: 0, mismatch: "fetch failed" };
    const fresh = new DOMParser().parseFromString(await res.text(), "text/html");
    const freshBlocks = discoverContentBlocks(fresh.body);
    const liveBlocks = discoverContentBlocks(document.body, {
      skip: (elLike) => {
        const el = elLike;
        if (el.classList?.contains("gp-layer"))
          return true;
        const src = el.getAttribute("data-chapter-src");
        return src != null && src !== chapter;
      }
    });
    if (freshBlocks.length !== liveBlocks.length) {
      const detail2 = { chapter, healed: 0, mismatch: "block count" };
      emit("editDrift", detail2);
      return detail2;
    }
    let healed = 0;
    const degraded = [];
    const options = { features: opts.features };
    for (let i = 0;i < freshBlocks.length; i++) {
      const live = liveBlocks[i];
      const freshEl = freshBlocks[i];
      const freshRange = findBlockRangeAttr(freshEl);
      if (freshRange)
        live.setAttribute("data-source-range", freshRange);
      const liveRange = parseRangeAttr(live);
      const liveChapter = chapterOf(live);
      if (liveRange && liveChapter && dirty.has(keyOf(liveChapter, liveRange))) {
        continue;
      }
      if (live.contains(getSelection()?.anchorNode ?? null))
        continue;
      let same = false;
      try {
        same = modelsEqual(extractBlockModel(live, options), extractBlockModel(freshEl, options));
      } catch {
        continue;
      }
      if (!same) {
        const imported = document.importNode(freshEl, true);
        const range = parseSourceRange(freshRange);
        const healKey = range ? keyOf(chapter, range) : null;
        const heals = healKey ? (healCounts.get(healKey) ?? 0) + 1 : 1;
        if (healKey)
          healCounts.set(healKey, heals);
        if (heals >= DEGRADE_AFTER_HEALS) {
          imported.setAttribute(DEGRADED_ATTR, "");
          if (range)
            degraded.push({ chapter, range });
        }
        live.replaceWith(imported);
        committedModels.delete(live);
        healed++;
      }
    }
    if (healed)
      safeRelayout();
    const detail = { chapter, healed, degraded };
    emit("editDrift", detail);
    return detail;
  }
  function applyInlineFormat(spec) {
    if (!enabled)
      return { applied: false };
    const sel = getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed)
      return { applied: false };
    const unit = commitUnitOf(sel.anchorNode);
    const focusUnit = commitUnitOf(sel.focusNode);
    if (!unit || unit !== focusUnit || unit.hasAttribute(DEGRADED_ATTR)) {
      return { applied: false };
    }
    if (spec.format !== "code") {
      const command = { bold: "bold", italic: "italic", strike: "strikeThrough" }[spec.format];
      const applied = document.execCommand(command, false);
      return { applied };
    }
    const range = sel.getRangeAt(0);
    const existing = elementOf(sel.anchorNode)?.closest("code");
    ensureTracked(unit);
    if (existing && unit.contains(existing)) {
      const text = document.createTextNode(existing.textContent ?? "");
      existing.replaceWith(text);
      sel.selectAllChildren(text.parentElement ?? unit);
      sel.setBaseAndExtent(text, 0, text, text.length);
    } else {
      const text = range.toString();
      if (!text)
        return { applied: false };
      range.deleteContents();
      const code = document.createElement("code");
      code.textContent = text;
      range.insertNode(code);
      sel.setBaseAndExtent(code, 0, code, code.childNodes.length);
    }
    if (!hadDirty) {
      hadDirty = true;
      emit("editStateChanged", { dirty: true });
    }
    scheduleRelayout();
    scheduleAutosync();
    return { applied: true };
  }
  function getSelectionState() {
    const sel = getSelection();
    const empty = {
      collapsed: true,
      rects: [],
      formats: { strong: false, em: false, s: false, code: false },
      block: null
    };
    if (!sel || sel.rangeCount === 0)
      return empty;
    const range = sel.getRangeAt(0);
    const unit = commitUnitOf(sel.anchorNode);
    const anchorEl = elementOf(sel.anchorNode);
    const has = (selector) => anchorEl?.closest(selector) != null;
    return {
      collapsed: sel.isCollapsed,
      rects: [...range.getClientRects()].map((r) => ({
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height
      })),
      formats: { strong: has("strong,b"), em: has("em,i"), s: has("s,del"), code: has("code") },
      block: unit ? {
        chapter: chapterOf(unit) ?? "",
        range: parseRangeAttr(unit) ?? [0, 0],
        tag: unit.tagName.toLowerCase()
      } : null
    };
  }
  function onKeyDown(ev) {
    if (!enabled || composing)
      return;
    const forward = ev.key === "ArrowRight" || ev.key === "ArrowDown";
    const backward = ev.key === "ArrowLeft" || ev.key === "ArrowUp";
    if (!forward && !backward || ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.altKey)
      return;
    const sel = getSelection();
    if (!sel?.isCollapsed || !sel.anchorNode)
      return;
    const strip = elementOf(sel.anchorNode)?.closest(".gp-strip");
    if (!strip)
      return;
    const before = { node: sel.anchorNode, offset: sel.anchorOffset };
    setTimeout(() => {
      const after = getSelection();
      if (!after?.isCollapsed || after.anchorNode !== before.node || after.anchorOffset !== before.offset) {
        return;
      }
      const strips = [...document.querySelectorAll(".gp-strip")];
      const idx = strips.indexOf(strip);
      const target = strips[idx + (forward ? 1 : -1)];
      if (!target)
        return;
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => n.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      });
      let node = null;
      if (forward) {
        node = walker.nextNode();
      } else {
        for (let t = walker.nextNode();t; t = walker.nextNode())
          node = t;
      }
      if (!node)
        return;
      after.setBaseAndExtent(node, forward ? 0 : node.length, node, forward ? 0 : node.length);
      node.parentElement?.scrollIntoView({ block: "nearest" });
    }, 0);
  }
  var selectionTimer;
  var lastSelectionCollapsed = true;
  function onSelectionChange() {
    if (!enabled)
      return;
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      const collapsed = getSelection()?.isCollapsed ?? true;
      if (collapsed) {
        if (!lastSelectionCollapsed) {
          lastSelectionCollapsed = true;
          emit("editSelection", {
            collapsed: true,
            rects: [],
            formats: { strong: false, em: false, s: false, code: false },
            block: null
          });
        }
        return;
      }
      lastSelectionCollapsed = false;
      emit("editSelection", getSelectionState());
    }, 150);
  }
  function onCompositionStart() {
    composing = true;
  }
  function onCompositionEnd() {
    composing = false;
    markDirtyFromSelection();
    scheduleRelayout();
    scheduleAutosync();
  }
  function onRelayout() {
    if (enabled)
      applyEditability();
  }
  function onDragStart(ev) {
    if (enabled)
      ev.preventDefault();
  }
  function enable(options = {}) {
    const injected = window.__GP_EDIT_FEATURES__;
    opts = {
      relayoutDelayMs: 300,
      autosyncDelayMs: 600,
      ...injected ? { features: injected } : {},
      ...options
    };
    if (!enabled) {
      enabled = true;
      try {
        document.execCommand("defaultParagraphSeparator", false, "p");
      } catch {}
      document.addEventListener("beforeinput", onBeforeInput, true);
      document.addEventListener("input", onInput, true);
      document.addEventListener("compositionstart", onCompositionStart, true);
      document.addEventListener("compositionend", onCompositionEnd, true);
      document.addEventListener("dragstart", onDragStart, true);
      document.addEventListener("keydown", onKeyDown, true);
      document.addEventListener("selectionchange", onSelectionChange);
      window.addEventListener("gp:relayout", onRelayout);
    }
    applyEditability();
    return true;
  }
  function disable() {
    if (!enabled)
      return;
    const flushing = autosync();
    enabled = false;
    document.removeEventListener("beforeinput", onBeforeInput, true);
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("compositionstart", onCompositionStart, true);
    document.removeEventListener("compositionend", onCompositionEnd, true);
    document.removeEventListener("dragstart", onDragStart, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("selectionchange", onSelectionChange);
    clearTimeout(selectionTimer);
    window.removeEventListener("gp:relayout", onRelayout);
    clearTimeout(relayoutTimer);
    clearTimeout(autosyncTimer);
    for (const t of verifyTimers.values())
      clearTimeout(t);
    verifyTimers.clear();
    applyEditability();
    flushing.finally(() => {
      dirty.clear();
      pendingBatches.clear();
    });
  }
  var isEnabled = () => enabled;
  function flushPatches() {
    clearTimeout(autosyncTimer);
    return autosync();
  }
  window.GutterpressEdit = {
    enable,
    disable,
    isEnabled,
    ackPatches,
    verifyChapter,
    getSelectionState,
    applyInlineFormat,
    flushPatches
  };
})();
