/**
 * Dimm City Field Guide — Server-Side Only Plugin for print-md
 *
 * IMPORTANT: This plugin only transforms content marked with special markers.
 * Regular markdown content passes through unchanged.
 *
 * MARKERS (support optional key="value" attributes):
 *   @sidebar            → Start a dc-sidebar wrapper
 *   @end-sidebar        → End sidebar wrapper
 *   @specialty          → Start a specialty section (auto-closes any prior specialty,
 *                          learning-path, or skill so each chapter-02 file can open
 *                          cleanly without legacy fenced-div containers)
 *   @end-specialty      → Manually end a specialty section
  *   @sidebar-box        → Start a dc-sidebar-box wrapper
  *   @end-sidebar-box    → End sidebar-box wrapper
 *   @definition         → Start a dc-definition-block wrapper
 *   @end-definition     → End definition wrapper
 *   @procedure          → Start a dc-steps procedure wrapper
 *   @end-procedure      → End procedure wrapper
 *   @learning-path      → Start a learning path section (auto-closes previous sections)
 *   @end-learning-path  → Manually end a learning path section
 *   @skill              → Start skill cards section (auto-closes previous sections)
 *   @end-skill          → End skill transformation mode
 *
 * SKILL VARIANTS:
 *   Use variant="N" to select a preset style (1-5):
 *
 *   @skill variant="1"  (default)
 *   @skill variant="2"  (sharp angular)
 *   @skill variant="3"  (asymmetric tech)
 *   @skill variant="4"  (rounded soft)
 *   @skill variant="5"  (scooped futuristic)
 *
 * ATTRIBUTE SUPPORT:
 *   Markers can include key="value", key='value', or key=value pairs:
 *
 *   @learning-path data-foo="bar"
 *     → <section class="dc-learning-path dc-path-block" data-foo="bar">
 *
 *   @skill id="my-skill" data-category="combat"
 *     → Extra attributes added to skill-card wrapper
 *
 *   @skill variant="2" {.pain-compliance}
 *     → <div class="dc-skill-card pain-compliance" ...>
 *
 *   @learning-path {.custom-path}
 *     → <section class="dc-learning-path dc-path-block custom-path" ...>
 *
 * LEARNING PATH FORMAT:
 *   @learning-path
 *   ### Title
 *   > Subtitle/description
 *   - Skill A
 *   - Skill B
 *   - Skill C
 *
 * SKILL FORMAT:
 *   @skill
 *   #### Skill Name
 *   > Flavor text
 *   1. **0 AP** *Ability Name:* Description
 *   2. **2 AP** *Another:* Description
 *   ##### Outcomes (optional sub-header)
 *   | Roll | Outcome |
 *   | --- | --- |
 *   | 20 | Critical |
 *
 * Auto-closes at: EOF, @end-skill, @end-learning-path, @learning-path, or @skill
 */

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function makeToken(type, content, nesting) {
  return {
    type: type,
    tag: '',
    nesting: nesting || 0,
    attrs: null,
    map: null,
    level: 0,
    children: null,
    content: typeof content === 'string' ? content : '',
    markup: '',
    info: '',
    meta: null,
    block: true,
    hidden: false,
    attrSet: function(name, value) {
      if (!this.attrs) this.attrs = [];
      const idx = this.attrIndex(name);
      if (idx < 0) {
        this.attrs.push([name, value]);
      } else {
        this.attrs[idx][1] = value;
      }
    },
    attrIndex: function(name) {
      if (!this.attrs) return -1;
      for (let j = 0; j < this.attrs.length; j++) {
        if (this.attrs[j][0] === name) return j;
      }
      return -1;
    }
  };
}

function parseSkillTitle(text) {
  // Parse "Skill Name" or "Skill Name | T0" or "Skill Name | T0 | highlight"
  const parts = text.split('|');
  const name = parts[0].trim();
  const tier = parts.length > 1 ? parts[1].trim() : '';
  const flags = parts.slice(2).map(f => f.trim().toLowerCase());
  const highlight = flags.includes('highlight');
  return { name, tier, highlight };
}

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function specialtyCodeFromClass(className) {
  const classList = (className || '').split(/\s+/).filter(Boolean);
  const specialtyMap = {
    augmerc: 'AUG',
    proxy: 'PRX',
    streetwarden: 'STW',
    gutterdruid: 'GDR',
    cybersurgeon: 'CBS',
    wirephreak: 'WPH',
    technosorcerer: 'TNS',
    etherlock: 'ETH',
  };

  for (const cls of classList) {
    if (specialtyMap[cls]) return specialtyMap[cls];
  }

  return 'PATH';
}

/**
 * Skill card variants are now controlled by the .specialty.<name> parent
 * container (CSS parent-selector model). The variant= attribute on @skill,
 * @continue, and @learning-path has been removed. No SKILL_VARIANTS map.
 */

function buildStickerChain(items) {
  let html = '<div class="dc-stickers">';
  items.forEach((name, i) => {
    const cls = 'dc-sticker' + (i === 0 ? ' active' : '');
    html += '<span class="' + cls + '"><span class="dc-sticker-ref">' + esc(String(i + 1)) + '</span>' + esc(name.trim()) + '</span>';
    if (i < items.length - 1) {
      html += '<span class="dc-arrow">»</span>';
    }
  });
  html += '</div>\n';
  return html;
}

function processRollDie(html) {
  return html.replace(/\*\*ROLL THE DIE!\*\*/g, '<span class="scream">ROLL THE DIE!</span>')
             .replace(/ROLL THE DIE!/g, '<span class="scream">ROLL THE DIE!</span>');
}

function renderInlineChildren(inlineTok, md) {
  if (!inlineTok || !inlineTok.children) return esc(inlineTok.content || '');
  return md.renderer.render(inlineTok.children, md.options, {});
}

function collectTableTokens(tokens, start) {
  const result = [];
  let depth = 0;
  for (let i = start; i < tokens.length; i++) {
    result.push(tokens[i]);
    if (tokens[i].type === 'table_open') depth++;
    if (tokens[i].type === 'table_close') {
      depth--;
      if (depth === 0) break;
    }
  }
  return result;
}

function skipToTableClose(tokens, start) {
  for (let i = start; i < tokens.length; i++) {
    if (tokens[i].type === 'table_close') return i;
  }
  return tokens.length - 1;
}

function getTableHeaders(tableTokens) {
  const headers = [];
  let inHead = false;
  for (let i = 0; i < tableTokens.length; i++) {
    if (tableTokens[i].type === 'thead_open') inHead = true;
    if (tableTokens[i].type === 'thead_close') break;
    if (inHead && tableTokens[i].type === 'inline') {
      headers.push(tableTokens[i].content.toLowerCase().trim());
    }
  }
  return headers;
}

function classifyTable(headers) {
  if (headers.includes('roll') && headers.includes('outcome')) {
    return 'outcomes';
  }
  if (headers.includes('distance')) {
    return 'distance';
  }
  return '';
}

function getRollTier(text) {
  const clean = text.replace(/[\u2013\u2014]/g, '-').trim();
  if (clean === '20') return 'crit';
  if (clean === '1') return 'fail';
  // Handle ranges like "11 - 19" or "11-19"
  const rangeMatch = clean.match(/^(\d+)/);
  if (rangeMatch) {
    const n = parseInt(rangeMatch[1], 10);
    if (n >= 11) return 'hit';
    if (n >= 6) return 'mixed';
    if (n >= 2) return 'miss';
  }
  return 'hit';
}

function buildOutcomesBlock(rows, md, needsAvoid = true) {
  // data-break-inside="avoid" is added when the parent card can be split (has
  // allow-split) — the polyfill needs this to keep the
  // outcomes table together when the card itself isn't protected. When the card
  // already has data-break-inside="avoid" (non-splittable cards), adding a
  // nested avoid creates a conflicting inner break that the polyfill resolves
  // by splitting the card at the outcomes boundary, leaving a headless
  // card-body on one page and the outcomes-only continuation on the next.
  const avoidAttr = needsAvoid ? ' data-break-inside="avoid"' : '';
  let html = '<div class="dc-outcomes"' + avoidAttr + '>\n';
  html += '  <div class="dc-outcomes-label">Outcomes</div>\n';

  rows.forEach(row => {
    if (row.length < 2) return;
    const rollVal = row[0].trim();
    const outcomeText = row[1].trim();
    const tier = getRollTier(rollVal);

    // Render markdown inline content (e.g., **bold**, *italic*)
    const renderedOutcome = md.renderInline(outcomeText);

    const outcomeNameMap = {
      crit: 'Crit',
      hit: 'Hit',
      mixed: 'Hard Choice',
      miss: 'Miss',
      fail: 'Catastrophe',
    };

    html += '  <div class="dc-outcome-row ' + tier + '">\n';
    html += '    <span class="dc-outcome-key tier-' + tier + '"><span class="dc-outcome-name">' + outcomeNameMap[tier] + '</span><span class="dc-outcome-roll">' + esc(rollVal) + '</span></span>\n';
    html += '    <span class="dc-outcome-text">' + renderedOutcome + '</span>\n';
    html += '  </div>\n';
  });

  html += '</div>\n';
  return html;
}

