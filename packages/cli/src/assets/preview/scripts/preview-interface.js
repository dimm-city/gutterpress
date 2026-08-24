// Interface adapter: exposes window.previewAPI for the parent toolbar.
//
// The Gutterpress engine viewer paginates into .gp-sheet elements (one per
// page, `dataset.page` = 1-based book page) and exposes
// window.Gutterpress.pageOf(el) (0-based); it fires 'gp:layout' when its
// pagination completes.
//
// Blocks are addressed by `{chapter, range}` (data-source-range) — see
// blocksMatchingRange below. The native viewer never clones an element across
// pages (an element that visually spans pages is still ONE element), so such a
// spec resolves to AT MOST ONE element. That is what lets in-flow editing put
// a single contenteditable on a block that spans a page break.

(function () {
  'use strict';

  var pages = [];
  var currentPage = 1;
  var debugMode = false;
  var currentViewMode = 'two-column';
  var ignoreScrollUntil = 0;
  var lastSourceLine = -1;
  var lastSourceChapter = null;
  // Find-in-book state (see previewAPI.find below).
  var findQuery = '';
  var findTotal = 0;

  function refreshPages() {
    pages = Array.from(document.querySelectorAll('.gp-sheet')).sort(function (a, b) {
      return (parseInt(a.dataset.page, 10) || 0) - (parseInt(b.dataset.page, 10) || 0);
    });
    return pages;
  }

  function clampPage(n) {
    if (pages.length === 0) return 1;
    var page = Number(n);
    if (!Number.isFinite(page)) page = 1;
    return Math.max(1, Math.min(Math.round(page), pages.length));
  }

  // The native viewer lays one CHAPTER per row (`.gp-run`), each row as
  // wide as that chapter needs — rows stack vertically, but a long chapter's
  // pages run off horizontally within its own row (viewer.css: `.gp-sheet`
  // is `left`-positioned within the row, every sheet in a row shares `top`).
  // A top-only scan can't tell two sheets in the same row apart — every one
  // of them has the same `top`, so it always resolves to the LAST sheet of
  // whichever row is vertically in view, ignoring scrollLeft entirely
  // (measured: goToPage(18/30/34) in a 34pp book all landed on page 14 —
  // row 1's last page — regardless of horizontal scroll position). Pick the
  // sheet with the GREATEST visible overlap area with the viewport — a fixed
  // reference-point distance was tried first but broke at the very end of a
  // row: the browser clamps scrollIntoView({inline:'start'}) once there's no
  // more row content to scroll past, so the last page of a short final row
  // can land mid-viewport rather than flush against any fixed point
  // (measured: goToPage(34) on a 34pp book left page 34 at ~40% visible
  // width from the left edge, so a left-edge reference point missed it and
  // matched page 33 instead, which still touched the reference point). Falls
  // back to nearest-by-distance when nothing overlaps at all (e.g. mid-scroll
  // between rows, or every sheet clipped by a shorter viewport than a page).
  function detectVisiblePage() {
    if (pages.length === 0) return 1;
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

  function scrollToCurrentPage() {
    if (pages.length === 0) return;
    var page = clampPage(currentPage);
    currentPage = page;
    ignoreScrollUntil = Date.now() + 300;
    // Native's rows can be wider than the viewport (a long chapter scrolls
    // horizontally within its own row) — align the target sheet's left edge
    // to the viewport's left edge (matching detectVisiblePage's `refX`).
    pages[page - 1].scrollIntoView({
      behavior: 'instant',
      block: 'start',
      inline: 'start'
    });
    recordVisibleSource();
  }

  function pageStep(mode) {
    return (mode || currentViewMode) === 'single' ? 1 : 2;
  }

  // ── Source-mapping helpers (ADR 0005) ──────────────────────────────────────
  // Every block element carries data-source-line (markdown-it-source-map). These
  // map rendered DOM <-> markdown source line and rendered DOM <-> page. The
  // native fragmenter MOVES elements into strips, it does not clone them, so
  // these attributes survive intact.
  function lineOf(el) {
    if (!el || !el.getAttribute) return null;
    var n = parseInt(el.getAttribute('data-source-line'), 10);
    return Number.isFinite(n) ? n : null;
  }

  function pageIndexOf(el) {
    if (!el) return 0;
    if (!window.Gutterpress || typeof window.Gutterpress.pageOf !== 'function') return 0;
    var native = window.Gutterpress.pageOf(el);
    return native >= 0 ? native + 1 : 0;
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

  function rectsOf(el) {
    var rects = el && el.getClientRects ? Array.from(el.getClientRects()) : [];
    return rects.length ? rects : [el.getBoundingClientRect()];
  }

  function visibleRectOf(el, pageRect) {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var ref = 4;
    var rects = rectsOf(el);
    var best = null;
    var bestIndex = -1;
    var bestDistance = Infinity;
    var bestArea = -1;
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      var width = Math.min(r.right, vw, pageRect ? pageRect.right : vw) -
        Math.max(r.left, 0, pageRect ? pageRect.left : 0);
      var height = Math.min(r.bottom, vh, pageRect ? pageRect.bottom : vh) -
        Math.max(r.top, 0, pageRect ? pageRect.top : 0);
      if (width <= 0 || height <= 0) continue;
      var distance = r.top <= ref && r.bottom > ref ? 0 : Math.abs(r.top - ref);
      var area = width * height;
      if (distance < bestDistance || (distance === bestDistance && area > bestArea)) {
        best = r;
        bestIndex = i;
        bestDistance = distance;
        bestArea = area;
      }
    }
    return best ? { rect: best, index: bestIndex, distance: bestDistance, area: bestArea } : null;
  }

  function rectOnPage(el, pageRect) {
    if (!pageRect) return null;
    var rects = rectsOf(el);
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      var width = Math.min(r.right, pageRect.right) - Math.max(r.left, pageRect.left);
      var height = Math.min(r.bottom, pageRect.bottom) - Math.max(r.top, pageRect.top);
      if (width > 0 && height > 0) return r;
    }
    return null;
  }

  // Find the source fragment nearest the viewport's top edge. getClientRects()
  // matters here: one source block can fragment across several printed pages.
  function topVisibleSource() {
    var blocks = sourcedBlocks();
    if (blocks.length === 0) return null;
    if (pages.length === 0) refreshPages();
    var page = pages[detectVisiblePage() - 1];
    var pageRect = page ? page.getBoundingClientRect() : null;
    var best = null, bestRect = null, bestIndex = -1, bestDistance = Infinity, bestArea = -1;
    for (var i = 0; i < blocks.length; i++) {
      var visible = visibleRectOf(blocks[i], pageRect);
      if (!visible) continue;
      if (visible.distance < bestDistance || (visible.distance === bestDistance && visible.area > bestArea)) {
        best = blocks[i];
        bestRect = visible.rect;
        bestIndex = visible.index;
        bestDistance = visible.distance;
        bestArea = visible.area;
      }
    }
    return best ? { el: best, rect: bestRect, index: bestIndex, pageRect: pageRect } : null;
  }

  function topVisibleSourceEl() {
    var source = topVisibleSource();
    return source ? source.el : null;
  }

  // {el, line} of the viewport-top source position, with the line interpolated
  // within the straddling block by the viewport top's fractional distance to the
  // next annotated block (source-map only annotates top-level blocks, so the
  // block's start line alone can be tens of lines above the visible content).
  function visibleSourcePosition() {
    var source = topVisibleSource();
    if (!source) return null;
    var el = source.el;
    var line = lineOf(el);
    if (line == null) return { el: el, rect: source.rect, index: source.index, line: null };
    var ref = 4; // same reference line as topVisibleSourceEl
    var top = source.rect.top;
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
        var nextRect = source.pageRect ? rectOnPage(blocks[i], source.pageRect) : null;
        if (!nextRect) break;
        var nextTop = nextRect.top;
        if (nextTop > top) {
          var f = Math.max(0, Math.min(1, (ref - top) / (nextTop - top)));
          line = line + Math.round(f * (nl - line));
        }
        break;
      }
    }
    return { el: el, rect: source.rect, index: source.index, line: line };
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
      index: position.index,
      top: position.rect.top,
      left: position.rect.left
    } : null;
    change();
    refreshPages();
    if (!anchor) {
      scrollToCurrentPage();
      return;
    }
    ignoreScrollUntil = Date.now() + 300;
    var rects = rectsOf(anchor.el);
    var currentRect = rects[anchor.index] || anchor.el.getBoundingClientRect();
    var delta = currentRect.top - anchor.top;
    var deltaX = currentRect.left - anchor.left;
    if (delta || deltaX) {
      window.scrollBy({ top: delta, left: deltaX, behavior: 'instant' });
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
  var LAYOUT_MARKER_CLASSES = ['chapter', 'spread', 'page', 'section', 'gp-page-break', 'gp-column-break'];

  function elementAtPoint(x, y) {
    try {
      if (typeof document.elementFromPoint === 'function') return document.elementFromPoint(x, y);
    } catch (_e) { /* unsupported host — degrade to null */ }
    return null;
  }

  // Full hit stack at a point, top-most first. Degrades to the single
  // elementFromPoint() hit on hosts without elementsFromPoint().
  function elementStackAtPoint(x, y) {
    try {
      if (typeof document.elementsFromPoint === 'function') {
        var els = document.elementsFromPoint(x, y);
        if (els && els.length) return Array.prototype.slice.call(els);
      }
    } catch (_e) { /* fall through to the single-element path */ }
    var el = elementAtPoint(x, y);
    return el ? [el] : [];
  }

  // Computed z-index as a number; NaN for 'auto'/unset/unsupported hosts
  // (NaN < 0 is false, so those never qualify as behind-layered below).
  function zIndexOf(el) {
    try {
      if (typeof window.getComputedStyle === 'function') {
        return parseFloat(window.getComputedStyle(el).zIndex);
      }
    } catch (_e) { /* unsupported host */ }
    return NaN;
  }

  // Why elementsFromPoint (plural) exists here: a `.gp-behind` image — the
  // image-properties "Layer" facet sets `z-index: -1` to paint a pinned
  // plate UNDER the page's own text (gutterpress-css.ts's depth ladder) —
  // hit-tests beneath the covering paragraph boxes and the annotated
  // `.page`/`.section` containers too, so document.elementFromPoint() can
  // NEVER return it. Every right-click used to resolve the covering element
  // instead, leaving the image's context menu unreachable at EVERY point.
  // Probe the full hit stack for the first (= top-most in paint order, so
  // the upper of two overlapping plates wins) image layered at negative z.
  // ONLY negative-z images qualify: a normally-layered image that merely
  // overlaps other content is already reachable at its uncovered points,
  // and stealing the covering content's right-clicks would invert the bug.
  // Computed style, not a `gp-behind` class test, mirrors the build-time
  // engine.layer.trapped audit — book CSS can layer an image behind with a
  // bare `z-index: -1` of its own.
  function behindImageInStack(stack) {
    for (var i = 0; i < stack.length; i++) {
      var el = stack[i];
      if (el.tagName && el.tagName.toLowerCase() === 'img' && zIndexOf(el) < 0) return el;
    }
    return null;
  }

  // The .gp-sheet whose box contains a viewport point, or null. The sheet
  // chrome lives in the hit-transparent .gp-layer (viewer.css), so it can
  // never appear in the hit stack — this is a geometric scan of the cached
  // page list (refreshPages), not a DOM hit test.
  function sheetAtPoint(x, y) {
    if (pages.length === 0) refreshPages();
    for (var i = 0; i < pages.length; i++) {
      var r = pages[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return pages[i];
    }
    return null;
  }

  // The annotated .page/.spread wrapper that OWNS a sheet: greatest
  // client-rect intersection with the sheet's box — the same rect-vs-sheet
  // resolution nativeRectsFor() uses. Null when the page has no author
  // @page/@spread wrapper (plain flowed content) — callers then keep the
  // plain hit result.
  function pageMarkerElForSheet(sheet) {
    var sheetRect = sheet.getBoundingClientRect();
    var candidates = document.querySelectorAll('.page[data-source-range], .spread[data-source-range]');
    var best = null;
    var bestArea = 0;
    for (var i = 0; i < candidates.length; i++) {
      var rects = rectsOf(candidates[i]);
      for (var j = 0; j < rects.length; j++) {
        var r = rects[j];
        var width = Math.min(r.right, sheetRect.right) - Math.max(r.left, sheetRect.left);
        var height = Math.min(r.bottom, sheetRect.bottom) - Math.max(r.top, sheetRect.top);
        var area = width > 0 && height > 0 ? width * height : 0;
        if (area > bestArea) {
          bestArea = area;
          best = candidates[i];
        }
      }
    }
    return best;
  }

  // The element getContextTargetAt() resolves the payload from. `topmostOnly`
  // (the keyboard path) skips the behind-image probe: its anchor is a
  // SYNTHETIC block-center point (keyboardAnchorPoint()), not a user-aimed
  // pointer position — probing beneath it would hijack every keyboard menu
  // on a page with a background plate.
  function contextPointEl(x, y, topmostOnly) {
    var stack = elementStackAtPoint(x, y);
    var topEl = stack.length ? stack[0] : null;
    if (topmostOnly || !topEl || !topEl.closest) return topEl;
    // The user aimed at visible interactive content — a directly-hit image
    // (an <img> only ever matches closest('img') as itself: images have no
    // descendants) or a link's own text — never probe beneath those.
    if (topEl.closest('img') || topEl.closest('a')) return topEl;
    // Margin-box furniture (running headers, page numbers) keeps its native
    // context menu even when a full-bleed plate runs beneath it — the
    // contextmenu listener's kind==='none' contract below.
    if (topEl.closest('.gp-marginbox')) return topEl;
    var behind = behindImageInStack(stack);
    if (behind) return behind;
    // Margin band (protocol v7): the point sits in a page's margin — outside
    // every author box, so nothing annotated is under it (the sheet chrome
    // and the run/strip boxes are hit-transparent viewer chrome). When the
    // point still lies inside a .gp-sheet, resolve to the annotated
    // .page/.spread that owns that sheet, so right-clicking anywhere on the
    // paper reaches the @page marker, not just the content box.
    if (!resolveAnnotatedBlock(topEl)) {
      var sheet = sheetAtPoint(x, y);
      var owner = sheet ? pageMarkerElForSheet(sheet) : null;
      if (owner) return owner;
    }
    return topEl;
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

  // The native fragmenter MOVES elements into strips rather than cloning them,
  // so there is no split-fragment marker to detect here — a block that visually
  // spans pages is still exactly one element.
  function isSplitFragment() {
    return false;
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
    var sourceOf = function (el) {
      if (!el || !el.hasAttribute || !el.hasAttribute('data-gp-source-token')) return null;
      var token = el.getAttribute('data-gp-source-token');
      var rawOccurrence = el.getAttribute('data-gp-source-occurrence');
      if (!token || !rawOccurrence) return null;
      for (var i = 0; i < rawOccurrence.length; i++) {
        if (rawOccurrence[i] < '0' || rawOccurrence[i] > '9') return null;
      }
      var occurrence = Number(rawOccurrence);
      if (!Number.isSafeInteger(occurrence)) return null;
      return {
        token: token,
        occurrence: occurrence
      };
    };
    var image = imageEl ? {
      src: imageEl.getAttribute('src'),
      alt: imageEl.getAttribute('alt'),
      source: sourceOf(imageEl)
    } : null;
    var linkEl = pointEl && pointEl.closest ? pointEl.closest('a') : null;
    var link = linkEl ? {
      href: linkEl.getAttribute('href'),
      text: (linkEl.textContent || '').trim(),
      source: sourceOf(linkEl)
    } : null;

    var block = resolveAnnotatedBlock(pointEl);

    // Secondary page-marker target (protocol v7): resolveAnnotatedBlock()
    // returns the INNERMOST annotated block, so inside a @section the
    // enclosing @page marker never wins the primary slot. Surface the
    // enclosing .page/.spread/.chapter wrapper's own marker line as a
    // secondary field — the same always-populated pattern image/link/
    // selection use — so the menu can offer "Edit page marker…" when it
    // differs from the primary target.
    var pageMarkerEl = pointEl && pointEl.closest ? pointEl.closest('.page, .spread, .chapter') : null;
    var pageMarkerRange = pageMarkerEl ? sourceRangeOf(pageMarkerEl) : null;
    var pageMarker = pageMarkerRange ? {
      chapter: chapterOf(pageMarkerEl),
      range: pageMarkerRange,
      blockTag: pageMarkerEl.tagName ? pageMarkerEl.tagName.toLowerCase() : null
    } : null;

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
      selection: selection,
      pageMarker: pageMarker
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

  // ── In-flow block editing (protocol v8) ────────────────────────────────────
  // docs/inline-editing-plan.md §3.1 / ADR 0009 decision 4 (as revised).
  //
  // The block's OWN element becomes the editing surface: its rendered HTML is
  // swapped for that block's markdown source under
  // `contenteditable="plaintext-only"`, so the caret sits in the real page, in
  // the book's own typography, and Chromium's fragmenter re-flows the pages
  // around it as the author types. This replaced a floating CodeMirror panel
  // positioned in host-SPA coordinates; `getRectsFor()`/`setEditMask()` existed
  // ONLY to serve that panel and went with it (protocol v8).
  //
  // Three properties of the native viewer are what make this work, each
  // spike-verified rather than assumed (plan §2) — under Paged.js none of them
  // held, which is why the panel existed:
  //   1. A block spanning a page break is ONE element with several client
  //      rects, so it takes ONE contenteditable and the caret crosses the
  //      break natively (ArrowDown walks into the next page).
  //   2. `white-space: pre-wrap` + `plaintext-only` round-trips multi-line
  //      markdown EXACTLY through `textContent` (lists, tables, fences); Enter
  //      inserts a real "\n" rather than a <div>/<br>, and a rich-HTML paste
  //      is stripped to text by the browser. So there is no serializer and no
  //      sanitiser here — text in, text out.
  //   3. `Gutterpress.refresh()` -> `relayout()` rebuilds the strips from
  //      scratch and re-measures, so a growing block gets a correct page
  //      count. This is MANDATORY, not cosmetic: `.gp-strip` is
  //      `column-fill: auto` and its `.gp-run` clips to the last measured page,
  //      so content that grows past that is silently invisible rather than
  //      overlapping (measured: a strip needing 2400px still clipped at its
  //      900px run width). Never mutate this DOM without scheduling a refresh.
  //
  // Nothing here writes to disk. `endBlockEdit()` hands text back and the SPA
  // decides whether it becomes a patch, behind the commit engine's clean-buffer
  // gate (ADR 0009 decision 3, unchanged).

  function rangedBlocks() {
    return Array.from(document.querySelectorAll('[data-source-range]'));
  }

  function rangedBlocksInChapter(chapter) {
    if (!chapter) return rangedBlocks();
    return rangedBlocks().filter(function (el) { return chapterOf(el) === chapter; });
  }

  // The native viewer never clones, so a `{chapter, range}` spec resolves to AT
  // MOST ONE element — this returns an array only because callers still guard
  // on emptiness (a range that no longer matches anything: block deleted or
  // moved since the target was captured).
  function blocksMatchingRange(chapter, range) {
    if (!range) return [];
    return rangedBlocksInChapter(chapter).filter(function (el) {
      var r = sourceRangeOf(el);
      return r && r[0] === range[0] && r[1] === range[1];
    });
  }

  // Re-pagination debounce while typing. Tuned by measurement, not taste:
  // `relayout()` costs "the same order as mount (tens of ms on a real book)"
  // per fragment.ts, so it cannot run per keystroke on a long book.
  var EDIT_REFRESH_MS = 120;

  // The one live edit, or null. At most one at a time — `beginBlockEdit`
  // commits any predecessor before opening (an author double-clicking straight
  // from one block to another must not silently drop the first edit).
  var edit = null;
  var editRefreshTimer = null;

  function scheduleEditRefresh() {
    if (editRefreshTimer !== null) clearTimeout(editRefreshTimer);
    editRefreshTimer = setTimeout(function () {
      editRefreshTimer = null;
      repaginate();
    }, EDIT_REFRESH_MS);
  }

  function repaginate() {
    if (!window.Gutterpress || typeof window.Gutterpress.refresh !== 'function') return;
    try {
      window.Gutterpress.refresh();
    } catch (_e) {
      // A refresh failure must not trap the author inside a broken edit; the
      // authoritative render still arrives on commit.
    }
    // The strips are rebuilt, so cached sheet nodes are stale.
    pages = [];
  }

  // Place the caret from the click point, on the SOURCE text now in the box.
  // Approximate by construction (the point was measured against the RENDERED
  // text) and that is fine — it puts the caret near what the author aimed at,
  // which is the whole affordance. Falls back to end-of-block.
  function placeCaret(el, point) {
    var range = null;
    if (point && typeof document.caretRangeFromPoint === 'function') {
      try {
        var hit = document.caretRangeFromPoint(point.x, point.y);
        if (hit && el.contains(hit.startContainer)) range = hit;
      } catch (_e) { /* fall through to end-of-block */ }
    }
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    try {
      var sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
      if (!sel) return;
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_e) {
      // Focus is already set, so the box is usable even if seating the caret
      // failed (a detached selection, a host without Selection support). The
      // author clicks once more; nothing is lost.
    }
  }

  function finishEdit(commit, notify) {
    if (!edit) return { ended: false, text: null, commit: false };
    if (editRefreshTimer !== null) {
      clearTimeout(editRefreshTimer);
      editRefreshTimer = null;
    }
    var el = edit.el;
    var text = el.textContent || '';
    var done = { ended: true, text: text, commit: commit === true, chapter: edit.chapter, range: edit.range };

    // Restore the rendered HTML on BOTH paths. On cancel it is the final
    // state; on commit it avoids showing raw markdown for the ~500ms until the
    // authoritative re-render swaps the frame.
    el.removeAttribute('contenteditable');
    if (edit.hadWhiteSpace) el.style.whiteSpace = edit.whiteSpace;
    else el.style.removeProperty('white-space');
    if (!el.getAttribute('style')) el.removeAttribute('style');
    el.classList.remove('gutterpress-editing');
    el.innerHTML = edit.html;
    el.removeEventListener('input', onEditInput);
    el.removeEventListener('blur', onEditBlur);
    edit = null;
    repaginate();

    if (notify) {
      window.dispatchEvent(new CustomEvent('blockEditFinished', { detail: done }));
    }
    // ALWAYS emitted, on both paths, unlike blockEditFinished above — the
    // shell holds hot-reload swaps on this and a missed close would freeze the
    // preview until the next manual action.
    window.dispatchEvent(new CustomEvent('blockEditStateChanged', { detail: { open: false } }));
    return done;
  }

  function onEditInput() {
    scheduleEditRefresh();
  }

  function onEditBlur() {
    // Losing focus commits (the same rule the panel used): an author who
    // clicks away has finished with this block, and silently discarding their
    // typing is the worst outcome available. Deferred a tick so a click that
    // moves focus INSIDE the same box (or a synchronous re-focus) does not
    // register as leaving.
    var target = edit;
    setTimeout(function () {
      if (!edit || edit !== target) return;
      if (document.activeElement === edit.el || edit.el.contains(document.activeElement)) return;
      finishEdit(true, true);
    }, 0);
  }

  function startEdit(spec) {
    var el = blocksMatchingRange(spec.chapter, spec.range)[0] || null;
    if (!el) return { ok: false, reason: 'unresolved' };
    if (edit) finishEdit(true, true);

    var style = el.style;
    edit = {
      el: el,
      chapter: spec.chapter,
      range: spec.range,
      html: el.innerHTML,
      hadWhiteSpace: !!style.whiteSpace,
      whiteSpace: style.whiteSpace
    };
    // pre-wrap is load-bearing, not cosmetic: without it the source's newlines
    // collapse and a multi-line block (list, table, fence) is unreadable AND
    // uneditable line-by-line.
    style.whiteSpace = 'pre-wrap';
    el.classList.add('gutterpress-editing');
    el.setAttribute('contenteditable', 'plaintext-only');
    el.textContent = typeof spec.text === 'string' ? spec.text : '';
    el.addEventListener('input', onEditInput);
    el.addEventListener('blur', onEditBlur);
    // Focus and caret seating are best-effort. A throw here must not escape:
    // the edit state is already installed, so an exception would leave the
    // block stuck in editing mode with the host believing nothing opened.
    try {
      el.focus({ preventScroll: true });
    } catch (_e) {
      try { el.focus(); } catch (_e2) { /* unfocusable host; the box still edits */ }
    }
    placeCaret(el, spec.caret);
    // The swap from rendered HTML to source text changes the block's extent
    // immediately, so pagination is already stale before a single keystroke.
    repaginate();
    window.dispatchEvent(new CustomEvent('blockEditStateChanged', { detail: { open: true } }));
    return { ok: true };
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
      var width = page.offsetWidth;
      if (currentViewMode !== 'single') {
        var runs = Array.from(document.querySelectorAll('.gp-run'));
        for (var i = 0; i < runs.length; i++) {
          var gap = parseFloat(getComputedStyle(runs[i]).getPropertyValue('--gp-sheet-gap')) || 0;
          var runSheets = Array.from(runs[i].querySelectorAll('.gp-sheet'));
          if (runSheets.length) {
            var left = 0;
            var right = page.offsetWidth;
            for (var j = 0; j < runSheets.length; j++) {
              left = Math.min(left, runSheets[j].offsetLeft || 0);
              right = Math.max(right, (runSheets[j].offsetLeft || 0) + (runSheets[j].offsetWidth || 0));
            }
            width = Math.max(width, right - left);
          } else {
            width = Math.max(width, Math.max(0, (runs[i].offsetWidth || 0) - gap));
          }
        }
      }
      return {
        width: width,
        height: page.offsetHeight,
        // The host iframe's clientWidth includes this document's vertical
        // scrollbar. Report the actual layout viewport so fit-width can center
        // within the pixels available to the book.
        viewportWidth: document.documentElement.clientWidth
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
        // `pageStep()` above makes next/prevPage step by 1 or 2 book pages.
        // `setSpread()` does the real relayout: `column-wrap: wrap` wraps each
        // chapter's columns into a 2-column grid so content, not just sheet
        // chrome, actually moves into pairs — see fragment.ts's
        // `applySpreadMode`, which no-ops to single-row where CSS
        // `column-wrap`/`column-height` are unavailable (Chromium < 145).
        // The guard below is a LIB-version check, not a browser one: a
        // hot-updated shell may be paired with an older bundled viewer.
        if (window.Gutterpress && typeof window.Gutterpress.setSpread === 'function') {
          window.Gutterpress.setSpread(currentViewMode !== 'single');
        }
      });
      if (!silent) return api.notifyPageChange();
    },
    setZoom: function (z, silent) {
      preserveViewport(function () {
        // Embedded previews have one zoom owner. Clear the standalone
        // viewer's narrow-screen fit before applying the host scale.
        document.body.style.removeProperty('--gutterpress-fit-zoom');
        document.documentElement.style.setProperty('--gutterpress-zoom', z);
      });
      if (!silent) api.notifyPageChange();
    },
    toggleDebugMode: function () {
      debugMode = !debugMode;
      document.body.classList.toggle('debug', debugMode);
      if (window.Gutterpress && window.Gutterpress.decoration) {
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
    // (the native viewer never mints a ref — it never clones).
    // v7: getContextTargetAt() gained the `pageMarker` secondary field (the
    // enclosing .page/.spread/.chapter marker) and the margin-band fallback
    // (a point inside a .gp-sheet but outside every author box resolves to
    // the sheet's owning .page/.spread). An older SPA simply ignores the
    // extra field; a newer SPA feature-detects by the field's presence.
    // v8: in-flow block editing. ADDED beginBlockEdit()/endBlockEdit() and the
    // blockEditRequested/blockEditFinished/blockEditStateChanged events;
    // REMOVED getRectsFor() and
    // setEditMask(), which existed only to place and de-clutter behind the
    // floating edit panel this replaces. A v8 lib with a pre-v8 SPA loses the
    // "Edit this block" action and nothing else; a v8 SPA feature-detects on
    // the version before offering it.
    getProtocolVersion: function () { return 8; },

    // Resolve the annotated element/selection at a viewport point (protocol
    // v4). Pure read; see buildContextTarget() above for the full contract.
    // Point resolution prefers a behind-layered (negative z-index) image the
    // top-most hit covers — see contextPointEl(); `spec.topmostOnly` opts a
    // synthetic-anchor caller (the keyboard listener) out of that probe.
    getContextTargetAt: function (spec) {
      spec = spec || {};
      return buildContextTarget(contextPointEl(spec.x, spec.y, spec.topmostOnly));
    },

    // Open the in-flow editor on one block (protocol v8). `text` is that
    // block's markdown source, read SPA-side from the authoritative buffer —
    // this function never derives source from the DOM. `caret` is the optional
    // viewport point to seat the caret near. Returns
    // `{ok: false, reason: 'unresolved'}` when the range no longer matches a
    // live block, so the SPA can drop the request instead of hanging.
    beginBlockEdit: function (spec) {
      spec = spec || {};
      return startEdit(spec);
    },

    // Close it and hand back the current text (protocol v8). Idempotent:
    // `{ended: false}` when nothing is open. The SPA calls this to force an end
    // it initiated (a dialog opening over the workspace); ends the author
    // initiates from inside the book — Escape, Cmd/Ctrl+Enter, blur — arrive
    // as the `blockEditFinished` event instead, so a keystroke the SPA cannot
    // see still resolves the edit. Both paths restore the rendered HTML.
    endBlockEdit: function (spec) {
      spec = spec || {};
      return finishEdit(spec.commit !== false, false);
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
    // minimap, scrollspy. Page math needs same-origin engine access, so it
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
      if (pages.length === 0) refreshPages();
      var pos = visibleSourcePosition();
      return pos ? { sourceLine: pos.line, chapter: chapterOf(pos.el), page: detectVisiblePage() } : null;
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

    // ── Find in book (the app's Ctrl+F) ─────────────────────────────────
    // window.find() runs inside THIS frame, so it can only ever match book
    // content — never the app's toolbar chrome or the editor. Each call with
    // the same query advances the native selection (wrapping at the ends)
    // and Chromium scrolls the match into view; a NEW query restarts from
    // the top and counts total occurrences once (case-insensitive).
    find: function (query, backwards) {
      query = String(query == null ? '' : query);
      if (!query) return api.clearFind();
      if (query !== findQuery) {
        findQuery = query;
        var text = (document.body.textContent || '').toLowerCase();
        var needle = query.toLowerCase();
        findTotal = 0;
        var idx = 0;
        while (findTotal < 10000) {
          idx = text.indexOf(needle, idx);
          if (idx === -1) break;
          findTotal++;
          idx += needle.length;
        }
        var sel = window.getSelection();
        if (sel) sel.removeAllRanges();
      }
      var found = false;
      try {
        found = window.find(query, false, !!backwards, true, false, false, false);
      } catch (_e) {
        found = false;
      }
      return { found: !!found, total: findTotal };
    },

    clearFind: function () {
      findQuery = '';
      findTotal = 0;
      var sel = window.getSelection();
      if (sel) sel.removeAllRanges();
      return { found: false, total: 0 };
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

  // In-flow editing style (protocol v8, plan §3.1).
  // Preview-only, never part of the PDF build path. Marks the block being
  // edited without moving it: `outline` and `box-shadow` are chosen because
  // they take NO space in layout — a border or padding here would change the
  // block's extent and repaginate the book on entering edit mode, which is
  // exactly the divergence this project cares most about. Nothing in this
  // rule may become layout-affecting.
  //
  // No scroll lock and no dimming of the surrounding page: the caret is in the
  // flow now, so the page can scroll freely and the neighbouring text stays
  // legible while the author works. Both existed only to prop up the floating
  // panel this replaced. Exact visual treatment is a design-review item
  // (plan §6), same as the mask treatment was.
  if (typeof document.createElement === 'function') {
    try {
      var editStyle = document.createElement('style');
      editStyle.textContent =
        '.gutterpress-editing{outline:2px solid Highlight;outline-offset:2px;' +
        'box-shadow:0 0 0 2px color-mix(in srgb, Highlight 25%, transparent);' +
        'border-radius:2px;caret-color:currentColor;}' +
        '.gutterpress-editing:focus{outline-style:solid;}';
      (document.head || document.documentElement).appendChild(editStyle);
    } catch (_e) { /* non-fatal: the edit box just renders unmarked */ }
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
      // Inside the live in-flow editor the native menu is the useful one
      // (cut/copy/paste on the source text). Ours offers block actions that
      // make no sense mid-edit.
      if (edit && edit.el.contains(e.target)) return;
      var detail = api.getContextTargetAt({ x: e.clientX, y: e.clientY });
      if (detail.kind === 'none') return;
      e.preventDefault();
      detail.x = e.clientX;
      detail.y = e.clientY;
      detail.via = 'mouse';
      window.dispatchEvent(new CustomEvent('contextMenuRequested', { detail: detail }));
    }, true);

    // Double-click to edit (protocol v8, plan §6). The SECOND entry point
    // alongside the context menu's "Edit this block" — both land on the same
    // SPA handler, which reads the source slice and calls beginBlockEdit().
    // Requesting rather than starting is deliberate: only the SPA can read the
    // authoritative buffer, so the book document never sources its own text.
    //
    // Bails while an edit is live so a double-click INSIDE the box keeps its
    // native meaning (select word). Never preventDefault: on a block that does
    // not resolve, double-click must keep selecting text as it always has.
    document.addEventListener('dblclick', function (e) {
      if (edit) return;
      var el = e.target && e.target.closest ? e.target.closest('[data-source-range]') : null;
      if (!el) return;
      var range = sourceRangeOf(el);
      var chapter = chapterOf(el);
      if (!range || !chapter) return;
      window.dispatchEvent(new CustomEvent('blockEditRequested', {
        detail: { chapter: chapter, range: range, x: e.clientX, y: e.clientY, via: 'dblclick' }
      }));
    }, true);

    // Edit-mode keys. These MUST live inside the book iframe for the same
    // physical reason the Shift+F10 listener below does: the caret is in a
    // cross-origin document, so its keystrokes never reach the SPA.
    // Cmd/Ctrl+Enter commits (Enter alone is a newline — a markdown block can
    // be multi-line); Escape cancels and restores.
    document.addEventListener('keydown', function (e) {
      if (!edit) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finishEdit(false, true);
        return;
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        finishEdit(true, true);
      }
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
      // topmostOnly: the anchor is a synthetic block-center point, so the
      // behind-image probe must not run — see contextPointEl().
      var detail = api.getContextTargetAt({ x: anchor.x, y: anchor.y, topmostOnly: true });
      detail.x = anchor.x;
      detail.y = anchor.y;
      detail.via = 'keyboard';
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('contextMenuRequested', { detail: detail }));
    }, true);
  }

  // Scroll tracking
  var scrollTimer = null;
  var viewportFrame = null;
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
      var detail = { sourceLine: sl, chapter: chapter, page: page };
      if (!silent) {
        window.dispatchEvent(new CustomEvent('sourceLineChanged', { detail: detail }));
      }
      return detail;
    }
    return null;
  }
  function scheduleViewportChanged() {
    if (!viewportFrame) {
      var schedule = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : function (fn) { return setTimeout(fn, 0); };
      viewportFrame = schedule(function () {
        viewportFrame = null;
        window.dispatchEvent(new CustomEvent('viewportChanged', { detail: {} }));
      });
    }
  }
  window.addEventListener('scroll', function () {
    scheduleViewportChanged();
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(publishScrollPosition, 150);
  });
  window.addEventListener('resize', scheduleViewportChanged);

  // Reset to page 1, scroll to top, and announce completion once the native
  // viewer's pagination finishes.
  function onRenderingComplete() {
    // Latch: a host that attaches its 'renderingComplete' listener after the
    // event already fired (preview-shell.js binds on the iframe's `load`, which
    // the native viewer's DOMContentLoaded mount can beat) has no other way to
    // know pagination is done.
    window.__GUTTERPRESS_RENDERED__ = true;
    refreshPages();
    currentPage = 1;
    ignoreScrollUntil = Date.now() + 300;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    recordVisibleSource();
    console.log('Gutterpress engine rendered ' + pages.length + ' pages');
    api.notifyRenderingComplete();
    setTimeout(api.notifyPageChange, 0);
  }

  // The Gutterpress engine viewer dispatches this when its pagination
  // completes (engine/viewer/index.ts's mount()).
  window.addEventListener('gp:layout', onRenderingComplete);
})();
