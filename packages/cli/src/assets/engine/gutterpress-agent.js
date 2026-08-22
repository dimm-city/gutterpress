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

  // src/engine/compiler/agent.ts
  var exports_agent = {};
  __export(exports_agent, {
    xrefSites: () => xrefSites,
    targetTexts: () => targetTexts,
    stringSources: () => stringSources,
    setGenerated: () => setGenerated,
    setFlushFurniture: () => setFlushFurniture,
    instrument: () => instrument,
    forcedBreakSites: () => forcedBreakSites,
    flushRoots: () => flushRoots,
    fillLeaders: () => fillLeaders,
    counterResetSites: () => counterResetSites,
    collectCss: () => collectCss,
    auditContent: () => auditContent,
    applyRectoSpacers: () => applyRectoSpacers,
    addCss: () => addCss
  });

  // src/engine/shared/synthesis.ts
  var WHICH_VALUES = new Set(["first", "start", "last", "first-except"]);
  var LEADER_RE = /\uE000([^\uE001]*)\uE001/;
  function leaderFillCount(gapPx, gluePx) {
    if (!(gluePx > 0) || !(gapPx > 0))
      return 0;
    return Math.max(0, Math.floor(gapPx / gluePx) - 1);
  }

  // src/engine/shared/gcpm-extract.ts
  function skipString(css, i) {
    const quote = css[i];
    i++;
    while (i < css.length) {
      if (css[i] === "\\")
        i += 2;
      else if (css[i] === quote)
        return i + 1;
      else
        i++;
    }
    return i;
  }
  function splitTopLevel(s, sep) {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0;i < s.length; i++) {
      const c = s[i];
      if (c === '"' || c === "'") {
        i = skipString(s, i) - 1;
        continue;
      }
      if (c === "(")
        depth++;
      else if (c === ")")
        depth--;
      else if (c === sep && depth === 0) {
        out.push(s.slice(start, i));
        start = i + 1;
      }
    }
    out.push(s.slice(start));
    return out.map((x) => x.trim()).filter(Boolean);
  }
  var UNITS_PER_PT = {
    pt: 1,
    px: 0.75,
    in: 72,
    pc: 12,
    cm: 72 / 2.54,
    mm: 72 / 25.4,
    q: 72 / 101.6
  };

  // src/engine/shared/content-value.ts
  var FUNC = /^([a-z-]+)\(/i;
  function parseContent(value) {
    const parts = [];
    let i = 0;
    const s = value.trim();
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (c === '"' || c === "'") {
        const end = closeString(s, i);
        parts.push({ type: "literal", value: unquote(s.slice(i, end)) });
        i = end;
        continue;
      }
      const rest = s.slice(i);
      const fn = FUNC.exec(rest);
      if (fn && fn[1] !== undefined) {
        const open = i + fn[0].length - 1;
        const close = matchParen(s, open);
        const args = splitTopLevel(s.slice(open + 1, close), ",");
        parts.push(toPart(fn[1].toLowerCase(), args));
        i = close + 1;
        continue;
      }
      const word = /^[^\s"']+/.exec(rest)[0];
      parts.push({ type: "keyword", value: word });
      i += word.length;
    }
    return parts;
  }
  function toPart(name, args) {
    switch (name) {
      case "counter":
        return { type: "counter", name: args[0] ?? "page", style: args[1] ?? "decimal" };
      case "string":
        return { type: "string", name: args[0] ?? "", which: args[1] ?? "first" };
      case "target-counter":
        return {
          type: "target-counter",
          url: args[0] ?? "",
          counter: args[1] ?? "page",
          style: args[2] ?? "decimal"
        };
      case "target-text":
        return { type: "target-text", url: args[0] ?? "", which: args[1] ?? "content" };
      case "leader":
        return { type: "leader", glue: unquote(args[0] ?? '"."') };
      case "attr": {
        const [a, as] = (args[0] ?? "").split(/\s+/);
        return { type: "attr", name: a ?? "", as };
      }
      case "content":
        return { type: "content", which: args[0] ?? "text" };
      default:
        return { type: "keyword", value: `${name}(${args.join(",")})` };
    }
  }
  function closeString(s, i) {
    const q = s[i++];
    while (i < s.length) {
      if (s[i] === "\\")
        i += 2;
      else if (s[i] === q)
        return i + 1;
      else
        i++;
    }
    return i;
  }
  function matchParen(s, open) {
    let depth = 0;
    for (let i = open;i < s.length; i++) {
      const c = s[i];
      if (c === '"' || c === "'") {
        i = closeString(s, i) - 1;
        continue;
      }
      if (c === "(")
        depth++;
      else if (c === ")" && --depth === 0)
        return i;
    }
    return s.length - 1;
  }
  function unquote(s) {
    const t = s.trim();
    if (t.startsWith('"') && t.endsWith('"') || t.startsWith("'") && t.endsWith("'"))
      return t.slice(1, -1).replace(/\\(.)/g, "$1");
    return t;
  }
  function resolveUrlArg(arg, ctx) {
    const m = /^attr\(\s*([\w-]+)(?:\s+url)?\s*\)$/i.exec(arg.trim());
    if (m && m[1] !== undefined)
      return ctx.attr?.(m[1]) ?? "";
    return unquote(arg);
  }
  var ROMAN = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"]
  ];
  function formatCounter(n, style = "decimal") {
    switch (style.trim()) {
      case "decimal-leading-zero":
        return n < 10 ? `0${n}` : String(n);
      case "lower-roman":
      case "upper-roman": {
        let v = n;
        let out = "";
        for (const [num, sym] of ROMAN)
          while (v >= num)
            out += sym, v -= num;
        return style === "upper-roman" ? out.toUpperCase() : out;
      }
      case "lower-alpha":
      case "upper-alpha": {
        let v = n;
        let out = "";
        while (v > 0) {
          const r = (v - 1) % 26;
          out = String.fromCharCode(97 + r) + out;
          v = Math.floor((v - 1) / 26);
        }
        return style === "upper-alpha" ? out.toUpperCase() : out;
      }
      case "none":
        return "";
      default:
        return String(n);
    }
  }
  function evaluateContent(parts, ctx) {
    let out = "";
    for (const p of parts) {
      switch (p.type) {
        case "literal":
          out += p.value;
          break;
        case "counter":
          out += formatCounter(p.name === "pages" ? ctx.pages ?? 0 : ctx.page ?? 0, p.style);
          break;
        case "string":
          out += ctx.strings?.(p.name, p.which) ?? "";
          break;
        case "target-counter": {
          const url = resolveUrlArg(p.url, ctx);
          const page = ctx.targetPage?.(url);
          out += page === undefined ? "?" : formatCounter(page, p.style);
          break;
        }
        case "target-text": {
          const url = resolveUrlArg(p.url, ctx);
          out += ctx.targetText?.(url, p.which) ?? "";
          break;
        }
        case "attr":
          out += ctx.attr?.(p.name) ?? "";
          break;
        case "content":
          out += ctx.text ?? "";
          break;
        case "leader":
          out += ctx.leader?.(p.glue) ?? "";
          break;
        case "keyword":
          if (p.value === "normal" || p.value === "none")
            break;
          out += p.value;
          break;
      }
    }
    return out;
  }
  function evaluate(value, ctx) {
    return evaluateContent(parseContent(value), ctx);
  }

  // src/engine/compiler/agent.ts
  var uid = 0;
  function ensureAnchor(el) {
    if (el.id)
      return el.id;
    const existing = el.firstElementChild;
    if (existing?.tagName === "GP-ANCHOR" && existing.id)
      return existing.id;
    const anchor = document.createElement("gp-anchor");
    anchor.id = `gp-m-${++uid}`;
    anchor.setAttribute("style", "display:inline");
    el.insertBefore(anchor, el.firstChild);
    return anchor.id;
  }
  function anchorHost(id) {
    const el = document.getElementById(id);
    if (!el)
      return null;
    return el.tagName === "GP-ANCHOR" ? el.parentElement : el;
  }
  async function collectCss() {
    let out = "";
    for (const sheet of Array.from(document.styleSheets)) {
      const owner = sheet.ownerNode;
      if (owner?.tagName === "STYLE") {
        out += owner.textContent + `
`;
      } else if (owner?.tagName === "LINK") {
        try {
          out += await (await fetch(owner.href)).text() + `
`;
        } catch {}
      }
    }
    return out;
  }
  function stringSources(stringSets) {
    const out = [];
    let order = 0;
    for (const decl of stringSets) {
      let els = [];
      try {
        els = Array.from(document.querySelectorAll(decl.selector));
      } catch {
        continue;
      }
      for (const el of els) {
        const attrs = {};
        for (const a of Array.from(el.attributes))
          attrs[a.name] = a.value;
        const text = decl.value ? evaluate(decl.value, {
          text: (el.textContent ?? "").trim().replace(/\s+/g, " "),
          attr: (n) => el.getAttribute(n) ?? undefined
        }) : (el.textContent ?? "").trim().replace(/\s+/g, " ");
        out.push({
          name: decl.name,
          id: ensureAnchor(el),
          text,
          attrs,
          order: order++
        });
      }
    }
    out.sort((a, b) => {
      const ea = document.getElementById(a.id);
      const eb = document.getElementById(b.id);
      const rel = ea.compareDocumentPosition(eb);
      return rel & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    return out;
  }
  function forcedBreakSites(decls) {
    const out = [];
    for (const d of decls) {
      let els = [];
      try {
        els = Array.from(document.querySelectorAll(d.selector));
      } catch {
        continue;
      }
      for (const el of els)
        out.push({ id: ensureAnchor(el), prop: d.prop, value: d.value, selector: d.selector });
    }
    return out;
  }
  function counterResetSites(resets) {
    const out = [];
    for (const r of resets) {
      let els = [];
      try {
        els = Array.from(document.querySelectorAll(r.selector));
      } catch {
        continue;
      }
      for (const el of els)
        out.push({ id: ensureAnchor(el), start: r.start, selector: r.selector });
    }
    return out;
  }
  function applyRectoSpacers(ids, pageName) {
    for (const spacer of Array.from(document.querySelectorAll(".gp-recto-spacer")))
      spacer.remove();
    let inserted = 0;
    for (const id of ids) {
      const el = anchorHost(id);
      if (!el)
        continue;
      const spacer = document.createElement("div");
      spacer.className = "gp-recto-spacer";
      spacer.setAttribute("aria-hidden", "true");
      spacer.style.cssText = `break-before: page; break-after: page; height: 0; margin: 0; padding: 0; border: 0; page: ${pageName};`;
      el.before(spacer);
      inserted++;
    }
    return inserted;
  }
  function auditContent(contentHeights, dpiFloor) {
    const out = [];
    const name = (el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "") + (el.className && typeof el.className === "string" ? `.${el.className.split(/\s+/)[0]}` : "");
    const pageContext = (el) => {
      for (let node = el;node; node = node.parentElement) {
        const pageName = getComputedStyle(node).getPropertyValue("page").trim();
        if (pageName && pageName !== "auto") {
          return {
            name: pageName,
            height: contentHeights.named[pageName] ?? contentHeights.default
          };
        }
      }
      return { name: "default", height: contentHeights.default };
    };
    for (const el of Array.from(document.querySelectorAll("figure,img,table,pre,svg,div"))) {
      const h = el.getBoundingClientRect().height;
      const context = pageContext(el);
      if (h > context.height + 1 && el.children.length === 0) {
        out.push({
          kind: "overheight",
          what: name(el),
          detail: `${Math.round(h)}px tall on a ${Math.round(context.height)}px ` + `${context.name === "default" ? "default-page" : `${context.name} page`} content box`
        });
      }
    }
    for (const img of Array.from(document.querySelectorAll("img"))) {
      const rect = img.getBoundingClientRect();
      if (!rect.width || !img.naturalWidth)
        continue;
      const dpi = img.naturalWidth / (rect.width / 96);
      if (dpi < dpiFloor) {
        out.push({
          kind: "low-dpi",
          what: name(img),
          detail: `${img.naturalWidth}px wide printed at ${(rect.width / 96).toFixed(2)}in = ${Math.round(dpi)} DPI`
        });
      }
    }
    return out;
  }
  function targetTexts(ids) {
    const out = {};
    for (const id of ids) {
      const el = anchorHost(id);
      if (el)
        out[id] = (el.textContent ?? "").trim().replace(/\s+/g, " ");
    }
    return out;
  }
  function xrefSites(selectors) {
    const out = [];
    for (const selector of selectors) {
      const base = selector.replace(/::?(after|before)$/, "");
      let els = [];
      try {
        els = Array.from(document.querySelectorAll(base));
      } catch {
        continue;
      }
      for (const el of els) {
        const href = el.getAttribute("href") ?? "";
        out.push({ id: ensureAnchor(el), href, selector });
      }
    }
    return out;
  }
  function instrument(ids) {
    let host = document.getElementById("gp-instrumentation");
    if (!host) {
      host = document.createElement("div");
      host.id = "gp-instrumentation";
      host.style.display = "none";
      document.body.appendChild(host);
    }
    host.textContent = "";
    for (const id of ids) {
      const a = document.createElement("a");
      a.href = `#${id}`;
      a.textContent = ".";
      host.appendChild(a);
    }
    return ids.length;
  }
  function addCss(id, css) {
    let style = document.getElementById(id);
    if (!style) {
      style = document.createElement("style");
      style.id = id;
      document.head.appendChild(style);
    }
    style.textContent = css;
  }
  function fillLeaders(contentWidthPx) {
    const marked = [];
    for (const attr of ["data-gp-after", "data-gp-before"]) {
      for (const el of Array.from(document.querySelectorAll(`[${attr}]`))) {
        const raw = el.getAttribute(attr) ?? "";
        if (LEADER_RE.test(raw))
          marked.push({ el, attr, raw });
      }
    }
    if (!marked.length)
      return 0;
    const prevWidth = document.body.style.width;
    document.body.style.width = `${contentWidthPx}px`;
    const canvas = document.createElement("canvas");
    const cx = canvas.getContext("2d");
    try {
      for (const m of marked)
        m.el.setAttribute(m.attr, m.raw.replace(LEADER_RE, ""));
      document.body.offsetHeight;
      for (const m of marked) {
        const match = LEADER_RE.exec(m.raw);
        const glue = match[1] || ".";
        const host = m.el;
        const block = host.parentElement ?? document.body;
        const blockRect = block.getBoundingClientRect();
        const cs = getComputedStyle(block);
        const contentRight = blockRect.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
        const rects = host.getClientRects();
        const last = rects.length ? rects[rects.length - 1] : host.getBoundingClientRect();
        cx.font = getComputedStyle(host).font;
        const glueW = cx.measureText(glue).width;
        const n = leaderFillCount(contentRight - last.right, glueW);
        m.el.setAttribute(m.attr, m.raw.replace(LEADER_RE, glue.repeat(n)));
      }
    } finally {
      document.body.style.width = prevWidth;
    }
    return marked.length;
  }
  function setGenerated(entries, css) {
    for (const e of entries) {
      const el = anchorHost(e.id);
      if (el)
        el.setAttribute(`data-gp-${e.where}`, e.text);
    }
    addCss("gp-generated-content", css);
    return entries.length;
  }
  function flushRoots() {
    const out = [];
    for (const root of Array.from(document.querySelectorAll(".page, .spread"))) {
      const edges = ["top", "right", "bottom", "left"].filter((edge) => root.querySelector(`.gp-pin.gp-flush.gp-${edge}`));
      if (!edges.length)
        continue;
      const page = getComputedStyle(root).page;
      const key = `${page === "auto" ? "" : page}|${edges.map((e) => e[0]).join("")}`;
      root.dataset.gpFlush = key;
      out.push({ id: ensureAnchor(root), page, edges, key });
    }
    return out;
  }
  function setFlushFurniture(items) {
    let painted = 0;
    for (const item of items) {
      const host = anchorHost(item.id);
      if (!host)
        continue;
      let layer = host.querySelector(":scope > .gp-flush-furniture");
      if (!layer) {
        layer = document.createElement("div");
        layer.className = "gp-flush-furniture";
        layer.setAttribute("aria-hidden", "true");
        layer.setAttribute("style", "position:absolute;inset:0;pointer-events:none;z-index:10;");
        host.appendChild(layer);
      }
      layer.textContent = "";
      for (const b of item.boxes) {
        const slot = document.createElement("div");
        slot.dataset.box = b.box;
        const justify = b.align === "center" ? "center" : b.align === "end" ? "flex-end" : "flex-start";
        slot.setAttribute("style", `position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;` + `display:flex;align-items:center;justify-content:${justify};overflow:hidden;white-space:pre;`);
        const content = document.createElement("span");
        content.textContent = b.text;
        for (const [prop, value] of Object.entries(b.decls))
          content.style.setProperty(prop, value);
        slot.appendChild(content);
        layer.appendChild(slot);
        painted++;
      }
    }
    return painted;
  }
  var api = {
    auditContent,
    collectCss,
    forcedBreakSites,
    counterResetSites,
    applyRectoSpacers,
    stringSources,
    xrefSites,
    targetTexts,
    fillLeaders,
    instrument,
    addCss,
    setGenerated,
    flushRoots,
    setFlushFurniture
  };
  if (typeof window !== "undefined")
    window.__gp = api;
})();