function buildDistanceTags(rows, md) {
  let html = '<div class="dc-sub-header">AP Cost × Distance</div>\n';
  html += '<div class="dc-distance-tags">\n';

  rows.forEach(row => {
    if (row.length < 2) return;
    const distance = row[0].trim();
    const cost = row[1].trim();

    // Render markdown inline content
    const renderedDistance = md.renderInline(distance);
    const renderedCost = md.renderInline(cost);

    html += '  <span class="dc-dist-tag">\n';
    html += '    <span class="dc-dist-ap">' + renderedCost + '</span>\n';
    html += '    <span class="dc-dist-name">' + renderedDistance + '</span>\n';
    html += '  </span>\n';
  });

  html += '</div>\n';
  return html;
}

function buildTable(tableTokens, tableClass, md, needsAvoid = true) {
  const rows = [];
  let currentRow = [];
  let inBody = false;

  for (let i = 0; i < tableTokens.length; i++) {
    const t = tableTokens[i];
    if (t.type === 'tbody_open') inBody = true;
    if (t.type === 'tbody_close') inBody = false;
    if (t.type === 'tr_open' && inBody) currentRow = [];
    if (t.type === 'tr_close' && inBody) {
      rows.push(currentRow);
    }
    if (t.type === 'td_open' && inBody) {
      const contentTok = tableTokens[i + 1];
      if (contentTok && contentTok.type === 'inline') {
        currentRow.push(contentTok.content);
      }
    }
  }

  if (tableClass === 'outcomes') {
    return buildOutcomesBlock(rows, md, needsAvoid);
  } else if (tableClass === 'distance') {
    return buildDistanceTags(rows, md);
  }

  // Fallback: render as simple table with inline markdown support
  let html = '<table>\n<tbody>\n';
  rows.forEach(row => {
    html += '<tr>';
    row.forEach(cell => {
      html += '<td>' + md.renderInline(cell) + '</td>';
    });
    html += '</tr>\n';
  });
  html += '</tbody>\n</table>\n';
  return html;
}

// Parse ability from list item - handles rendered HTML: "<strong>0 AP</strong> <em>Name:</em> Description"
function parseAbilityFromListItem(html) {
  // Match <strong>N AP</strong> or <strong>N-X AP</strong> at the start (rendered HTML)
  const apMatch = html.match(/^\s*<strong>([^<]+)<\/strong>\s*/i);
  if (!apMatch) return null;

  let apVal = apMatch[1].trim();
  // Normalize: ensure "AP" suffix
  if (!apVal.toUpperCase().includes('AP')) {
    apVal = apVal + ' AP';
  }

  const rest = html.slice(apMatch[0].length);

  // Determine AP class
  let apClass = 'dc-ap';
  if (apVal === '0 AP' || apVal === '0AP') apClass += ' free';
  else if (apVal.includes('-') || apVal.toUpperCase().includes('X')) apClass += ' variable';

  return {
    apVal: apVal,
    apClass: apClass,
    text: rest
  };
}

function admonitionRule(state, startLine, endLine, silent) {
  const pos = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];

  if (max - pos < 4) return false;
  if (state.src.charCodeAt(pos) !== 0x21 ||
      state.src.charCodeAt(pos + 1) !== 0x21 ||
      state.src.charCodeAt(pos + 2) !== 0x21) {
    return false;
  }

  if (silent) return true;

  const label = state.src.slice(pos + 3, max).trim();

  let nextLine = startLine + 1;
  const contentLines = [];
  while (nextLine < endLine) {
    const lS = state.bMarks[nextLine] + state.tShift[nextLine];
    const lE = state.eMarks[nextLine];
    const line = state.src.slice(lS, lE);
    if (line.trim() === '') break;
    if (line.trimStart().startsWith('!!!')) break;
    if (line.trimStart().startsWith('# ')) break;
    if (/^-{3,}\s*$/.test(line.trim())) break;
    contentLines.push(line);
    nextLine++;
  }

  let tok = state.push('admonition_open', 'div', 1);
  tok.attrSet('class', 'dc-alert dc-dm-note');
  tok.block = true;
  tok.map = [startLine, nextLine];

  tok = state.push('html_block', '', 0);
  tok.content = '<strong class="dc-alert-label">' + esc(label) + '</strong>\n';
  tok.block = true;

  if (contentLines.length > 0) {
    tok = state.push('paragraph_open', 'p', 1);
    tok.map = [startLine + 1, nextLine];
    tok = state.push('inline', '', 0);
    tok.content = contentLines.join(' ');
    tok.map = [startLine + 1, nextLine];
    tok.children = [];
    state.push('paragraph_close', 'p', -1);
  }

  state.push('admonition_close', 'div', -1);
  state.line = nextLine;
  return true;
}

