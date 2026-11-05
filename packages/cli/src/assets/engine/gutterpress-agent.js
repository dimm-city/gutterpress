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
    setPinGeometry: () => setPinGeometry,
    setPinFurniture: () => setPinFurniture,
    setGenerated: () => setGenerated,
    printArea: () => printArea,
    pinRoots: () => pinRoots,
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
  var RECTO_VERSO_VALUES = /^(right|recto|left|verso)$/;
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

  // src/engine/shared/pin-edges.ts
  var PIN_EDGES = ["top", "right", "bottom", "left"];
  var EDGE_PIN_SELECTOR = PIN_EDGES.map((edge) => `.gp-pin.gp-${edge}`).join(", ");
  function pinEdgesIn(root) {
    const pins = Array.from(root.querySelectorAll(EDGE_PIN_SELECTOR)).filter((pin) => pin.offsetParent === root);
    return PIN_EDGES.filter((edge) => pins.some((pin) => pin.classList.contains(`gp-${edge}`)));
  }
  function pinKey(edges) {
    return PIN_EDGES.filter((e) => edges.includes(e)).map((e) => e[0]).join("");
  }
  function paddingOf(cs) {
    return {
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0
    };
  }

  // src/engine/shared/split.ts
  var SPLIT_CSS = "[data-gp-split-cont] { break-before: page; margin-block-start: 0; }";
  var PX_PER = { px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };
  function wordsOf(text) {
    return text.split(/\s+/).filter(Boolean);
  }
  function sameWords(before, after) {
    return before.length === after.length && before.every((w, i) => w === after[i]);
  }

  // src/engine/viewer/split-dom.ts
  var CARD_SELECTOR = "[data-gp-split]";
  var CONT = "data-gp-split-cont";
  var JOIN = "data-gp-split-join";
  var COPY = "data-gp-split-copy";
  function ensureSplitCss(doc = document) {
    if (doc.getElementById("gp-split-css"))
      return;
    const style = doc.createElement("style");
    style.id = "gp-split-css";
    style.textContent = SPLIT_CSS;
    doc.head.appendChild(style);
  }
  function cardsOf(root = document) {
    return Array.from(root.querySelectorAll(CARD_SELECTOR));
  }
  function flowOf(card) {
    const sel = card.getAttribute("data-gp-split");
    if (!sel)
      return null;
    try {
      return card.querySelector(sel);
    } catch {
      return null;
    }
  }
  function templateOf(card) {
    return card.querySelector("template[data-gp-split-head]");
  }
  function childrenMatching(parent, sel) {
    return Array.from(parent.children).filter((c) => {
      try {
        return c.matches(sel);
      } catch {
        return false;
      }
    });
  }
  function unitsOf(flow) {
    const out = [];
    for (const block of Array.from(flow.children)) {
      if (block.tagName === "GP-ANCHOR" || block.tagName === "TEMPLATE")
        continue;
      const whole = () => void out.push({ el: block, block, kind: "block" });
      if (block.hasAttribute("data-gp-nosplit")) {
        whole();
        continue;
      }
      const declared = block.getAttribute("data-gp-split-units");
      let units = [];
      const groups = [];
      let kind = "unit";
      if (declared)
        units = childrenMatching(block, declared);
      else if ((block.tagName === "UL" || block.tagName === "OL") && !block.hasAttribute("reversed")) {
        units = childrenMatching(block, "li");
        kind = "list-item";
      } else if (block.tagName === "TABLE") {
        const bodies = childrenMatching(block, "tbody");
        if (bodies.length === 1 && !block.querySelector(":scope > tfoot")) {
          const rows = Array.from(bodies[0].children).filter((r) => r.tagName === "TR");
          let covered = 0;
          for (const row of rows) {
            if (covered > 0 && groups.length)
              groups[groups.length - 1].last = row;
            else {
              units.push(row);
              groups.push({ el: row });
            }
            const reach = Math.max(0, ...Array.from(row.cells, (c) => c.rowSpan - 1));
            covered = Math.max(covered - 1, reach);
          }
          kind = "table-row";
        }
      }
      if (!units.length)
        whole();
      else if (groups.length)
        for (const g of groups)
          out.push({ ...g, block, kind });
      else
        for (const el of units)
          out.push({ el, block, kind });
    }
    return out;
  }
  function stripIds(el) {
    const bare = (e) => {
      e.removeAttribute("id");
      e.removeAttribute("data-source-range");
      e.removeAttribute("data-source-line");
    };
    bare(el);
    for (const d of Array.from(el.querySelectorAll("[id], [data-source-range], [data-source-line]")))
      bare(d);
  }
  function copyOf(el) {
    const c = el.cloneNode(true);
    stripIds(c);
    c.setAttribute(COPY, "");
    return c;
  }
  function tailOf(block, first) {
    const shell = block.cloneNode(false);
    stripIds(shell);
    shell.setAttribute(JOIN, "");
    let target = shell;
    let from = first;
    if (block.tagName === "TABLE") {
      for (const c of childrenMatching(block, "colgroup, thead"))
        shell.appendChild(copyOf(c));
      const body = first.parentElement;
      target = body.cloneNode(false);
      stripIds(target);
      target.setAttribute(JOIN, "");
      shell.appendChild(target);
    } else if (block.tagName === "OL") {
      const start = parseInt(block.getAttribute("start") ?? "1", 10) || 1;
      const index = Array.from(block.children).filter((c) => c.tagName === "LI").indexOf(first);
      shell.setAttribute("start", String(start + index));
    } else {
      const repeat = block.getAttribute("data-gp-split-repeat");
      if (repeat)
        for (const c of childrenMatching(block, repeat))
          shell.appendChild(copyOf(c));
    }
    while (from) {
      const next = from.nextElementSibling;
      target.appendChild(from);
      if (!next)
        break;
      from = next;
    }
    return shell;
  }
  function continuationOf(head) {
    for (let n = head.nextElementSibling;n; n = n.nextElementSibling) {
      if (n.hasAttribute(CONT))
        return n;
      if (!/(^|\s)gp-/.test(n.className))
        return null;
    }
    return null;
  }
  function headOf(cont) {
    for (let n = cont.previousElementSibling;n; n = n.previousElementSibling) {
      if (/(^|\s)gp-/.test(n.className))
        continue;
      return n.hasAttribute("data-gp-split") ? n : null;
    }
    return null;
  }
  function wordSpots(el) {
    const nodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode();n; n = walker.nextNode())
      nodes.push(n);
    const starts = [];
    let flat = "";
    for (const n of nodes) {
      starts.push(flat.length);
      flat += n.data;
    }
    const at = (g, inclusive) => {
      let i = nodes.length - 1;
      while (i > 0 && starts[i] > (inclusive ? g : g - 1))
        i--;
      return [nodes[i], g - starts[i]];
    };
    return Array.from(flat.matchAll(/\S+/g), (m) => {
      const [node, offset] = at(m.index, true);
      const [endNode, endOffset] = at(m.index + m[0].length, false);
      return { node, offset, endNode, endOffset };
    });
  }
  function cutParagraphAt(p, index) {
    if (/^pre/.test(getComputedStyle(p).whiteSpace))
      return false;
    const spot = wordSpots(p)[index];
    if (!spot || index < 1)
      return false;
    const range = document.createRange();
    range.setStart(spot.node, spot.offset);
    let from = spot.node;
    while (spot.offset === 0 && from.parentNode && from.parentNode !== p && !from.previousSibling)
      from = from.parentNode;
    if (from !== spot.node)
      range.setStartBefore(from);
    range.setEnd(p, p.childNodes.length);
    const rest = p.cloneNode(false);
    rest.setAttribute(JOIN, "");
    rest.classList.add("gp-split-cont");
    rest.appendChild(range.extractContents());
    stripIds(rest);
    p.after(rest);
    return true;
  }
  function makeContinuation(head) {
    const tpl = templateOf(head);
    const root = tpl?.content.firstElementChild;
    if (!tpl || !root)
      return null;
    const cont = root.cloneNode(true);
    if (!cont.querySelector("[data-gp-flow]"))
      return null;
    stripIds(cont);
    for (const a of Array.from(head.attributes))
      if (a.name.startsWith("data-gp-split"))
        cont.setAttribute(a.name, a.value);
    cont.setAttribute("data-gp-split", "[data-gp-flow]");
    cont.setAttribute(CONT, "");
    cont.appendChild(tpl.cloneNode(true));
    return cont;
  }
  function flowWords(card) {
    const flow = flowOf(card);
    if (!flow)
      return [];
    const text = [];
    const walk = (node) => {
      for (const n of Array.from(node.childNodes)) {
        if (n.nodeType === 3)
          text.push(n.textContent ?? "");
        else if (n instanceof Element && !n.hasAttribute(COPY))
          walk(n);
      }
    };
    walk(flow);
    return wordsOf(text.join(" "));
  }
  function splitCardAt(card, index, word) {
    const flow = flowOf(card);
    let units = flow ? unitsOf(flow) : [];
    let unit = units[index];
    if (!flow || !unit || index < 1 && word === undefined)
      return { ok: false };
    const cont = makeContinuation(card);
    if (!cont) {
      return {
        ok: false,
        diagnostic: {
          code: "engine.split.template",
          message: `A card marked data-gp-split has no usable <template data-gp-split-head> ` + `(one root element holding an empty [data-gp-flow]), so it stays as the browser breaks it.`
        }
      };
    }
    const before = flowWords(card);
    let kind = unit.kind;
    if (word !== undefined) {
      if (unit.kind !== "block" || unit.el.tagName !== "P" || !cutParagraphAt(unit.el, word))
        return { ok: false };
      units = unitsOf(flow);
      index += 1;
      unit = units[index];
      kind = "paragraph";
    }
    const contFlow = flowOf(cont);
    const following = [];
    for (let n = unit.block.nextElementSibling;n; n = n.nextElementSibling)
      following.push(n);
    const blockStart = units.findIndex((u) => u.block === unit.block);
    const head = blockStart === index ? unit.block : tailOf(unit.block, unit.el);
    const moved = [head, ...following];
    for (const el of moved)
      contFlow.appendChild(el);
    card.after(cont);
    const cut = card.getAttribute("data-gp-split-cut");
    if (cut)
      card.classList.add(cut);
    if (!sameWords(before, [...flowWords(card), ...flowWords(cont)])) {
      mergeBack(card);
      return {
        ok: false,
        diagnostic: {
          code: "engine.split.text-changed",
          message: `Splitting a card would have changed its words, so it was left as the browser breaks it.`
        }
      };
    }
    return { ok: true, cont, kind };
  }
  function sameShell(a, b) {
    const x = a.cloneNode(false);
    const y = b.cloneNode(false);
    for (const e of [x, y]) {
      e.removeAttribute("id");
      e.removeAttribute("data-source-range");
      e.removeAttribute("data-source-line");
    }
    return x.isEqualNode(y);
  }
  function mergeInto(target, shell, inline = shell.classList.contains("gp-split-cont")) {
    while (shell.firstChild) {
      const n = shell.firstChild;
      const last = target.lastChild;
      if (n instanceof Element && n.hasAttribute(COPY))
        n.remove();
      else if (n instanceof Element && n.hasAttribute(JOIN)) {
        mergeInto(target.lastElementChild, n);
        n.remove();
      } else if (inline && n instanceof Element && last instanceof Element && sameShell(last, n)) {
        mergeInto(last, n, true);
        n.remove();
      } else
        target.appendChild(n);
    }
    target.normalize();
  }
  function mergeBack(head) {
    const cont = continuationOf(head);
    const hf = flowOf(head);
    const cf = cont ? flowOf(cont) : null;
    if (!cont || !hf || !cf)
      return;
    const first = cf.firstElementChild;
    if (first?.hasAttribute(JOIN)) {
      const last = Array.from(hf.children).filter((c) => c.tagName !== "GP-ANCHOR").at(-1);
      if (last)
        mergeInto(last, first);
      first.remove();
    }
    while (cf.firstChild)
      hf.appendChild(cf.firstChild);
    cont.remove();
    const cut = head.getAttribute("data-gp-split-cut");
    if (cut)
      head.classList.remove(cut);
  }
  function clearLabels(root) {
    for (const e of Array.from(root.querySelectorAll("[id^='gp-split-']")))
      if (/^gp-split-\d+(-head)?$/.test(e.id))
        e.removeAttribute("id");
  }
  function labelContinuations(root = document) {
    clearLabels(root);
    const continuations = [];
    const heads = [];
    for (const cont of Array.from(root.querySelectorAll(`[${CONT}]`))) {
      const flow = flowOf(cont);
      if (!flow)
        continue;
      const n = continuations.length + 1;
      flow.id = `gp-split-${n}`;
      continuations.push(flow.id);
      const head = headOf(cont);
      const hf = head ? flowOf(head) : null;
      const last = hf ? unitsOf(hf).at(-1)?.el : undefined;
      if (last && !last.id)
        last.id = `gp-split-${n}-head`;
      heads.push(last?.id ?? "");
    }
    return { continuations, heads };
  }
  function replaySplitOps(ops) {
    ensureSplitCss();
    let failed = 0;
    for (const op of ops) {
      const card = cardsOf()[op.n];
      if (!card || !splitCardAt(card, op.unit, op.word).ok)
        failed++;
    }
    return { ...labelContinuations(), failed };
  }

  // src/engine/shared/print-area.ts
  function printAreaFromMeta(doc) {
    const raw = doc.querySelector('meta[name="gp-print-area"]')?.getAttribute("content");
    if (!raw)
      return null;
    try {
      const v = JSON.parse(raw);
      const n = (x) => typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0;
      if (!n(v.width) || !n(v.height))
        return null;
      const safe = n(v.safe);
      const spec = v.spec && typeof v.spec.label === "string" && typeof v.spec.url === "string" && /^https?:\/\//i.test(v.spec.url) ? v.spec : undefined;
      return {
        width: n(v.width),
        height: n(v.height),
        bleed: n(v.bleed),
        safe,
        artSafe: typeof v.artSafe === "number" ? n(v.artSafe) : safe,
        gutter: typeof v.gutter === "number" ? n(v.gutter) : safe,
        preset: typeof v.preset === "string" ? v.preset : undefined,
        spec
      };
    } catch {
      return null;
    }
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
    const found = [];
    const seen = new Set;
    for (const d of decls) {
      let els = [];
      try {
        els = Array.from(document.querySelectorAll(d.selector));
      } catch {
        continue;
      }
      for (const el of els) {
        const id = ensureAnchor(el);
        const value = getComputedStyle(el).breakBefore;
        if (seen.has(el) || !RECTO_VERSO_VALUES.test(value))
          continue;
        seen.add(el);
        found.push({ el, id, prop: d.prop, value, selector: d.selector });
      }
    }
    found.sort((a, b) => a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    return found.map(({ el: _el, ...site }) => site);
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
      const src = img.currentSrc || img.src;
      if (/^data:image\/svg|\.svg(?:[?#]|$)/i.test(src))
        continue;
      const dpi = img.naturalWidth / (rect.width / 96);
      if (dpi < dpiFloor) {
        const file = src.startsWith("data:") ? "" : decodeURIComponent(src.split(/[?#]/)[0].split("/").pop());
        out.push({
          kind: "low-dpi",
          what: file ? `${name(img)} (${file})` : name(img),
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
  function pinRoots() {
    const out = [];
    for (const root of Array.from(document.querySelectorAll(".page, .spread"))) {
      const edges = pinEdgesIn(root);
      if (!edges.length)
        continue;
      const cs = getComputedStyle(root);
      const padding = paddingOf(cs);
      const key = `${cs.page === "auto" ? "" : cs.page}|${pinKey(edges)}|${edges.map((e) => padding[e]).join(",")}`;
      root.dataset.gpPin = key;
      out.push({ id: ensureAnchor(root), page: cs.page, edges, padding, key });
    }
    return out;
  }
  function printArea() {
    return printAreaFromMeta(document);
  }
  function setPinGeometry(items) {
    let set = 0;
    for (const item of items) {
      const host = anchorHost(item.id);
      if (!host)
        continue;
      for (const [prop, value] of Object.entries(item.style))
        host.style.setProperty(prop, value);
      set++;
    }
    return set;
  }
  function setPinFurniture(items) {
    let painted = 0;
    for (const item of items) {
      const host = anchorHost(item.id);
      if (!host)
        continue;
      let layer = host.querySelector(":scope > .gp-pin-furniture");
      if (!layer) {
        layer = document.createElement("div");
        layer.className = "gp-pin-furniture";
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
    applySplitOps: replaySplitOps,
    addCss,
    setGenerated,
    pinRoots,
    printArea,
    setPinGeometry,
    setPinFurniture
  };
  if (typeof window !== "undefined")
    window.__gp = api;
})();
