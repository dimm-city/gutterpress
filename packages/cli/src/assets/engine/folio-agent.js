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
    instrument: () => instrument,
    forcedBreakSites: () => forcedBreakSites,
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

  // src/engine/compiler/agent.ts
  var uid = 0;
  function ensureAnchor(el) {
    if (el.id)
      return el.id;
    const existing = el.firstElementChild;
    if (existing?.tagName === "FOLIO-ANCHOR" && existing.id)
      return existing.id;
    const anchor = document.createElement("folio-anchor");
    anchor.id = `folio-m-${++uid}`;
    anchor.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
    el.insertBefore(anchor, el.firstChild);
    return anchor.id;
  }
  function anchorHost(id) {
    const el = document.getElementById(id);
    if (!el)
      return null;
    return el.tagName === "FOLIO-ANCHOR" ? el.parentElement : el;
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
        out.push({
          name: decl.name,
          id: ensureAnchor(el),
          text: (el.textContent ?? "").trim().replace(/\s+/g, " "),
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
    for (const spacer of Array.from(document.querySelectorAll(".folio-recto-spacer")))
      spacer.remove();
    let inserted = 0;
    for (const id of ids) {
      const el = anchorHost(id);
      if (!el)
        continue;
      const spacer = document.createElement("div");
      spacer.className = "folio-recto-spacer";
      spacer.setAttribute("aria-hidden", "true");
      spacer.style.cssText = `break-before: page; break-after: page; height: 0; margin: 0; padding: 0; border: 0; page: ${pageName};`;
      el.before(spacer);
      inserted++;
    }
    return inserted;
  }
  function auditContent(contentHeightPx, dpiFloor) {
    const out = [];
    const name = (el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "") + (el.className && typeof el.className === "string" ? `.${el.className.split(/\s+/)[0]}` : "");
    for (const el of Array.from(document.querySelectorAll("figure,img,table,pre,svg,div"))) {
      const h = el.getBoundingClientRect().height;
      if (h > contentHeightPx + 1 && el.children.length === 0) {
        out.push({
          kind: "overheight",
          what: name(el),
          detail: `${Math.round(h)}px tall on a ${Math.round(contentHeightPx)}px content box`
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
    let host = document.getElementById("folio-instrumentation");
    if (!host) {
      host = document.createElement("div");
      host.id = "folio-instrumentation";
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
    for (const attr of ["data-folio-after", "data-folio-before"]) {
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
        el.setAttribute(`data-folio-${e.where}`, e.text);
    }
    addCss("folio-generated-content", css);
    return entries.length;
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
    setGenerated
  };
  if (typeof window !== "undefined")
    window.__folio = api;
})();