// Parse key="value", key='value', key=value, and {.class #id} attribute pairs from a string
function parseAttrs(str) {
  const attrs = {};
  // Match {.class1 .class2 #id} blocks (markdown-it attr style)
  const braceRegex = /\{([^}]+)\}/g;
  let match;
  while ((match = braceRegex.exec(str)) !== null) {
    const inside = match[1].trim();
    const parts = inside.split(/\s+/);
    const classes = [];
    for (const part of parts) {
      if (part.startsWith('.')) {
        classes.push(part.slice(1));
      } else if (part.startsWith('#')) {
        attrs['id'] = part.slice(1);
      }
    }
    if (classes.length > 0) {
      attrs['class'] = (attrs['class'] ? attrs['class'] + ' ' : '') + classes.join(' ');
    }
  }
  // Strip brace blocks before parsing key=value pairs
  const strNoBraces = str.replace(/\{[^}]+\}/g, '');
  // Match key="value" or key='value' (quoted)
  const quotedRegex = /(\S+?)=["']([^"']*?)["']/g;
  while ((match = quotedRegex.exec(strNoBraces)) !== null) {
    attrs[match[1]] = match[2];
  }
  // Match key=value (unquoted, no spaces in value)
  const unquotedRegex = /(\S+?)=(\S+)/g;
  while ((match = unquotedRegex.exec(strNoBraces)) !== null) {
    // Only add if not already set by quoted regex (quoted takes precedence)
    if (!(match[1] in attrs)) {
      // Strip any quotes that might have been partially matched
      const val = match[2].replace(/^["']|["']$/g, '');
      attrs[match[1]] = val;
    }
  }
  return attrs;
}

// Check if a paragraph contains a marker and extract any attributes
// Returns { matched: true, attrs: {...} } or { matched: false }
function parseMarker(tok, tokens, i, marker) {
  if (tok.type !== 'paragraph_open') return { matched: false };
  const inline = tokens[i + 1];
  if (!inline || inline.type !== 'inline') return { matched: false };

  const content = inline.content.trim();

  // Exact match (no attributes)
  if (content === marker) {
    return { matched: true, attrs: {} };
  }

  // Check if starts with marker followed by space
  if (content.startsWith(marker + ' ')) {
    const rest = content.slice(marker.length + 1).trim();
    return { matched: true, attrs: parseAttrs(rest) };
  }

  return { matched: false };
}

// Legacy helper for simple marker checks (no attrs needed)
function isMarker(tok, tokens, i, marker) {
  return parseMarker(tok, tokens, i, marker).matched;
}


// Collect bullet list items
function collectBulletListItems(tokens, startIndex) {
  const items = [];
  let i = startIndex;

  // Find bullet_list_open
  while (i < tokens.length && tokens[i].type !== 'bullet_list_open') {
    i++;
  }
  if (i >= tokens.length) return { items: [], endIndex: startIndex };

  i++; // Skip bullet_list_open

  while (i < tokens.length && tokens[i].type !== 'bullet_list_close') {
    if (tokens[i].type === 'list_item_open') {
      // Find the inline content
      let j = i + 1;
      while (j < tokens.length && tokens[j].type !== 'list_item_close') {
        if (tokens[j].type === 'inline') {
          items.push(tokens[j].content);
        }
        j++;
      }
      i = j;
    }
    i++;
  }

  return { items: items, endIndex: i };
}

// Collect ordered list items for abilities
function collectOrderedListItems(tokens, startIndex, md) {
  const items = [];
  let i = startIndex;

  // Find ordered_list_open
  while (i < tokens.length && tokens[i].type !== 'ordered_list_open') {
    i++;
  }
  if (i >= tokens.length) return { items: [], endIndex: startIndex };

  i++; // Skip ordered_list_open

  while (i < tokens.length && tokens[i].type !== 'ordered_list_close') {
    if (tokens[i].type === 'list_item_open') {
      // Find the inline content
      let j = i + 1;
      while (j < tokens.length && tokens[j].type !== 'list_item_close') {
        if (tokens[j].type === 'inline') {
          const html = renderInlineChildren(tokens[j], md);
          items.push(html);
        }
        j++;
      }
      i = j;
    }
    i++;
  }

  return { items: items, endIndex: i };
}

function buildAttrs(userAttrs, baseClass) {
  let attrs = ' class="' + esc(baseClass + (userAttrs['class'] ? ' ' + userAttrs['class'] : '')) + '"';
  for (const [key, val] of Object.entries(userAttrs)) {
    if (key !== 'class') {
      attrs += ' ' + key + '="' + esc(val) + '"';
    }
  }
  return attrs;
}

function buildProcedureList(items) {
  let html = '<ol class="dc-steps">\n';
  items.forEach((itemHtml, idx) => {
    const stepNo = String(idx + 1).padStart(2, '0');
    html += '  <li><span class="dc-step-no">' + esc(stepNo) + '</span><span>' + itemHtml + '</span></li>\n';
  });
  html += '</ol>\n';
  return html;
}

/**
 * Main plugin function - default export for print-md
 */
export default function dimmCityPlugin(md, options = {}) {
  // Add admonition block rule
  md.block.ruler.before('paragraph', 'admonition', admonitionRule, {
    alt: ['paragraph', 'reference', 'blockquote']
  });

  // Transform tokens after parsing
   md.core.ruler.push('dimm_city_transform', function (state) {
     const tokens = state.tokens;
     const newTokens = [];

     // State tracking
     let inSpecialty = false;
     let inLearningPath = false;
     let inSkillMode = false;
     let inSkillCard = false;
     let inRollTable = false;
     let rollTableItems = [];
     let inOptionsTable = false;
     let optionsTableItems = [];
      let inOutcomeBlock = false;
      let outcomeBlockItems = [];
      let outcomeBlockFlush = false;
      let inSidebar = false;
      let inSidebarBox = false;
      let inDefinition = false;
      let inProcedure = false;
      let inCallout = false;
      let inDmNote = false;
      let inClassEntry = false;
      let classEntryName = '';
      let classEntryTokens = [];
     let learningPathHasTitle = false;
     let inLearningPathShell = false;
     let currentSkillAttrs = {};
     let currentSpecialtyCode = '';
     let currentLearningPathIndex = 0;
     let currentLearningPathRef = '';
     let currentLearningPathName = '';
      let currentSkillIndex = 0;
      /* Whether the current skill card allows splitting (has .allow-split).
         Used by outcomes-table to decide if it needs its own break-inside:avoid. */
      let currentCardCanSplit = false;
      /* Last skill-card title (parsed name + tier). Used by @continue to render
        a continuation card with a "{name} ▸" tab so the reader sees the link
        between Part 1 and the continuation. */
     let lastCardTitle = '';
     let lastCardTier = '';

     // Helper to close all open structures EXCEPT specialty (specialty
     // wraps the entire chapter section and is closed separately).
      function closeAll() {
        if (inSidebar) {
          newTokens.push(makeToken('html_block', '</div>\n'));
          inSidebar = false;
        }
        if (inSidebarBox) {
          newTokens.push(makeToken('html_block', '</div>\n'));
          inSidebarBox = false;
        }
        if (inDefinition) {
          newTokens.push(makeToken('html_block', '</div>\n'));
          inDefinition = false;
        }
        if (inSkillCard) {
          newTokens.push(makeToken('html_block', '</div></div></div>\n'));
          inSkillCard = false;
       }
       if (inLearningPathShell) {
         newTokens.push(makeToken('html_block', '</div>\n'));
         inLearningPathShell = false;
       }
        if (inLearningPath) {
          newTokens.push(makeToken('html_block', '</section>\n'));
          inLearningPath = false;
        }
        if (inCallout) {
          newTokens.push(makeToken('html_block', '</div>\n'));
          inCallout = false;
        }
        if (inDmNote) {
          newTokens.push(makeToken('html_block', '</div>\n'));
          inDmNote = false;
        }
        inProcedure = false;
        learningPathHasTitle = false;
        inSkillMode = false;
        currentSkillAttrs = {};
       currentCardCanSplit = false;
       currentLearningPathRef = '';
       currentLearningPathName = '';
      currentSkillIndex = 0;
    }

    function closeSpecialty() {
      closeAll();
      if (inSpecialty) {
        newTokens.push(makeToken('html_block', '</section>\n'));
        inSpecialty = false;
      }
       currentSpecialtyCode = '';
      currentLearningPathIndex = 0;
    }

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];

      // --- @sidebar / @end-sidebar ---
      const sidebarMarker = parseMarker(tok, tokens, i, '@sidebar');
      if (sidebarMarker.matched) {
        if (inSidebar) {
          newTokens.push(makeToken('html_block', '</div>\n'));
          inSidebar = false;
        }
        if (inSidebarBox) {
          newTokens.push(makeToken('html_block', '</div>\n'));
          inSidebarBox = false;
        }
        if (inDefinition) {
          newTokens.push(makeToken('html_block', '</div>\n'));
          inDefinition = false;
        }
        newTokens.push(makeToken('html_block', '<div' + buildAttrs(sidebarMarker.attrs, 'dc-sidebar') + '>\n'));
        inSidebar = true;
        i += 2;
        continue;
      }

      if (isMarker(tok, tokens, i, '@end-sidebar')) {
        if (inSidebar) {
          newTokens.push(makeToken('html_block', '</div>\n'));
          inSidebar = false;
        }
        i += 2;
        continue;
      }

      // --- @chapter-opener ---
      // Syntax: @chapter-opener C.02
      // Emits:  <span class="dc-chapter-opener-no">C.02</span>
      const chapterOpenerMarker = parseMarker(tok, tokens, i, '@chapter-opener');
      if (chapterOpenerMarker.matched) {
        const inline = tokens[i + 1];
        const content = inline ? inline.content.trim() : '';
        // Extract label: everything after '@chapter-opener '
        const label = content.startsWith('@chapter-opener ')
          ? content.slice('@chapter-opener '.length).trim()
          : '';
        newTokens.push(makeToken('html_block', '<span class="dc-chapter-opener-no">' + esc(label) + '</span>\n'));
        i += 2; // Skip paragraph_open, inline, paragraph_close
        continue;
      }

      // --- @roll-table / @end-roll-table ---
      // Collects bullet list items between markers and emits a styled table
      if (isMarker(tok, tokens, i, '@roll-table')) {
        inRollTable = true;
        rollTableItems = [];
        i += 2;
        continue;
      }

      if (inRollTable) {
        // Collect list items while inside the roll table
        if (tok.type === 'bullet_list_open') {
          const { items, endIndex } = collectBulletListItems(tokens, i);
          rollTableItems = rollTableItems.concat(items);
          i = endIndex;
          continue;
        }
        // @end-roll-table emits the table
        if (isMarker(tok, tokens, i, '@end-roll-table')) {
          inRollTable = false;
          const tierMap = { crit: 'crit', hit: 'hit', mixed: 'mixed', miss: 'miss', fail: 'fail' };
          let html = '<table class="dc-roll-table">\n';
          html += '  <thead>\n    <tr>\n';
          html += '      <th class="dc-roll-table-th dc-roll-table-th--roll">Roll</th>\n';
          html += '      <th class="dc-roll-table-th dc-roll-table-th--result">Result</th>\n';
          html += '    </tr>\n  </thead>\n  <tbody>\n';
          rollTableItems.forEach((item, idx) => {
            const parts = item.split('|').map(s => s.trim());
            const roll = parts[0] || '';
            const name = parts[1] || '';
            const tier = (parts[2] || '').toLowerCase();
            const validTier = tierMap[tier] || 'hit';
            const isLast = idx === rollTableItems.length - 1;
            const rowClass = 'dc-roll-table-row' + (isLast ? ' dc-roll-table-row--last' : '');
            html += '    <tr class="' + rowClass + '">\n';
            html += '      <td class="dc-roll-table-roll dc-roll-table-roll--' + validTier + '">' + esc(roll) + '</td>\n';
            html += '      <td class="dc-roll-table-result"><strong class="dc-roll-table-name dc-roll-table-name--' + validTier + '">' + esc(name) + '</strong></td>\n';
            html += '    </tr>\n';
          });
          html += '  </tbody>\n</table>\n';
          newTokens.push(makeToken('html_block', html));
          rollTableItems = [];
          i += 2;
          continue;
        }
        // Skip other tokens inside @roll-table (non-list content)
        continue;
      }

      // --- @options-table / @end-options-table ---
      // Collects bullet list items and emits a 2-column label/desc table
      if (isMarker(tok, tokens, i, '@options-table')) {
        inOptionsTable = true;
        optionsTableItems = [];
        i += 2;
        continue;
      }

      if (inOptionsTable) {
        if (tok.type === 'bullet_list_open') {
          const { items, endIndex } = collectBulletListItems(tokens, i);
          optionsTableItems = optionsTableItems.concat(items);
          i = endIndex;
          continue;
        }
        if (isMarker(tok, tokens, i, '@end-options-table')) {
          inOptionsTable = false;
          let html = '<table class="dc-options-table">\n  <tbody>\n';
          optionsTableItems.forEach(item => {
            const pipeIdx = item.indexOf('|');
            const label = pipeIdx >= 0 ? item.slice(0, pipeIdx).trim() : item.trim();
            const desc = pipeIdx >= 0 ? item.slice(pipeIdx + 1).trim() : '';
            html += '    <tr>\n';
            html += '      <td class="dc-options-label">' + esc(label) + '</td>\n';
            html += '      <td class="dc-options-desc">' + esc(desc) + '</td>\n';
            html += '    </tr>\n';
          });
          html += '  </tbody>\n</table>\n';
          newTokens.push(makeToken('html_block', html));
          optionsTableItems = [];
          i += 2;
          continue;
        }
        // Skip other tokens inside @options-table
        continue;
      }

      // --- @outcome / @end-outcome ---
      // Collects pipe-separated rows and emits a styled dc-outcomes block.
      // Syntax:
      //   @outcome [flush]
      //   20 | Crit | You flow. Automatic success — no roll needed.
      //   11–19 | Hit | You succeed cleanly.
      //   @end-outcome
      // Row ordering determines tier class: crit, hit, mixed, miss, fail.
      // Also handles the compact form where @outcome, rows, and @end-outcome
      // are all in one paragraph block (no blank lines between them).
      if (isMarker(tok, tokens, i, '@outcome')) {
        inOutcomeBlock = true;
        outcomeBlockItems = [];
        // Check for flush modifier
        const ocInline = tokens[i + 1];
        const ocContent = ocInline ? ocInline.content.trim() : '';
        outcomeBlockFlush = /\bflush\b/.test(ocContent.replace('@outcome', ''));
        i += 2;
        continue;
      }

      // Handle compact multiline @outcome block: all rows + @end-outcome in one paragraph
      if (tok.type === 'paragraph_open' && !inOutcomeBlock) {
        const inlineTok = tokens[i + 1];
        if (inlineTok && inlineTok.type === 'inline') {
          const firstLine = inlineTok.content.split('\n')[0].trim();
          if (firstLine === '@outcome' || firstLine.startsWith('@outcome ')) {
            // This is a compact outcome block — process all lines inline
            inOutcomeBlock = false; // We'll handle it fully here
            const isFlush = /\bflush\b/.test(firstLine.replace('@outcome', ''));
            const rows = [];
            const allLines = inlineTok.content.split('\n');
            let inBlock = false;
            for (const line of allLines) {
              const trimmed = line.trim();
              if (trimmed === '@outcome' || trimmed.startsWith('@outcome ')) { inBlock = true; continue; }
              if (trimmed === '@end-outcome') { inBlock = false; continue; }
              if (inBlock && trimmed && !trimmed.startsWith('#')) rows.push(trimmed);
            }
            if (rows.length > 0) {
              const tierClasses = ['crit', 'hit', 'mixed', 'miss', 'fail'];
              const wrapperClass = 'dc-outcomes' + (isFlush ? ' flush' : '');
              let html = '<div class="' + wrapperClass + '">\n';
              html += '  <div class="dc-outcomes-label">Outcomes</div>\n';
              rows.forEach((line, idx) => {
                const parts = line.split('|').map(s => s.trim());
                const range = parts[0] || '';
                const name  = parts[1] || '';
                const desc  = parts[2] || '';
                const tier  = tierClasses[idx] || 'hit';
                html += '  <div class="dc-outcome-row ' + tier + '">\n';
                html += '    <span class="dc-outcome-key tier-' + tier + '">';
                html += '<span class="dc-outcome-name">' + esc(name) + '</span>';
                html += '<span class="dc-outcome-roll">' + esc(range) + '</span>';
                html += '</span>\n';
                html += '    <span class="dc-outcome-text">' + md.renderInline(desc) + '</span>\n';
                html += '  </div>\n';
              });
              html += '</div>\n';
              newTokens.push(makeToken('html_block', html));
              i += 2; // skip inline + paragraph_close
              continue;
            }
          }
        }
      }

      if (inOutcomeBlock) {
        // Collect inline tokens (each inline contains one or more lines)
        if (tok.type === 'inline') {
          // Each inline token can have newlines — split into lines
          const lines = tok.content.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
              outcomeBlockItems.push(trimmed);
            }
          }
          continue;
        }
        // @end-outcome — emit the block
        if (isMarker(tok, tokens, i, '@end-outcome')) {
          inOutcomeBlock = false;
          const tierClasses = ['crit', 'hit', 'mixed', 'miss', 'fail'];
          const wrapperClass = 'dc-outcomes' + (outcomeBlockFlush ? ' flush' : '');
          let html = '<div class="' + wrapperClass + '">\n';
          html += '  <div class="dc-outcomes-label">Outcomes</div>\n';
          outcomeBlockItems.forEach((line, idx) => {
            const parts = line.split('|').map(s => s.trim());
            const range = parts[0] || '';
            const name  = parts[1] || '';
            const desc  = parts[2] || '';
            const tier  = tierClasses[idx] || 'hit';
            html += '  <div class="dc-outcome-row ' + tier + '">\n';
            html += '    <span class="dc-outcome-key tier-' + tier + '">';
            html += '<span class="dc-outcome-name">' + esc(name) + '</span>';
            html += '<span class="dc-outcome-roll">' + esc(range) + '</span>';
            html += '</span>\n';
            html += '    <span class="dc-outcome-text">' + md.renderInline(desc) + '</span>\n';
            html += '  </div>\n';
          });
          html += '</div>\n';
          newTokens.push(makeToken('html_block', html));
          outcomeBlockItems = [];
          i += 2;
          continue;
        }
        // Skip paragraph open/close wrapper tokens — we only want inline content
        if (tok.type === 'paragraph_open' || tok.type === 'paragraph_close') {
          continue;
        }
        // Pass through anything else (shouldn't normally occur)
        continue;
      }

      // --- @class-entry / @end-class-entry ---
      // Collects tokens between markers and emits a class entry card
      const classEntryMarker = parseMarker(tok, tokens, i, '@class-entry');
      if (classEntryMarker.matched) {
        inClassEntry = true;
        classEntryTokens = [];
        // Extract specialty name from the inline content after '@class-entry '
        const ceInline = tokens[i + 1];
        const ceContent = ceInline ? ceInline.content.trim() : '';
        const ceRest = ceContent.startsWith('@class-entry ')
          ? ceContent.slice('@class-entry '.length).trim()
          : '';
        classEntryName = ceRest.split(/\s+/)[0] || '';
        i += 2;
        continue;
      }

      if (inClassEntry) {
        if (isMarker(tok, tokens, i, '@end-class-entry')) {
          inClassEntry = false;
          // Walk collected tokens to build portrait, name, and body content
          const specialtySlug = classEntryName.toLowerCase();
          const specialtyLabel = specialtySlug.charAt(0).toUpperCase() + specialtySlug.slice(1);
          let portraitHtml = '';
          let entryNameHtml = '';
          let bodyPartsHtml = '';

          for (let ci = 0; ci < classEntryTokens.length; ci++) {
            const ctok = classEntryTokens[ci];
            // Image-only paragraph → portrait div
            if (ctok.type === 'inline' && /!\[([^\]]*)\]\(([^)]+)\)/.test(ctok.content)) {
              const imgMatch = ctok.content.match(/!\[([^\]]*)\]\(([^)]+)\)/);
              if (imgMatch) {
                portraitHtml = '<div class="dc-class-entry-portrait">\n  <img src="' + esc(imgMatch[2]) + '" alt="' + esc(imgMatch[1]) + '">\n</div>\n';
              }
              continue;
            }
            // Heading h3 → class name
            if (ctok.type === 'heading_open' && ctok.tag === 'h3') {
              const headInline = classEntryTokens[ci + 1];
              const headText = headInline && headInline.type === 'inline' ? headInline.content.trim() : '';
              entryNameHtml = '<h3 class="dc-class-entry-name">' + esc(headText) + '</h3>\n';
              ci += 2; // Skip heading_open, inline, heading_close
              continue;
            }
            // Blockquote → flavor paragraph
            if (ctok.type === 'blockquote_open') {
              let bqContent = '';
              let bi = ci + 1;
              while (bi < classEntryTokens.length && classEntryTokens[bi].type !== 'blockquote_close') {
                if (classEntryTokens[bi].type === 'inline') {
                  bqContent = classEntryTokens[bi].content;
                }
                bi++;
              }
              // Render italic/bold in flavor text
              const renderedFlavor = md.renderInline(bqContent);
              bodyPartsHtml += '<p class="dc-flavor">' + renderedFlavor + '</p>\n';
              ci = bi;
              continue;
            }
            // Inline token in a paragraph → prose
            if (ctok.type === 'inline' && ctok.content.trim() !== '') {
              const renderedProse = md.renderInline(ctok.content);
              bodyPartsHtml += '<p>' + renderedProse + '</p>\n';
            }
          }

          let html = '<div class="dc-class-entry">\n';
          if (portraitHtml) html += portraitHtml;
          html += '<div class="dc-class-entry-body">\n';
          if (entryNameHtml) html += entryNameHtml;
          html += '<div class="dc-class-entry-tags">\n';
          html += '  <span class="dc-classtag ' + esc(specialtySlug) + '"><span class="dc-classtag-dot"></span>' + esc(specialtyLabel) + '</span>\n';
          html += '</div>\n';
          html += bodyPartsHtml;
          html += '</div>\n</div>\n';
          newTokens.push(makeToken('html_block', html));
          classEntryName = '';
          classEntryTokens = [];
          i += 2;
          continue;
        }
        // Collect all tokens between @class-entry and @end-class-entry
        classEntryTokens.push(tok);
        continue;
      }

      // Check for @specialty marker (must come before @learning-path/@skill
      // since it auto-closes everything else)
      const sidebarBoxMarker = parseMarker(tok, tokens, i, '@sidebar-box');
      if (sidebarBoxMarker.matched) {
        if (inSidebarBox) {
          newTokens.push(makeToken('html_block', '</div>\n'));
          inSidebarBox = false;
        }
        if (inSidebar) {
          newTokens.push(makeToken('html_block', '</div>\n'));
          inSidebar = false;
        }
        if (inDefinition) {
          newTokens.push(makeToken('html_block', '</div>\n'));
          inDefinition = false;
        }
        newTokens.push(makeToken('html_block', '<div' + buildAttrs(sidebarBoxMarker.attrs, 'dc-prose-panel dc-sidebar-box') + '>\n'));
        inSidebarBox = true;
        i += 2;
        continue;
      }

      if (isMarker(tok, tokens, i, '@end-sidebar-box')) {
        if (inSidebarBox) {
          newTokens.push(makeToken('html_block', '</div>\n'));
          inSidebarBox = false;
        }
        i += 2;
        continue;
      }

      const definitionMarker = parseMarker(tok, tokens, i, '@definition');
      if (definitionMarker.matched) {
        if (inDefinition) {
          newTokens.push(makeToken('html_block', '</div>\n'));
          inDefinition = false;
        }
        if (inSidebar) {
          newTokens.push(makeToken('html_block', '</div>\n'));
          inSidebar = false;
        }
        if (inSidebarBox) {
          newTokens.push(makeToken('html_block', '</div>\n'));
          inSidebarBox = false;
        }
        newTokens.push(makeToken('html_block', '<div' + buildAttrs(definitionMarker.attrs, 'dc-prose-panel dc-definition-block') + '>\n'));
        inDefinition = true;
        i += 2;
        continue;
      }

      if (isMarker(tok, tokens, i, '@end-definition')) {
        if (inDefinition) {
          newTokens.push(makeToken('html_block', '</div>\n'));
          inDefinition = false;
        }
        i += 2;
        continue;
      }

      const procedureMarker = parseMarker(tok, tokens, i, '@procedure');
      if (procedureMarker.matched) {
        inProcedure = true;
        i += 2;
        continue;
      }

      if (isMarker(tok, tokens, i, '@end-procedure')) {
        inProcedure = false;
        i += 2;
        continue;
      }

      // --- @callout / @end-callout ---
      // Block-level alert wrapper. variant="note|warning|dm|vibe|origin|visit|gear"
      const calloutMarker = parseMarker(tok, tokens, i, '@callout');
      if (calloutMarker.matched) {
        closeAll();
        const variant = (calloutMarker.attrs['variant'] || 'note').toLowerCase();
        const CALLOUT_VARIANTS = {
          'note':    { classes: 'dc-note',           label: 'Note' },
          'warning': { classes: 'dc-note warning',   label: 'Warning' },
          'dm':      { classes: 'dc-dm-note',        label: 'Dream Master Note' },
          'vibe':    { classes: 'dc-vibe-callout',   label: 'Vibe' },
          'origin':  { classes: 'dc-origin-callout', label: 'Origin' },
          'visit':   { classes: 'dc-visit-callout',  label: 'Visit' },
          'gear':    { classes: 'dc-gear-callout',   label: 'Gear' },
        };
        const cfg = CALLOUT_VARIANTS[variant] || CALLOUT_VARIANTS['note'];
        const labelOverride = calloutMarker.attrs['label'];
        const labelText = labelOverride ? esc(labelOverride) : cfg.label;
        newTokens.push(makeToken('html_block',
          '<div class="dc-alert ' + cfg.classes + '">\n' +
          '<span class="dc-alert-label">' + labelText + '</span>\n'
        ));
        inCallout = true;
        i += 2;
        continue;
      }

      if (isMarker(tok, tokens, i, '@end-callout')) {
        if (inCallout) {
          newTokens.push(makeToken('html_block', '</div>\n'));
          inCallout = false;
        }
        i += 2;
        continue;
      }

      // --- @dm-note / @end-dm-note ---
      // Block-level DM note wrapper. Equivalent to > [!DM] but supports multi-paragraph content.
      const dmNoteMarker = parseMarker(tok, tokens, i, '@dm-note');
      if (dmNoteMarker.matched) {
        closeAll();
        const labelOverride = dmNoteMarker.attrs['label'];
        const labelText = labelOverride ? esc(labelOverride) : 'Dream Master Note';
        newTokens.push(makeToken('html_block',
          '<div class="dc-alert dc-dm-note">\n' +
          '<span class="dc-alert-label">' + labelText + '</span>\n'
        ));
        inDmNote = true;
        i += 2;
        continue;
      }

      if (isMarker(tok, tokens, i, '@end-dm-note')) {
        if (inDmNote) {
          newTokens.push(makeToken('html_block', '</div>\n'));
          inDmNote = false;
        }
        i += 2;
        continue;
      }

      // --- @specialty-card / @end-specialty-card ---
      // Summary card used in the choose-specialty overview grid.
      // Shape and color inherited from .specialty.<name> parent container.
      const specialtyCardMarker = parseMarker(tok, tokens, i, '@specialty-card');
      if (specialtyCardMarker.matched) {
        closeAll();
        const userAttrs = { ...specialtyCardMarker.attrs };
        const extraClass = userAttrs['class'] ? ' ' + userAttrs['class'] : '';
        delete userAttrs['class'];
        let extraAttrs = '';
        for (const [key, val] of Object.entries(userAttrs)) {
          extraAttrs += ' ' + key + '="' + esc(val) + '"';
        }
        newTokens.push(makeToken('html_block', '<div class="dc-specialty-card' + extraClass + '"' + extraAttrs + '>\n'));
        i += 2;
        continue;
      }

      if (isMarker(tok, tokens, i, '@end-specialty-card')) {
        newTokens.push(makeToken('html_block', '</div>\n'));
        i += 2;
        continue;
      }

      // --- @specialty-intro / @end-specialty-intro ---
      // Full-page specialty intro panel. Shape/color from .specialty.<name> parent.
      const specialtyIntroMarker = parseMarker(tok, tokens, i, '@specialty-intro');
      if (specialtyIntroMarker.matched) {
        closeAll();
        const userAttrs = { ...specialtyIntroMarker.attrs };
        const extraClass = userAttrs['class'] ? ' ' + userAttrs['class'] : '';
        delete userAttrs['class'];
        newTokens.push(makeToken('html_block', '<div class="specialty-intro' + extraClass + '">\n'));
        i += 2;
        continue;
      }

      if (isMarker(tok, tokens, i, '@end-specialty-intro')) {
        newTokens.push(makeToken('html_block', '</div>\n'));
        i += 2;
        continue;
      }

      // --- @specialty-art / @end-specialty-art ---
      // Full-page art plate. Emits .specialty-art wrapper.
      const specialtyArtMarker = parseMarker(tok, tokens, i, '@specialty-art');
      if (specialtyArtMarker.matched) {
        closeAll();
        const userAttrs = { ...specialtyArtMarker.attrs };
        const extraClass = userAttrs['class'] ? ' ' + userAttrs['class'] : '';
        delete userAttrs['class'];
        newTokens.push(makeToken('html_block', '<div class="specialty-art' + extraClass + '">\n'));
        i += 2;
        continue;
      }

      if (isMarker(tok, tokens, i, '@end-specialty-art')) {
        newTokens.push(makeToken('html_block', '</div>\n'));
        i += 2;
        continue;
      }

      // --- @toc / @end-toc ---
      const tocMarker = parseMarker(tok, tokens, i, '@toc');
      if (tocMarker.matched) {
        closeAll();
        newTokens.push(makeToken('html_block', '<div class="dc-toc">\n'));
        i += 2; continue;
      }
      if (isMarker(tok, tokens, i, '@end-toc')) {
        newTokens.push(makeToken('html_block', '</div>\n'));
        i += 2; continue;
      }

      // --- @two-column / @end-two-column ---
      const twoColMarker = parseMarker(tok, tokens, i, '@two-column');
      if (twoColMarker.matched) {
        closeAll();
        newTokens.push(makeToken('html_block', '<div class="two-column">\n'));
        i += 2; continue;
      }
      if (isMarker(tok, tokens, i, '@end-two-column')) {
        newTokens.push(makeToken('html_block', '</div>\n'));
        i += 2; continue;
      }

      // --- @three-column / @end-three-column ---
      const threeColMarker = parseMarker(tok, tokens, i, '@three-column');
      if (threeColMarker.matched) {
        closeAll();
        newTokens.push(makeToken('html_block', '<div class="three-column">\n'));
        i += 2; continue;
      }
      if (isMarker(tok, tokens, i, '@end-three-column')) {
        newTokens.push(makeToken('html_block', '</div>\n'));
        i += 2; continue;
      }

      // --- @no-break / @end-no-break ---
      const noBreakMarker = parseMarker(tok, tokens, i, '@no-break');
      if (noBreakMarker.matched) {
        closeAll();
        newTokens.push(makeToken('html_block', '<div class="pmd-no-break">\n'));
        i += 2; continue;
      }
      if (isMarker(tok, tokens, i, '@end-no-break')) {
        newTokens.push(makeToken('html_block', '</div>\n'));
        i += 2; continue;
      }

      // --- @gear-card / @end-gear-card ---
      const gearCardMarker = parseMarker(tok, tokens, i, '@gear-card');
      if (gearCardMarker.matched) {
        closeAll();
        const userAttrs = { ...gearCardMarker.attrs };
        const extraClass = userAttrs['class'] ? ' ' + userAttrs['class'] : '';
        delete userAttrs['class'];
        let extraAttrs = '';
        for (const [key, val] of Object.entries(userAttrs)) {
          extraAttrs += ' ' + key + '="' + esc(val) + '"';
        }
        newTokens.push(makeToken('html_block', '<div class="dc-gear-entry' + extraClass + '"' + extraAttrs + '>\n'));
        i += 2; continue;
      }
      if (isMarker(tok, tokens, i, '@end-gear-card')) {
        newTokens.push(makeToken('html_block', '</div>\n'));
        i += 2; continue;
      }

      // --- @tape (single-line tape divider) ---
      const tapeMarker = parseMarker(tok, tokens, i, '@tape');
      if (tapeMarker.matched) {
        const labelAttr = tapeMarker.attrs['label'] || '';
        const extraClass = tapeMarker.attrs['class'] ? ' ' + esc(tapeMarker.attrs['class']) : '';
        newTokens.push(makeToken('html_block', '<div class="dc-tape' + extraClass + '">' + esc(labelAttr) + '</div>\n'));
        i += 2; continue;
      }

      // --- @lede / @end-lede ---
      const ledeMarker = parseMarker(tok, tokens, i, '@lede');
      if (ledeMarker.matched) {
        closeAll();
        newTokens.push(makeToken('html_block', '<div class="dc-intro lede">\n'));
        i += 2; continue;
      }
      if (isMarker(tok, tokens, i, '@end-lede')) {
        newTokens.push(makeToken('html_block', '</div>\n'));
        i += 2; continue;
      }

      // --- @glossary / @end-glossary ---
      const glossaryMarker = parseMarker(tok, tokens, i, '@glossary');
      if (glossaryMarker.matched) {
        closeAll();
        newTokens.push(makeToken('html_block', '<div class="dc-terms">\n'));
        i += 2; continue;
      }
      if (isMarker(tok, tokens, i, '@end-glossary')) {
        newTokens.push(makeToken('html_block', '</div>\n'));
        i += 2; continue;
      }

      const specialtyMarker = parseMarker(tok, tokens, i, '@specialty');
      if (specialtyMarker.matched) {
        closeSpecialty();
        const userAttrs = specialtyMarker.attrs;
        let specClass = 'specialty' + (userAttrs['class'] ? ' ' + userAttrs['class'] : '');
        let specAttrs = '';
        for (const [key, val] of Object.entries(userAttrs)) {
          if (key !== 'class') {
            specAttrs += ' ' + key + '="' + esc(val) + '"';
          }
        }
        newTokens.push(makeToken('html_block', '<section class="' + specClass + '"' + specAttrs + '>\n'));
        inSpecialty = true;
        currentSpecialtyCode = specialtyCodeFromClass(specClass);
        currentLearningPathIndex = 0;
        i += 2;
        continue;
      }

      // Check for @end-specialty marker
      if (isMarker(tok, tokens, i, '@end-specialty')) {
        closeSpecialty();
        i += 2;
        continue;
      }

      // Check for @learning-path marker
      const learningPathMarker = parseMarker(tok, tokens, i, '@learning-path');
      if (learningPathMarker.matched) {
        closeAll();
        inLearningPath = true;
        inLearningPathShell = true;
        learningPathHasTitle = false;
        currentLearningPathIndex++;
        currentLearningPathRef = currentSpecialtyCode + currentLearningPathIndex;
        currentLearningPathName = '';
        currentSkillIndex = 0;

        // Build opening tag with any custom attributes (no variant= — use .specialty.<name> parent)
        let lpAttrs = '';
        const lpUserAttrs = learningPathMarker.attrs;
        for (const [key, val] of Object.entries(lpUserAttrs)) {
          if (key !== 'class') {
            lpAttrs += ' ' + key + '="' + esc(val) + '"';
          }
        }
        const lpClass = 'dc-learning-path dc-path-block' + (lpUserAttrs['class'] ? ' ' + lpUserAttrs['class'] : '');
        newTokens.push(makeToken('html_block', '<section class="' + lpClass + '" data-path-ref="' + esc(currentLearningPathRef) + '"' + lpAttrs + '>\n<div class="dc-path-shell">\n'));
        i += 2; // Skip paragraph_open, inline, paragraph_close
        continue;
      }

      // Check for @skill marker
      const skillMarker = parseMarker(tok, tokens, i, '@skill');
      if (skillMarker.matched) {
        if (inLearningPathShell) {
          newTokens.push(makeToken('html_block', '</div>\n'));
          inLearningPathShell = false;
        }
        // Close previous skill card if open
        if (inSkillCard) {
          newTokens.push(makeToken('html_block', '</div></div></div>\n'));
          inSkillCard = false;
        }
        inSkillMode = true;
        // Store skill attrs for use when building the card
        currentSkillAttrs = skillMarker.attrs;
        i += 2;
        continue;
      }

      // Check for @end-skill marker
      if (isMarker(tok, tokens, i, '@end-skill') || isMarker(tok, tokens, i, '@end-skills')) {
        closeAll();
        inSkillMode = false;
        i += 2;
        continue;
      }

      // Check for @continue marker — manually splits a long ability into two
      // (or more) chrome-bearing cards. Closes the current skill-card and
      // opens a new one with the same variant and a "{title} ▸"
      // tab so the reader sees the continuation visually. Use this instead
      // of `.allow-split` when an ability is too tall for one page; manual
      // splits keep card chrome on every fragment, while paged.js auto-splits
      // produce naked continuations (no tab, no body frame on later pages).
      if (isMarker(tok, tokens, i, '@continue')) {
        if (inSkillMode && inSkillCard) {
          // Close current card
          newTokens.push(makeToken('html_block', '</div></div></div>\n'));
          inSkillCard = false;

          // No variant class — shape inherited from .specialty.<name> parent container

          let cardAttrs = '';
          for (const [key, val] of Object.entries(currentSkillAttrs)) {
            if (key !== 'class') {
              cardAttrs += ' ' + key + '="' + esc(val) + '"';
            }
          }

          // Honor allow-split on continuation cards too
          const userClassList = (currentSkillAttrs['class'] || '').split(/\s+/).filter(Boolean);
          const allowSplitCont = userClassList.includes('allow-split');
          const userClass = userClassList.join(' ');
          const cardClass = 'dc-skill-card dc-skill-card-cont' + (userClass ? ' ' + userClass : '');
          const breakInsideContAttr = allowSplitCont ? '' : ' data-break-inside="avoid"';

          let cardHtml = '<div class="' + cardClass + '" name="' + esc(slugify(lastCardTitle)) + '"' + breakInsideContAttr + cardAttrs + '>\n';
          const fullTabClassCont = 'dc-card-tab dc-card-tab-cont';
          cardHtml += '  <div class="' + fullTabClassCont + '">\n';
          cardHtml += '    <span class="dc-tab-title">' + esc(lastCardTitle) + ' ▸</span>\n';
          if (lastCardTier) {
            cardHtml += '    <span class="dc-tab-tier">' + esc(lastCardTier) + '</span>\n';
          }
          cardHtml += '  </div>\n';
          const fullBodyClassCont = 'dc-card-body';
          cardHtml += '  <div class="' + fullBodyClassCont + '">\n';
          cardHtml += '    <div class="dc-card-inner">\n';

          newTokens.push(makeToken('html_block', cardHtml));
          inSkillCard = true;
        }
        i += 2;
        continue;
      }

      // Check for @end-learning-path marker
      if (isMarker(tok, tokens, i, '@end-learning-path')) {
        if (inLearningPathShell) {
          newTokens.push(makeToken('html_block', '</div>\n'));
          inLearningPathShell = false;
        }
        if (inLearningPath) {
          newTokens.push(makeToken('html_block', '</section>\n'));
          inLearningPath = false;
          learningPathHasTitle = false;
        }
        i += 2;
        continue;
      }

      // Inside @learning-path section
      if (inLearningPath && !inSkillMode) {
        // H3 = Learning path title (banner)
        if (tok.type === 'heading_open' && tok.tag === 'h3') {
          const inlineTok = tokens[i + 1];
          const titleText = inlineTok && inlineTok.content ? inlineTok.content : '';
          currentLearningPathName = titleText;
          newTokens.push(makeToken('html_block', '<h2 class="dc-spray"><span class="dc-path-sticker">' + esc(currentLearningPathRef) + '</span>' + esc(titleText) + '</h2>\n'));
          learningPathHasTitle = true;
          i += 2; // Skip heading_open, inline, heading_close
          continue;
        }

        // Blockquote = Subtitle/description (after title)
        if (tok.type === 'blockquote_open' && learningPathHasTitle) {
          let bqContent = '';
          let j = i + 1;
          while (j < tokens.length && tokens[j].type !== 'blockquote_close') {
            if (tokens[j].type === 'inline') {
              bqContent = tokens[j].content;
            }
            j++;
          }
          newTokens.push(makeToken('html_block', '<div class="dc-intro">' + esc(bqContent) + '</div>\n'));
          i = j;
          continue;
        }

        // Bullet list = Sticker chain
        if (tok.type === 'bullet_list_open') {
          const { items, endIndex } = collectBulletListItems(tokens, i);
          if (items.length > 0) {
            newTokens.push(makeToken('html_block', buildStickerChain(items)));
          }
          i = endIndex;
          continue;
        }

        // Paragraphs = body prose within the learning path block
        if (tok.type === 'paragraph_open') {
          const inlineTok = tokens[i + 1];
          const closeTok = tokens[i + 2];
          if (inlineTok && inlineTok.type === 'inline' && closeTok && closeTok.type === 'paragraph_close') {
            const bodyHtml = processRollDie(renderInlineChildren(inlineTok, md));
            newTokens.push(makeToken('html_block', '<p>' + bodyHtml + '</p>\n'));
            i += 2;
            continue;
          }
        }

        // Pass through other content in learning-path
        newTokens.push(tok);
        continue;
      }

      // Mark image-only paragraphs so layout rules can target them without
      // relying on p:has(img), which Paged.js drops silently. The base CSS
      // rule (p.img-wrapper { padding:0; margin:0 }) lives in dc-brand.css.
      // Per-page rules can further refine position via .page.my-class p.img-wrapper.
      if (tok.type === 'paragraph_open') {
        const inlineTok = tokens[i + 1];
        const closeTok = tokens[i + 2];
        if (inlineTok && inlineTok.type === 'inline' && closeTok && closeTok.type === 'paragraph_close') {
          const hasOnlyImage = Array.isArray(inlineTok.children)
            && inlineTok.children.length === 1
            && inlineTok.children[0].type === 'image';
          if (hasOnlyImage) {
            tok.attrSet('class', 'img-wrapper');
          }
        }
      }

      // Inside @skill section
      if (inSkillMode) {
        // H4 = Skill card title
        if (tok.type === 'heading_open' && tok.tag === 'h4') {
          // Close previous card if open
          if (inSkillCard) {
            newTokens.push(makeToken('html_block', '</div></div></div>\n'));
          }

          const inlineTok = tokens[i + 1];
          const h4Text = inlineTok && inlineTok.content ? inlineTok.content : '';
          const parsed = parseSkillTitle(h4Text);
          currentSkillIndex++;

          // No variant class — shape is inherited from .specialty.<name> parent container

          // Collect extra attributes for skill-card wrapper (exclude class)
          let cardAttrs = '';
          for (const [key, val] of Object.entries(currentSkillAttrs)) {
            if (key !== 'class') {
              cardAttrs += ' ' + key + '="' + esc(val) + '"';
            }
          }

          // Build card class: "dc-skill-card" + any custom classes from {.foo .bar}
          const cardClass = 'dc-skill-card' + (currentSkillAttrs['class'] ? ' ' + currentSkillAttrs['class'] : '');

          // Card splitting strategy:
          //   - `.allow-split`: omit `data-break-inside="avoid"` so the card
          //     can split across pages (for cards taller than a page).
          //   - Default: `data-break-inside="avoid"` keeps card intact.
          const userClasses = (currentSkillAttrs['class'] || '').split(/\s+/);
          const allowSplit = userClasses.includes('allow-split');
          const breakInsideAttr = allowSplit ? '' : ' data-break-inside="avoid"';

          // Track allowSplit for outcomes-table (needs avoid only when card can split)
          currentCardCanSplit = allowSplit;

          // Track for @continue continuation cards.
          lastCardTitle = parsed.name;
          lastCardTier = parsed.tier || '';

          // Build card structure
          let cardHtml = '<div class="' + cardClass + '" name="' + esc(slugify(parsed.name)) + '"' + breakInsideAttr + cardAttrs + '>\n';
          const tabBaseClass = 'dc-card-tab' + (parsed.highlight ? ' highlight' : '');
          cardHtml += '  <div class="' + tabBaseClass + '">\n';
          const autoTier = currentLearningPathRef ? currentLearningPathRef + '.' + currentSkillIndex : '';
          cardHtml += '    <span class="dc-tab-title">' + esc(parsed.name) + '</span>\n';
          cardHtml += '    <span class="dc-tab-tier">' + esc(parsed.tier || autoTier) + '</span>\n';
          cardHtml += '  </div>\n';

          const bodyBaseClass = 'dc-card-body' + (parsed.highlight ? ' highlight-body' : '');
          cardHtml += '  <div class="' + bodyBaseClass + '">\n';
          cardHtml += '    <div class="dc-card-inner">\n';

          newTokens.push(makeToken('html_block', cardHtml));
          inSkillCard = true;
          i += 2;
          continue;
        }

        // H5 = Sub-header (like "Outcomes")
        if (tok.type === 'heading_open' && tok.tag === 'h5' && inSkillCard) {
          const inlineTok = tokens[i + 1];
          const h5Text = inlineTok && inlineTok.content ? inlineTok.content : '';
          // Skip "Outcomes" header since the table will have its own label
          if (h5Text.toLowerCase() !== 'outcomes') {
            newTokens.push(makeToken('html_block', '<div class="dc-sub-header">' + esc(h5Text) + '</div>\n'));
          }
          i += 2;
          continue;
        }

        // Blockquote = Flavor text (inside skill card)
        if (tok.type === 'blockquote_open' && inSkillCard) {
          let bqContent = '';
          let j = i + 1;
          while (j < tokens.length && tokens[j].type !== 'blockquote_close') {
            if (tokens[j].type === 'inline') {
              bqContent = tokens[j].content;
            }
            j++;
          }
          newTokens.push(makeToken('html_block', '<p class="dc-flavor">' + esc(bqContent) + '</p>\n'));
          i = j;
          continue;
        }

        // Ordered list = Abilities
        if (tok.type === 'ordered_list_open' && inSkillCard) {
          const { items, endIndex } = collectOrderedListItems(tokens, i, md);

          items.forEach(itemHtml => {
            const ability = parseAbilityFromListItem(itemHtml);
            if (ability) {
              let output = '<div class="dc-ability">\n';
              output += '  <span class="' + ability.apClass + '">' + esc(ability.apVal) + '</span>\n';
              output += '  <p class="dc-ability-text">' + processRollDie(ability.text) + '</p>\n';
              output += '</div>\n';
              newTokens.push(makeToken('html_block', output));
            } else {
              // Fallback: render as paragraph
              newTokens.push(makeToken('html_block', '<p>' + processRollDie(itemHtml) + '</p>\n'));
            }
          });

          i = endIndex;
          continue;
        }

        // Bullet list inside skill card (e.g., sub-points)
        if (tok.type === 'bullet_list_open' && inSkillCard) {
          // Pass through as regular list
          newTokens.push(tok);
          continue;
        }

        // Table = Outcomes or Distance
        if (tok.type === 'table_open' && inSkillCard) {
          const tableTokens = collectTableTokens(tokens, i);
          const headers = getTableHeaders(tableTokens);
          const tableClass = classifyTable(headers);
          // Pass currentCardCanSplit: outcomes-block needs data-break-inside="avoid"
          // only when the parent card can be split (no card-level avoid). When the
          // card already has card-level avoid, a nested outcomes-block avoid creates
          // a conflicting inner break that splits the card at the outcomes boundary.
          const tableHtml = buildTable(tableTokens, tableClass, md, currentCardCanSplit);

          newTokens.push(makeToken('html_block', tableHtml));
          i = skipToTableClose(tokens, i);
          continue;
        }

        // Pass through other tokens in skill mode
        newTokens.push(tok);
        continue;
      }

      if (inProcedure && tok.type === 'ordered_list_open') {
        const { items, endIndex } = collectOrderedListItems(tokens, i, md);
        if (items.length > 0) {
          newTokens.push(makeToken('html_block', buildProcedureList(items)));
        }
        i = endIndex;
        continue;
      }

      if (inProcedure && tok.type === 'ordered_list_close') {
        continue;
      }

      // Outside any special section - pass through unchanged
      newTokens.push(tok);
    }

    // Close any open structures at EOF

    // Emit partial @roll-table if @end-roll-table was missing
    if (inRollTable && rollTableItems.length > 0) {
      const tierMap = { crit: 'crit', hit: 'hit', mixed: 'mixed', miss: 'miss', fail: 'fail' };
      let html = '<table class="dc-roll-table">\n';
      html += '  <thead>\n    <tr>\n';
      html += '      <th class="dc-roll-table-th dc-roll-table-th--roll">Roll</th>\n';
      html += '      <th class="dc-roll-table-th dc-roll-table-th--result">Result</th>\n';
      html += '    </tr>\n  </thead>\n  <tbody>\n';
      rollTableItems.forEach((item, idx) => {
        const parts = item.split('|').map(s => s.trim());
        const roll = parts[0] || '';
        const name = parts[1] || '';
        const tier = (parts[2] || '').toLowerCase();
        const validTier = tierMap[tier] || 'hit';
        const isLast = idx === rollTableItems.length - 1;
        const rowClass = 'dc-roll-table-row' + (isLast ? ' dc-roll-table-row--last' : '');
        html += '    <tr class="' + rowClass + '">\n';
        html += '      <td class="dc-roll-table-roll dc-roll-table-roll--' + validTier + '">' + esc(roll) + '</td>\n';
        html += '      <td class="dc-roll-table-result"><strong class="dc-roll-table-name dc-roll-table-name--' + validTier + '">' + esc(name) + '</strong></td>\n';
        html += '    </tr>\n';
      });
      html += '  </tbody>\n</table>\n';
      newTokens.push(makeToken('html_block', html));
    }

    // Emit partial @options-table if @end-options-table was missing
    if (inOptionsTable && optionsTableItems.length > 0) {
      let html = '<table class="dc-options-table">\n  <tbody>\n';
      optionsTableItems.forEach(item => {
        const pipeIdx = item.indexOf('|');
        const label = pipeIdx >= 0 ? item.slice(0, pipeIdx).trim() : item.trim();
        const desc = pipeIdx >= 0 ? item.slice(pipeIdx + 1).trim() : '';
        html += '    <tr>\n';
        html += '      <td class="dc-options-label">' + esc(label) + '</td>\n';
        html += '      <td class="dc-options-desc">' + esc(desc) + '</td>\n';
        html += '    </tr>\n';
      });
      html += '  </tbody>\n</table>\n';
      newTokens.push(makeToken('html_block', html));
    }

    // Emit partial @class-entry if @end-class-entry was missing
    if (inClassEntry && classEntryTokens.length > 0) {
      const specialtySlug = classEntryName.toLowerCase();
      const specialtyLabel = specialtySlug.charAt(0).toUpperCase() + specialtySlug.slice(1);
      let portraitHtml = '';
      let entryNameHtml = '';
      let bodyPartsHtml = '';
      for (let ci = 0; ci < classEntryTokens.length; ci++) {
        const ctok = classEntryTokens[ci];
        if (ctok.type === 'inline' && /!\[([^\]]*)\]\(([^)]+)\)/.test(ctok.content)) {
          const imgMatch = ctok.content.match(/!\[([^\]]*)\]\(([^)]+)\)/);
          if (imgMatch) {
            portraitHtml = '<div class="dc-class-entry-portrait">\n  <img src="' + esc(imgMatch[2]) + '" alt="' + esc(imgMatch[1]) + '">\n</div>\n';
          }
          continue;
        }
        if (ctok.type === 'heading_open' && ctok.tag === 'h3') {
          const headInline = classEntryTokens[ci + 1];
          const headText = headInline && headInline.type === 'inline' ? headInline.content.trim() : '';
          entryNameHtml = '<h3 class="dc-class-entry-name">' + esc(headText) + '</h3>\n';
          ci += 2;
          continue;
        }
        if (ctok.type === 'blockquote_open') {
          let bqContent = '';
          let bi = ci + 1;
          while (bi < classEntryTokens.length && classEntryTokens[bi].type !== 'blockquote_close') {
            if (classEntryTokens[bi].type === 'inline') bqContent = classEntryTokens[bi].content;
            bi++;
          }
          bodyPartsHtml += '<p class="dc-flavor">' + md.renderInline(bqContent) + '</p>\n';
          ci = bi;
          continue;
        }
        if (ctok.type === 'inline' && ctok.content.trim() !== '') {
          bodyPartsHtml += '<p>' + md.renderInline(ctok.content) + '</p>\n';
        }
      }
      let html = '<div class="dc-class-entry">\n';
      if (portraitHtml) html += portraitHtml;
      html += '<div class="dc-class-entry-body">\n';
      if (entryNameHtml) html += entryNameHtml;
      html += '<div class="dc-class-entry-tags">\n';
      html += '  <span class="dc-classtag ' + esc(specialtySlug) + '"><span class="dc-classtag-dot"></span>' + esc(specialtyLabel) + '</span>\n';
      html += '</div>\n';
      html += bodyPartsHtml;
      html += '</div>\n</div>\n';
      newTokens.push(makeToken('html_block', html));
    }

    closeSpecialty();

    state.tokens = newTokens;
  });

}

/**
 * Plugin metadata for print-md
 */
export const metadata = {
  name: 'dimm-city-plugin',
  version: '17.1.1',
  description: 'Dimm City TTRPG skill cards - supports H3/H4, bullet lists, numbered abilities',
  author: 'Dimm City',
  keywords: ['ttrpg', 'rpg', 'skills', 'dimm-city'],
};
