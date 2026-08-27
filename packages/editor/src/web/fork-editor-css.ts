/**
 * SFE-P2a Lane A — the fork's own editor-chrome CSS, embedded as plain TS
 * string constants so `mountEditor` can inject it into a real
 * `<style>` element without any bundler-specific CSS-import
 * mechanism (`?raw`, `with { type: \"text\" }`, a CSS loader, ...). This package
 * is consumed as raw TS source by whatever bundler the HOST happens to use
 * (Vite for the desktop app, esbuild for the VS Code webview, Bun for this
 * package's own tests) — a literal exported string is the one representation
 * every one of those hosts can compile identically, with zero configuration
 * this package does not itself own. This mirrors an existing repo pattern
 * for exactly this problem: `packages/cli`'s `MARKER_CSS`/`GUTTERPRESS_CSS`
 * (see CLAUDE.md §6) ship author-facing CSS the same way, as committed TS
 * string constants rather than bundler-loaded CSS files.
 *
 * SOURCE OF TRUTH: the two constants below are the fork's own source CSS
 * files, verbatim (comments included — they are real documentation, not
 * runtime-affecting, and cost nothing extra once escaped), at the pinned
 * fork version recorded below, with exactly two mechanical changes:
 *
 *   - every backtick, backslash, and `${` sequence is escaped so the text
 *     survives unmodified inside this file's own template-literal wrapper
 *     (the source comments are full of backtick-quoted class names, e.g.
 *     `\`.md-cursor\`` in the original — escaped mechanically, not by hand,
 *     so this is a faithful copy, not a paraphrase);
 *   - `editor.css`'s own two leading `@import` statements (`@vscode/codicons
 *     /dist/codicon.css` and `../contrib/find/find.css`) are removed — an
 *     `@import` inside a `<style>` element injected by `mountEditor` resolves
 *     relative to the HOST DOCUMENT's URL, not the package's own file
 *     location, so leaving them in would 404 in every real host except the
 *     one test harness that happens to serve matching routes
 *     (tests/browser-harness/server.ts). Both are OUT OF SCOPE for this run:
 *     codicon.css only supplies the glyph for the (decorative) readonly-
 *     toggle icon and the (unused, no find/replace UI wired up yet) find
 *     widget's icons; find.css styles that same unused find widget. Missing
 *     either is a decorative gap, not a functional one — the fork's own file
 *     header calls `editor.css` the "ABSOLUTE MINIMUM ... functional chrome,"
 *     which is exactly the part kept here in full. A later run that wires up
 *     toolbar/find UI (P2a Lane B, P3b) should revisit whether those two
 *     assets need to join this embedded bundle or arrive through the host's
 *     own presentation context (D7/G-03) instead — see mount.ts's own header
 *     for why CSS is this package's responsibility for THIS layer only, not
 *     the book/theme layer.
 *
 * Regenerating after an upstream/fork CSS change: re-run the same
 * mechanical steps (strip the two `@import` lines, escape
 * `\\`/`\``/`${` for a template literal, nothing else) against the
 * fork's `src/view/editor.css` and `src/view/themes/default.css`. This file's
 * content is mechanically derived, not hand-authored — treat a diff here as
 * a diff of those two upstream files, not of this package's own logic.
 *
 * Pinned fork version this copy was taken from (packages/vscode-markdown-editor
 * /package.json's `gutterpressFork` block): upstreamVersion 0.0.2-84,
 * upstreamGitHead b5fd5cda44376c118dd383f8c03ac4f6a06c648e, fork version
 * 0.0.2-84.gp.1.
 */

/**
 * `@dimm-city/vscode-markdown-editor`'s `src/view/editor.css` — the fork's
 * theme-agnostic functional chrome (cursor, selection, source markers,
 * active-block highlight, task-list checkbox, table/list layout). Every
 * mount needs this regardless of which (if any) typography theme is
 * layered on top of it.
 */
