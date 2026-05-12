/**
 * Dimm City runtime — browser-side helpers that run alongside Paged.js.
 *
 * Loaded via a `<script>` tag injected by dimm-city-plugin.js. Chains into
 * `window.PagedConfig.before/after` so it integrates with whatever the host
 * pipeline (print-md preview, build, etc.) already has registered.
 *
 * Currently does:
 *   - Card-split continuation markers
 *     When a `.card-fillable` skill card splits across pages, Paged.js sets
 *     `data-split-from` on continuation fragments and `data-split-to` on
 *     originating ones. We inject real DOM markers (not pseudo-elements)
 *     because augmented-ui hijacks ::before/::after on data-augmented-ui
 *     card bodies.
 *
 *   - Design guide chapter counter fix
 *     Paged.js can't propagate counter-reset on content-level divs (.chapter.*)
 *     to @page margin boxes. After layout is complete, we walk each page, read
 *     the chapter class from the page content, and inject a real DOM span with
 *     the correct "c.N" text into the margin box. A CSS rule (injected once)
 *     suppresses the ::after counter when our span is present.
 */
(function () {
  'use strict';

  // Map design guide chapter classes to their chapter numbers.
  // This determines what c.N the footer shows for design-guide-only pages.
  var GUIDE_CHAPTER_MAP = {
    'overview':      1,
    'typography':    2,
    'palette':       3,
    'components':    4,
    'dc-components': 5,
    'templates':     6,
    'layout':        7,
    'reference':     8,
    'fg-components': 9,
    'fg-examples':   10,
    'cli':           11
  };

  // Classes that suppress the chapter footer entirely (front-matter, covers, etc.)
  var NO_CHAPTER_CLASSES = ['toc', 'guide-toc', 'front-matter', 'credits', 'intro', 'page-intro', 'cover', 'back-cover', 'colophon'];

  /**
   * Find the guide chapter number for a given page element.
   * Returns null if the page is front-matter or has a known RPG chapter class.
   */
  function getGuideChapterForPage(pageEl) {
    var content = pageEl.querySelector('.pagedjs_area');
    if (!content) return null;

    // Check if this is a front-matter page (no chapter counter shown)
    for (var i = 0; i < NO_CHAPTER_CLASSES.length; i++) {
      if (content.querySelector('.' + NO_CHAPTER_CLASSES[i])) return null;
    }

    // Detect RPG chapter classes (chapter-01..05) — don't override those
    if (content.querySelector('.chapter-01, .chapter-02, .chapter-03, .chapter-04, .chapter-05')) return null;

    // Walk chapter divs and find the highest chapter number present
    // (page may straddle two chapters — use the one most recently started)
    var bestChapter = null;
    var chapterDivs = content.querySelectorAll('[class*="chapter "], [class^="chapter "]');
    // Also check direct div.chapter.X elements
    var chapterEls = content.querySelectorAll('div[class]');
    chapterEls.forEach(function (el) {
      var classes = el.className.split(/\s+/);
      // We need exactly the pattern: class list includes 'chapter' and one of our named classes
      var hasChapter = classes.indexOf('chapter') !== -1;
      if (!hasChapter) return;
      classes.forEach(function (cls) {
        if (GUIDE_CHAPTER_MAP[cls] !== undefined) {
          var num = GUIDE_CHAPTER_MAP[cls];
          if (bestChapter === null || num > bestChapter) {
            bestChapter = num;
          }
        }
      });
    });

    return bestChapter;
  }

  /**
   * Inject a CSS rule that suppresses the ::after counter on margin boxes
   * that contain our injected .guide-chapter-label span.
   */
  function injectCounterSuppressionCSS() {
    if (document.getElementById('guide-chapter-counter-css')) return;
    var style = document.createElement('style');
    style.id = 'guide-chapter-counter-css';
    // When our span exists in the margin-content, suppress the ::after counter.
    // The span IS the content; no need for the CSS counter() fallback.
    style.textContent = [
      '.pagedjs_margin-content:has(.guide-chapter-label)::after { content: none !important; }',
      '.guide-chapter-label {',
      '  display: block;',
      '  font-family: var(--font-display, "Archivo Black", sans-serif);',
      '  font-size: var(--fs-footer, 9.5pt);',
      '  letter-spacing: 0.08em;',
      '  color: var(--blood, #a30900);',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  /**
   * For each page in the design guide, determine its chapter number and
   * inject a real DOM span into the appropriate margin box so the footer
   * shows the correct "c.N" value regardless of Paged.js counter propagation.
   */
  function injectChapterCounters() {
    try {
      injectCounterSuppressionCSS();

      document.querySelectorAll('.pagedjs_page').forEach(function (pageEl) {
        var chapterNum = getGuideChapterForPage(pageEl);
        if (chapterNum === null) return;

        var isLeftPage = pageEl.classList.contains('pagedjs_left_page');
        var isRightPage = pageEl.classList.contains('pagedjs_right_page');

        // Left pages: chapter counter is on bottom-right
        // Right pages: chapter counter is on bottom-left
        var marginBox = null;
        if (isLeftPage) {
          marginBox = pageEl.querySelector('.pagedjs_margin-bottom-right .pagedjs_margin-content');
        } else if (isRightPage) {
          marginBox = pageEl.querySelector('.pagedjs_margin-bottom-left .pagedjs_margin-content');
        }

        if (!marginBox) return;
        // Don't double-inject
        if (marginBox.querySelector('.guide-chapter-label')) return;

        var span = document.createElement('span');
        span.className = 'guide-chapter-label';
        span.textContent = 'c.' + chapterNum;
        marginBox.appendChild(span);
      });
    } catch (e) {
      console.warn('[dimm-city-runtime] chapter counter injection failed:', e);
    }
  }

  function injectCardSplitMarkers() {
    try {
      document.querySelectorAll('.card-fillable[data-split-from]').forEach(function (card) {
        if (card.querySelector(':scope > .card-cont-marker')) return;
        var m = document.createElement('div');
        m.className = 'card-cont-marker';
        m.textContent = '▸ continued';
        card.insertBefore(m, card.firstChild);
      });
      document.querySelectorAll('.card-fillable[data-split-to]:not([data-split-from])').forEach(function (card) {
        if (card.querySelector(':scope > .card-fwd-marker')) return;
        var m = document.createElement('div');
        m.className = 'card-fwd-marker';
        m.textContent = '▸';
        card.appendChild(m);
      });
    } catch (e) {
      console.warn('[dimm-city-runtime] card-marker injection failed:', e);
    }
  }

  function chainAfter() {
    var prev = window.PagedConfig && window.PagedConfig.after;
    (window.PagedConfig = window.PagedConfig || {}).after = function (flow) {
      injectCardSplitMarkers();
      injectChapterCounters();
      if (typeof prev === 'function') return prev(flow);
    };
  }

  // Chain via `before()` so we capture whatever `after` handlers other
  // scripts (e.g. print-md's BreakInsideAvoidHandler) install during their
  // own `before()` pass.
  var origBefore = window.PagedConfig && window.PagedConfig.before;
  (window.PagedConfig = window.PagedConfig || {}).before = function () {
    var ret = typeof origBefore === 'function' ? origBefore() : undefined;
    chainAfter();
    return ret;
  };
})();
