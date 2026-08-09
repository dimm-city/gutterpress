// Interface adapter: exposes window.previewAPI for the parent toolbar. Works
// under BOTH pagination engines (`--engine paged` / `--engine native`),
// detected once at load time from the injected engine <script> tag — by the
// time any previewAPI method actually runs, the corresponding engine has had
// a chance to mount.
//
// Paged.js paginates into .pagedjs_page elements; we use PagedConfig.after to
// know when rendering is done. The Gutterpress engine viewer paginates into
// .folio-sheet elements (one per page, `dataset.page` = 1-based book page)
// and exposes window.Gutterpress.pageOf(el) (0-based); it fires 'folio:layout'
// when its pagination completes.
//
// The block-overlay fragment-grouping machinery below (blocksMatchingRange)
// groups by `{chapter, range}` (data-source-range), not `data-ref` — a source
// range is duplicated onto every fragment identically (Paged.js CLONES an
// element across pages and strips its id from every clone but the first, but
// copies data-source-range verbatim), so it groups a clone-set exactly as
// well as a ref would, with no separate ref bookkeeping needed. The native
// viewer never clones — an element that visually spans pages is still ONE
// element — so the native path (nativeRectsFor) resolves rects straight off
// the single matching element via getClientRects() + pageOf().

(function () {
  'use strict';

  var NATIVE_ENGINE = !!(
    document.querySelector &&
    document.querySelector('script[src*="/engine/gutterpress-viewer.js"]')
  );

  var pages = [];
  var currentPage = 1;
  var debugMode = false;
  var currentViewMode = 'two-column';
  var ignoreScrollUntil = 0;
  var lastSourceLine = -1;
  var lastSourceChapter = null;

  function refreshPages() {
    if (NATIVE_ENGINE) {
      pages = Array.from(document.querySelectorAll('.folio-sheet')).sort(function (a, b) {
        return (parseInt(a.dataset.page, 10) || 0) - (parseInt(b.dataset.page, 10) || 0);
      });
    } else {
      pages = Array.from(document.querySelectorAll('.pagedjs_page'));
    }
    return pages;
  }

  function clampPage(n) {
    if (pages.length === 0) return 1;
    var page = Number(n);
    if (!Number.isFinite(page)) page = 1;
    return Math.max(1, Math.min(Math.round(page), pages.length));
  }

  // The native viewer lays one CHAPTER per row (`.folio-run`), each row as
  // wide as that chapter needs — rows stack vertically, but a long chapter's
  // pages run off horizontally within its own row (viewer.css: `.folio-sheet`
  // is `left`-positioned within the row, every sheet in a row shares `top`).
  // The paged.js top-only scan below can't tell two sheets in the same row
  // apart — every one of them has the same `top`, so it always resolves to
  // the LAST sheet of whichever row is vertically in view, ignoring
  // scrollLeft entirely (measured: goToPage(18/30/34) in a 34pp book all
  // landed on page 14 — row 1's last page — regardless of horizontal scroll
  // position). Pick the sheet with the GREATEST visible overlap area with the
  // viewport — a fixed reference-point distance was tried first but broke at
  // the very end of a row: the browser clamps scrollIntoView({inline:'start'})
  // once there's no more row content to scroll past, so the last page of a
  // short final row can land mid-viewport rather than flush against any fixed
  // point (measured: goToPage(34) on a 34pp book left page 34 at ~40% visible
  // width from the left edge, so a left-edge reference point missed it and
  // matched page 33 instead, which still touched the reference point). Falls
  // back to nearest-by-distance when nothing overlaps at all (e.g. mid-scroll
  // between rows, or every sheet clipped by a shorter viewport than a page).
  function detectVisiblePageNative() {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var best = 0;
    var bestArea = 0;
    var nearest = 0;
    var nearestScore = Infinity;
    var refX = vw / 3;
    var refY = vh / 3;
    for (var i = 0; i < pages.length; i++) {
      var r = pages[i].getBoundingClientRect();
      var w = Math.min(r.right, vw) - Math.max(r.left, 0);
      var h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      var area = w > 0 && h > 0 ? w * h : 0;
      if (area > bestArea) { bestArea = area; best = i; }
      var dx = refX < r.left ? r.left - refX : (refX > r.right ? refX - r.right : 0);
      var dy = refY < r.top ? r.top - refY : (refY > r.bottom ? refY - r.bottom : 0);
      var score = dx * dx + dy * dy;
      if (score < nearestScore) { nearestScore = score; nearest = i; }
    }
    return (bestArea > 0 ? best : nearest) + 1;
  }

  function detectVisiblePage() {
    if (pages.length === 0) return 1;
    if (NATIVE_ENGINE) return detectVisiblePageNative();
    // Use getBoundingClientRect (viewport-relative, post-zoom) rather than
    // offsetTop. The desktop applies CSS `zoom` for fit-width; under `zoom`,
    // offsetTop stays in PRE-zoom layout coords while window.scrollY is POST-zoom,
    // so mixing them pinned the detected page to 1. getBoundingClientRect is
    // consistent with the rendered viewport at any zoom.
    var line = window.innerHeight / 3; // reference line in the upper third
    var vh = window.innerHeight;
    var last = 0;
    for (var i = 0; i < pages.length; i++) {
      var top = pages[i].getBoundingClientRect().top;
      if (top <= line) last = i;       // last page whose top is at/above the line
      else if (top > vh) break;        // well below the viewport — stop scanning
    }
    // In spread/two-column view a row holds two pages at the same top; report the
    // FIRST page of that row (matches single view, where each row is one page).
    var rowTop = pages[last].getBoundingClientRect().top;
    while (last > 0 && Math.abs(pages[last - 1].getBoundingClientRect().top - rowTop) < 2) last--;
    return last + 1;
  }

  function scrollToCurrentPage() {
    if (pages.length === 0) return;
    var page = clampPage(currentPage);
    currentPage = page;
    ignoreScrollUntil = Date.now() + 300;
    // Native's rows can be wider than the viewport (a long chapter scrolls
    // horizontally within its own row) — align the target sheet's left edge
    // to the viewport's left edge (matching detectVisiblePageNative's `refX`)
    // rather than paged's single-column 'nearest', which leaves scrollLeft
    // wherever it already was when the sheet is already partly on-screen.
    pages[page - 1].scrollIntoView({
      behavior: 'instant',
      block: 'start',
      inline: NATIVE_ENGINE ? 'start' : 'nearest'
    });
    recordVisibleSource();
  }

  function pageStep(mode) {
    return (mode || currentViewMode) === 'single' ? 1 : 2;
  }

  // ── Source-mapping helpers (ADR 0005) ──────────────────────────────────────
  // Every block element carries data-source-line (markdown-it-source-map). These
  // map rendered DOM <-> markdown source line and rendered DOM <-> paged.js page,
  // which is the same-origin info the cross-iframe host cannot compute itself.
  function lineOf(el) {
    if (!el || !el.getAttribute) return null;
    var n = parseInt(el.getAttribute('data-source-line'), 10);
    return Number.isFinite(n) ? n : null;
  }

  function pageIndexOf(el) {
    if (!el) return 0;
    if (NATIVE_ENGINE) {
      if (!window.Gutterpress || typeof window.Gutterpress.pageOf !== 'function') return 0;
      var native = window.Gutterpress.pageOf(el);
      return native >= 0 ? native + 1 : 0;
    }
    if (!el.closest) return 0;
    var pg = el.closest('.pagedjs_page');
    if (!pg) return 0;
    if (pages.length === 0) refreshPages();
    var idx = pages.indexOf(pg);
    return idx >= 0 ? idx + 1 : 0;
  }

  function sourcedBlocks() {
    return Array.from(document.querySelectorAll('[data-source-line]'));
  }

  // data-source-line resets PER FILE, so a line number is only unambiguous when
  // paired with its chapter (data-chapter-src — the source filename). These two
  // helpers scope line lookups to a chapter so editor<->preview sync maps to the
  // right file in a multi-chapter book.
  function chapterOf(el) {
    var c = el && el.closest ? el.closest('[data-chapter-src]') : null;
    return c ? c.getAttribute('data-chapter-src') : null;
  }

  function blocksInChapter(chapter) {
    if (!chapter) return sourcedBlocks();
    return sourcedBlocks().filter(function (block) {
      return chapterOf(block) === chapter;
    });
  }

  // The block straddling the top of the viewport (greatest top still at/above a
  // reference line just below the viewport edge); falls back to the first block
  // below the fold when scrolled to the very top.
  function topVisibleSourceEl() {
    var blocks = sourcedBlocks();
    if (blocks.length === 0) return null;
    var ref = 4;
    var best = null, bestTop = -Infinity;
    for (var i = 0; i < blocks.length; i++) {
      var top = blocks[i].getBoundingClientRect().top;
      if (top <= ref && top > bestTop) { bestTop = top; best = blocks[i]; }
    }
    if (!best) {
      for (var j = 0; j < blocks.length; j++) {
        if (blocks[j].getBoundingClientRect().top >= 0) { best = blocks[j]; break; }
      }
    }
    return best || blocks[0];
  }

  // {el, line} of the viewport-top source position, with the line interpolated
  // within the straddling block by the viewport top's fractional distance to the
  // next annotated block (source-map only annotates top-level blocks, so the
  // block's start line alone can be tens of lines above the visible content).
  function visibleSourcePosition() {
    var el = topVisibleSourceEl();
    if (!el) return null;
    var line = lineOf(el);
    if (line == null) return { el: el, line: null };
    var ref = 4; // same reference line as topVisibleSourceEl
    var top = el.getBoundingClientRect().top;
    if (top < ref) {
      // Find the next annotated sibling-in-flow (document order, higher line —
      // explicitly constrained to this chapter because source lines restart per
      // file and a following chapter may begin at any line after front matter).
      var blocks = sourcedBlocks();
      var idx = blocks.indexOf(el);
      var chapter = chapterOf(el);
      for (var i = idx + 1; i < blocks.length; i++) {
        if (chapterOf(blocks[i]) !== chapter) break;
        var nl = lineOf(blocks[i]);
        if (nl == null) continue;
        if (nl <= line) break;
        var nextTop = blocks[i].getBoundingClientRect().top;
        if (nextTop > top) {
          var f = Math.max(0, Math.min(1, (ref - top) / (nextTop - top)));
          line = line + Math.round(f * (nl - line));
        }
        break;
      }
    }
    return { el: el, line: line };
  }

  function recordVisibleSource() {
    var pos = visibleSourcePosition();
    lastSourceLine = pos && pos.line != null ? pos.line : -1;
    lastSourceChapter = pos ? chapterOf(pos.el) : null;
  }

  function preserveViewport(change) {
    refreshPages();
    var position = visibleSourcePosition();
    var anchor = position ? {
      el: position.el,
      top: position.el.getBoundingClientRect().top
    } : null;
    change();
    refreshPages();
    if (!anchor) {
      scrollToCurrentPage();
      return;
    }
    ignoreScrollUntil = Date.now() + 300;
    var delta = anchor.el.getBoundingClientRect().top - anchor.top;
    if (delta) {
      window.scrollBy({ top: delta, behavior: 'instant' });
    }
    currentPage = detectVisiblePage();
    recordVisibleSource();
  }

  // Resolve a {line, chapter?} target to its enclosing annotated block PLUS the
  // following annotated block, so callers can interpolate within long blocks
  // (markdown-it-source-map only annotates top-level *_open tokens, so a target
  // line deep inside a list/table/paragraph would otherwise snap to the block's
  // start line — measured 35-line snap-backs on real chapters).
  function resolveLinePosition(target) {
    var line = Number(target.line);
    var blocks = blocksInChapter(target.chapter);
    var best = null, bestLine = -Infinity, next = null, nextLine = Infinity;
    for (var i = 0; i < blocks.length; i++) {
      var l = lineOf(blocks[i]);
      if (l == null) continue;
      if (l <= line && l > bestLine) { bestLine = l; best = blocks[i]; }
      else if (l > line && l < nextLine) { nextLine = l; next = blocks[i]; }
    }
    if (!best) return blocks[0] ? { el: blocks[0], line: lineOf(blocks[0]), nextEl: null, nextLine: null } : null;
    return { el: best, line: bestLine, nextEl: next, nextLine: next ? nextLine : null };
  }

  // Resolve a scrollTo/highlight target ({line}|{id}|{selector}|{page} or a bare
  // line number) to a DOM element.
  function resolveTarget(target) {
    if (target == null) return null;
    if (typeof target === 'number') target = { line: target };
    if (target.selector) { try { return document.querySelector(target.selector); } catch (_e) { return null; } }
    if (target.id) return document.getElementById(target.id);
    if (target.page != null) { refreshPages(); return pages[clampPage(target.page) - 1] || null; }
    if (target.line != null) {
      var pos = resolveLinePosition(target);
      return pos ? pos.el : null;
    }
    return null;
  }

  // ── Context-menu target resolution (protocol v4) ────────────────────────────
  // docs/inline-editing-plan.md §3.1 / ADR 0009. getContextTargetAt() is the
  // single resolution routine shared by the public previewAPI member and both
  // event listeners below (contextmenu + keyboard) — see that doc for the
  // exact kind-precedence contract implemented here.
  var LAYOUT_MARKER_CLASSES = ['chapter', 'spread', 'page', 'section', 'md-page-break', 'md-column-break'];

  function elementAtPoint(x, y) {
    try {
      if (typeof document.elementFromPoint === 'function') return document.elementFromPoint(x, y);
    } catch (_e) { /* unsupported host — degrade to null */ }
    return null;
  }

  function elementOf(node) {
    if (!node) return null;
    return node.nodeType === 1 ? node : (node.parentElement || null);
  }

  // Parse a `data-source-range="<start>:<end>"` value into a [start, end)
  // pair — token.map's own 0-based half-open convention, verbatim.
  function sourceRangeOf(el) {
    if (!el || !el.getAttribute) return null;
    var raw = el.getAttribute('data-source-range');
    if (!raw) return null;
    var sep = raw.indexOf(':');
    if (sep < 0) return null;
    var start = parseInt(raw.slice(0, sep), 10);
    var end = parseInt(raw.slice(sep + 1), 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return [start, end];
  }

  // Fence gotcha (§2.6): markdown-it's default fence renderer puts token
  // attrs on the inner <code>, never the <pre> wrapper — a click on the code
  // block's padding hits <pre>'s box, which never carries data-source-range.
  // Prefer an annotated <code> child over climbing to a coarser ancestor.
  function fenceCodeChild(el) {
    if (!el || !el.tagName || el.tagName.toLowerCase() !== 'pre' || !el.children) return null;
    for (var i = 0; i < el.children.length; i++) {
      var c = el.children[i];
      if (c.tagName && c.tagName.toLowerCase() === 'code' && c.getAttribute && c.getAttribute('data-source-range')) {
        return c;
      }
    }
    return null;
  }

  // Innermost [data-source-range] element at/around `el` (self-or-ancestor),
  // with the fence <pre>-hits-<code> special case above taking priority.
  function resolveAnnotatedBlock(el) {
    if (!el) return null;
    var fenceCode = fenceCodeChild(el);
    if (fenceCode) return fenceCode;
    return el.closest ? el.closest('[data-source-range]') : null;
  }

  function isMarkerBlock(el) {
    if (!el || !el.classList) return false;
    for (var i = 0; i < LAYOUT_MARKER_CLASSES.length; i++) {
      if (el.classList.contains(LAYOUT_MARKER_CLASSES[i])) return true;
    }
    return false;
  }

  // Split fragments duplicate every data attribute (including
  // data-source-range and data-ref); data-split-from/-to are the only
  // markers Paged.js adds fresh on the clone, so they're what identifies a
  // fragment as split (never key on `id` — Paged.js strips it from every
  // fragment but the first, mirroring it to data-id instead).
  function isSplitFragment(el) {
    return !!(el && el.hasAttribute && (el.hasAttribute('data-split-from') || el.hasAttribute('data-split-to')));
  }

  // Plain, JSON-cloneable rect — the payload crosses two postMessage
  // boundaries, so no DOMRect instances (§3.5).
  function plainRect(el) {
    if (!el || !el.getBoundingClientRect) return null;
    var r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }

  // Non-collapsed selection info, or null. NEVER Range.toString() — a
  // cross-page range's raw text is polluted with inter-page structural
  // whitespace and can include every intervening page's content (§3.5);
  // selection.toString() is the display-only source of truth here.
  function selectionInfo() {
    var sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (!sel || sel.isCollapsed) return null;
    var anchorBlock = resolveAnnotatedBlock(elementOf(sel.anchorNode));
    var focusBlock = resolveAnnotatedBlock(elementOf(sel.focusNode));
    var withinSingleBlock = !!(anchorBlock && focusBlock && anchorBlock === focusBlock);
    return {
      text: sel.toString(),
      withinSingleBlock: withinSingleBlock,
      range: withinSingleBlock ? sourceRangeOf(anchorBlock) : null,
      chapter: withinSingleBlock ? chapterOf(anchorBlock) : null
    };
  }

  // Shared resolution: builds the full getContextTargetAt() payload for a
  // point element. `selection`/`image`/`link` are populated whenever
  // applicable REGARDLESS of which `kind` wins, so the menu can offer
  // secondary items (§3.1).
  //
  // kind precedence (decided): selection -> image -> link -> marker -> block
  // -> none.
  function buildContextTarget(pointEl) {
    var selection = selectionInfo();
    var imageEl = pointEl && pointEl.closest ? pointEl.closest('img') : null;
    var image = imageEl ? { src: imageEl.getAttribute('src'), alt: imageEl.getAttribute('alt') } : null;
    var linkEl = pointEl && pointEl.closest ? pointEl.closest('a') : null;
    var link = linkEl ? { href: linkEl.getAttribute('href'), text: (linkEl.textContent || '').trim() } : null;

    var block = resolveAnnotatedBlock(pointEl);

    var kind;
    if (selection) kind = 'selection';
    else if (image) kind = 'image';
    else if (link) kind = 'link';
    else if (block && isMarkerBlock(block)) kind = 'marker';
    else if (block) kind = 'block';
    else kind = 'none';

    return {
      kind: kind,
      chapter: chapterOf(pointEl),
      range: block ? sourceRangeOf(block) : null,
      blockTag: block && block.tagName ? block.tagName.toLowerCase() : null,
      split: isSplitFragment(block),
      rect: plainRect(block || pointEl),
      image: image,
      link: link,
      selection: selection
    };
  }

  // The anchor point for a keyboard-invoked menu: the current selection's
  // focus position if non-collapsed, else the block at the top of the
  // viewport (topVisibleSourceEl(), which already exists for scroll sync).
  // Keyboard events targeted at a focused element in a cross-origin iframe
  // never reach the parent SPA — this resolution MUST live here, not
  // SPA-side.
  function keyboardAnchorPoint() {
    var sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
    var el = sel && !sel.isCollapsed ? elementOf(sel.focusNode) : null;
    if (!el) el = topVisibleSourceEl();
    var rect = el ? plainRect(el) : null;
    if (!rect) return { x: 0, y: 0 };
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  // ── Block-overlay geometry + masking (protocol v6) ──────────────────────────
  // docs/inline-editing-plan.md §5.3 / ADR 0009. A block split across pages
  // exists as MULTIPLE DOM fragments that duplicate every data attribute
  // (§3.5's split-fragment gotcha applies here too) — `data-source-range` is
  // duplicated onto every fragment identically, so `{chapter, range}` groups
  // them exactly as well as the `data-ref` this used to key off (protocol v5
  // dropped `data-ref` from the wire contract entirely: the native viewer
  // never mints one at all — it never clones, so there is nothing to give a
  // shared identity to — and a source range already uniquely identifies one
  // block, so the ref was pure duplication of information `{chapter, range}`
  // already carried on every path, paged included).

  function rangedBlocks() {
    return Array.from(document.querySelectorAll('[data-source-range]'));
  }

  function rangedBlocksInChapter(chapter) {
    if (!chapter) return rangedBlocks();
    return rangedBlocks().filter(function (el) { return chapterOf(el) === chapter; });
  }

  function blocksMatchingRange(chapter, range) {
    if (!range) return [];
    return rangedBlocksInChapter(chapter).filter(function (el) {
      var r = sourceRangeOf(el);
      return r && r[0] === range[0] && r[1] === range[1];
    });
  }

  // Native-engine getRectsFor(): the viewer never clones, so a spec resolves
  // to AT MOST ONE element. Its fragment rects come straight from
  // getClientRects() — a block can still visually span pages if the
  // browser's own multicol layout breaks it there — each reported under the
  // block's own page (window.Gutterpress.pageOf() locates the fragmentainer
  // the element STARTS in, so every rect shares that one page number).
  function nativeRectsFor(spec) {
    spec = spec || {};
    var el = blocksMatchingRange(spec.chapter, spec.range)[0] || null;
    if (!el) return { rects: [] };
    var page = pageIndexOf(el);
    var raw = el.getClientRects ? Array.from(el.getClientRects()) : [];
    if (!raw.length) {
      var r0 = plainRect(el);
      raw = r0 ? [r0] : [];
    }
    var rects = raw.map(function (r) {
      return { top: r.top, left: r.left, width: r.width, height: r.height, page: page };
    });
    return { rects: rects };
  }

  var api = {
    getTotalPages: function () { refreshPages(); return pages.length; },
    getCurrentPage: function () { return currentPage; },
    goToPage: function (n) {
      refreshPages();
      currentPage = clampPage(n);
      scrollToCurrentPage();
      return api.notifyPageChange();
    },
    getPageDimensions: function () {
      refreshPages();
      var page = pages[0] || null;
      if (!page) return null;
      if (NATIVE_ENGINE) {
        return { width: page.offsetWidth, height: page.offsetHeight };
      }
      var pagesEl = document.querySelector('.pagedjs_pages');
      return {
        width: currentViewMode === 'single' ? page.offsetWidth : (pagesEl ? pagesEl.scrollWidth : page.offsetWidth),
        height: page.offsetHeight
      };
    },
    firstPage: function () { return api.goToPage(1); },
    prevPage: function (mode) { return api.goToPage(currentPage - pageStep(mode)); },
    nextPage: function (mode) { return api.goToPage(currentPage + pageStep(mode)); },
    lastPage: function () { refreshPages(); return api.goToPage(pages.length); },
    setViewMode: function (mode, silent) {
      preserveViewport(function () {
        currentViewMode = mode || 'two-column';
        document.body.classList.remove('view-single', 'view-spread', 'view-two-column');
        if (mode) document.body.classList.add('view-' + mode);
        // Under native the view-mode classes NEVER move content or sheets —
        // a prior `decoration.setSpread()` call repositioned the sheet chrome
        // to fake a single/two-up layout, but the strip underneath is one
        // multicol flow element whose columns cannot be individually moved,
        // so the author's content stayed at its native column position while
        // the sheets moved, visibly detaching text from page (retired; see
        // decorate.ts's draw()). Instead the classes ONLY drive CSS
        // scroll-snap granularity (viewer.css: 1 page per snap point in
        // single mode, recto+verso pairs in two-up/spread) — sheets are
        // already laid out correctly by decorate.ts; a view mode just picks
        // how a manual scroll settles. `pageStep()` above already makes
        // next/prevPage step by 1 or 2 book pages to match.
      });
      if (!silent) return api.notifyPageChange();
    },
    setZoom: function (z, silent) {
      preserveViewport(function () {
        document.documentElement.style.setProperty('--gutterpress-zoom', z);
      });
      if (!silent) api.notifyPageChange();
    },
    toggleDebugMode: function () {
      debugMode = !debugMode;
      document.body.classList.toggle('debug', debugMode);
      if (NATIVE_ENGINE && window.Gutterpress && window.Gutterpress.decoration) {
        window.Gutterpress.decoration.setDesigner(debugMode);
      }
      return debugMode;
    },
    notifyPageChange: function () {
      var detail = { currentPage: api.getCurrentPage(), totalPages: pages.length };
      window.dispatchEvent(new CustomEvent('pageChanged', { detail: detail }));
      return detail;
    },
    notifyRenderingComplete: function () {
      window.dispatchEvent(new CustomEvent('renderingComplete', {
        detail: { totalPages: pages.length }
      }));
    },
    // Re-read the page list and recompute the current page from the scroll
    // position, then notify. Hosts may call this after replacing paginated DOM
    // so cached page counters and scroll synchronization stay current.
    refresh: function () {
      refreshPages();
      currentPage = detectVisiblePage();
      recordVisibleSource();
      return api.notifyPageChange();
    },

    // ── ADR 0005 generic primitives ─────────────────────────────────────────
    // Bumped whenever a command/event is added so a hot-updated SPA can
    // feature-detect against an older bundled lib.
    // v6 (WORK PACKAGE B item 2): getRectsFor()/setEditMask() dropped the
    // {ref} form entirely — {chapter, range} is the only target shape now
    // (v5 had a data-ref fast path that the native viewer, which never mints
    // one, could never use in the first place).
    getProtocolVersion: function () { return 6; },

    // Resolve the annotated element/selection at a viewport point (protocol
    // v4). Pure read; see buildContextTarget() above for the full contract.
    getContextTargetAt: function (spec) {
      spec = spec || {};
      return buildContextTarget(elementAtPoint(spec.x, spec.y));
    },

    // All fragment rects for one logical block (protocol v6, §5.3), targeted
    // by {chapter, range}. Pure read; never mutates the DOM. Plain,
    // JSON-cloneable objects only (§3.5) — no DOMRect instances.
    getRectsFor: function (spec) {
      if (NATIVE_ENGINE) return nativeRectsFor(spec);
      spec = spec || {};
      var els = blocksMatchingRange(spec.chapter, spec.range);
      var rects = els.map(function (el) {
        var r = plainRect(el);
        if (!r) return null;
        r.page = pageIndexOf(el);
        return r;
      }).filter(function (r) { return r != null; });
      return { rects: rects };
    },

    // Toggle a masking class on EVERY fragment of a block ({chapter, range}
    // match, protocol v6, §5.1/§5.3), plus a scroll lock on the book document
    // element. Purely cosmetic and fully reversible — Paged.js never
    // re-layouts after a mutation (spike-verified), so nothing here may touch
    // anything layout-affecting; see the class definitions below and ADR
    // 0009. `masked: false` always removes the lock class too, even if this
    // particular range has zero live fragments (e.g. called defensively
    // during teardown after a splice) — it is a document-level toggle, not
    // scoped per-block, and there is at most one overlay open at a time.
    setEditMask: function (spec) {
      spec = spec || {};
      var els = blocksMatchingRange(spec.chapter, spec.range);
      for (var i = 0; i < els.length; i++) {
        if (spec.masked) els[i].classList.add('gutterpress-edit-mask');
        else els[i].classList.remove('gutterpress-edit-mask');
      }
      var root = document.documentElement;
      if (root && root.classList) {
        if (spec.masked) root.classList.add('gutterpress-edit-scroll-lock');
        else root.classList.remove('gutterpress-edit-scroll-lock');
      }
      return { count: els.length };
    },

    // Publish any debounced reader movement before a host atomically replaces
    // this frame. `silent` lets the shell relay the returned event itself so a
    // queued postMessage from the outgoing frame cannot arrive after the swap.
    flushScroll: function (silent) {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = null;
      return publishScrollPosition(true, silent === true);
    },

    // Heading tree with page + source line — powers chapter jump (UX-013), TOC,
    // minimap, scrollspy. Page math needs same-origin paged.js access, so it
    // lives here rather than being derived host-side.
    getOutline: function () {
      refreshPages();
      var hs = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
      var out = [];
      for (var i = 0; i < hs.length; i++) {
        var h = hs[i];
        var text = (h.textContent || '').trim();
        if (!text) continue;
        out.push({
          level: parseInt(h.tagName.charAt(1), 10),
          text: text,
          id: h.id || null,
          sourceLine: lineOf(h),
          chapter: chapterOf(h),
          page: pageIndexOf(h),
          index: i
        });
      }
      return out;
    },

    // Single anchored-jump primitive: target {line}|{id}|{selector}|{page}.
    // Returns the resolved {page, sourceLine}. Suppresses the scroll-driven
    // pageChanged/sourceLineChanged echo so host-driven jumps don't loop back.
    scrollTo: function (target, opts) {
      opts = opts || {};
      if (typeof target === 'number') target = { line: target };
      var el = null;
      var fraction = 0;
      var nextEl = null;
      if (target && target.line != null && target.selector == null && target.id == null && target.page == null) {
        var pos = resolveLinePosition(target);
        if (pos) {
          el = pos.el;
          if (pos.nextEl && pos.nextLine != null && pos.nextLine > pos.line) {
            nextEl = pos.nextEl;
            fraction = (Number(target.line) - pos.line) / (pos.nextLine - pos.line);
            fraction = Math.max(0, Math.min(1, fraction));
          }
        }
      } else {
        el = resolveTarget(target);
      }
      if (!el) return null;
      ignoreScrollUntil = Date.now() + 350;
      var behavior = opts.smooth ? 'smooth' : 'instant';
      el.scrollIntoView({
        behavior: fraction > 0 ? 'instant' : behavior,
        block: opts.block || 'start',
        inline: 'nearest'
      });
      if (fraction > 0 && nextEl) {
        // Interpolate within the block: nudge the scroll by the target line's
        // fractional distance between this block's top and the NEXT annotated
        // block's top. Only when the next block is genuinely lower on screen —
        // a facing-page or next-column neighbour (top <= ours) degrades to the
        // plain block-top scroll, which is the pre-existing behaviour.
        var top = el.getBoundingClientRect().top;
        var nextTop = nextEl.getBoundingClientRect().top;
        if (nextTop > top) {
          window.scrollBy({ top: fraction * (nextTop - top), behavior: behavior });
        }
      }
      var page = pageIndexOf(el);
      if (page) currentPage = page;
      if (!opts.smooth) recordVisibleSource();
      return { page: page || currentPage, sourceLine: lineOf(el) };
    },

    // Source line + page of the block at the top of the viewport (host scroll
    // position read for preview->editor sync).
    getVisibleSource: function () {
      var pos = visibleSourcePosition();
      return pos ? { sourceLine: pos.line, chapter: chapterOf(pos.el), page: pageIndexOf(pos.el) } : null;
    },

    // Generic, read-only DOM extraction. fields: 'text'|'id'|'sourceLine'|
    // 'page'|'tag'|'rectTop'|{attr:'name'}. No eval, no innerHTML — this is the
    // forward-compat hook that lets the SPA build find/figure-list/etc. with no
    // further lib change.
    queryDom: function (spec) {
      spec = spec || {};
      if (!spec.selector) return [];
      var fields = spec.fields || ['text'];
      var els;
      try { els = Array.from(document.querySelectorAll(spec.selector)); }
      catch (_e) { return []; }
      if (spec.limit && els.length > spec.limit) els = els.slice(0, spec.limit);
      return els.map(function (el) {
        var row = {};
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          if (f === 'text') row.text = (el.textContent || '').trim();
          else if (f === 'id') row.id = el.id || null;
          else if (f === 'sourceLine') row.sourceLine = lineOf(el);
          else if (f === 'page') row.page = pageIndexOf(el);
          else if (f === 'chapter') row.chapter = chapterOf(el);
          else if (f === 'tag') row.tag = el.tagName.toLowerCase();
          else if (f === 'rectTop') row.rectTop = el.getBoundingClientRect().top;
          else if (f && typeof f === 'object' && f.attr) row['attr:' + f.attr] = el.getAttribute(f.attr);
        }
        return row;
      });
    },

    // Toggle a marker class on matched elements (DOM write inside the frame).
    // spec: {line?|id?|selector?, group?, scroll?, transient?, transientMs?}.
    // Powers find-in-page, editor-cursor echo, annotations.
    highlight: function (spec) {
      spec = spec || {};
      var group = spec.group || 'default';
      var els = [];
      if (spec.selector) { try { els = Array.from(document.querySelectorAll(spec.selector)); } catch (_e) {} }
      else if (spec.id) { var byId = document.getElementById(spec.id); if (byId) els = [byId]; }
      else if (spec.line != null) { var one = resolveTarget({ line: spec.line }); if (one) els = [one]; }
      for (var i = 0; i < els.length; i++) {
        els[i].classList.add('gutterpress-hl');
        els[i].setAttribute('data-gutterpress-hl-group', group);
      }
      if (spec.scroll && els[0]) {
        ignoreScrollUntil = Date.now() + 350;
        els[0].scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
        recordVisibleSource();
      }
      if (spec.transient && els.length) {
        setTimeout(function () {
          for (var j = 0; j < els.length; j++) {
            if (els[j].getAttribute('data-gutterpress-hl-group') === group) {
              els[j].classList.remove('gutterpress-hl');
              els[j].removeAttribute('data-gutterpress-hl-group');
            }
          }
        }, spec.transientMs || 1200);
      }
      return { count: els.length };
    },

    clearHighlights: function (group) {
      var sel = group ? '.gutterpress-hl[data-gutterpress-hl-group="' + group + '"]' : '.gutterpress-hl';
      var els = Array.from(document.querySelectorAll(sel));
      for (var i = 0; i < els.length; i++) {
        els[i].classList.remove('gutterpress-hl');
        els[i].removeAttribute('data-gutterpress-hl-group');
      }
      return { cleared: els.length };
    }
  };

  window.previewAPI = api;

  // Default highlight style (preview-only; never part of the PDF build path).
  // Guarded so a minimal/headless DOM (e.g. unit-test harness) can't crash here.
  if (typeof document.createElement === 'function') {
    try {
      var hlStyle = document.createElement('style');
      hlStyle.textContent =
        '.gutterpress-hl{outline:2px solid var(--gutterpress-hl-color,#4ea1ff);outline-offset:2px;' +
        'background:var(--gutterpress-hl-bg,rgba(78,161,255,.14));' +
        'transition:outline-color .2s,background .2s;}';
      (document.head || document.documentElement).appendChild(hlStyle);
    } catch (_e) { /* non-fatal: highlight just renders unstyled */ }
  }

  // Block-overlay mask + scroll-lock style (protocol v5, plan §5.1/§5.3).
  // Preview-only, never part of the PDF build path. Purely cosmetic: dims the
  // masked fragment(s) so stale rendered text doesn't show behind/beside the
  // overlay, and disables the book document's own scroll while an overlay is
  // open (the overlay is positioned in host-SPA coordinates from a rect
  // snapshot; an unlocked scroll would silently drift it over unrelated
  // content — see BlockOverlayController). Exact visual treatment (dim vs.
  // blank) is a placeholder pending design review (plan §7.6 open item).
  if (typeof document.createElement === 'function') {
    try {
      var maskStyle = document.createElement('style');
      maskStyle.textContent =
        '.gutterpress-edit-mask{opacity:.2;filter:saturate(.4);pointer-events:none;' +
        'transition:opacity .12s,filter .12s;}' +
        'html.gutterpress-edit-scroll-lock{overflow:hidden !important;}';
      (document.head || document.documentElement).appendChild(maskStyle);
    } catch (_e) { /* non-fatal: mask just renders unstyled */ }
  }

  // Click-to-source: emit elementActivated when the user clicks a source-mapped
  // block. Never preventDefault (links/selection keep working); the host decides
  // whether to act. (ADR 0005)
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-source-line]') : null;
      if (!el) return;
      window.dispatchEvent(new CustomEvent('elementActivated', {
        detail: { sourceLine: lineOf(el), chapter: chapterOf(el), id: el.id || null, tag: el.tagName.toLowerCase() }
      }));
    }, true);

    // Context menu (protocol v4, docs/inline-editing-plan.md §3.1). Both the
    // mouse and keyboard paths dispatch the same contextMenuRequested window
    // event carrying the getContextTargetAt() payload plus the viewport
    // x/y and `via`.
    //
    // preventDefault() ONLY when kind !== 'none' — right-clicks on page
    // furniture (margin boxes, running headers, page numbers) keep native
    // behavior: that text is selectable/copyable, and killing native copy
    // with no replacement menu would be a strict regression. No event is
    // dispatched for 'none' either.
    document.addEventListener('contextmenu', function (e) {
      var detail = api.getContextTargetAt({ x: e.clientX, y: e.clientY });
      if (detail.kind === 'none') return;
      e.preventDefault();
      detail.x = e.clientX;
      detail.y = e.clientY;
      detail.via = 'mouse';
      window.dispatchEvent(new CustomEvent('contextMenuRequested', { detail: detail }));
    }, true);

    // Shift+F10 / the dedicated ContextMenu key. This listener MUST live
    // inside the book iframe: keyboard events targeted at a focused element
    // in a cross-origin iframe never reach the parent SPA, so an SPA-side
    // listener cannot implement this.
    document.addEventListener('keydown', function (e) {
      var isShiftF10 = e.shiftKey && e.key === 'F10';
      var isMenuKey = e.key === 'ContextMenu';
      if (!isShiftF10 && !isMenuKey) return;
      var anchor = keyboardAnchorPoint();
      var detail = api.getContextTargetAt({ x: anchor.x, y: anchor.y });
      detail.x = anchor.x;
      detail.y = anchor.y;
      detail.via = 'keyboard';
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('contextMenuRequested', { detail: detail }));
    }, true);
  }

  var observedPageCount = 0;
  var pageObserverQueued = false;
  function publishObservedPageCount() {
    pageObserverQueued = false;
    if (window.__PAGED_RENDERED__ === true) return;
    var count = refreshPages().length;
    if (count > observedPageCount) {
      observedPageCount = count;
      window.dispatchEvent(new CustomEvent('pageChanged', {
        detail: { currentPage: count, totalPages: count }
      }));
    }
  }
  var pageObserver = new MutationObserver(function () {
    if (window.__PAGED_RENDERED__ === true) return;
    if (pageObserverQueued) return;
    pageObserverQueued = true;
    window.requestAnimationFrame(publishObservedPageCount);
  });

  function startPageObserver() {
    var target = document.body || document.documentElement;
    if (!target) return false;
    pageObserver.observe(target, { childList: true, subtree: true });
    return true;
  }

  // The incremental page-count MutationObserver is a Paged.js-only heuristic:
  // Paged.js builds .pagedjs_page elements one at a time as it paginates, so
  // watching the DOM lets the toolbar show a growing page count before
  // PagedConfig.after fires. The native viewer lays out synchronously and
  // announces completion via 'folio:layout' (below) — no observer needed.
  if (!NATIVE_ENGINE && !startPageObserver()) {
    document.addEventListener('DOMContentLoaded', function onReady() {
      document.removeEventListener('DOMContentLoaded', onReady);
      startPageObserver();
    });
  }

  // Scroll tracking
  var scrollTimer = null;
  function publishScrollPosition(force, silent) {
    scrollTimer = null;
    var remainingGuard = ignoreScrollUntil - Date.now();
    if (!force && remainingGuard > 0) {
      scrollTimer = setTimeout(publishScrollPosition, remainingGuard);
      return null;
    }
    if (pages.length === 0) refreshPages();
    if (pages.length === 0) return null;
    var page = detectVisiblePage();
    if (page !== currentPage) {
      currentPage = page;
      if (!silent) api.notifyPageChange();
    }
    // Emit finer-grained source position for editor sync (ADR 0005).
    var pos = visibleSourcePosition();
    var sl = pos ? pos.line : null;
    var chapter = pos ? chapterOf(pos.el) : null;
    if (sl != null && (sl !== lastSourceLine || chapter !== lastSourceChapter)) {
      lastSourceLine = sl;
      lastSourceChapter = chapter;
      var detail = { sourceLine: sl, chapter: chapter, page: pageIndexOf(pos.el) };
      if (!silent) {
        window.dispatchEvent(new CustomEvent('sourceLineChanged', { detail: detail }));
      }
      return detail;
    }
    return null;
  }
  window.addEventListener('scroll', function () {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(publishScrollPosition, 150);
  });

  // Shared "pagination finished" handling for both engines: reset to page 1,
  // scroll to top, and announce completion.
  function onRenderingComplete(label) {
    // Latch: a host that attaches its 'renderingComplete' listener after the
    // event already fired (preview-shell.js binds on the iframe's `load`, which
    // the native viewer's DOMContentLoaded mount can beat) has no other way to
    // know pagination is done.
    window.__GUTTERPRESS_RENDERED__ = true;
    refreshPages();
    observedPageCount = pages.length;
    pageObserver.disconnect();
    currentPage = 1;
    ignoreScrollUntil = Date.now() + 300;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    recordVisibleSource();
    console.log(label + ' rendered ' + pages.length + ' pages');
    api.notifyRenderingComplete();
    setTimeout(api.notifyPageChange, 0);
  }

  // Paged.js calls this when rendering is complete.
  window.PagedConfig = window.PagedConfig || {};
  window.PagedConfig.after = function (flow) {
    onRenderingComplete('Paged.js');
  };

  // The Gutterpress engine viewer dispatches this when its pagination
  // completes (engine/viewer/index.ts's mount()).
  window.addEventListener('folio:layout', function () {
    if (NATIVE_ENGINE) onRenderingComplete('Gutterpress engine');
  });
})();