export const FORK_EDITOR_BASE_CSS: string = `
/*
 * Base editor styles — ABSOLUTE MINIMUM.
 *
 * Only the *functional* chrome the editor needs regardless of theme:
 * positioning, source markers, the rendered cursor/selection, the
 * active-block highlight, the task-list checkbox widget, and the structural
 * layout that keeps active/inactive rendering identical (markers in the
 * gutter, list paragraphs inline).
 *
 * NO markdown-content typography lives here (fonts, sizes, colors,
 * heading/paragraph/blockquote/table spacing). That lives in opt-in, scoped
 * theme files (\`themes/default.css\`, \`themes/github.css\`) applied via the
 * \`classNames\` editor option; those selectors only ever match inside their
 * own theme class and never style the global scope.
 *
 * NO \`--vscode-*\` variables may be referenced here. This base file must stay
 * theme-agnostic and know nothing about VS Code. Where a value needs to vary
 * per theme, expose a local \`--md-*\` custom property WITH a sensible literal
 * fallback (e.g. \`var(--md-cursor-background, #000)\`) and let a theme file set
 * it. Only the \`themes/vscode-*.css\` themes are permitted to read \`--vscode-*\`
 * variables and map them onto these \`--md-*\` properties.
 */

.md-editor {
	display: flow-root;
	outline: none;
	/* The editor paints its own cursor (\`.md-cursor\`); hide the native caret. */
	caret-color: transparent;
}

.md-editor-a11y-status {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border: 0;
}

/*
 * The transient empty paragraph — the blank line conjured by pressing Enter at
 * the end of a paragraph (see \`PendingParagraph\` in the model). It is not part
 * of the document (Markdown has no empty-paragraph node); it holds a single
 * \`<br>\` so it occupies one line's height, and the caret is painted over it.
 */
.md-pending-paragraph {
	min-height: 1em;
}

/*
 * Inner content container. Holds the rendered document and the cursor/selection
 * overlays, which position themselves relative to this box, so it is the
 * positioning context. In limited-width mode the editor sets an inline
 * \`max-width\` here and the auto inline margins center it within the full-width
 * \`.md-editor\`. The block-start padding keeps every document clear of the top
 * edge, independent of the first block's theme margins.
 */
.md-editor-content {
	--md-editor-content-inline-start-padding: 48px;
	--md-readonly-toggle-width: 58px;
	--md-readonly-toggle-height: 32px;
	/* Leaves 16px of optical separation beyond the active block's 8px outset glow. */
	--md-readonly-toggle-gap: 24px;
	--md-readonly-toggle-inset: 4px;
	--md-editor-content-inline-end-padding: var(--md-editor-content-inline-start-padding);
	position: relative;
	margin-inline: auto;
	padding-block: 24px 0;
	padding-inline: var(--md-editor-content-inline-start-padding) var(--md-editor-content-inline-end-padding);
}

.md-editor-content-with-readonly-toggle {
	--md-editor-content-inline-end-padding: calc(var(--md-readonly-toggle-width) + var(--md-readonly-toggle-gap) + var(--md-readonly-toggle-inset));
}

.md-editor-content-with-readonly-toggle>.md-document :is(.md-heading, .md-paragraph) {
	overflow-wrap: anywhere;
}

.md-block-active {
	background: var(--md-block-active-background, #f8f8f8);
	border-radius: 4px;
	box-shadow: 0 0 0 8px var(--md-block-active-background, #f8f8f8);
}

/*
 * The whole-empty-document case. Markdown has no empty-paragraph node, so a
 * document with no content parses to a single empty paragraph (see
 * \`_ensureBlocks\` in the parser) which renders as a childless \`<p>\` of zero
 * height. Give it one line's height so the editor presents an intentional,
 * clickable empty editing surface — and so typing the first character causes no
 * layout shift (a filled line is also one \`lh\` tall).
 */
.md-paragraph:empty {
	min-height: 1lh;
}

/*
 * ...and never paint the active-block card over that zero-content line: with no
 * text to size it, the card's background + 8px box-shadow glow would show up as
 * a stray gray bar. The two extra classes outrank the base \`.md-block-active\`
 * rule above in every theme (themes only remap \`--md-block-active-background\`).
 */
.md-paragraph:empty.md-block-active {
	background: transparent;
	box-shadow: none;
}

/*
 * Cursor mirrors the same open affordance as the underline below: the anchor's
 * pointer cursor appears exactly when a click would open the link. An inactive
 * (rendered) link opens on a plain click, so it keeps the browser's default
 * anchor pointer. Once its block is active a plain click places the caret, so
 * the link shows the normal editing cursor — except while Ctrl/Cmd is held
 * (\`.md-mod-down\`), when a click opens it and the pointer returns.
 */
.md-block-active a {
	cursor: inherit;
}

.md-editor.md-mod-down .md-block-active a[href] {
	cursor: pointer;
}

/*
 * Link underline is an "open affordance": show it only while a click on the
 * link right now would actually open it. An inactive (rendered) link opens on
 * a plain click, so hovering it underlines. An active link's plain click edits
 * its source — it only opens with Ctrl/Cmd — so it underlines on hover only
 * while that modifier is held (\`.md-mod-down\`, set live by the view).
 */
.md-editor a[href]:hover {
	text-decoration: underline;
}

.md-editor:not(.md-mod-down) .md-block-active a[href]:hover {
	text-decoration: none;
}

.md-rich-link {
	display: inline-flex;
	align-items: baseline;
	max-width: min(100%, 52rem);
	box-sizing: border-box;
	gap: 0.24em;
	padding: 1px 0.3em;
	border: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground, #0969da) 24%, transparent);
	border-radius: 0.3em;
	background: var(--vscode-button-secondaryBackground, #f3f3f3);
	color: inherit;
	font-size: 1em;
	line-height: 1.25;
	text-decoration: none;
	vertical-align: baseline;
	white-space: nowrap;
	cursor: pointer;
	--md-rich-link-success-color: var(--vscode-charts-green, #1f883d);
}

.md-rich-link:hover {
	border-color: var(--vscode-focusBorder, color-mix(in srgb, currentColor 42%, transparent));
	background: var(--vscode-button-secondaryHoverBackground, #e5e5e5);
	text-decoration: none;
}

.md-rich-link:focus-visible {
	outline: 1px solid var(--vscode-focusBorder, currentColor);
	outline-offset: 1px;
}

.md-rich-link-icon {
	flex: none;
	align-self: center;
	font-size: 0.92em;
	color: color-mix(in srgb, var(--vscode-textLink-foreground, #0969da) 78%, currentColor);
}

.md-rich-link-label,
.md-rich-link-title,
.md-rich-link-detail {
	overflow: hidden;
	text-overflow: ellipsis;
}

.md-rich-link-label,
.md-rich-link-title {
	flex: 0 1 auto;
	min-width: 0;
	color: var(--vscode-textLink-foreground, currentColor);
	font-weight: 600;
}

.md-rich-link-title {
	max-width: 200px;
}

.md-rich-link[data-md-rich-link-kind='session'] :is(.md-rich-link-label, .md-rich-link-title) {
	max-width: 150px;
}

.md-rich-link-label[hidden],
.md-rich-link-title[hidden],
.md-rich-link-reference[hidden] {
	display: none;
}

.md-rich-link-reference {
	flex: none;
	color: var(--vscode-descriptionForeground, color-mix(in srgb, currentColor 72%, transparent));
	font-size: 0.92em;
}

.md-rich-link-detail {
	flex: 1 1 auto;
	min-width: 1.5em;
	color: var(--vscode-descriptionForeground, color-mix(in srgb, currentColor 72%, transparent));
	font-size: 0.92em;
}

.md-rich-link-detail::before {
	content: '·';
	margin-right: 0.28em;
}

.md-rich-link-status {
	flex: none;
	display: inline-flex;
	align-self: center;
	align-items: center;
	gap: 0.22em;
	margin-left: 0.04em;
	color: var(--vscode-descriptionForeground, currentColor);
	font-size: 0.86em;
	font-weight: 600;
	line-height: 1;
}

.md-rich-link-detail[hidden],
.md-rich-link-changes[hidden],
.md-rich-link-status[hidden] {
	display: none;
}

.md-rich-link-changes {
	flex: none;
	display: inline-flex;
	align-self: center;
	gap: 0.28em;
	font-size: 0.86em;
	font-weight: 600;
	line-height: 1;
}

.md-rich-link-changes::before,
.md-rich-link:not(
	[data-md-rich-link-kind='issue'],
	[data-md-rich-link-kind='pullRequest'],
	[data-md-rich-link-kind='session']
) .md-rich-link-primary-status::before {
	content: '·';
	color: var(--vscode-descriptionForeground, currentColor);
	font-weight: 400;
}

.md-rich-link-insertions {
	color: var(--vscode-charts-green, #1f883d);
}

.md-rich-link-deletions {
	color: var(--vscode-charts-red, #cf222e);
}

.md-rich-link-status-icon {
	flex: none;
	align-self: center;
	font-size: 1em;
}

.md-rich-link:is(
	[data-md-rich-link-status='open'],
	[data-md-rich-link-status='closed'],
	[data-md-rich-link-status='merged'],
	[data-md-rich-link-status='draft'],
	[data-md-rich-link-status='notPlanned']
) .md-rich-link-primary-status {
	color: var(--md-rich-link-state-color);
}

.md-rich-link-secondary-status {
	margin-left: 0.06em;
}

.md-rich-link-secondary-status::before {
	content: '·';
	margin-right: 0.08em;
	color: var(--vscode-descriptionForeground, currentColor);
	font-weight: 400;
}

.md-rich-link:is(
	[data-md-rich-link-status='open'],
	[data-md-rich-link-status='closed'],
	[data-md-rich-link-status='merged'],
	[data-md-rich-link-status='draft'],
	[data-md-rich-link-status='notPlanned']
) .md-rich-link-primary-status {
	align-self: baseline;
	padding: 0;
	border: 0;
	border-radius: 0;
	background: transparent;
	font-size: 1em;
	line-height: inherit;
}

.md-rich-link[data-md-rich-link-status='success'] .md-rich-link-primary-status {
	color: var(--vscode-charts-green, #1f883d);
}

.md-rich-link[data-md-rich-link-secondary-status='success'] .md-rich-link-secondary-status {
	color: var(--md-rich-link-success-color);
}

.md-rich-link[data-md-rich-link-status='warning'] .md-rich-link-primary-status,
.md-rich-link[data-md-rich-link-secondary-status='warning'] .md-rich-link-secondary-status {
	color: var(--vscode-editorWarning-foreground, #bf8700);
}

.md-rich-link[data-md-rich-link-status='error'] .md-rich-link-primary-status,
.md-rich-link[data-md-rich-link-secondary-status='error'] .md-rich-link-secondary-status {
	color: var(--vscode-errorForeground, #cf222e);
}

.md-rich-link[data-md-rich-link-status='pending'] .md-rich-link-primary-status,
.md-rich-link[data-md-rich-link-secondary-status='pending'] .md-rich-link-secondary-status {
	color: var(--vscode-editorWarning-foreground, #bf8700);
}

.md-rich-link[data-md-rich-link-kind='issue'] .md-rich-link-primary-status .md-rich-link-status-label,
.md-rich-link[data-md-rich-link-kind='pullRequest'] :is(
	.md-rich-link-primary-status,
	.md-rich-link-secondary-status
) .md-rich-link-status-label {
	display: none;
}

.md-rich-link[data-md-rich-link-status='open'] {
	--md-rich-link-state-color: var(--vscode-charts-green, #1f883d);
}

.md-rich-link[data-md-rich-link-kind='issue'][data-md-rich-link-status='closed'],
.md-rich-link[data-md-rich-link-status='merged'] {
	--md-rich-link-state-color: var(--vscode-charts-purple, #8250df);
}

.md-rich-link[data-md-rich-link-kind='pullRequest'][data-md-rich-link-status='closed'] {
	--md-rich-link-state-color: var(--vscode-charts-red, #cf222e);
}

.md-rich-link[data-md-rich-link-status='draft'],
.md-rich-link[data-md-rich-link-status='notPlanned'] {
	--md-rich-link-state-color: var(--vscode-descriptionForeground, #656d76);
}

.md-rich-link[data-md-rich-link-kind='pullRequest'][data-md-rich-link-secondary-status='error'] .md-rich-link-secondary-status {
	color: var(--vscode-charts-red, var(--vscode-errorForeground, #cf222e));
}

.md-rich-link:is(
	[data-md-rich-link-kind='issue'],
	[data-md-rich-link-kind='pullRequest']
) {
	align-items: center;
	gap: 4px;
	padding: 1px 6px;
	border-color: var(--vscode-button-secondaryBorder, var(--vscode-button-border, transparent));
	border-radius: 4px;
	background: var(--vscode-button-secondaryBackground, #f3f3f3);
	color: var(--vscode-button-secondaryForeground, #242424);
	font-size: 1em;
	line-height: 1.25;
	vertical-align: -0.5px;
}

.md-rich-link:is(
	[data-md-rich-link-kind='issue'],
	[data-md-rich-link-kind='pullRequest']
):hover {
	border-color: var(--vscode-button-secondaryBorder, var(--vscode-button-border, transparent));
	background: var(--vscode-button-secondaryHoverBackground, #e5e5e5);
	color: var(--vscode-button-secondaryForeground, #242424);
}

.md-rich-link:is(
	[data-md-rich-link-kind='issue'],
	[data-md-rich-link-kind='pullRequest']
) .md-rich-link-reference {
	display: none;
}

.md-rich-link:is(
	[data-md-rich-link-kind='issue'],
	[data-md-rich-link-kind='pullRequest']
) :is(
	.md-rich-link-label,
	.md-rich-link-title,
	.md-rich-link-primary-status,
	.md-rich-link-secondary-status
) {
	align-self: center;
	font-size: inherit;
	line-height: inherit;
}

.md-rich-link:is(
	[data-md-rich-link-kind='issue'],
	[data-md-rich-link-kind='pullRequest']
) :is(.md-rich-link-label, .md-rich-link-title) {
	position: relative;
	top: 0.25px;
	max-width: 200px;
	color: inherit;
	font-weight: 400;
}

.md-rich-link:is(
	[data-md-rich-link-kind='issue'],
	[data-md-rich-link-kind='pullRequest']
) .md-rich-link-status {
	align-items: center;
	height: 1.25em;
}

.md-rich-link:is(
	[data-md-rich-link-kind='issue'],
	[data-md-rich-link-kind='pullRequest']
) .md-rich-link-status-icon {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 12px;
	height: 12px;
	font-size: 12px;
	line-height: 12px;
}

.md-rich-link:is(
	[data-md-rich-link-kind='issue'],
	[data-md-rich-link-kind='pullRequest']
) .md-rich-link-secondary-status::before {
	align-self: center;
	line-height: inherit;
}

.md-rich-link[data-md-rich-link-kind='session'] {
	align-items: center;
	gap: 4px;
	padding: 1px 6px;
	border-color: var(--vscode-chat-requestBorder, var(--vscode-input-border, color-mix(in srgb, currentColor 24%, transparent)));
	border-radius: 4px;
	background: var(--vscode-button-secondaryBackground, #f3f3f3);
	color: var(--vscode-descriptionForeground, #656d76);
	font-size: 1em;
	font-weight: var(--vscode-agents-fontWeight-regular, 400);
	line-height: 1.25;
	vertical-align: baseline;
}

.md-rich-link[data-md-rich-link-kind='session']:hover {
	border-color: var(--vscode-chat-requestBorder, var(--vscode-input-border, color-mix(in srgb, currentColor 24%, transparent)));
	background: var(--vscode-toolbar-hoverBackground, color-mix(in srgb, currentColor 8%, transparent));
}

.md-rich-link[data-md-rich-link-kind='session'] :is(.md-rich-link-label, .md-rich-link-title) {
	color: inherit;
	font-weight: 400;
}

.md-rich-link[data-md-rich-link-kind='session'] .md-rich-link-primary-status {
	align-self: center;
	align-items: center;
	width: 12px;
	height: 12px;
	margin: 0;
	padding: 0;
	border: 0;
	border-radius: 0;
	background: transparent;
	font-size: 1em;
	line-height: inherit;
}

.md-rich-link[data-md-rich-link-kind='session'] .md-rich-link-primary-status .md-rich-link-status-label {
	display: none;
}

.md-rich-link[data-md-rich-link-kind='session'] .md-rich-link-status-icon:not(.monaco-pixel-spinner, [hidden]) {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 12px;
	height: 12px;
	font-size: 12px;
	line-height: 12px;
}

.md-rich-link .md-rich-link-status-icon[hidden] {
	display: none;
}

.md-rich-link[data-md-rich-link-kind='session'][data-md-rich-link-status='neutral'] .md-rich-link-primary-status,
.md-rich-link[data-md-rich-link-kind='session'][data-md-rich-link-status='success'] .md-rich-link-primary-status,
.md-rich-link[data-md-rich-link-kind='session'][data-md-rich-link-status='pending'] .md-rich-link-primary-status {
	color: var(--vscode-descriptionForeground, #656d76);
}

.md-rich-link .monaco-pixel-spinner {
	display: inline-grid;
	grid-template-columns: repeat(2, 2px);
	grid-template-rows: repeat(3, 2px);
	column-gap: 2px;
	row-gap: 2px;
	place-content: center;
	width: 16px;
	height: 16px;
	color: currentColor;
	contain: layout style size paint;
	isolation: isolate;
	pointer-events: none;
	transform: translateZ(0);
}

.md-rich-link[data-md-rich-link-kind='session'] .monaco-pixel-spinner {
	width: 12px;
	height: 12px;
}

.md-rich-link .monaco-pixel-spinner-dot {
	display: block;
	width: 2px;
	height: 2px;
	border-radius: 50%;
	background-color: currentColor;
	opacity: 0;
	transform: translateY(-4px);
	animation: monaco-pixel-spinner-dot-cycle 1820ms steps(6, jump-none) infinite;
}

.md-rich-link .monaco-pixel-spinner-dot:nth-child(1) {
	animation-delay: 520ms;
}

.md-rich-link .monaco-pixel-spinner-dot:nth-child(2) {
	animation-delay: 650ms;
}

.md-rich-link .monaco-pixel-spinner-dot:nth-child(3) {
	animation-delay: 260ms;
}

.md-rich-link .monaco-pixel-spinner-dot:nth-child(4) {
	animation-delay: 390ms;
}

.md-rich-link .monaco-pixel-spinner-dot:nth-child(5) {
	animation-name: monaco-pixel-spinner-dot-cycle-long;
}

.md-rich-link .monaco-pixel-spinner-dot:nth-child(6) {
	animation-name: monaco-pixel-spinner-dot-cycle-short;
	animation-delay: 130ms;
}

.md-rich-link .monaco-pixel-spinner-ring .monaco-pixel-spinner-dot {
	opacity: 0.25;
	transform: none;
	animation: monaco-pixel-spinner-ring-pulse 1200ms steps(4, jump-none) infinite;
}

.md-rich-link .monaco-pixel-spinner-ring .monaco-pixel-spinner-dot:nth-child(1) {
	animation-delay: 0ms;
}

.md-rich-link .monaco-pixel-spinner-ring .monaco-pixel-spinner-dot:nth-child(2) {
	animation-delay: 200ms;
}

.md-rich-link .monaco-pixel-spinner-ring .monaco-pixel-spinner-dot:nth-child(3) {
	animation-delay: 1000ms;
}

.md-rich-link .monaco-pixel-spinner-ring .monaco-pixel-spinner-dot:nth-child(4) {
	animation-delay: 400ms;
}

.md-rich-link .monaco-pixel-spinner-ring .monaco-pixel-spinner-dot:nth-child(5) {
	animation-delay: 800ms;
}

.md-rich-link .monaco-pixel-spinner-ring .monaco-pixel-spinner-dot:nth-child(6) {
	animation-delay: 600ms;
}

@keyframes monaco-pixel-spinner-dot-cycle {
	0% {
		opacity: 0;
		transform: translateY(-4px);
	}
	9.34%, 57.14% {
		opacity: 1;
		transform: translateY(0);
	}
	66.48%, 100% {
		opacity: 0;
		transform: translateY(7px);
	}
}

@keyframes monaco-pixel-spinner-dot-cycle-long {
	0% {
		opacity: 0;
		transform: translateY(-4px);
	}
	9.34%, 64.29% {
		opacity: 1;
		transform: translateY(0);
	}
	73.63%, 100% {
		opacity: 0;
		transform: translateY(7px);
	}
}

@keyframes monaco-pixel-spinner-dot-cycle-short {
	0% {
		opacity: 0;
		transform: translateY(-4px);
	}
	9.34%, 50% {
		opacity: 1;
		transform: translateY(0);
	}
	59.34%, 100% {
		opacity: 0;
		transform: translateY(7px);
	}
}

@keyframes monaco-pixel-spinner-ring-pulse {
	0%, 100% {
		opacity: 0.25;
		transform: none;
	}
	16.67% {
		opacity: 1;
		transform: none;
	}
}

@media (prefers-reduced-motion: reduce) {
	.md-rich-link .monaco-pixel-spinner-dot {
		animation: none;
		opacity: 1;
		transform: translateY(0);
	}
}

.md-rich-link[data-md-rich-link-kind='session'][data-md-rich-link-status='warning'] .md-rich-link-primary-status {
	color: var(--vscode-list-warningForeground, #855f00);
}

.md-rich-link[data-md-rich-link-kind='session'][data-md-rich-link-status='warning'] {
	border-color: var(--vscode-list-warningForeground, #855f00);
	background-color: color-mix(in srgb, var(--vscode-list-warningForeground, #855f00) 12%, transparent);
	color: var(--vscode-list-warningForeground, #855f00);
}

.md-rich-link[data-md-rich-link-kind='session'][data-md-rich-link-status='error'] .md-rich-link-primary-status {
	color: var(--vscode-errorForeground, #cf222e);
}

.md-rich-link-unavailable {
	border-style: dashed;
}

.md-fence-spacer {
	visibility: hidden;
	font-family: 'Cascadia Code', 'Fira Code', monospace;
	font-size: 0.85em;
}

.md-marker {
	color: #999;
	font-family: 'Cascadia Code', 'Fira Code', monospace;
	/*
	 * Revealed source is painted a step smaller than body text. Published as a
	 * custom property because a gutter marker has to undo it to size its box
	 * against the body line box — see \`.md-list-item-active>.md-marker-listItemMarker\`.
	 */
	--md-marker-font-scale: 0.85;
	font-size: calc(1em * var(--md-marker-font-scale));
	display: inline;
	overflow: hidden;
	max-width: 100px;
	opacity: 1;
	line-height: 1;
}

.md-marker-hidden {
	display: none;
}

/*
 * Active thematic break: the source markup (\`---\`) shown in place of the
 * rendered rule, in the muted monospace used for all revealed source. Rendered
 * inline-block so the hostless trailing gap (its \`\\n\\n\`, revealed as \`↵\`
 * glyphs) flows on the same line, to the right of the \`---\`.
 */
.md-thematic-break-source {
	display: inline-block;
	color: #999;
	font-family: 'Cascadia Code', 'Fira Code', monospace;
	font-size: 0.85em;
	white-space: pre-wrap;
}

/*
 * An unhandled block: a construct the parser does not model (setext heading,
 * an extension token). Its raw source is shown verbatim,
 * styled like a code block but visibly flagged as "not understood" by a dashed
 * warning border, so the content is preserved and editable rather than silently
 * dropped.
 *
 * The wrapper is the non-scrolling box (border + block spacing); the inner
 * \`.md-unhandled-scroll\` <pre> is the horizontal scroller.
 */
.md-unhandled-block {
	margin: 0.5em 0;
	border: 1px dashed #d0a000;
	border-radius: 4px;
}

/*
 * Inner scroller. Beats the per-theme \`.md-theme-* .md-code-block\` box rules
 * (same class count) via the extra \`pre\` type selector: no margin/border of its
 * own (those live on the wrapper).
 */
pre.md-unhandled-scroll.md-code-block {
	margin: 0;
	border: 0;
	border-radius: 4px;
}

/*
 * Complete block HTML comments are authoring metadata, not unsupported-syntax
 * warnings. Keep them source-identifiable but quiet while reading, and reveal
 * their exact whitespace when the block becomes active.
 */
.md-html-comment {
	margin: 0.125em 0 0.25em;
	padding: 0.125em 0;
	overflow: hidden;
	color: var(--md-html-comment-foreground, #6e7378);
	font-family: var(--md-html-comment-font-family, 'Cascadia Code', 'Fira Code', monospace);
	font-size: 0.85em;
	line-height: 1.5;
	text-overflow: ellipsis;
	white-space: nowrap;
	transition: color 80ms ease-out;
}

.md-html-comment:not(.md-html-comment-source):hover {
	color: var(--md-html-comment-hover-foreground, #45494e);
}

.md-html-comment-source {
	overflow: visible;
	text-overflow: clip;
	white-space: pre-wrap;
}

.md-html-comment-syntax {
	opacity: 0.6;
}

.md-html-comment-source .md-html-comment-syntax {
	opacity: 1;
}

/*
 * Visible whitespace indicators, shown only in the active/source view. The real
 * whitespace character stays in the DOM (so source ↔ DOM mapping and selection
 * are unaffected); the glyph is a pure CSS overlay. Spaces and tabs overlay
 * their glyph (keeping the character's own width), while a newline shows its
 * glyph inline since the line ending collapses to zero/again width.
 */
.md-ws-space,
.md-ws-tab {
	position: relative;
	/*
	 * Each decorated whitespace span wraps a single space/tab and is made
	 * non-collapsing, so adjacent dots in a run like \`foo  bar\` each keep their
	 * own width (two dots, not one). Scoping this to the span — rather than
	 * preserving whitespace on the whole leaf — leaves a literal \`\\n\` in the
	 * source (e.g. a hard break's holder) collapsible, so only the \`<br>\`
	 * breaks the line and no stray empty line appears.
	 */
	white-space: pre;
}

/*
 * A decorated text leaf needs no special whitespace handling of its own: its
 * non-obvious whitespace is kept from collapsing by the \`white-space: pre\` on
 * the individual indicator spans (see \`.md-ws-space\`), and plain runs between
 * them never contain consecutive spaces.
 */
.md-ws-space::before,
.md-ws-tab::before {
	position: absolute;
	left: 0;
	right: 0;
	text-align: center;
	color: #b0b0b0;
	pointer-events: none;
}

.md-ws-space::before {
	content: '·';
}

.md-ws-tab::before {
	content: '⇥';
}

.md-ws-newline::before {
	content: '↵';
	color: #b0b0b0;
	pointer-events: none;
}

/*
 * Inter-block gap newline rendered as a real \`↵\` glyph character (see the
 * \`newlineGlyph\` whitespace mode). Unlike \`.md-ws-newline\` it has no \`::before\`
 * overlay — the glyph is the character's own text, so it keeps its own width and
 * its selection box coincides exactly with the glyph (every newline is
 * individually selectable). It is not whitespace, so it never collapses.
 */
.md-ws-newline-glyph {
	color: #b0b0b0;
}

/*
 * The structural block break: the leading newline of an inter-block gap (a
 * \`blockBreak\` glue) — the \`\\n\` that starts the next block. Painted as a real
 * \`↵\` glyph like \`.md-ws-newline-glyph\`, but blue, to distinguish "this newline
 * splits two blocks" (delete it and they merge) from the neutral blank-line
 * glyphs that follow. A soft break inside a single block stays neutral.
 */
.md-ws-blockbreak-glyph {
	color: #4a90d9;
}

/*
 * Hard line break: the \`<br>\` always renders so the line breaks in both views;
 * the break's source characters are revealed only while the block is active.
 * The holder keeps default whitespace handling so its literal \`\\n\` collapses
 * (only the \`<br>\` breaks the line); the trailing spaces stay visible because
 * each decorated dot span is non-collapsing (see \`.md-ws-space\`).
 *
 * The break's source markers are painted in the same blue as the structural
 * block break (\`.md-ws-blockbreak-glyph\`) to signal a deliberate, structural
 * line break rather than incidental whitespace: both trailing-space dots (drawn
 * via \`.md-ws-space::before\`, so their colour is overridden there) and the
 * escape backslash (the holder's own text).
 */
.md-hardbreak-src {
	color: #4a90d9;
}

.md-hardbreak-src .md-ws-space::before {
	color: #4a90d9;
}

.md-hardbreak-src-hidden {
	display: none;
}

/*
 * Glue normally keeps its inline footprint when hidden so source padding and
 * widget gutters stay identical between active and inactive states. Hidden
 * table-cell glue is the exception below: leaving it in inline flow lets its
 * invisible spaces wrap around long cell content.
 */
.md-glue-hidden {
	display: inline;
	visibility: hidden;
}

/*
 * Inactive table pipes stay in the DOM/source tree, but leave layout and
 * hit-testing entirely. Keeping an invisible rect either in the content flow or
 * over the cell padding can create phantom lines or steal clicks from visible
 * text. Hidden source offsets therefore collapse to the neighboring semantic
 * seam, matching other display-none markers. Visible pipes retain the per-theme
 * active/source layout.
 */
.md-table td>.md-glue-tableCellGlue.md-glue-hidden {
	display: none;
}

/*
 * Active table: take each cell's TRAILING structural glue (the source space
 * after the cell text, and — via the per-theme \`right: 0\` rule — the last
 * column's closing \`|\`) out of the cell's inline flow. Left in flow, that glue
 * wraps below long cell content (the same wrapping the hidden-glue note above
 * describes), which makes the cell two lines tall: the browser's default
 * \`vertical-align: middle\` then re-centres the other cells' single-line content
 * in Y, their runs merge into one oversized VisualLine, and the caret — sized
 * directly from that line box — grows far past the line height while the
 * visible pipes drift apart row-to-row. Positioning the trailing glue
 * absolutely removes it from wrapping flow while keeping its real client rects
 * at the static (content-line) position, so caret placement, hit-testing,
 * source mapping and injectivity are unchanged. \`top\`/\`bottom: auto\` keep it on
 * that content line rather than the cell's top edge. This mirrors the inactive
 * \`display: none\` above; the leading \`| \` glue deliberately stays in flow (a
 * relative glyph shift, per theme) so first-text X is preserved.
 *
 * \`:not(:first-child)\` restricts this to a genuine trailing glue: a non-empty
 * cell emits leading + trailing glue, but an EMPTY cell parses to a single glue
 * node that is simultaneously first and last child. That lone node is the
 * cell's leading pipe, so it must stay in flow like every other leading pipe;
 * excluding it keeps empty cells identical to their previous (base) behaviour.
 */
.md-table.md-block-active td {
	position: relative;
}

.md-table.md-block-active td>.md-glue-tableCellGlue:last-child:not(:first-child) {
	position: absolute;
	top: auto;
	bottom: auto;
}

/*
 * Inter-block glue: the run of blank lines between two top-level blocks. It is
 * mounted as the last inline child of the block that precedes it, so it sits at
 * the end of that block's last line rather than on its own lines between the
 * blocks. When a neighbouring block is active it is revealed: each blank-line
 * newline shows a real \`↵\` glyph character (\`.md-ws-newline-glyph\`) while the
 * trailing line-terminator \`\\n\` collapses (\`white-space: normal\`) so the run
 * adds no line break and no height — active and inactive therefore have the
 * same height. When hidden it collapses to nothing.
 */
.md-glue-blockGap {
	white-space: normal;
}

/*
 * The structural block break between two top-level blocks. Like \`.md-glue-blockGap\`
 * its trailing line-terminator \`\\n\` collapses (\`white-space: normal\`) so the run
 * adds no height; its leading newline is painted as the blue break glyph
 * (\`.md-ws-blockbreak-glyph\`).
 */
.md-glue-blockBreak {
	white-space: normal;
}

/*
 * The task-list checkbox marker (\`[x]\`/\`[ ]\`) is special: instead of being
 * removed from layout when hidden, it keeps its inline width (visibility
 * hidden) and the rendered checkbox is overlaid on top of it. This keeps the
 * inline flow identical in active and inactive mode, so the text following
 * the marker does not drift horizontally when markers are toggled.
 */
.md-marker-checkbox.md-marker-hidden {
	display: inline;
	visibility: hidden;
}

/*
 * The code-block fences (\`\`\`lang / \`\`\`) each sit on their own source line. When
 * hidden they keep their vertical footprint (visibility hidden, not display
 * none) so the inactive block reserves the same two fence lines the active
 * block shows. This keeps the code block's height identical between active and
 * inactive, avoiding a layout shift on focus.
 */
.md-marker-openFence.md-marker-hidden,
.md-marker-closeFence.md-marker-hidden {
	display: inline;
	visibility: hidden;
}

/*
 * The table delimiter (\`| --- | --- |\`) row is collapsed entirely while the
 * table is inactive and revealed — compact, small font — while active. The
 * header reserves the matching vertical space when inactive (in the theme
 * files), so the total table height is unchanged between the two states.
 */
.md-table-delimiter-row {
	display: none;
}

.md-block-active .md-table-delimiter-row {
	display: table-row;
}

.md-table-delimiter-row td {
	padding: 0;
	font-size: 11px;
	line-height: 1;
	height: 16px;
}

/*
 * A wide table scrolls horizontally inside its wrapper (the block box) instead
 * of overflowing the page and scrolling the editor's fixed left gutter away.
 * The wrapper is the scroll viewport the selection/caret clipping measures (see
 * \`BlockViewNode.scrollElement\` / \`blockViewportClip\`); the inner \`<table>\`
 * keeps \`width: auto\` (theme-defined) so it sizes to its content and overflows.
 *
 * \`width: fit-content\` keeps the wrapper hugging the table's intrinsic width, so
 * a narrow table — and the active-block glow redirected onto the wrapper below —
 * stays as wide as the table (unchanged from before this wrapper existed).
 * \`max-width: 100%\` caps it at the content column, past which the table
 * overflows and scrolls locally. This is the standard responsive-table pattern
 * (cf. GitHub's own \`width: max-content; max-width: 100%\`).
 */
.md-table-wrapper {
	overflow-x: auto;
	width: fit-content;
	max-width: 100%;
}

/*
 * The active-block highlight is an *outset* glow (\`box-shadow: 0 0 0 8px\`).
 * Making the wrapper a scroll box (\`overflow-x: auto\`, which also forces
 * \`overflow-y: auto\`) clips descendant paint to its padding box, so the glow on
 * the inner active \`<table>\` would be cut off (the table has no horizontal
 * margin to give the shadow room). Render the generic active chrome on the
 * wrapper instead — a scroll box's own shadow is never clipped by its own
 * overflow, exactly like a code block carries the glow on its own scroller —
 * and drop it from the table, which keeps \`md-block-active\` purely for the
 * per-theme source-pipe styling.
 */
.md-table-wrapper:has(> .md-table.md-block-active) {
	background: var(--md-block-active-background, #f8f8f8);
	border-radius: 4px;
	box-shadow: 0 0 0 8px var(--md-block-active-background, #f8f8f8);
}

.md-table.md-block-active {
	background: none;
	box-shadow: none;
}

.md-selection-layer {
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	pointer-events: none;
	overflow: visible;
}

.md-selection-path {
	fill: rgba(59, 130, 246, 0.25);
}

/*
 * Gutter markers (source-control style change indicators). The layer fills the
 * content box; each marker is an absolutely-positioned bar pinned to the left
 * gutter (inside \`.md-editor-content\`'s 48px padding). The view sets only
 * \`top\`/\`height\`; horizontal placement, width and color live here so themes can
 * tune them without touching layout. Like the other overlays it never eats
 * pointer events.
 */
.md-gutter-layer {
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	pointer-events: none;
	overflow: visible;
}

.md-gutter-marker {
	position: absolute;
	left: var(--md-gutter-marker-left, 18px);
	width: var(--md-gutter-marker-width, 3px);
	border-radius: 2px;
}

.md-gutter-marker-added {
	background: var(--md-gutter-added, #2ea043);
}

.md-gutter-marker-modified {
	background: var(--md-gutter-modified, #0969da);
}

/*
 * A deletion has no lines to span, so it is drawn as a downward-pointing
 * triangle centered on the seam where the removed text used to be (the top of
 * the line that now follows it), matching the git deleted-lines affordance.
 */
.md-gutter-marker-deleted {
	width: 0;
	height: 0;
	border-radius: 0;
	border-left: var(--md-gutter-marker-width, 3px) solid var(--md-gutter-deleted, #cf222e);
	border-top: 4px solid transparent;
	border-bottom: 4px solid transparent;
	transform: translateY(-4px);
}

/* Source markers occupy the gutter so toggling them never shifts content. */
.md-heading {
	position: relative;
}

.md-heading>.md-marker:first-child {
	position: absolute;
	right: 100%;
	white-space: pre;
	top: 0;
	/* Match the heading's line box (font-size + line-height inherited) so the
	 * marker box equals the first text line at every heading level; then center
	 * the glyph vertically and shrink it back to the muted marker size. */
	font-size: inherit;
	line-height: inherit;
	height: 1lh;
	display: inline-flex;
	align-items: center;
	justify-content: flex-end;
	transform: scale(0.85);
	transform-origin: right center;
}

/*
 * The gutter rule above sets \`display: inline-flex\`, which outranks the plain
 * \`.md-marker-hidden { display: none }\` (more specific), so the marker must be
 * re-hidden here for the inactive heading — otherwise the \`#\` would always show.
 */
.md-heading>.md-marker-hidden:first-child {
	display: none;
}

/*
 * Block-quote prefixes (\`> \`, one per quoted source line) are real
 * \`blockQuoteMarker\` markers, siblings of the quote's child blocks. Each hangs
 * in the quote's left padding instead of taking inline width: its right edge is
 * pulled to the content edge (\`right: 100% - pad\`) so the \`>\` sits just left of
 * the quoted text, and \`top: auto\` keeps it on its own source line. Because the
 * markers add no inline width, the quoted text keeps the exact same x in active
 * and inactive mode (toggling the prefix never shifts content); because every
 * marker measures from the same content edge, the markers of one quote stack in
 * a single vertical column, and a nested quote — itself inset by the outer
 * quote's padding — forms its own column one level in.
 *
 * \`--md-blockquote-pad\` is the quote's own left padding, published by the theme
 * so this functional rule can find the content edge without hard-coding it.
 */
.md-blockquote {
	position: relative;
}

.md-blockquote>.md-marker-blockQuoteMarker {
	position: absolute;
	right: calc(100% - var(--md-blockquote-pad, 0px) - 1ch);
	top: auto;
	/*
	 * Reserve the optional-space column so adding it cannot move the \`>\` glyph,
	 * then shift and scale every active quote marker consistently to leave a
	 * virtual gap before body text without consuming source width. These tuned
	 * properties are shared by ordinary and marker-only quote lines.
	 */
	--md-blockquote-marker-shift: -0.18ch;
	--md-blockquote-marker-scale: 0.9;
	display: inline-flex;
	min-width: 2ch;
	font-size: inherit;
	line-height: inherit;
	height: 1lh;
	align-items: center;
	text-align: left;
	white-space: pre;
	transform: translateX(var(--md-blockquote-marker-shift)) scale(var(--md-blockquote-marker-scale));
	transform-origin: left center;
}

/* Inactive: gone entirely (the gutter is empty, the text stays put). */
.md-blockquote>.md-marker-blockQuoteMarker.md-marker-hidden {
	display: none;
}

/* Collapsed block-gap newlines still need one flow box per marker-only line. */
.md-blockquote-line-anchor {
	display: block;
}

/* A trailing marker-only source line follows the preceding quoted line directly. */
.md-blockquote-marker-only-line>.md-paragraph:last-of-type {
	margin-bottom: 0;
}

/* Code/math blocks scroll horizontally; their look is theme-defined. */
.md-code-block {
	overflow-x: auto;
}

.md-math-block {
	overflow-x: auto;
}

.md-list li>.md-paragraph {
	margin: 0;
}

.md-list li>.md-block {
	margin: 0;
}

.md-list li>.md-block+.md-block {
	margin-top: 0.25em;
}

.md-list-item-active {
	list-style: none;
	position: relative;
}

/*
 * The list marker is pulled into the gutter by markerKind (not \`:first-child\`),
 * because a nested item may carry its source indentation as a leading glue
 * before the marker. Gutter-positioning keeps the marker out of the inline
 * flow so toggling it never shifts the item's text horizontally.
 *
 * Vertical centring makes the marker box exactly the item's first line box and
 * centres the glyph in it. Getting that box right is the whole trick: an
 * inherited UNITLESS line-height is re-resolved against the element's own
 * font-size, so a marker shrunk by \`--md-marker-font-scale\` also gets a
 * proportionally shorter line box which, pinned at \`top: 0\`, floats the glyph
 * above the text. Dividing \`1lh\` by that same scale cancels the shrink exactly,
 * without touching the painted size and without a \`transform\` (which would
 * shrink the box the caret geometry is measured from).
 */
.md-list-item-active>.md-marker-listItemMarker {
	position: absolute;
	right: 100%;
	top: 0;
	line-height: inherit;
	height: calc(1lh / var(--md-marker-font-scale));
	display: inline-flex;
	align-items: center;
	justify-content: flex-end;
	white-space: pre;
}

/*
 * \`display: inline-flex\` above outranks the plain \`.md-marker-hidden\`
 * (\`display: none\`), so — exactly as for headings — re-hide the marker here for
 * the states that ask for it, otherwise the bullet could never be hidden.
 */
.md-list-item-active>.md-marker-listItemMarker.md-marker-hidden {
	display: none;
}

/*
 * An inactive ordered item uses the browser's native \`::marker\`. Match its
 * typography when revealing the source marker so switching the active item
 * does not change the number's width or horizontal position: an ordered marker
 * opts out of the muted size step entirely, which also makes the \`1lh\`
 * compensation above a no-op for it. Keep unordered source markers in the
 * standard muted monospace source style.
 */
ol.md-list>.md-list-item-active>.md-marker-listItemMarker,
ol.md-list>.md-list-item-active>.md-list-gutter>.md-marker-listItemMarker {
	font-family: inherit;
	--md-marker-font-scale: 1;
}

/*
 * A nested item's source indentation precedes its bullet (\`␣␣- text\`). The
 * indent glue and the bullet are mounted together in this gutter span, which is
 * pulled out of flow with its right edge at the content edge. The gutter itself
 * is shrink-to-fit: the dot run gets a fixed *structural* width of \`(level − 1)\`
 * indent steps and the bullet contributes its own intrinsic width on top, so the
 * gutter's left edge lands exactly one bullet-width left of the root content
 * column — i.e. aligned with the root bullet. The dot run's width is driven by
 * the nesting level rather than the literal source glyphs, so the dots fill the
 * whole indentation column, every level lines up in a vertical track aligned to
 * the root bullet, and a leading tab lands on the same column as the equivalent
 * spaces. The glue's revealed dots are spread across the column; the bullet sits
 * flush against the text. It is absolute in both states (not just active) so the
 * hidden indentation never widens the line.
 */
.md-list-gutter {
	position: absolute;
	right: 100%;
	display: flex;
	white-space: pre;
}

.md-list-gutter>.md-glue-indent {
	flex: 0 0 calc((var(--md-list-level, 1) - 1) * var(--md-list-indent-step, 2em));
	display: flex;
	justify-content: space-between;
}

.md-list-gutter>.md-marker-listItemMarker {
	flex: 0 0 auto;
}

/*
 * A NESTED item's bullet is a flex child of the gutter, so the direct-child
 * rule above cannot reach it and it would otherwise stretch to the gutter's
 * full height with its glyph parked at the top. Centring is therefore done by
 * the gutter itself: it is statically positioned (hence aligned to the item's
 * first line), so making it one line box tall and centring its children puts
 * the bullet and the indentation dots on that line.
 *
 * The gutter carries body typography, so its \`1lh\` needs no compensation — and
 * the bullet inside keeps its own muted \`font-size\`, which is exactly what the
 * shrink-to-fit gutter reserves. Shrinking the bullet visually instead would
 * make the gutter reserve more width than the bullet paints and slide the whole
 * indentation column left.
 */
.md-list-item-active>.md-list-gutter {
	height: 1lh;
	align-items: center;
}


/*
 * Re-attributed source indentation (the spaces after a line break that precede
 * a nested list) keeps its exact width in both states: \`white-space: pre\` so
 * the run does not collapse, paired with the hidden footprint of
 * \`.md-glue-hidden\` when inactive. This keeps the nested item's text at the
 * same horizontal position whether or not the indentation dots are shown.
 */
.md-glue-indent {
	white-space: pre;
}

/*
 * A continuation-line indent inside a paragraph is source-only padding. When
 * inactive, the preceding soft-break newline already collapses to the single
 * rendered space Markdown requires; retaining the hidden indent would add the
 * tab/space run's width on top of it.
 */
.md-paragraph>.md-glue-indent.md-glue-hidden {
	display: none;
}

/*
 * A loose list item's later block (its second paragraph etc.) owns the source
 * continuation indent that precedes it as its \`leadingTrivia\`. Like a nested
 * list's gutter, that indent glue is pulled out of flow to the left so it never
 * widens the line: the block's text stays aligned with the first paragraph
 * above it, and the indent dots only appear in the left margin when the block is
 * active (the footprint is identical in both states, so the text never shifts).
 */
.md-list li>.md-block,
.md-task-list-item>.md-block {
	position: relative;
}

.md-list li>.md-block>.md-glue-indent:first-child,
.md-task-list-item>.md-block>.md-glue-indent:first-child {
	position: absolute;
	right: 100%;
	top: 0;
}

.md-task-list-item {
	list-style: none;
	position: relative;
	/*
	 * Width of the checkbox / \`[x]\` source column. Single-sourced so the marker
	 * reservation on the first paragraph and the left indent of any following
	 * block (loose task items) stay in lockstep — keeping every block's text in
	 * one vertical column under the marker.
	 */
	--md-task-marker-width: 1.75em;
}

/*
 * Reserve the marker column on the paragraph rather than only on its first
 * inline child. This gives every wrapped line the same content edge. The
 * source marker glue is positioned over that reserved column, as is the
 * rendered checkbox, so activating the item does not shift its text (see the
 * compare fixture's \`checkMarkedTextX\` assertion).
 */
.md-task-list-item>.md-paragraph {
	padding-left: var(--md-task-marker-width);
}

.md-task-list-item>.md-paragraph>.md-glue:first-child {
	position: absolute;
	top: 0;
	left: 0;
	width: var(--md-task-marker-width);
}

/*
 * Following blocks in a loose task item (the second paragraph etc.) carry no
 * marker glue, so indent them by the marker column to line their text up under
 * the first paragraph's text rather than under the checkbox.
 */
.md-task-list-item>.md-block+.md-block {
	padding-left: var(--md-task-marker-width);
}

.md-checkbox {
	/* The rendered task-list widget — editor chrome, not markdown typography. */
	appearance: none;
	-webkit-appearance: none;
	margin: 0;
	width: 16px;
	height: 16px;
	border: 2px solid #bbb;
	border-radius: 3px;
	position: absolute;
	left: 0;
	top: 0.25em;
	z-index: 1;
	cursor: pointer;
	transition: background-color 0.15s ease, border-color 0.15s ease;
}

.md-checkbox:checked {
	background-color: #4c8bf5;
	border-color: #4c8bf5;
}

.md-checkbox:checked::after {
	content: '';
	position: absolute;
	left: 2.5px;
	top: -1px;
	width: 5px;
	height: 9px;
	border: solid white;
	border-width: 0 2px 2px 0;
	transform: rotate(45deg);
}

.md-checkbox:hover {
	border-color: #888;
}

/*
 * The rotating "broken rounded-square" progress ring for an inactive task item
 * whose text begins with the hidden \`:running:\` marker (see
 * \`ListItemViewData.isRunning\`). Rendered as a conic-gradient ring — masked so
 * only the ring (not its center) paints — with a transparent gap that spins,
 * reading as a segmented spinner rather than a checked/unchecked box.
 */
.md-checkbox-running,
.md-checkbox-running:checked {
	padding: 2px;
	border: 0;
	border-radius: 4px;
	background: conic-gradient(
		transparent 0deg 42deg,
		#bbb 62deg 360deg
	);
	-webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
	-webkit-mask-composite: xor;
	mask-composite: exclude;
	animation: md-checkbox-spin 0.8s linear infinite;
	opacity: 1;
}

@keyframes md-checkbox-spin {
	to {
		transform: rotate(360deg);
	}
}

.md-checkbox-running:hover {
	border-color: transparent;
}

.md-checkbox:checked:hover {
	background-color: #3a73d4;
	border-color: #3a73d4;
}

.md-checkbox:disabled {
	cursor: default;
	opacity: 0.6;
}

.md-checkbox-running:disabled {
	opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
	.md-checkbox-running {
		animation: none !important;
	}
}

/*
 * The \`:running:\` marker hidden from an inactive task item's rendered text
 * (see \`TextViewData.hiddenPrefixLength\`). It stays real, selectable source —
 * only visually hidden, per "Hidden markers remain real source" — so it takes
 * no layout space in either state.
 */
.md-runner-marker {
	display: none;
}

.md-cursor {
	position: absolute;
	width: 2px;
	background: var(--md-cursor-background, #000);
	pointer-events: none;
}

/*
 * The painted caret is only shown while the editor is genuinely focused — focus
 * rests inside it and its window is focused, mirrored onto the root as
 * \`.md-focused\`. When unfocused, hide the caret element but keep its layout box
 * (so caret geometry, selection and comment anchoring are unchanged) and stop
 * the blink. Adding the animation on focus restarts it from 0% (a solid caret).
 */
.md-editor:not(.md-focused) .md-cursor {
	visibility: hidden;
}

.md-editor.md-focused .md-cursor {
	animation: md-cursor-blink 1s step-end infinite;
}

/*
 * Read-only mode retains the logical caret for selection and comment anchoring.
 * Hide only its painted element so unlocking can restore it in place.
 */
.md-editor.md-readonly .md-cursor {
	visibility: hidden;
}

.md-editor.md-readonly-editing-attempt {
	animation: md-readonly-editing-attempt 300ms ease-out;
}

@keyframes md-readonly-editing-attempt {
	50% {
		box-shadow: inset 0 0 0 2px var(--md-readonly-shine-glow, rgba(255, 255, 255, 0.58));
	}
}

@keyframes md-cursor-blink {

	0%,
	100% {
		opacity: 1;
	}

	50% {
		opacity: 0;
	}
}

/*
 * Edit / read-only lock toggle.
 *
 * The asymmetric content padding reserves a real rail for the control:
 * button width + gap + edge inset. The zero-height sticky host spans the
 * document column and that rail, keeping the button beside (never over) the
 * rendered document as it scrolls. Colors use local \`--md-readonly-*\` custom
 * properties with literal fallbacks so this base file stays theme-agnostic
 * (themes may override them).
 */
.md-readonly-toggle-host {
	position: sticky;
	top: 0;
	width: calc(100% + var(--md-editor-content-inline-end-padding));
	height: 0;
	z-index: 10;
	pointer-events: none;
}

.md-readonly-toggle {
	position: absolute;
	top: 4px;
	right: var(--md-readonly-toggle-inset);
	pointer-events: auto;
	display: inline-grid;
	grid-template-columns: repeat(2, 24px);
	align-items: center;
	justify-items: center;
	gap: 2px;
	box-sizing: border-box;
	width: var(--md-readonly-toggle-width);
	height: var(--md-readonly-toggle-height);
	padding: 3px;
	overflow: hidden;
	direction: ltr;
	appearance: none;
	border-radius: 999px;
	border: 1px solid var(--md-readonly-border, #b8b8b8);
	background: var(--md-readonly-background, #f3f3f3);
	color: var(--md-readonly-foreground, #444444);
	font-size: 16px;
	line-height: 1;
	cursor: pointer;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0, 0, 0, 0.08);
	transition: background-color 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
}

/*
 * Below this width there is not enough document column for the side rail to be
 * useful. Give the host its own row and stop it from sticking, so neither long
 * unbreakable content nor later content scrolled through the viewport can ever
 * pass underneath the button.
 */
.md-editor-narrow .md-readonly-toggle-host {
	position: relative;
	height: calc(var(--md-readonly-toggle-height) + var(--md-readonly-toggle-inset) + var(--md-readonly-toggle-inset));
}

.md-readonly-toggle::after {
	content: '';
	position: absolute;
	z-index: 2;
	top: -8px;
	bottom: -8px;
	left: -30px;
	width: 24px;
	background: linear-gradient(90deg,
			transparent,
			var(--md-readonly-shine-edge, rgba(255, 255, 255, 0.16)) 24%,
			var(--md-readonly-shine, #ffffff) 50%,
			var(--md-readonly-shine-edge, rgba(255, 255, 255, 0.16)) 76%,
			transparent);
	box-shadow: 0 0 8px 2px var(--md-readonly-shine-glow, rgba(255, 255, 255, 0.58));
	opacity: 0;
	pointer-events: none;
	transform: skewX(-20deg);
}

.md-readonly-toggle.md-readonly-toggle-shine::after {
	animation: md-readonly-toggle-shine 2s linear;
	will-change: transform, opacity;
}

@keyframes md-readonly-toggle-shine {
	0% {
		opacity: 0;
		transform: translateX(0) skewX(-20deg);
	}

	12%,
	88% {
		opacity: 1;
	}

	100% {
		opacity: 0;
		transform: translateX(122px) skewX(-20deg);
	}
}

.md-readonly-toggle:hover {
	border-color: var(--md-readonly-border-hover, #8d8d8d);
	background: var(--md-readonly-background-hover, #e9e9e9);
	box-shadow: 0 2px 4px rgba(0, 0, 0, 0.12), 0 6px 16px rgba(0, 0, 0, 0.1);
}

.md-readonly-toggle:focus-visible {
	outline: 2px solid var(--md-readonly-accent, #4c8bf5);
	outline-offset: 1px;
}

.md-readonly-toggle .md-readonly-toggle-indicator {
	position: absolute;
	top: 50%;
	left: 3px;
	width: 24px;
	height: 24px;
	border-radius: 50%;
	background: var(--md-readonly-accent, #4c8bf5);
	box-shadow: 0 0 3px rgba(0, 0, 0, 0.25);
	transform: translate(26px, -50%);
	transition: background-color 0.12s ease, transform 0.16s ease;
}

.md-readonly-toggle .md-readonly-toggle-icon {
	position: relative;
	z-index: 1;
	display: block;
	width: 16px;
	height: 16px;
	color: var(--md-readonly-foreground, #444444);
	opacity: 0.62;
	pointer-events: none;
	transition: color 0.12s ease, opacity 0.12s ease;
}

.md-readonly-toggle:not(.md-readonly-toggle-locked) .md-readonly-toggle-icon-editing,
.md-readonly-toggle.md-readonly-toggle-locked .md-readonly-toggle-icon-locked {
	color: var(--md-readonly-accent-foreground, #ffffff);
	opacity: 1;
}

.md-readonly-toggle.md-readonly-toggle-locked .md-readonly-toggle-indicator {
	transform: translate(0, -50%);
}

@media (prefers-reduced-motion: reduce) {

	.md-editor.md-readonly-editing-attempt,
	.md-readonly-toggle,
	.md-readonly-toggle .md-readonly-toggle-indicator,
	.md-readonly-toggle .md-readonly-toggle-icon,
	.md-readonly-toggle.md-readonly-toggle-shine::after {
		animation: none;
		transition: none;
	}
}

@media (forced-colors: active) {
	.md-readonly-toggle {
		forced-color-adjust: none;
		border-color: ButtonText;
		background: ButtonFace;
		color: ButtonText;
		box-shadow: none;
	}

	.md-readonly-toggle::after {
		display: none;
	}

	.md-readonly-toggle:hover {
		border-color: Highlight;
		background: ButtonFace;
		box-shadow: none;
	}

	.md-readonly-toggle:focus-visible {
		outline-color: Highlight;
	}

	.md-readonly-toggle .md-readonly-toggle-indicator {
		background: Highlight;
		box-shadow: none;
	}

	.md-readonly-toggle .md-readonly-toggle-icon {
		color: ButtonText;
		opacity: 1;
	}

	.md-readonly-toggle:not(.md-readonly-toggle-locked) .md-readonly-toggle-icon-editing,
	.md-readonly-toggle.md-readonly-toggle-locked .md-readonly-toggle-icon-locked {
		color: HighlightText;
	}
}`;

/**
 * `@dimm-city/vscode-markdown-editor`'s `src/view/themes/default.css` — the
 * fork's default typography theme, scoped entirely under `.md-theme-default`
 * (every selector; see the source file's own header comment), applied by
 * passing `classNames: ['md-theme-default']` to the underlying
 * `EditorView` — which is exactly what `FORK_THEME_CLASS_NAME` below names, so
 * `mount.ts` and this module never let the class name and the CSS scope it
 * against drift apart.
 */
export const FORK_DEFAULT_THEME_CSS: string = `
/*
 * Default ("plain") markdown theme.
 *
 * The editor's original typography, extracted out of the functional base and
 * scoped under \`.md-theme-default\`. Apply it via the editor \`classNames\`
 * option:
 *
 *     new EditorView(model, { classNames: ['md-theme-default'] });
 *
 * Every selector is scoped under the theme class, so importing this file
 * never affects the global page or any editor that did not opt in.
 */

.md-editor.md-theme-default {
    color-scheme: light;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 16px;
    line-height: 1.6;
    max-width: 800px;
}

.md-theme-default .md-heading {
    margin: 0.5em 0 0.25em;
}

.md-theme-default .md-paragraph {
    margin: 0.5em 0;
}

.md-theme-default .md-code-block {
    background: #f4f4f4;
    border-radius: 4px;
    padding: 8px 12px;
    margin: 0.5em 0;
}

.md-theme-default .md-code-block code {
    font-family: 'Cascadia Code', 'Fira Code', monospace;
    font-size: 14px;
}

/* Syntax-highlight token colours (VS Code light theme palette). */
.md-theme-default .md-code-block .tok-keyword {
    color: #0000ff;
}

.md-theme-default .md-code-block .tok-string {
    color: #a31515;
}

.md-theme-default .md-code-block .tok-comment {
    color: #008000;
}

.md-theme-default .md-code-block .tok-number {
    color: #098658;
}

.md-theme-default .md-code-block .tok-regexp {
    color: #811f3f;
}

.md-theme-default .md-code-block .tok-type {
    color: #267f99;
}

.md-theme-default .md-code-block .tok-annotation {
    color: #267f99;
}

.md-theme-default .md-code-block .tok-tag {
    color: #800000;
}

.md-theme-default .md-code-block .tok-attribute {
    color: #e50000;
}

.md-theme-default .md-code-block .tok-delimiter {
    color: #000000;
}

.md-theme-default .md-math-block {
    border-radius: 4px;
    padding: 12px 16px;
    margin: 0.5em 0;
}

.md-theme-default .md-math-block code {
    font-family: 'Cascadia Code', 'Fira Code', monospace;
    font-size: 14px;
}

.md-theme-default .md-inline-math {
    padding: 2px 4px;
    border-radius: 3px;
}

.md-theme-default .md-inline-math .katex {
    line-height: 1;
}

.md-theme-default .md-thematic-break {
    border: none;
    border-top: 2px solid #e0e0e0;
    margin: 1em 0;
}

.md-theme-default .md-blockquote {
    border-left: 4px solid #ddd;
    margin: 0.5em 0;
    padding: 0 0 0 16px;
    /* The left padding the \`>\` gutter hangs in (matches padding-left). */
    --md-blockquote-pad: 16px;
    color: #666;
}

.md-theme-default .md-list {
    margin: 0.5em 0;
    padding-left: 24px;
    /* The per-level indentation step the list gutter fills (matches padding-left). */
    --md-list-indent-step: 24px;
}

.md-theme-default .md-table-wrapper {
    /* Block spacing lives on the wrapper (the scroll/BFC box) so it collapses
       with siblings as before; the inner table has no margin of its own. */
    margin: 0.5em 0;
}

.md-theme-default .md-table {
    border-collapse: collapse;
    width: auto;
}

.md-theme-default .md-table th,
.md-theme-default .md-table td {
    border: 1px solid #ddd;
    padding: 6px 12px;
    text-align: left;
}

.md-theme-default .md-table th {
    background: #f4f4f4;
    font-weight: 600;
}

/* Header reserves extra vertical space when inactive; reclaimed when active
   to host the delimiter row, keeping the table height constant. */
.md-theme-default .md-table tr:first-child td {
    padding-top: 11px;
    padding-bottom: 11px;
}

.md-theme-default .md-table.md-block-active tr:first-child td {
    padding-top: 3px;
    padding-bottom: 3px;
}

.md-theme-default .md-table tbody tr:nth-child(even) {
    background: #fafafa;
}

/* Delimiter row (\`| --- | --- |\`) is edit-time source: borderless, compact. */
.md-theme-default .md-table-delimiter-row td {
    border: 0;
    padding: 0 12px;
    background: transparent;
}

/*
 * Active table: the source \`|\` pipes ARE the outline. Drop the HTML cell
 * borders (kept as transparent so the 1px box geometry — and thus the table's
 * height and first-text X — is unchanged) and clear the header/zebra fills so
 * the table reads as plain source.
 */
.md-theme-default .md-table.md-block-active td {
    border-color: transparent;
}

.md-theme-default .md-table.md-block-active tr:first-child td {
    background: transparent;
}

.md-theme-default .md-table.md-block-active tbody tr:nth-child(even) td {
    background: transparent;
}

/*
 * Shift each cell's leading pipe onto its left gridline (where the border was)
 * and the last cell's closing pipe onto the right gridline. \`position:
 * relative\` moves only the painted glyph by the cell's horizontal padding;
 * siblings and the glue's reserved width are untouched, so active/inactive
 * height and first-text X stay pixel-identical. The delimiter row's single
 * \`tableDelimiter\` marker is shifted the same way to line its leading pipe up.
 */
.md-theme-default .md-table.md-block-active td>.md-glue-tableCellGlue:first-child,
.md-theme-default .md-table.md-block-active .md-table-delimiter-row td>.md-marker-tableDelimiter {
    position: relative;
    left: -12px;
}

/*
 * The last cell's closing \`|\` floats right after the (left-aligned) cell text,
 * so on its own it would be ragged between rows of differing width. Pin it to
 * the column's right gridline (the cell's border edge, 12px past the content
 * box) so the right outline is a straight line. Absolute removes it from flow,
 * but it is the trailing node so no text shifts; the leading pipe still fixes
 * first-text X and the row stays one line tall, keeping the compare invariants.
 * \`top: auto\` keeps the pipe on the content line (the shared editor.css rule
 * also takes trailing glue out of flow); the previous \`top: 0\` floated it to
 * the cell's top edge, misaligning it with the leading pipes on wrapping rows.
 */
.md-theme-default .md-table.md-block-active td:last-child {
    position: relative;
}

.md-theme-default .md-table.md-block-active td:last-child>.md-glue-tableCellGlue:last-child {
    position: absolute;
    right: 0;
    top: auto;
}

/*
 * The delimiter row's last cell carries its closing \`|\` as a separate
 * \`tableDelimiterClose\` marker; pin it to the same right gridline as the body
 * rows' closing pipe so the last column's outline stays straight.
 */
.md-theme-default .md-table.md-block-active .md-table-delimiter-row td:last-child>.md-marker-tableDelimiterClose {
    position: absolute;
    right: 0;
    top: auto;
}

.md-theme-default code {
    font-family: 'Cascadia Code', 'Fira Code', monospace;
    font-size: 0.9em;
}

.md-theme-default :not(pre)>code {
    background: #f0f0f0;
    padding: 2px 4px;
    border-radius: 3px;
}`;

/** The `EditorViewOptions.classNames` entry `FORK_DEFAULT_THEME_CSS`'s rules are
 * scoped under; `mount.ts` passes this to `createVscodeEditorAdapter` so the
 * theme it just injected actually applies to the mounted view. */
export const FORK_THEME_CLASS_NAME = "md-theme-default";
