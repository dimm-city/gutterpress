import { Disposable } from '@vscode/observables';
import { IDisposable } from '@vscode/observables';
import { IObservable } from '@vscode/observables';
import { IObservableWithChange } from '@vscode/observables';
import { ISettableObservable } from '@vscode/observables';
import { ITransaction } from '@vscode/observables';
import { MonarchTokenizer } from 'monaco-editor/esm/vs/editor/standalone/common/monarch/monarchLexer.js';

declare interface AddedItem {
    readonly kind: 'added';
    readonly node: AstNode;
    readonly modifiedStart: number;
    readonly insertedLocal: readonly AnnotatedRange[];
}

/**
 * A word/character-level highlight inside a single block, in that block's
 * *local* coordinate space (`0` = block start). `inserted` ranges live on a
 * modified/added block, `deleted` ranges on an original/removed block.
 */
declare interface AnnotatedRange {
    readonly range: OffsetRange;
    readonly kind: 'inserted' | 'deleted';
}

/** Every concrete node kind, for exhaustive consumer-side dispatch. */
export declare type AnyAstNode = TextAstNode | MarkerAstNode | GlueAstNode | ThematicBreakAstNode | StrongAstNode | EmphasisAstNode | StrikethroughAstNode | InlineCodeAstNode | InlineMathAstNode | LinkAstNode | ImageAstNode | HeadingAstNode | ParagraphAstNode | FrontMatterAstNode | CodeBlockAstNode | MathBlockAstNode | BlockQuoteAstNode | ListAstNode | ListItemAstNode | TableAstNode | TableRowAstNode | TableCellAstNode | DocumentAstNode | UnhandledBlockAstNode;

declare type AnyViewData = DocumentViewData | BlockViewData | InlineViewData | ListItemViewData | TableRowViewData | TableCellViewData | MarkerViewData | GlueViewData | DiffHunkViewData | DiffDecorationViewData;

export declare abstract class AstNode {
    abstract readonly kind: string;
    abstract get children(): readonly AstNode[];
    /**
     * A stable identity. Every node has one: it is minted on construction and
     * carried across edits by reconciliation, so a node that survives an edit
     * (even with changed content) keeps the same id.
     */
    readonly id: number;
    /** Rebuild this node with each child replaced by `map.get(child) ?? child`. */
    abstract mapChildren(map: ReadonlyMap<AstNode, AstNode>): AstNode;
    private _length;
    get length(): number;
    /**
     * True when `other` has the same content. Containers compare children *by
     * identity* (`===`): bottom-up reconciliation substitutes reused old
     * instances into the fresh tree first, so equal children already share
     * instances — keeping this O(children), not O(subtree). Leaves have no
     * children, so {@link _localEquals} is their whole comparison.
     */
    equalsShallow(other: AstNode): boolean;
    /** Compares only this node's own scalar fields (kind/length already match). */
    protected _localEquals(_other: this): boolean;
    /**
     * A copy of this node that adopts `id`. Reconciliation uses this to carry an
     * old identity onto a node whose content changed. Nodes are immutable value
     * holders, so a shallow prototype copy with `id` overridden is sound.
     */
    cloneWithId(id: number): this;
}

export declare interface AstVisualization {
    $fileExtension: 'ast.w';
    source: string;
    root: AstVisualizationNode;
}

declare interface AstVisualizationNode {
    label: string;
    range: [start: number, endExclusive: number];
    children?: AstVisualizationNode[];
}

/**
 * Strategy for hosts that never deliver native clipboard events to the editor
 * — most importantly VS Code webviews, whose preload calls `preventDefault()`
 * on the Ctrl/Cmd+C/X/V keydowns, so no `copy`/`cut`/`paste` event is ever
 * dispatched. Here the keystrokes are the only signal, so this strategy
 * listens for them directly and drives the async {@link Clipboard} API
 * (`navigator.clipboard`), which webviews are granted.
 *
 * Cut deletes synchronously once the text is captured; the clipboard write is
 * fire-and-forget. Paste must wait for the async read before inserting.
 */
export declare class AsyncClipboardStrategy implements IClipboardStrategy {
    private readonly _clipboard;
    constructor(_clipboard?: Clipboard);
    connect(context: IClipboardContext): IDisposable;
}

export declare type BlockAstNode = HeadingAstNode | ParagraphAstNode | FrontMatterAstNode | CodeBlockAstNode | MathBlockAstNode | ThematicBreakAstNode | BlockQuoteAstNode | ListAstNode | TableAstNode | UnhandledBlockAstNode;

/**
 * A block-level node. Every block may carry a {@link leadingTrivia} glue — the
 * whitespace that precedes it on its own line (a nested list's indentation, the
 * leading space of a continued paragraph). It is owned by the block it precedes
 * (not the one it trails), so the view reveals it exactly when *this* block is
 * active, and it tiles at the block's front: {@link children} prepends it to the
 * block's own content while `content` stays the block's real payload.
 */
declare abstract class BlockAstNodeBase extends AstNode {
    abstract readonly leadingTrivia?: GlueAstNode;
    /** This block with its leading trivia replaced — re-homes a leading glue onto it. */
    abstract withLeadingTrivia(trivia: GlueAstNode | undefined): BlockAstNode;
    /** Prepends {@link leadingTrivia}, if any, ahead of the block's own children. */
    protected _withLeading(own: readonly AstNode[]): readonly AstNode[];
}

/**
 * One block's place in the rendered document.
 *
 * Geometry is in editor-local CSS pixels. `height` is either a real DOM measurement
 * (`isMeasured: true`) or an estimate produced when the block is not
 * currently mounted (`isMeasured: false`). Estimates exist so virtual
 * rendering can size the scroll container without mounting every block.
 *
 * `visualLineMap` and `viewNode` are set only when the block is mounted
 * and measured. Cursor positioning, selection painting and up/down
 * navigation read through `visualLineMap`; the debug view walks
 * `viewNode` to enumerate text leaves for per-character introspection.
 * Unmeasured blocks have neither.
 */
export declare interface BlockMeasurement {
    readonly block: BlockAstNode;
    readonly absoluteStart: number;
    readonly height: number;
    /** Local border box when mounted and measured. */
    readonly rect: Rect2D | undefined;
    /** Local horizontal padding-box clip when this block scrolls horizontally. */
    readonly viewportClip: {
        readonly left: number;
        readonly right: number;
    } | undefined;
    readonly isMeasured: boolean;
    readonly visualLineMap: VisualLineMap | undefined;
    readonly viewNode: ViewNode | undefined;
}

export declare class BlockQuoteAstNode extends BlockAstNodeBase {
    readonly content: readonly (MarkerAstNode | BlockAstNode | GlueAstNode)[];
    readonly leadingTrivia?: GlueAstNode | undefined;
    readonly kind = "blockQuote";
    constructor(content: readonly (MarkerAstNode | BlockAstNode | GlueAstNode)[], leadingTrivia?: GlueAstNode | undefined);
    get children(): readonly AstNode[];
    get blocks(): readonly BlockAstNode[];
    mapChildren(m: ReadonlyMap<AstNode, AstNode>): AstNode;
    withLeadingTrivia(trivia: GlueAstNode | undefined): BlockQuoteAstNode;
}

declare class BlockQuoteViewData {
    readonly ast: BlockQuoteAstNode;
    readonly content: readonly AnyViewData[];
    /** False while a pending paragraph replaces the final marker-only line. */
    readonly showFinalMarkerOnlyLine: boolean;
    readonly kind = "blockQuote";
    constructor(ast: BlockQuoteAstNode, content: readonly AnyViewData[], 
    /** False while a pending paragraph replaces the final marker-only line. */
    showFinalMarkerOnlyLine: boolean);
}

/**
 * All blocks whose source range intersects `[start, endExclusive]`. A
 * collapsed range (start === endExclusive) matches the block containing
 * that offset (with the same boundary rule as {@link findBlockAtOffset}).
 */
export declare function blocksIntersecting(doc: DocumentAstNode, start: SourceOffset, endExclusive: SourceOffset): BlockAstNode[];

declare type BlockViewData = HeadingViewData | ParagraphViewData | FrontMatterViewData | CodeBlockViewData | MathBlockViewData | ThematicBreakViewData | BlockQuoteViewData | ListViewData | TableViewData | UnhandledBlockViewData;

/**
 * Base view node for everything the editor renders, generic over the
 * {@link AnyViewData view-data} it renders so subclasses get a precisely-typed
 * {@link data} (e.g. `BlockViewNode<HeadingViewData>`). Every view-data kind has
 * a subclass whose constructor builds the node's DOM and, recursively,
 * constructs its child view nodes — so *constructing a node is rendering it*.
 * There is no separate render pass: the view tree is the result of construction,
 * and {@link createViewNode} is the single entry point that turns a `ViewData`
 * into a node (reusing a `previous` node untouched when it still matches).
 *
 * The name is historical — it is the base for inline and leaf nodes too — but
 * top-level blocks are always instances of it, and {@link element}/{@link block}
 * are the conveniences {@link EditorView} uses for those.
 */
export declare class BlockViewNode<T extends AnyViewData = AnyViewData> extends ViewNode {
    readonly data: T;
    constructor(data: T, dom: globalThis.Node, children: readonly ViewNode[]);
    get block(): BlockAstNode;
    get element(): HTMLElement;
    /**
     * The horizontal scroll viewport for selection/caret clipping
     * ({@link blockViewportClip}). For most blocks the scroller *is*
     * {@link element} — a code / math / unhandled block's `element` is the very
     * `overflow-x: auto` box that scrolls. A table is the exception: its
     * `element` stays the inner `<table>` (so the active/markers classes and
     * `.md-table` theme styling are unaffected), but the box that actually
     * scrolls is the wrapping `.md-table-wrapper`, so {@link TableViewNode}
     * overrides this to return that wrapper.
     */
    get scrollElement(): HTMLElement;
    /**
     * Whether this already-built node can stand in for `data` unchanged. The
     * builder preserves view-data identity for any subtree whose ast and
     * selection-derived flags are unchanged (see `buildDocumentViewData`), so a
     * single identity check captures "nothing in my subtree changed" — and its
     * whole subtree, and any session it owns, are kept as-is.
     */
    canReuse(data: AnyViewData, _options: BlockViewOptions | undefined): boolean;
    /**
     * Called by the view after this block is mounted and measured, with the
     * block's rendered height in px. The default is a no-op; subclasses whose
     * active/inactive renderings have different intrinsic heights (e.g. a math
     * block) override this to remember a height to reserve across the toggle.
     */
    recordMeasuredHeight(_height: number): void;
}

export declare interface BlockViewOptions {
    readonly renderCustomCodeBlock?: (language: string, content: string) => HTMLElement | undefined;
    /**
     * gp-fork: renderCustomBlock. Pluggable renderer for the *inactive*
     * (rendered) form of a `"paragraph"` or `"unhandledBlock"` node —
     * parallel to {@link renderCustomCodeBlock} and {@link renderMath}, but
     * for any block those two seams do not cover. Called with the block's
     * AST node and its exact source text (see {@link CustomBlockRendering}).
     * When set and it returns a result, its {@link CustomBlockRendering.dom}
     * replaces the block's default rendering, and its
     * {@link CustomBlockRendering.segments}, if supplied, let parts of the
     * rendered output map back to source ranges so the caret can land
     * inside them (the same mechanism {@link renderMath}'s `segments` use).
     * Returning `undefined` falls back to the default rendering, unchanged.
     * Never consulted while the block is active (source shown).
     */
    readonly renderCustomBlock?: (node: BlockAstNode, sourceText: string) => CustomBlockRendering | undefined;
    readonly onToggleCheckbox?: (item: ListItemAstNode, newChecked: boolean) => void;
    /**
     * Supplies live, declarative metadata for recognized links. The editor owns
     * the markup and styling; providers own lookup, caching, and updates.
     */
    readonly linkPresentationProvider?: ILinkPresentationProvider;
    /**
     * Opens a link's URL. Called when the user activates a link: a plain click
     * while the link's block is inactive (rendered), or a Ctrl/Cmd+click while it
     * is active (source shown). Return `false` to use the anchor's native
     * navigation behavior.
     */
    readonly onOpenLink?: (url: string, event: MouseEvent) => false | void;
    /**
     * Colours fenced code blocks. When set, a code block's content is rendered
     * as a sequence of token spans instead of one plain text node. This is the
     * non-incremental path: the snapshot is read once at render time.
     */
    readonly syntaxHighlighter?: ISyntaxHighlighter;
    /**
     * Pluggable renderer for the *inactive* (rendered) form of a math node —
     * both `$$…$$` blocks and inline `$…$`. When set and it returns a result,
     * its {@link MathRendering.dom} replaces the default opaque `katex.render`
     * output, and its {@link MathRendering.segments} let parts of the rendered
     * math (e.g. individual identifier glyphs) map back to source ranges so the
     * caret can land inside them. Returning `undefined` falls back to the
     * default whole-node KaTeX leaf. The active (source) form is unaffected.
     *
     * This is the seam used to explore in-place editing of rendered math (see
     * `katexEditableIdentifiers.ts`).
     */
    readonly renderMath?: (request: MathRenderRequest) => MathRendering | undefined;
    /**
     * Pluggable factory for an in-place, interactive editor that replaces the
     * *rendered* (inactive) form of a fenced code block — see
     * {@link IEmbeddedCodeEditor}. When it returns an editor for the block's
     * language, that editor's element is mounted instead of the highlighted
     * code, and content flows both ways as string edits. Returning `undefined`
     * falls back to the default rendering. EXPERIMENTAL.
     */
    readonly embeddedCodeEditorFactory?: IEmbeddedCodeEditorFactory;
    /** Current read-only state forwarded to embedded code editors. */
    readonly embeddedCodeEditorReadOnly?: boolean;
    /** Identity used to invalidate previously created embedded editors. */
    readonly embeddedCodeEditorFactoryVersion?: unknown;
    /**
     * Called when an {@link IEmbeddedCodeEditor} edits its content. `contentEdit`
     * is in the block's *content* coordinates; the host translates it to a
     * document edit (via {@link CodeBlockAstNode.codeOffset} and the block's
     * offset) and applies it to the model.
     */
    readonly onEmbeddedCodeEditorEdit?: (block: CodeBlockAstNode, contentEdit: StringEdit) => void;
}

/**
 * gp-fork: renderCustomBlock. Result of a {@link BlockViewOptions.renderCustomBlock}
 * renderer. A direct rename of the package's own {@link MathRendering} to a
 * non-math-specific name — not a new shape.
 */
export declare interface CustomBlockRendering {
    /**
     * Host element to mount (the rendered block output). The host adds the
     * `md-block` class to this element itself (mirroring
     * {@link BlockViewOptions.renderCustomCodeBlock}'s call site, which does
     * the same for its own plain-`dom` result) — every `.md-block`-scoped
     * editor style depends on it, so providers do not need to set it
     * themselves, and setting it anyway is harmless (idempotent).
     */
    readonly dom: HTMLElement;
    /**
     * Source-mapped spans within {@link dom} (need not tile the whole node).
     * Optional — omit for the bare-`dom` fallback: the whole element is
     * mounted with no interior source mapping, so caret entry lands at the
     * block's start and drag precision is reduced to that one boundary.
     * When present, threaded into the same segment-tiling helper the
     * package's own math views already use.
     */
    readonly segments?: readonly SourceSegment[];
}

/**
 * gp-fork: renderCustomBlock. A span of a {@link CustomBlockRendering.dom}
 * that maps to a slice of source, relative to the block node's start. A
 * direct rename of the package's own {@link MathSourceSegment} to a
 * non-math-specific name — not a new shape.
 */
export declare interface SourceSegment {
    /** A DOM node (ideally a Text node) within the rendered output. */
    readonly dom: globalThis.Node;
    /** Start offset of the mapped slice, relative to the block node's start. */
    readonly start: number;
    /** Source length of the mapped slice. */
    readonly length: number;
}

export declare class CodeBlockAstNode extends BlockAstNodeBase {
    /** First token of the fenced code block info string, used for syntax highlighting. */
    readonly language: string;
    /** Complete fenced code block info string, including metadata after the language token. */
    readonly infoString: string;
    readonly content: readonly (MarkerAstNode | GlueAstNode)[];
    readonly leadingTrivia?: GlueAstNode | undefined;
    readonly kind = "codeBlock";
    private _previous?;
    private _contentEdit?;
    constructor(
    /** First token of the fenced code block info string, used for syntax highlighting. */
    language: string, 
    /** Complete fenced code block info string, including metadata after the language token. */
    infoString: string, content: readonly (MarkerAstNode | GlueAstNode)[], leadingTrivia?: GlueAstNode | undefined);
    get children(): readonly AstNode[];
    get openFence(): MarkerAstNode | undefined;
    get closeFence(): MarkerAstNode | undefined;
    get code(): MarkerAstNode | undefined;
    /** Relative start offset of the {@link code} marker within this block. */
    get codeOffset(): number;
    mapChildren(m: ReadonlyMap<AstNode, AstNode>): AstNode;
    withLeadingTrivia(trivia: GlueAstNode | undefined): CodeBlockAstNode;
    protected _localEquals(o: this): boolean;
    /**
     * A copy of this block carrying an incremental link to `previous`:
     * `contentEdit` (in the block's *content* coordinates) turns `previous`'s
     * content into this one. Uses a weak reference so the previous tree can be
     * garbage-collected.
     */
    withCodeDiff(previous: CodeBlockAstNode, contentEdit: StringEdit): CodeBlockAstNode;
    /**
     * When this block was incrementally derived from `previous` (same
     * fences/language, edit entirely within the content), returns the
     * content-coordinate edit; otherwise `undefined`.
     */
    getDiff(previous: CodeBlockAstNode): CodeBlockDiff | undefined;
}

/**
 * Describes how a {@link CodeBlockAstNode} was incrementally derived from a previous
 * one: {@link stringEdit} (in the block's *content* coordinates) turns the
 * previous content into this one.
 */
declare interface CodeBlockDiff {
    readonly stringEdit: StringEdit;
}

declare class CodeBlockViewData {
    readonly ast: CodeBlockAstNode;
    /** Active: render the fenced source; inactive: the (custom/highlighted) block. */
    readonly showMarkup: boolean;
    readonly content: readonly AnyViewData[];
    readonly kind = "codeBlock";
    constructor(ast: CodeBlockAstNode, 
    /** Active: render the fenced source; inactive: the (custom/highlighted) block. */
    showMarkup: boolean, content: readonly AnyViewData[]);
}

/**
 * A fenced code block. It owns its incremental
 * {@link ISyntaxHighlighterDocument} session: constructing the node creates (or
 * adopts from `previous`) the session, and disposing the node disposes it, so
 * colouring stays incremental across edits — the session is reused and
 * `update`d rather than rebuilt. A node at any depth owns a session; the only
 * difference today is that the parser links `getDiff` for top-level code blocks
 * only, so a nested block currently builds a fresh session on each rebuild.
 */
export declare class CodeBlockViewNode extends BlockViewNode<CodeBlockViewData> {
    private _session;
    /**
     * Subscription that re-tokenises the rendered `<code>` in place whenever the
     * session advances its {@link ISyntaxHighlighterDocument.snapshot} *without*
     * a source edit (an async grammar finishing, a live recolour). It is tied to
     * this node's lifetime, but like {@link _session} it must be disposed
     * manually: a node reused as `previous` for a rebuild is never `dispose`d
     * (see {@link reconcileDomChildren}), so the rebuilding constructor disposes
     * its predecessor's subscription explicitly.
     */
    private _snapshotSub;
    /**
     * An in-place interactive editor (e.g. an iframe) mounted instead of the
     * rendered code. Like {@link _session} it is adopted from `previous` across
     * rebuilds so the underlying editor keeps its state, and must be disposed
     * manually (a node reused as `previous` is never {@link dispose}d).
     */
    private _embeddedEditor;
    private readonly _embeddedEditorFactoryVersion;
    private readonly _embeddedEditorReadOnly;
    canReuse(data: AnyViewData, options: BlockViewOptions | undefined): boolean;
    constructor(data: CodeBlockViewData, options: BlockViewOptions | undefined, previous: ViewNode | undefined);
    dispose(): void;
}

/**
 * Canonical editor command catalog. Standalone keyboard handling and host
 * integrations derive their command registration and default keybindings from
 * this list.
 */
export declare const commands: readonly EditorCommandDefinition[];

/** A persistent comment anchored to a source range. */
declare interface Comment_2 {
    readonly id: string;
    /** Source range the comment refers to (its highlighted region). */
    readonly range: OffsetRange;
    /** The comment text. */
    readonly body: string;
    /** Display name of the author, if any. */
    readonly author?: string;
    /** Creation time (epoch ms), used to render a relative timestamp. */
    readonly createdAt?: number;
}
export { Comment_2 as Comment }

/**
 * The compact editing state for a markdown comment.
 *
 * The widget owns its DOM and draft state but not its position. The comment-mode
 * controller mounts it next to the active selection.
 */
export declare class CommentInputWidget extends Disposable {
    private readonly _options?;
    readonly element: HTMLElement;
    private readonly _textarea;
    private readonly _measure;
    private readonly _submitButton;
    private readonly _value;
    /** Live, untrimmed textarea content. */
    get value(): IObservable<string>;
    /** The raw textarea, exposed so a host can move focus into it. */
    get inputElement(): HTMLTextAreaElement;
    constructor(_options?: CommentInputWidgetOptions | undefined);
    focus(): void;
    setText(text: string): void;
    clear(): void;
    private _submit;
    private _autoSize;
}

export declare interface CommentInputWidgetOptions {
    /** Placeholder shown while the textarea is empty. Defaults to "Add comment". */
    readonly placeholder?: string;
    /** Called after the textarea changes size. */
    readonly onDidChangeSize?: () => void;
    /**
     * Called when the user submits a non-empty comment (Enter or the add button).
     * The text is trimmed; never called with an empty string.
     */
    readonly onSubmit?: (text: string) => void;
    /** Called when the user dismisses the input (Escape). */
    readonly onCancel?: () => void;
}

/**
 * Comment mode — a compact "add a comment" affordance layered on top of
 * the editor *without modifying it*. It reads the editor's public observables
 * ({@link EditorModel.readonlyMode}, {@link EditorModel.selection}) and the
 * exposed {@link EditorView.caretRect} geometry, and mounts a
 * {@link CommentInputWidget} into {@link EditorView.overlayContainer}.
 *
 * Behaviour:
 *  - Only active in read-only mode (the "review" view).
 *  - When a user-created selection is non-empty, the input box appears next to
 *    the caret (the selection's active end) but does NOT take focus, so keyboard
 *    selection keeps working. Programmatic selections such as find matches do
 *    not summon it. Press Tab to move focus into the box, then type.
 *  - The box appears on mouse-up, not mid-drag, so it doesn't flicker/jump
 *    while a selection is being dragged out (keyboard selection shows at once).
 *  - While the box has focus or holds a draft it is frozen in place (selection
 *    changes, drags and clicks no longer move it). It is dismissed by Escape,
 *    by submitting, or by blurring an empty box.
 *  - The editor's logical caret geometry remains available for anchoring in
 *    read-only mode even though the painted caret is hidden. While the box has
 *    focus, `.md-comment-active` also suppresses the painted caret in any mode.
 */
export declare class CommentModeController extends Disposable {
    private readonly _model;
    private readonly _view;
    private readonly _options?;
    private static _isCommentableSelectionSource;
    private readonly _widget;
    private readonly _gap;
    private _visible;
    private _anchorX;
    private _pinnedRange;
    /**
     * The range a comment was just submitted for. The box stays hidden for it
     * until the selection changes, so submitting doesn't immediately re-summon an
     * empty box on the still-selected text.
     */
    private _submittedRange;
    constructor(_model: EditorModel, _view: EditorView, _options?: CommentModeControllerOptions | undefined);
    private _update;
    private _show;
    private _layoutHorizontally;
    /** Force-hide and clear the box (used by Escape and submit). */
    private _hide;
    /**
     * Hide unless the user is engaged with the box: it has focus or holds a
     * non-empty draft. This preserves in-progress text and keeps a focused box
     * open (it is dismissed explicitly via Escape/submit, or by blurring it).
     */
    private _autoHide;
    private _widgetHasFocus;
    /**
     * The visible viewport (client coords) used for the flip-above decision: the
     * nearest scrollable ancestor of the editor. `.md-editor` itself spans the
     * full document height and never clips, so measuring against it would always
     * report room below. Falls back to the window when nothing scrolls.
     */
    private _getViewportRect;
    private _hideAndRefocus;
    private _submit;
}

export declare interface CommentModeControllerOptions {
    /** Called when the user submits a comment for the current selection. */
    readonly onSubmit?: (submission: CommentSubmission) => void;
    /** Gap (px) between the bottom of the selection and the top of the input box. */
    readonly gap?: number;
}

/**
 * Seedable store of {@link Comment}s for the comment-mode contribution. It has
 * no opinion on rendering or persistence — a host seeds it via
 * {@link set}/{@link add} and observes {@link comments}.
 */
export declare class CommentsModel {
    private readonly _comments;
    /** Monotonic counter for ids of comments created via {@link create}. */
    private _sequence;
    /** The current comments, in insertion order. */
    get comments(): IObservable<readonly Comment_2[]>;
    /** Replace the whole comment set. */
    set(comments: readonly Comment_2[]): void;
    /**
     * Create a comment from a user submission and append it, generating its `id`
     * and `createdAt` here so id/time allocation stays the store's concern (the
     * UI only supplies the range and text). Returns the created comment.
     */
    create(input: {
        range: OffsetRange;
        body: string;
        author?: string;
    }): Comment_2;
    /** Append a comment. */
    add(comment: Comment_2): void;
    /** Remove a comment by id. */
    remove(id: string): void;
}

/** A comment the user submitted, with the source range it was anchored to. */
export declare interface CommentSubmission {
    readonly text: string;
    readonly range: OffsetRange;
}

/** Displays posted comments beside their source ranges. */
export declare class CommentsView extends Disposable {
    private readonly _model;
    private readonly _view;
    private readonly _layer;
    private readonly _entries;
    private _order;
    private _pendingRevealCommentId;
    constructor(_model: CommentsModel, _view: EditorView);
    revealComment(id: string): void;
    private _reconcile;
    private _relayout;
    private _revealPendingComment;
}

/** Compact posted state for a markdown comment. */
export declare class CommentWidget {
    private readonly _domNode;
    private readonly _disposables;
    get element(): HTMLElement;
    constructor(options: CommentWidgetOptions);
    dispose(): void;
}

export declare interface CommentWidgetOptions {
    /** The posted comment body. */
    readonly body: string;
    /** If provided, shows a delete action and invokes it when activated. */
    readonly onDelete?: () => void;
}

/** The lossless source slices of a complete block HTML comment. */
declare interface CompleteHtmlCommentSource extends HtmlCommentSourceBase {
    readonly kind: 'complete';
    readonly closing: '-->';
    readonly trailingWhitespace: string;
}

/**
 * A {@link MonacoSyntaxHighlighter} preloaded with a handful of common Monarch
 * grammars (plus the usual short aliases). Unknown languages fall back to an
 * unstyled single token, so the highlighter is always safe to call.
 *
 * The Monarch runtime and grammar definitions are injected so this package
 * depends on `monaco-editor` for types only.
 */
export declare function createDefaultMonacoSyntaxHighlighter(monaco: IMonarchApi, grammars: IDefaultMonarchGrammars): MonacoSyntaxHighlighter;

export declare type CursorCommand = (ctx: CursorCommandContext) => CursorPosition;

export declare interface CursorCommandContext {
    readonly text: string;
    readonly selection: Selection_2;
    readonly document: DocumentAstNode;
    readonly activeBlock: BlockAstNode | undefined;
    readonly markerVisibleBlocks: ReadonlySet<BlockAstNode>;
    readonly wordNavigationConfig: WordNavigationConfig;
    readonly cursorPosition: CursorPosition;
}

export declare const cursorDocumentEnd: CursorCommand;

export declare const cursorDocumentStart: CursorCommand;

export declare const cursorDown: VisualCursorCommand;

export declare type CursorKeyboardAction = 'left' | 'right' | 'up' | 'down' | 'wordLeft' | 'wordRight' | 'visualLineStart' | 'visualLineEnd' | 'logicalLineStart' | 'logicalLineEnd' | 'documentStart' | 'documentEnd';

export declare const cursorLeft: CursorCommand;

export declare const cursorLineEnd: CursorCommand;

export declare const cursorLineStart: CursorCommand;

export declare const cursorMoveLeft: CursorCommand;

export declare interface CursorMoveResult {
    readonly position: CursorPosition;
    readonly desiredColumn: number | undefined;
}

export declare const cursorMoveRight: CursorCommand;

/** The cursor's position in either source text or a source-less visual line. */
export declare type CursorPosition = {
    readonly kind: 'source';
    readonly offset: SourceOffset;
} | {
    readonly kind: 'virtual';
    readonly line: VirtualCursorLine;
};

export declare namespace CursorPosition {
    export function source(offset: SourceOffset): CursorPosition;
    export function virtual(line: VirtualCursorLine): CursorPosition;
}

export declare const cursorRight: CursorCommand;

export declare const cursorUp: VisualCursorCommand;

/**
 * Owns the blinking cursor DOM element.
 *
 * The rendering pipeline is a single `derived` whose compute callback
 * asks the {@link VisualLineMap} for the caret rect at the current source or
 * virtual position, writes it to {@link element}, and returns a
 * {@link CursorViewRendering} value as proof. An autorun keeps the
 * derived subscribed.
 */
export declare class CursorView extends Disposable {
    readonly element: HTMLElement;
    readonly rendering: IObservable<CursorViewRendering>;
    constructor(options: CursorViewOptions);
}

export declare interface CursorViewOptions {
    readonly position: IObservable<CursorPosition | undefined>;
    readonly visualLineMap: IObservable<VisualLineMap>;
    /**
     * The mounted blocks, used to hide the caret when it sits at an offset that
     * has been scrolled out of its (horizontally scrolling) block's viewport —
     * matching how the selection is clipped there.
     */
    readonly blocks?: IObservable<readonly SelectionBlock[]>;
}

export declare class CursorViewRendering {
    readonly position: CursorPosition;
    readonly visible: boolean;
    readonly rect: Rect2D;
    constructor(position: CursorPosition, visible: boolean, rect: Rect2D);
}

export declare const cursorVisualLineEnd: VisualCursorCommand;

export declare const cursorVisualLineStart: VisualCursorCommand;

export declare const cursorWordLeft: CursorCommand;

export declare const cursorWordRight: CursorCommand;

export declare const DEFAULT_INDENTATION_CONFIG: IndentationConfig;

export declare const DEFAULT_WORD_NAVIGATION_CONFIG: WordNavigationConfig;

export declare const DEFAULT_WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?";

export declare const deleteLeft: EditCommand;

export declare const deleteLineLeft: EditCommand;

export declare const deleteLineRight: EditCommand;

export declare const deleteRight: EditCommand;

export declare const deleteWordLeft: EditCommand;

export declare const deleteWordRight: EditCommand;

/**
 * A read-only "removed" decoration: an original block rendered (red) above its
 * place in the modified document, occupying vertical space like a view-zone but
 * contributing **zero** source length, so the editor's source mapping stays the
 * modified document and editing is unaffected. Used for `removed` and the
 * original side of a `replaced` block in editor diff mode.
 */
declare class DiffDecorationViewData {
    readonly ast: AstNode;
    readonly side: BlockViewData;
    readonly deletedRanges: readonly DiffHighlightRange[];
    /** True when the whole block was removed: solid red band, no word rects. */
    readonly whole: boolean;
    /** Absolute offset of this block in the *original* document. */
    readonly originalStart: number;
    readonly kind = "diffDecoration";
    constructor(ast: AstNode, side: BlockViewData, deletedRanges: readonly DiffHighlightRange[], 
    /** True when the whole block was removed: solid red band, no word rects. */
    whole: boolean, 
    /** Absolute offset of this block in the *original* document. */
    originalStart: number);
}

/** A word/character highlight inside one diff side, in block-local coords. */
declare interface DiffHighlightRange {
    readonly range: OffsetRange;
    readonly kind: 'inserted' | 'deleted';
}

/**
 * A changed block rendered as its original form stacked over its modified form
 * (either side may be absent for a pure deletion/insertion). It is itself a
 * document child the renderer mounts like a block; its {@link ast} is the
 * surviving side's ast, used only for view-node identity/reuse.
 */
declare class DiffHunkViewData {
    readonly ast: AstNode;
    readonly original: DiffSideViewData | undefined;
    readonly modified: DiffSideViewData | undefined;
    readonly kind = "diffHunk";
    constructor(ast: AstNode, original: DiffSideViewData | undefined, modified: DiffSideViewData | undefined);
}

/**
 * The recursive classification of a diff. Each item describes one aligned
 * position in the merged document:
 *
 * - `unchanged` — render the (modified) node once, neutral.
 * - `added`     — exists only in the modified document (green).
 * - `removed`   — exists only in the original document (red).
 * - `replaced`  — a *leaf* block changed in place → render original over
 *                 modified, with word-level {@link AnnotatedRange}s on each.
 * - `nested`    — a *container* changed → render it once and diff its
 *                 {@link NestedItem.children} recursively.
 *
 * Offsets ({@link UnchangedItem.modifiedStart} etc.) are absolute in their
 * respective documents, so a renderer/visualizer can slice the source text.
 */
declare type DiffItem = UnchangedItem | AddedItem | RemovedItem | ReplacedItem | NestedItem;

/** One side (original or modified) of a {@link DiffHunkViewData}. */
declare interface DiffSideViewData {
    readonly view: BlockViewData;
    /** Render in active form (markers/whitespace visible). */
    readonly active: boolean;
    readonly ranges: readonly DiffHighlightRange[];
}

export declare class DocumentAstNode extends AstNode {
    readonly content: readonly (BlockAstNode | GlueAstNode)[];
    readonly kind = "document";
    constructor(content: readonly (BlockAstNode | GlueAstNode)[]);
    get children(): readonly AstNode[];
    get blocks(): readonly BlockAstNode[];
    mapChildren(m: ReadonlyMap<AstNode, AstNode>): AstNode;
}

/** A mounted block: its view node paired with where it starts in the source. */
export declare interface DocumentBlock {
    readonly node: BlockViewNode;
    readonly absoluteStart: number;
}

/** A top-level block plus the document-level state the renderer applies to it. */
declare interface DocumentBlockViewData {
    readonly ast: BlockAstNode;
    readonly absoluteStart: number;
    /** Whether the selection reaches this block (drives `md-block-active`). */
    readonly isActive: boolean;
    readonly view: BlockViewData;
}

/** A mounted document child: a block, a run of inter-block glue, the
 * transient empty paragraph (see {@link PendingParagraphViewData}), or a
 * {@link DiffHunkViewData diff hunk} (stacked original/modified blocks). */
declare interface DocumentChildViewData {
    readonly absoluteStart: number;
    /** For a block: selection reaches it. For glue: always false (unowned, hidden). */
    readonly isActive: boolean;
    readonly view: BlockViewData | GlueViewData | PendingParagraphViewData | DiffHunkViewData | DiffDecorationViewData;
    readonly kind: 'block' | 'glue' | 'pendingParagraph' | 'diffHunk' | 'diffDecoration';
    /**
     * Diff mode: how this (modified) block changed. `added` = a whole new block
     * (strong green band, no inline rects); `modified` = a partial change (light
     * band + inline rects on the changed words).
     */
    readonly diffKind?: 'added' | 'modified';
}

/**
 * The view-data root. Mirrors {@link DocumentAstNode}: {@link blocks} holds only
 * its top-level blocks (each wrapped with where it starts and whether it is
 * active), while {@link children} additionally interleaves the rendered
 * document-level glue (the blank lines between blocks) in source order.
 */
declare class DocumentViewData {
    readonly ast: DocumentAstNode;
    readonly blocks: readonly DocumentBlockViewData[];
    /**
     * Blocks and inter-block glue interleaved in source order — the actual
     * mount sequence. {@link blocks} is the block-only projection used for
     * measurement and selection.
     */
    readonly children: readonly DocumentChildViewData[];
    readonly kind = "document";
    constructor(ast: DocumentAstNode, blocks: readonly DocumentBlockViewData[], 
    /**
     * Blocks and inter-block glue interleaved in source order — the actual
     * mount sequence. {@link blocks} is the block-only projection used for
     * measurement and selection.
     */
    children: readonly DocumentChildViewData[]);
}

/**
 * Immutable view of the document's block sequence — the document-level
 * analogue of {@link BlockViewNode}. Each {@link create} maps the
 * {@link DocumentViewData} (the AST overlaid with selection-derived flags) to
 * the block sequence, reusing the previous node's blocks by view-data identity,
 * rebuilding only what changed, and patching its {@link contentDomNode}'s
 * children to match.
 *
 * Like a {@link BlockViewNode}, it owns its DOM: the first `create` allocates
 * the content element, and every later `create` keeps the previous node's
 * element rather than making a new one. The element is therefore stable
 * across rebuilds:
 *
 *     create(viewData, …, old).contentDomNode === old.contentDomNode
 *
 * so a parent can mount it once and never re-parent it.
 *
 * Because it is rebuilt rather than mutated, {@link EditorView} can hold the
 * whole block cache as one value and simply swap it each frame, instead of
 * carrying a mutable entry array and the reconcile bookkeeping itself.
 *
 * It is itself a {@link ViewNode} (the root of the view-node tree), so DOM ↔
 * source mapping such as {@link ViewNode.resolveSource} is inherited: a hit on
 * any descendant lifts up the parent chain to here, yielding an absolute
 * document offset.
 */
export declare class DocumentViewNode extends ViewNode {
    readonly blocks: readonly DocumentBlock[];
    /** The transient empty-paragraph element, when one is armed. */
    readonly pendingParagraph?: PendingParagraphViewNode | undefined;
    static create(viewData: DocumentViewData, options: BlockViewOptions | undefined, previous: DocumentViewNode | undefined): DocumentViewNode;
    private constructor();
    /** The stable content element this document mounts its children into. */
    get contentDomNode(): HTMLElement;
}

/**
 * A DOM node paired with a caret offset inside it. The node is an arbitrary
 * {@link globalThis.Node} (a Text node for a caret inside text, an Element for
 * a hit on element-only content), and `offset` is the caret offset within it.
 */
export declare interface DomPosition {
    readonly node: globalThis.Node;
    readonly offset: number;
}

export declare type EditCommand = (ctx: CursorCommandContext) => {
    readonly edit: StringEdit;
    readonly selection: Selection_2;
} | undefined;

export declare type EditKeyboardAction = 'deleteLeft' | 'deleteRight' | 'deleteWordLeft' | 'deleteWordRight' | 'deleteLineLeft' | 'deleteLineRight';

export declare interface EditorCommandDefinition {
    readonly id: `markdown.editor.${string}`;
    readonly title: string;
    readonly action: EditorKeyboardAction;
    readonly keybindings: readonly EditorCommandKeybinding[];
    /**
     * Local commands must execute synchronously in the webview instead of being
     * forwarded through the VS Code keybinding service.
     */
    readonly routing?: 'host' | 'local';
}

export declare interface EditorCommandKeybinding {
    readonly key: string;
    readonly modifiers?: KeyboardModifiers;
    readonly platforms?: readonly KeyboardPlatform[];
}

/**
 * Translates raw browser input (mouse, keyboard, EditContext) into model
 * mutations. Knows about DOM event types but never reads/writes the DOM
 * directly — it asks the {@link EditorView} to broker DOM↔source-offset
 * conversions so the model stays free of view types.
 *
 * Owns the only non-derivable controller state:
 * - `_desiredColumn` — sticky column for up/down navigation
 * - `_clickCount` / `_lastPointerDown` — multi-click detection for pointer
 *   input, since `pointerdown` events (unlike `mousedown`) don't populate
 *   `detail` with a click count.
 */
export declare class EditorController extends Disposable {
    private readonly _model;
    private readonly _view;
    readonly findController: FindController | undefined;
    private _desiredColumn;
    private readonly _keyboardPlatform;
    private readonly _keyboardProfile;
    private readonly _forwardedKeyboardProfile;
    private readonly _historyStrategy;
    private readonly _indentation;
    private readonly _tabFocusStatus;
    private _tabMovesFocus;
    /** Indentation copied by the most recent fenced-code Enter, while still untouched. */
    private _generatedIndentation;
    /** Running click count for the current multi-click sequence (1, 2, 3, …). */
    private _clickCount;
    /** Timestamp and position of the previous pointer-down, for multi-click detection. */
    private _lastPointerDown;
    constructor(_model: EditorModel, _view: EditorView, options?: EditorControllerOptions);
    private readonly _handleTextUpdate;
    private _insertText;
    private _remainingGeneratedIndentation;
    /** Handle typed, pasted, or command-generated text while a paragraph is pending. */
    private _handlePendingInput;
    private _deletePendingText;
    private readonly _handlePointerDown;
    private _makeCursorContext;
    private _makeVisualCursorContext;
    private _executeCursorCommand;
    private _executeEditCommand;
    private _runUndoableEdit;
    private _executeVisualCursorCommand;
    private _cursorDown;
    private _setUserSelection;
    private _applyCursorPosition;
    /** Move the cursor down one visual line (Arrow Down). */
    cursorDown(extend?: boolean): void;
    /** Move the cursor up one visual line (Arrow Up). */
    cursorUp(extend?: boolean): void;
    private _selectedText;
    private readonly _updateModifierState;
    private readonly _clearModifierState;
    /**
     * Drop any native DOM selection over the rendered text.
     *
     * The editor paints selection from `model.selection`, so a browser
     * selection there is always spurious: nothing reads it (copy/cut read the
     * model, hit-testing uses the measured layout) and nothing clears it, so it
     * lingers as a second highlight even after the caret moves away.
     * {@link isCaretMotionKey} stops the common source synchronously; this is
     * the backstop for the rest of the browser's editing commands, which are
     * platform- and version-specific and cannot be enumerated (Shift+PageDown
     * and macOS Shift+Ctrl+B both reach one today).
     *
     * Scoped twice so it only ever discards selections the editor owns: the
     * range must touch the rendered text (overlays such as comment widgets sit
     * beside it and stay selectable), and input focus must still be inside this
     * editor (so a host find-in-page, which selects while its own input is
     * focused, is left alone).
     */
    private readonly _discardNativeSelection;
    private readonly _handleKeyDown;
    executeCommand(command: EditorCommandDefinition): void;
    private _executeKeyboardAction;
    /**
     * Context-aware Enter: splits / line-breaks via {@link insertSmartEnter}, or
     * arms a transient empty paragraph when at the end of a paragraph.
     */
    private _smartEnter;
    private _registerTabFocusAccessibility;
}

/** Options for an {@link EditorController}. */
export declare interface EditorControllerOptions {
    /**
     * How copy/cut/paste is handled. Defaults to {@link NativeClipboardStrategy},
     * which reads the browser's native clipboard events — pass a different
     * strategy (e.g. `AsyncClipboardStrategy`) in hosts that swallow them.
     */
    readonly clipboardStrategy?: IClipboardStrategy;
    /**
     * Where undo and redo are executed: `LocalHistoryStrategy` for a
     * self-contained editor, or a strategy that forwards to the host's own
     * document history. Left unset, the chords are passed on to the host.
     */
    readonly historyStrategy?: IHistoryStrategy;
    readonly keyboardPlatform?: KeyboardPlatform;
    readonly keyboardProfile?: KeyboardProfile;
    /**
     * Bindings owned by the host. Matching events have their browser default
     * suppressed but continue propagating so the host keybinding service sees them.
     */
    readonly forwardedKeyboardProfile?: KeyboardProfile;
    /** Tab-stop settings used outside semantic list indentation. */
    readonly indentation?: IndentationConfig;
    readonly find?: false;
}

/**
 * The editor overlay's local CSS-pixel coordinate space.
 *
 * Browser geometry and pointer APIs expose viewport client coordinates. This
 * boundary converts them immediately into the coordinate system shared by the
 * editor content and its overlays. Range rectangles are axis-aligned, so the
 * current implementation deliberately supports positive axis-aligned scale and
 * translation only.
 */
export declare class EditorCoordinateSpace {
    private readonly _getLocalToClientMatrix;
    static forSvgOverlay(overlay: SVGSVGElement): EditorCoordinateSpace;
    private constructor();
    capture(): EditorCoordinateTransform;
}

/** A stable coordinate conversion captured for one measurement operation. */
export declare class EditorCoordinateTransform {
    private readonly _localToClient;
    private readonly _clientToLocal;
    constructor(_localToClient: DOMMatrix);
    toLocalPoint(point: Pick<Point2D, 'x' | 'y'>): Point2D;
    toClientPoint(point: Pick<Point2D, 'x' | 'y'>): Point2D;
    toLocalRect(rect: Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>): Rect2D;
    toClientRect(rect: Pick<Rect2D, 'left' | 'top' | 'width' | 'height'>): Rect2D;
    private _convertRect;
}

export declare type EditorKeyboardAction = {
    readonly kind: 'cursor';
    readonly command: CursorKeyboardAction;
    readonly extend: boolean;
} | {
    readonly kind: 'edit';
    readonly command: EditKeyboardAction;
} | {
    readonly kind: 'history';
    readonly command: HistoryKeyboardAction;
} | {
    readonly kind: 'tab';
    readonly command: TabKeyboardAction;
} | {
    readonly kind: 'toggleTabFocus';
} | {
    readonly kind: 'selectAll';
} | {
    readonly kind: 'enter';
    readonly command: 'smartEnter' | 'insertParagraph' | 'insertHardLineBreak';
};

export declare class EditorModel {
    private readonly _parser;
    private readonly _sourceEditListeners;
    private readonly _sourceTextIds;
    private _lastSourceTextId;
    /**
     * The most recent edit applied to {@link sourceText}, used by
     * {@link document} to let the parser link incrementally edited code
     * blocks. Only trusted when it exactly bridges the previous and current
     * source text (see {@link document}).
     */
    private _pendingEdit;
    readonly sourceText: ISettableObservable<StringValue, void>;
    readonly wordNavigationConfig: ISettableObservable<WordNavigationConfig, void>;
    /**
     * Read-only mode. When `true`, the editor never reveals a block's source
     * markers (markdown special characters like `**`, `#`, list bullets, code
     * fences, `$…$`) — every block stays in its clean rendered form regardless of
     * where the caret/selection is — and text-editing commands are ignored.
     * Explicit interactions with rendered controls, such as task checkboxes,
     * remain available. Plain text selection still works everywhere (so the user
     * can copy). The default (`false`) is the normal editing mode where the active
     * block reveals its markers.
     */
    readonly readonlyMode: ISettableObservable<boolean, void>;
    /**
     * The current selection, or `undefined` when the editor has no caret
     * (e.g. an inactive/unfocused rendering).
     */
    readonly selection: ISettableObservable<Selection_2 | undefined, void>;
    readonly selectionSource: ISettableObservable<SelectionSource, void>;
    /**
     * Whether a Ctrl/Cmd modifier is currently held. Set by the controller from
     * live keyboard state; the view reads it to show the link-open affordance
     * (underline + pointer cursor) only while a Ctrl/Cmd+click would open a link
     * whose block is active.
     */
    readonly ctrlOrMetaDown: ISettableObservable<boolean, void>;
    /**
     * Whether a pointer-driven selection drag is currently in progress. Set by
     * the controller between the pointer-down that starts the drag and the
     * pointer-up/cancel that ends it. Contributions read it to defer UI that
     * would otherwise flicker mid-drag (e.g. the comment input box appears only
     * once the drag ends).
     */
    readonly isSelecting: ISettableObservable<boolean, void>;
    /**
     * Gutter markers (source-control style change indicators) painted in the
     * left gutter. Each entry maps a source {@link OffsetRange} to a change kind
     * — see {@link GutterMarker}. Purely decorative: markers never affect the
     * parsed {@link document}, selection, or layout. Empty by default.
     */
    readonly gutterMarkers: ISettableObservable<readonly GutterMarker[], void>;
    /**
     * Forces the rendered active-block set. `undefined` (the default)
     * derives the set from the current selection range (see
     * {@link activeBlocks}). The sentinel {@link NO_ACTIVE_BLOCKS} forces
     * "no active block" — useful in fixtures that always want the
     * collapsed/inactive rendering.
     */
    readonly activeBlocksOverride: ISettableObservable<readonly BlockAstNode[] | typeof NO_ACTIVE_BLOCKS | undefined, void>;
    /**
     * The transient empty-paragraph editing state, or `undefined` when none is
     * armed. See {@link PendingParagraph}. This is *not* document data — it is
     * cleared by any source edit and lives only between the Enter that armed it
     * and the next content-producing edit.
     */
    readonly pendingParagraph: ISettableObservable<PendingParagraph | undefined, void>;
    readonly cursorOffset: IObservableWithChange<number | undefined, void>;
    readonly cursorPosition: IObservableWithChange<CursorPosition | undefined, void>;
    /**
     * The parsed document. Threads the previous document into the parser so
     * unchanged blocks keep their object identity across reparses (see
     * {@link MarkdownParser.parse}). Writing `previous` inside the compute is
     * safe: unchanged source reuses it directly, while changed source produces
     * a result structurally identical to a full reparse.
     */
    readonly document: IObservableWithChange<DocumentAstNode, void>;
    /**
     * Block that contains the cursor (selection's active end). Used by
     * cursor navigation to know which block's marker ranges count as
     * visible. Unaffected by {@link activeBlocksOverride} because
     * navigation is independent of rendering.
     */
    readonly activeBlock: IObservableWithChange<BlockAstNode | undefined, void>;
    /**
     * All blocks whose source range intersects the current selection.
     * The rendering side uses this to decide which blocks render in
     * their expanded (markers-visible) form. When the selection is
     * collapsed this is a one-element set holding {@link activeBlock}.
     */
    readonly activeBlocks: IObservableWithChange<Set<BlockAstNode>, void>;
    /**
     * The baseline document to diff against. When set, the editor renders in
     * diff mode: the modified document ({@link document}) stays editable, while
     * the baseline's removed/changed blocks are shown as read-only decorations.
     * `undefined` (the default) renders normally.
     */
    readonly baseline: ISettableObservable<StringValue | undefined, void>;
    private readonly _baselineDocument;
    /**
     * The diff of {@link baseline} → {@link document}, or `undefined` when no
     * baseline is set. The view renders the {@link DiffItem}s as stacked
     * decorations; `insertedRanges` (modified-side change spans) drive the green
     * word-level highlight.
     */
    readonly diff: IObservableWithChange<    {
    items: DiffItem[];
    insertedRanges: OffsetRange[];
    changedBlocks: Set<BlockAstNode>;
    } | undefined, void>;
    readonly markerVisibleBlocks: IObservableWithChange<Set<BlockAstNode>, void>;
    onWillApplySourceEdit(listener: (event: SourceEditEvent) => void): IDisposable;
    /** Returns a stable per-object identity without retaining the source text. */
    getSourceTextId(sourceText: StringValue): number;
    /**
     * Arm a {@link PendingParagraph} at the given gap, minting a fresh synthetic
     * AST node for it, and park the caret at the gap start. No source edit is
     * applied — the blank line exists only in the view until it is materialized.
     */
    armPendingParagraph(req: Omit<PendingParagraph, 'syntheticAst' | 'cursorLine' | 'text'>): void;
    /** Discard the pending paragraph (if any) without touching the source. */
    cancelPendingParagraph(): void;
    /**
     * Replace the source with an authoritative value from the host, mapping the
     * selection through the changed span and atomically discarding transient
     * state anchored to the previous parse.
     */
    replaceSourceText(text: StringValue): void;
    /** Replace the transient horizontal whitespace on the pending line. */
    setPendingParagraphText(text: string): void;
    /**
     * Turn the pending paragraph into real source: rewrite its gap so the typed
     * text, including any transient indentation, is separated from its neighbours
     * by blank lines, and place the caret after it.
     */
    materializePendingParagraph(text: string): void;
    /** Sets a rendered task checkbox state in either editing or read-only mode. */
    setTaskCheckboxChecked(item: ListItemAstNode, checked: boolean): void;
    applyEdit(edit: StringEdit, selection?: Selection_2): void;
    applyEditForSelection(edit: StringEdit): void;
    private _applySourceEdit;
    private _identifySourceEdit;
    private _emitWillApplySourceEdit;
}

export declare type EditorOverlayPosition = 'top-chrome' | 'below-selection' | 'above-decorations';

/**
 * Pure-render view of an {@link EditorModel}.
 *
 * Invariant (the whole point of this file):
 *
 *     view(model + Δ) = view(model) + Δ
 *
 * The DOM the view produces is a function of the model. The only state the
 * view holds is *DOM management*: the cached `BlockViewNode` instances and the
 * `EditContext`. Anything that influences correctness but is not derivable
 * from the model lives elsewhere:
 *
 *   - measured heights and per-block visual line maps  →  {@link MeasuredLayoutModel}
 *   - desired column, drag-time freeze                 →  EditorController
 *
 * The view does not own a controller — callers construct an
 * `EditorController` separately and pass it the view, so input handling is
 * explicit and the view stays a pure renderer.
 *
 * The view writes into the measured-layout model as a side effect of
 * rendering. It never reads its own measurements during rendering, so
 * there is no feedback loop.
 */
export declare class EditorView extends Disposable {
    private readonly _model;
    private readonly _options?;
    readonly element: HTMLElement;
    readonly editContext: EditContext;
    readonly measuredLayout: MeasuredLayoutModel;
    readonly coordinateSpace: EditorCoordinateSpace;
    readonly forcedMarkerVisibleBlocks: ISettableObservable<ReadonlySet<BlockAstNode>, void>;
    /**
     * Inner container that holds the rendered document and the cursor/selection
     * overlays. The outer {@link element} spans the full width; this container
     * is what limited-width mode caps and centers, so the overlays (which anchor
     * to their parent's box) stay aligned with the content.
     */
    private readonly _contentContainer;
    private readonly _resizeObserver;
    private readonly _cursorView;
    private readonly _selectionView;
    private readonly _gutterMarkersView;
    private readonly _diffHighlightsView;
    private _readonlyToggleButton;
    private readonly _editContextSuspensions;
    private readonly _revealOcclusions;
    private _caretRevealRaf;
    private _followedCaretBlock;
    private _followCaretAfterEdit;
    /**
     * The mounted block sequence, in source order. Rebuilt (not mutated) each
     * frame by {@link DocumentViewNode.create}; the view just swaps one
     * immutable node for the next. Never used for source-of-truth lookups
     * (those go through the measured-layout model).
     */
    private readonly _document;
    private readonly _embeddedCodeEditorFactoryVersion;
    /** The current view-node tree (AST overlaid with rendered DOM), for debugging. */
    get documentViewNode(): IObservable<DocumentViewNode | undefined>;
    /** Re-resolves embedded code editors while preserving the surrounding editor view. */
    refreshEmbeddedCodeEditors(): void;
    /**
     * Last frame's view-data overlay, threaded back into
     * {@link buildDocumentViewData} so any subtree whose ast and selection flags
     * are unchanged keeps its view-data object — which lets the renderer reuse
     * its DOM by identity.
     */
    private _previousViewData;
    /** The current view-data tree (AST overlaid with selection flags), for debugging. */
    private readonly _viewData;
    get viewData(): IObservable<DocumentViewData | undefined>;
    /**
     * Whether the editor is genuinely focused: focus rests somewhere inside the
     * editor subtree *and* its window is focused. Mirrored onto the root as
     * `.md-focused`, which gates the painted caret — the blinking cursor is only
     * shown while this is `true`, so it never blinks in an unfocused editor or
     * after the window loses focus. Only the caret's visibility is affected; the
     * logical selection and caret geometry ({@link caretRect}) are unchanged.
     */
    private readonly _focused;
    get focused(): IObservable<boolean>;
    /**
     * The block cache projected for views (selection painting) that need to
     * react to mount/unmount. Derived from {@link _document}, so it stays in
     * lock-step without any manual bookkeeping.
     */
    private readonly _selectionBlocksObs;
    /**
     * The caret rect (zero width) at the selection's active end, in
     * {@link overlayContainer}-local coordinates, or `undefined` when there is no
     * caret. This is the same geometry the editor paints its cursor from, so
     * contributions (e.g. comment mode) can anchor an overlay to the active end of
     * the selection — where the user's cursor is — without re-deriving geometry.
     */
    private readonly _caretRect;
    get caretRect(): IObservable<Rect2D | undefined>;
    /**
     * The container that establishes the positioning context for the editor's
     * overlays (cursor, selection, gutter). Contributions mount their own
     * absolutely-positioned overlays here so they share the coordinate space of
     * {@link caretRect}.
     */
    get overlayContainer(): HTMLElement;
    /**
     * Selection-style rectangles covering `range`, in {@link overlayContainer}-
     * local coordinates — the same geometry the live selection paints. Exposed so
     * contributions (e.g. persistent comments) can highlight arbitrary ranges and
     * anchor overlays to them. Recomputes when the measured layout changes.
     */
    rangeRects(range: OffsetRange): IObservable<readonly SelectionRect[]>;
    constructor(_model: EditorModel, _options?: EditorViewOptions | undefined);
    /**
     * Mirrors the model's live Ctrl/Cmd state onto the editor root as
     * `.md-mod-down` so CSS can show the link-open underline and pointer cursor
     * only while a click would actually open the link: an inactive link opens on
     * a plain click, but an active link only opens with the modifier held.
     */
    private _setupModifierTracking;
    /**
     * Tracks whether the editor is genuinely focused and mirrors it onto the
     * root as `.md-focused` so CSS can gate the painted caret. "Focused" means
     * focus rests somewhere inside the editor subtree *and* the window itself is
     * focused; either condition failing (focus moving elsewhere, or the window
     * losing focus) hides the blinking caret while leaving the logical selection
     * and caret geometry intact.
     */
    private _setupFocusTracking;
    private _setupCaretScrollPadding;
    /**
     * Renders the edit/read-only mode toggle. It flips the model's
     * {@link EditorModel.readonlyMode}: when locked (read-only) every block stays
     * in its clean rendered form (no markdown markers revealed) and edits are
     * ignored, while text selection still works. The control lives in a
     * zero-height *sticky* host inside the centered content container, so the
     * lock follows the content's right edge and remains pinned as the document
     * scrolls. The current mode is also mirrored onto the root as `.md-readonly`
     * for any CSS hooks.
     */
    private _setupReadonlyToggle;
    /** Draws attention to the mode toggle after text input is attempted while locked. */
    showReadonlyEditingAttempt(): void;
    focus(): void;
    mountOverlay(element: HTMLElement | SVGSVGElement, position: EditorOverlayPosition): IDisposable;
    /** Registers floating editor chrome that should count as covering a range during reveal. */
    registerRevealOcclusion(element: Element): IDisposable;
    /**
     * Temporarily detaches the root {@link EditContext} while focus is inside
     * nested editor chrome. Chromium otherwise reclaims focus from non-text
     * controls inside the EditContext host, breaking keyboard access to controls
     * such as the find actions and read-only toggle.
     */
    suspendEditContextWhileFocused(element: HTMLElement): IDisposable;
    revealRangeInCenterIfOutsideViewport(range: OffsetRange, behavior?: ScrollBehavior): IDisposable;
    /**
     * Keeps the caret visible after an editor-driven text edit. The reveal is
     * deferred until the rebuilt document has been laid out and uses nearest-edge
     * scrolling so ordinary typing only moves the containing viewport as far as
     * needed. While this mode is active, a later resize of the same active block
     * also re-reveals the caret (for asynchronous code, math, or diagram layout).
     */
    revealCaretAfterEdit(): void;
    /** Keeps a keyboard-moved caret visible without enabling edit-resize following. */
    revealCaretAfterKeyboardNavigation(): void;
    /** Stops edit-driven caret following before pointer-based selection begins. */
    stopFollowingCaret(): void;
    /**
     * Samples the ambient focus state that decides whether taking focus on open
     * would steal it from an explicit user target: whether the window is focused
     * and whether focus is still unclaimed (no active element, or the `<body>`
     * fallback).
     */
    private _sampleAutoFocusEnvironment;
    /**
     * One-shot guarded focus attempt: focuses the editor only if doing so will
     * not steal focus from an explicit user target — the window must already be
     * focused and no other element may have claimed focus yet. Returns whether
     * focus was taken. A no-op for a background window or when the user has
     * already focused something else. {@link autoFocusOnOpen} builds the
     * open-time behavior on top of this primitive.
     */
    tryAutoFocus(): boolean;
    /**
     * Focuses the editor when it opens without ever stealing focus from an
     * explicit user target. Tries once immediately; if the window is not focused
     * yet — a common open-time race where the editor is mounted before the host
     * routes focus to its window — the guarded attempt is deferred to the next
     * time the window gains focus and re-evaluated then. The deferral is
     * one-shot, so a later, unrelated window refocus never grabs focus, and the
     * re-check still respects any target the user has claimed in the meantime.
     */
    autoFocusOnOpen(): void;
    /**
     * Own point→offset resolution. When `true` (the default),
     * {@link resolveOffsetFromPoint} ignores the platform DOM hit-test
     * (`caretPositionFromPoint`) and snaps the point to the nearest offset purely
     * from the rendered {@link VisualLineMap} geometry — picking the nearest
     * visual line by `y`, then the nearest offset on it by `x`. Because a table
     * row's cells share one horizontal line band, this makes the whole width of a
     * row resolve into that row (rather than only the cell boxes), with no visible
     * layout change. It also lets a drag keep extending toward off-viewport points
     * (e.g. the pointer leaving the window), which the platform hit-test cannot
     * resolve. Set to `false` to fall back to the platform DOM hit-test.
     */
    readonly geometricHitTest: ISettableObservable<boolean, void>;
    /**
     * Client coordinates → absolute source offset (any block). Used during
     * drag to keep extending the selection even when the pointer leaves the
     * original block. Honours {@link geometricHitTest}.
     */
    resolveOffsetFromPoint(point: Point2D): SourceOffset | undefined;
    /**
     * Resolve table-cell hits that have no measurable text run. Empty cells map
     * from their own box instead of snapping to a neighboring cell; element-only
     * content (for example an inactive image) maps through the hit element's view
     * node. Text-bearing cells keep the normal pixel-precise line-map/DOM path.
     */
    private _resolveTableCellOffset;
    /**
     * Whether a client point falls on the rendered document content, as
     * opposed to the surrounding editor padding (the green area). Uses DOM
     * containment rather than the content node's bounding box so that markers
     * which overflow into the padding (e.g. a heading's `##`, which renders in
     * the left margin) still count as content. Overlays (cursor, selection)
     * have `pointer-events: none`, so the hit-test sees through them.
     */
    isPointInContent(point: Point2D): boolean;
    /**
     * Whether `range` intersects the rendered source text — the region whose
     * selection this editor paints itself from `model.selection`. This also
     * catches select-all ranges whose endpoints surround the rendered content.
     * Overlays anchored beside the text (comment widgets and the like) are *not*
     * part of it and keep their own native selection behaviour.
     */
    intersectsRenderedContent(range: Range): boolean;
    private readonly _renderAutorun;
    /** Current mounted blocks, or empty before the first render. */
    private get _blocks();
    /**
     * Measure each mounted block's rect and per-block visual line map, then
     * publish the result into the {@link MeasuredLayoutModel}. The model
     * is not read here, so there is no feedback loop into the render autorun.
     */
    private _publishMeasurements;
    /**
     * Paint the diff highlights via the CSS Custom Highlight API: green over the
     * inserted/changed modified ranges (mapped on the document's own DOM), and
     * red over each {@link DiffDecorationViewNode}'s deleted ranges (mapped on
     * the decoration's own subtree). No DOM is mutated, so reconciliation and
     * editing are unaffected.
     */
    private _paintDiff;
    private _clearDiff;
    private _syncEditContextAttachment;
    private _revealRange;
    private _revealTarget;
    private _scheduleCaretReveal;
    private _revealCaretNearest;
    private _revealCaretAfterActiveBlockResize;
    private _caretBlockAt;
    private _measurementAt;
    private _stopFollowingCaret;
    private _isRevealOccluded;
}

export declare interface EditorViewOptions extends BlockViewOptions {
    /**
     * Extra class names added to the editor root element, e.g. a theme class
     * such as `'md-theme-default'` or `'github-markdown-theme'`. Theme styles
     * are scoped under these classes, so the editor is unstyled (base chrome
     * only) unless a theme class is supplied.
     */
    readonly classNames?: readonly string[];
    /**
     * Whether to render the sticky edit/read-only toggle at the top-right edge
     * of the content. Defaults to `true`; set to `false` to omit it (e.g. in
     * fixtures that focus on selection rendering).
     */
    readonly showReadonlyToggle?: boolean;
    /**
     * Controls "limited width mode". The observable yields the maximum content
     * width in pixels, or `undefined` to let the content fill the available
     * width. When the option is omitted, the width is capped at
     * {@link DEFAULT_LIMITED_WIDTH}px (limited mode is on by default).
     *
     * The cap and centering apply to an inner content container; the editor
     * root ({@link element}) always spans the full available width.
     */
    readonly limitedWidth?: IObservable<number | undefined>;
    /**
     * Diff mode only: render every read-only original decoration in active
     * (source) form, so even whole-block removals expose their markdown markers
     * as real text. Used by the diff-coverage fixture to verify that every
     * changed original character is rendered somewhere; off in normal use, where
     * whole removals show a clean solid band.
     */
    readonly diffDecorationsActive?: boolean;
}

export declare class EmphasisAstNode extends AstNode {
    readonly openMarker: MarkerAstNode;
    readonly content: readonly (InlineAstNode | GlueAstNode)[];
    readonly closeMarker: MarkerAstNode;
    readonly kind = "emphasis";
    constructor(openMarker: MarkerAstNode, content: readonly (InlineAstNode | GlueAstNode)[], closeMarker: MarkerAstNode);
    get children(): readonly AstNode[];
    mapChildren(m: ReadonlyMap<AstNode, AstNode>): AstNode;
}

declare class EmphasisViewData {
    readonly ast: EmphasisAstNode;
    readonly content: readonly AnyViewData[];
    readonly kind = "emphasis";
    constructor(ast: EmphasisAstNode, content: readonly AnyViewData[]);
}

export declare function escapeFindRegex(value: string): string;

export declare const FIND_MATCH_LIMIT = 19999;

export declare function findBlockAtOffset(doc: DocumentAstNode, offset: SourceOffset): BlockAstNode | undefined;

export declare class FindController extends Disposable {
    private readonly _editorModel;
    private readonly _view;
    private readonly _options;
    readonly model: FindModel;
    readonly widget: FindWidget;
    private readonly _selectionForScope;
    private _forcedMatch;
    private _selectedMatch;
    private _observedSourceTextId;
    private readonly _sourceEditTracker;
    private _revealRequest;
    constructor(_editorModel: EditorModel, _view: EditorView, _options: FindControllerOptions);
    private _setForcedMarkerVisibleBlocks;
    openAndFocus(): void;
    close(): void;
    private _handleKeyDown;
    private _cancelRevealRequest;
    private _findByKeyboard;
    private _querySeed;
    private _prepareSeed;
    private _selectedSingleLineText;
    private _toggleFindInSelection;
}

export declare interface FindControllerOptions {
    readonly keyboardPlatform: KeyboardPlatform;
}

export declare type FindDirection = 'next' | 'previous';

export declare class FindHighlightsView extends Disposable {
    private readonly _view;
    private readonly _matchesLayer;
    private readonly _currentLayer;
    private readonly _highlightRegistration;
    private readonly _resizeObserver;
    private readonly _resizeObservedElements;
    private _snapshot;
    private _paintRaf;
    constructor(_view: EditorView, findModel: FindModel);
    private _schedulePaint;
    private _paint;
    private _observeResizeAncestors;
    private _paintRanges;
}

export declare interface FindMatchesResult {
    readonly matches: readonly OffsetRange[];
    readonly isCapped: boolean;
}

export declare class FindModel extends Disposable {
    private readonly _editorModel;
    readonly isRevealed: ISettableObservable<boolean, void>;
    readonly searchString: ISettableObservable<string, void>;
    readonly isRegex: ISettableObservable<boolean, void>;
    readonly matchCase: ISettableObservable<boolean, void>;
    readonly wholeWord: ISettableObservable<boolean, void>;
    readonly searchScope: ISettableObservable<OffsetRange | undefined, void>;
    readonly currentMatch: ISettableObservable<OffsetRange | undefined, void>;
    readonly loop: ISettableObservable<boolean, void>;
    readonly searchResult: IObservableWithChange<    {
    kind: "invalid";
    error: Error;
    pattern?: undefined;
    matches?: undefined;
    isCapped?: undefined;
    } | {
    kind: "valid";
    pattern: FindPattern;
    matches: readonly OffsetRange[];
    isCapped: boolean;
    error?: undefined;
    }, void>;
    readonly matchesCount: IObservableWithChange<number, void>;
    readonly isCapped: IObservableWithChange<boolean, void>;
    readonly currentMatchPosition: IObservableWithChange<number, void>;
    private _searchOrigin;
    private readonly _sourceEditTracker;
    private _pendingInitialDirection;
    constructor(_editorModel: EditorModel);
    reveal(options: {
        readonly origin: number;
        readonly searchString?: string;
        readonly direction?: FindDirection;
    }): void;
    hide(): void;
    setSearchOrigin(offset: number): void;
    setSearchScope(scope: OffsetRange | undefined): void;
    moveToNextMatch(): OffsetRange | undefined;
    moveToPreviousMatch(): OffsetRange | undefined;
    private _move;
    private _selectFromOrigin;
    private _mapStateThroughEdit;
    private _inputSnapshot;
    private _readInputSnapshot;
}

/**
 * Source offset (relative to `root`) of the node with `target`'s id, or
 * `undefined` when it is not in the tree. Ids are stable across edits, so this
 * locates a node even after reconciliation has rebuilt the tree around it.
 */
export declare function findNodeOffsetById(root: AstNode, target: AstNode): number | undefined;

export declare class FindPattern {
    private readonly _source;
    private readonly _flags;
    private readonly _wholeWord;
    private readonly _wordSeparators;
    readonly isEmpty: boolean;
    private constructor();
    static create(query: FindQuery): FindQueryResult;
    findMatches(text: string, scope?: OffsetRange, limit?: number): FindMatchesResult;
    findNextMatch(text: string, after: number, scope?: OffsetRange, loop?: boolean, skip?: OffsetRange): OffsetRange | undefined;
    findPreviousMatch(text: string, before: number, scope?: OffsetRange, loop?: boolean, skip?: OffsetRange): OffsetRange | undefined;
    private _forEachMatch;
}

export declare interface FindQuery {
    readonly searchString: string;
    readonly isRegex: boolean;
    readonly matchCase: boolean;
    readonly wholeWord: boolean;
    readonly wordSeparators: string;
}

export declare type FindQueryResult = {
    readonly kind: 'valid';
    readonly pattern: FindPattern;
} | {
    readonly kind: 'invalid';
    readonly error: Error;
};

export declare type FindSearchResult = {
    readonly kind: 'valid';
    readonly pattern: FindPattern;
    readonly matches: readonly OffsetRange[];
    readonly isCapped: boolean;
} | {
    readonly kind: 'invalid';
    readonly error: Error;
};

export declare class FindWidget extends Disposable {
    private readonly _view;
    private readonly _options;
    readonly element: HTMLElement;
    readonly panelElement: HTMLElement;
    readonly focused: ISettableObservable<boolean, void>;
    private readonly _inputShell;
    private readonly _input;
    private readonly _matchesCount;
    private readonly _previousButton;
    private readonly _nextButton;
    private readonly _selectionButton;
    private readonly _caseButton;
    private readonly _wholeWordButton;
    private readonly _regexButton;
    private readonly _error;
    constructor(_view: EditorView, _options: FindWidgetOptions);
    focusAndSelect(): void;
    private _registerButton;
    private _render;
}

export declare interface FindWidgetOptions {
    readonly findModel: FindModel;
    readonly canFindInSelection: IObservable<boolean>;
    readonly onNext: () => void;
    readonly onPrevious: () => void;
    readonly onToggleFindInSelection: () => void;
    readonly onClose: () => void;
}

export declare function findWordAt(text: string, offset: number, config?: WordNavigationConfig): {
    start: number;
    end: number;
};

export declare function findWordBoundaryLeft(text: string, offset: number, config?: WordNavigationConfig): number;

export declare function findWordBoundaryRight(text: string, offset: number, config?: WordNavigationConfig): number;

export declare function findWordDeleteBoundaryLeft(text: string, offset: number, config?: WordNavigationConfig): number;

export declare function findWordDeleteBoundaryRight(text: string, offset: number, config?: WordNavigationConfig): number;

/**
 * A leading YAML front matter block. The YAML value is intentionally opaque:
 * only the two fences and the exact source between them are modeled.
 */
export declare class FrontMatterAstNode extends BlockAstNodeBase {
    readonly content: readonly (MarkerAstNode | GlueAstNode)[];
    readonly leadingTrivia?: GlueAstNode | undefined;
    readonly kind = "frontMatter";
    constructor(content: readonly (MarkerAstNode | GlueAstNode)[], leadingTrivia?: GlueAstNode | undefined);
    get children(): readonly AstNode[];
    get openFence(): MarkerAstNode | undefined;
    get closeFence(): MarkerAstNode | undefined;
    get value(): MarkerAstNode | undefined;
    mapChildren(m: ReadonlyMap<AstNode, AstNode>): AstNode;
    withLeadingTrivia(trivia: GlueAstNode | undefined): FrontMatterAstNode;
}

declare class FrontMatterViewData {
    readonly ast: FrontMatterAstNode;
    /** Active: render both fences; inactive: render only the opaque YAML value. */
    readonly showMarkup: boolean;
    readonly content: readonly AnyViewData[];
    readonly kind = "frontMatter";
    constructor(ast: FrontMatterAstNode, 
    /** Active: render both fences; inactive: render only the opaque YAML value. */
    showMarkup: boolean, content: readonly AnyViewData[]);
}

export declare function getAnnotatedSource(node: AstNode, source: string, offset?: number): string;

/** Non-semantic syntactic glue: whitespace, padding, table pipes. */
export declare class GlueAstNode extends LeafAstNode {
    readonly content: string;
    readonly glueKind?: string | undefined;
    readonly kind = "glue";
    constructor(content: string, glueKind?: string | undefined);
    protected _localEquals(o: this): boolean;
}

declare class GlueViewData {
    readonly ast: GlueAstNode;
    readonly visible: boolean;
    /**
     * Whether a source newline in this glue gets a visible `↵`. True only in
     * inline flow, where the newline collapses to a space and the `↵` reveals
     * the line ending hiding there; between block-level siblings (list items,
     * block children) the break is already visible, so no `↵` is drawn.
     */
    readonly decorateNewline: boolean;
    readonly kind = "glue";
    constructor(ast: GlueAstNode, visible: boolean, 
    /**
     * Whether a source newline in this glue gets a visible `↵`. True only in
     * inline flow, where the newline collapses to a space and the `↵` reveals
     * the line ending hiding there; between block-level siblings (list items,
     * block children) the break is already visible, so no `↵` is drawn.
     */
    decorateNewline: boolean);
}

/**
 * A single gutter marker: a source {@link OffsetRange} tagged with a
 * {@link GutterMarkerType}. The view resolves the range to the visual lines it
 * covers and paints a bar (or, for `deleted`, a wedge at the range position) in
 * the left gutter.
 *
 * A `deleted` marker is normally an empty range (`range.isEmpty`) sitting at the
 * boundary where the removed text used to be — there is nothing left to span,
 * so it is drawn as a caret between lines rather than a bar.
 */
export declare interface GutterMarker {
    readonly range: OffsetRange;
    readonly type: GutterMarkerType;
}

/**
 * The kind of change a gutter marker represents, mirroring the three states a
 * source-control diff distinguishes (the git change markers in the editor
 * gutter): a freshly inserted region, an edited region, and a point where
 * content was removed.
 */
export declare type GutterMarkerType = 'added' | 'modified' | 'deleted';

export declare class HeadingAstNode extends BlockAstNodeBase {
    readonly level: 1 | 2 | 3 | 4 | 5 | 6;
    readonly marker: MarkerAstNode;
    readonly content: readonly (InlineAstNode | GlueAstNode)[];
    readonly leadingTrivia?: GlueAstNode | undefined;
    readonly kind = "heading";
    constructor(level: 1 | 2 | 3 | 4 | 5 | 6, marker: MarkerAstNode, content: readonly (InlineAstNode | GlueAstNode)[], leadingTrivia?: GlueAstNode | undefined);
    get children(): readonly AstNode[];
    mapChildren(m: ReadonlyMap<AstNode, AstNode>): AstNode;
    withLeadingTrivia(trivia: GlueAstNode | undefined): HeadingAstNode;
    protected _localEquals(o: this): boolean;
}

declare class HeadingViewData {
    readonly ast: HeadingAstNode;
    readonly content: readonly AnyViewData[];
    readonly kind = "heading";
    constructor(ast: HeadingAstNode, content: readonly AnyViewData[]);
}

export declare function hiddenCursorRanges(doc: DocumentAstNode, markerVisibleBlocks: ReadonlySet<BlockAstNode>, cursor: number): readonly OffsetRange[];

export declare type HistoryKeyboardAction = 'undo' | 'redo';

/** A block HTML comment, discriminated by whether its closing delimiter is present. */
declare type HtmlCommentSource = OpenHtmlCommentSource | CompleteHtmlCommentSource;

declare interface HtmlCommentSourceBase {
    readonly leadingWhitespace: string;
    readonly opening: '<!--';
    readonly body: string;
}

/**
 * The editor operations a clipboard strategy drives. The strategy never
 * touches the model or the DOM directly — it asks through this seam, so the
 * same strategy works regardless of how the editor is wired up.
 */
export declare interface IClipboardContext {
    /** The element that owns focus and receives clipboard/keyboard events. */
    readonly element: HTMLElement;
    /** The selected source text, or `undefined` when the selection is empty. */
    getSelectedText(): string | undefined;
    /** Delete the current selection (the cut half of cut). */
    deleteSelection(): void;
    /** Insert text at the caret, replacing any selection (the paste action). */
    insertText(text: string): void;
}

/**
 * How copy/cut/paste intent reaches the editor. Host environments deliver it
 * differently, so the controller owns no clipboard logic itself — it
 * {@link connect}s a strategy and lets it install whatever listeners it needs.
 *
 * Two implementations ship:
 * - {@link NativeClipboardStrategy} (default) reads the browser's native
 *   `copy`/`cut`/`paste` events and their synchronous `clipboardData`.
 * - {@link AsyncClipboardStrategy} drives the async `navigator.clipboard` API
 *   from Ctrl/Cmd+C/X/V keystrokes, for hosts (e.g. VS Code webviews) that
 *   swallow the native clipboard events before they reach the editor.
 */
export declare interface IClipboardStrategy {
    /**
     * Wire up clipboard handling against `context`. The returned disposable
     * tears down every listener the strategy installed.
     */
    connect(context: IClipboardContext): IDisposable;
}

/** The Monarch language definitions the default highlighter wires up. */
export declare interface IDefaultMonarchGrammars {
    typescript: unknown;
    javascript: unknown;
    css: unknown;
    html: unknown;
    python: unknown;
    rust: unknown;
    shell: unknown;
    yaml: unknown;
}

/**
 * A live editor embedded in place of a fenced code block's *rendered* form.
 *
 * This is the internal seam between the block view and a concrete embedded
 * editor (e.g. an `<iframe>` speaking the web-editor protocol). The block view
 * only speaks string edits: it pushes the block's content down via
 * {@link setContent} and receives the editor's own changes back through
 * {@link onEdit} (set by the block view on each (re)construction, so it always
 * routes to the current AST node). The concrete implementation owns its DOM,
 * transport, and lifecycle.
 *
 * A single instance is adopted across re-renders (like the highlighter session)
 * so the underlying editor keeps its state across edits — see
 * {@link CodeBlockViewNode}.
 */
declare interface IEmbeddedCodeEditor {
    /** The element mounted as the block's rendered form. */
    readonly element: HTMLElement;
    /**
     * Document → editor. The block's content changed (from any source). Must be
     * idempotent: pushing the content the editor already holds is a no-op, which
     * is how edits the editor itself originated are prevented from echoing back.
     */
    setContent(content: string): void;
    /** Update whether the embedded editor may change its content. */
    setReadOnly?(readOnly: boolean): void;
    /**
     * Optional synchronous height (px) to reserve for `content` *before* the
     * editor has laid out. Return `undefined` to let the editor size itself
     * (the implementation may report its real height later). Lets a registration
     * avoid a layout jump when it can cheaply estimate the size from content.
     */
    estimateHeight?(content: string): number | undefined;
    /**
     * Editor → document. Set by the block view on every (re)construction to
     * route the editor's own edits, expressed in the block's *content*
     * coordinates, to the current AST node.
     */
    onEdit?: (edit: StringEdit) => void;
    dispose(): void;
}

/** Creates an {@link IEmbeddedCodeEditor} for a fenced block, or opts out. */
declare interface IEmbeddedCodeEditorFactory {
    /**
     * Return an editor for a fenced block, or `undefined` to fall
     * back to the default (highlighting / {@link BlockViewOptions.renderCustomCodeBlock}).
     */
    create(language: string, infoString: string, initialContent: string): IEmbeddedCodeEditor | undefined;
}

/**
 * Routes undo and redo to whatever owns the document's history: the editor
 * itself on a standalone page, or the enclosing document in a host like
 * VS Code.
 */
export declare interface IHistoryStrategy {
    undo(): void;
    redo(): void;
    /**
     * Invoked around each source mutation so the strategy can record it.
     * Implemented only by strategies that build their own history; a host that
     * forwards edits to a VS Code `TextDocument` lets it record them instead.
     */
    record?(operation: () => void, edit?: StringEdit): void;
}

export declare interface ILinkPresentation extends IDisposable {
    /** Current presentation, updated without rebuilding the editor. */
    readonly presentation: IObservable<LinkPresentation | undefined>;
}

export declare interface ILinkPresentationProvider {
    /**
     * Returns `undefined` for unsupported links. The caller disposes the returned
     * reference when the rendered link disappears.
     */
    createLinkPresentation(url: string): ILinkPresentation | undefined;
}

export declare class ImageAstNode extends AstNode {
    readonly alt: string;
    readonly url: string;
    readonly content: readonly (MarkerAstNode | GlueAstNode)[];
    readonly kind = "image";
    constructor(alt: string, url: string, content: readonly (MarkerAstNode | GlueAstNode)[]);
    get children(): readonly AstNode[];
    mapChildren(m: ReadonlyMap<AstNode, AstNode>): AstNode;
    protected _localEquals(o: this): boolean;
}

declare class ImageViewData {
    readonly ast: ImageAstNode;
    /** Active: render the `![alt](url)` source; inactive: the `<img>`. */
    readonly showMarkup: boolean;
    readonly content: readonly AnyViewData[];
    readonly kind = "image";
    constructor(ast: ImageAstNode, 
    /** Active: render the `![alt](url)` source; inactive: the `<img>`. */
    showMarkup: boolean, content: readonly AnyViewData[]);
}

/**
 * The slice of monaco's Monarch internals the highlighter needs at runtime.
 *
 * `monaco-editor` is only a *type* dependency of this package; the caller (who
 * owns a real monaco runtime) passes these in, keeping monaco out of the bundle.
 */
export declare interface IMonarchApi {
    /** Compiles a Monarch language definition into the internal lexer form. */
    compile(languageId: string, json: unknown): unknown;
    MonarchTokenizer: new (languageService: unknown, standaloneThemeService: unknown, languageId: string, lexer: unknown, configurationService: unknown) => MonarchTokenizer;
}

/** Controls tab-stop insertion and non-list line indentation. */
export declare interface IndentationConfig {
    /** Number of visual columns between tab stops. */
    readonly tabSize: number;
    /** Whether indentation uses spaces instead of tab characters. */
    readonly insertSpaces: boolean;
}

export declare type InlineAstNode = TextAstNode | StrongAstNode | EmphasisAstNode | StrikethroughAstNode | InlineCodeAstNode | InlineMathAstNode | LinkAstNode | ImageAstNode;

export declare class InlineCodeAstNode extends AstNode {
    readonly content: readonly (MarkerAstNode | GlueAstNode)[];
    readonly kind = "inlineCode";
    constructor(content: readonly (MarkerAstNode | GlueAstNode)[]);
    get children(): readonly AstNode[];
    mapChildren(m: ReadonlyMap<AstNode, AstNode>): AstNode;
}

declare class InlineCodeViewData {
    readonly ast: InlineCodeAstNode;
    readonly content: readonly AnyViewData[];
    readonly kind = "inlineCode";
    constructor(ast: InlineCodeAstNode, content: readonly AnyViewData[]);
}

export declare class InlineMathAstNode extends AstNode {
    readonly content: readonly (MarkerAstNode | GlueAstNode)[];
    readonly kind = "inlineMath";
    constructor(content: readonly (MarkerAstNode | GlueAstNode)[]);
    get children(): readonly AstNode[];
    mapChildren(m: ReadonlyMap<AstNode, AstNode>): AstNode;
}

declare class InlineMathViewData {
    readonly ast: InlineMathAstNode;
    /** Active: render the `$…$` source; inactive: the KaTeX output. */
    readonly showMarkup: boolean;
    readonly content: readonly AnyViewData[];
    readonly kind = "inlineMath";
    constructor(ast: InlineMathAstNode, 
    /** Active: render the `$…$` source; inactive: the KaTeX output. */
    showMarkup: boolean, content: readonly AnyViewData[]);
}

declare type InlineViewData = TextViewData | StrongViewData | EmphasisViewData | StrikethroughViewData | InlineCodeViewData | InlineMathViewData | LinkViewData | ImageViewData;

/**
 * A Markdown hard line break: a `\n` whose preceding line ends with two spaces.
 * Any spaces already trailing the insertion point count toward the two, so the
 * line never accumulates more than the two needed to form the break.
 */
export declare const insertHardLineBreak: EditCommand;

export declare const insertLineBreak: EditCommand;

export declare const insertParagraph: EditCommand;

/**
 * Context-aware Enter. The behaviour is chosen from the active block:
 *  - paragraph / heading / thematic break — the "rich text" thing: at the
 *    block's end arm a transient empty paragraph (see {@link SmartEnterResult});
 *    elsewhere split into two paragraphs (`\n\n`).
 *  - fenced code / front matter — insert a newline that preserves the current
 *    line's indentation, staying inside the fences.
 *  - block quote — continue the quote (`\n> `); an empty quote line exits it.
 *  - list — continue the list with the next marker (incrementing ordered
 *    numbers, re-emitting task checkboxes); an empty item outdents one level
 *    before exiting the list.
 *  - complete HTML comment — at the comment's end, leave it by arming a
 *    transient paragraph; inside it (or while the comment is open), insert a
 *    normal source line break.
 * A non-collapsed selection, or any other block, falls back to a plain soft line
 * break, preserving today's behaviour.
 */
export declare const insertSmartEnter: (ctx: CursorCommandContext) => SmartEnterResult;

/**
 * VS Code-style Tab: insert to the next tab stop for a caret or partial
 * single-line selection, and indent every selected line for a line selection.
 */
export declare function insertTab(config?: IndentationConfig): EditCommand;

export declare function insertText(text: string, generatedIndentation?: OffsetRange): EditCommand;

/**
 * An immutable view of one document's tokens at a point in time. It may be a
 * thin view over the highlighter's mutable state: once the underlying document
 * advances, calling a stale snapshot is allowed to throw.
 *
 * Token stability: across snapshots `S1 -> S2` (with the change delivered as a
 * {@link LengthEdit}), `getTokens(r)` returns the same tokens for any range `r`
 * not touched by that edit. Only ranges the edit reports as changed may recolour.
 */
export declare interface ISyntaxHighlightedSnapshot {
    /**
     * Tokens covering a region that contains `queryRange`. Tokens are never
     * split: the returned {@link SnapshotTokens.range} is `queryRange` *grown*
     * to whole-token boundaries, so a token that straddles an end of
     * `queryRange` is returned in full. The result is dense over that grown
     * range — `sum(token.length) === range.length` — which is why the range is
     * returned alongside the tokens.
     */
    getTokens(queryRange: OffsetRange): SnapshotTokens;
}

export declare interface ISyntaxHighlighter {
    create(language: string, initialText: string): ISyntaxHighlighterDocument;
}

export declare interface ISyntaxHighlighterDocument extends IDisposable {
    /**
     * Apply a source edit. The {@link snapshot} updates synchronously within
     * `tx`, and the change it carries is the *minimal* {@link LengthEdit} that
     * actually re-coloured — not the whole document.
     */
    update(edit: StringEdit, tx: ITransaction): void;
    /**
     * The current snapshot. Its change reason is a {@link LengthEdit} mapping
     * the previous snapshot's offsets to this one's wherever tokens changed.
     */
    readonly snapshot: IObservableWithChange<ISyntaxHighlightedSnapshot, LengthEdit>;
}

export declare interface KeyboardBinding {
    readonly key: string;
    readonly modifiers?: KeyboardModifiers;
    readonly platforms?: readonly KeyboardPlatform[];
    readonly action: EditorKeyboardAction;
}

export declare interface KeyboardModifiers {
    readonly shift?: boolean;
    readonly alt?: boolean;
    readonly ctrl?: boolean;
    readonly meta?: boolean;
}

export declare type KeyboardPlatform = 'macos' | 'windows' | 'linux';

export declare interface KeyboardProfile {
    /**
     * Bindings in priority order. The first exact key/modifier/platform match wins.
     */
    readonly bindings: readonly KeyboardBinding[];
}

declare abstract class LeafAstNode extends AstNode {
    abstract readonly content: string;
    get children(): readonly AstNode[];
    get length(): number;
    mapChildren(): AstNode;
}

/**
 * A set of disjoint, sorted {@link LengthReplacement}s — the length-only
 * counterpart of {@link StringEdit}. Used as the change reason of an
 * observable so observers learn which offset ranges of the previous value map
 * to which ranges of the new value (and thus what to invalidate) without
 * carrying the new content itself.
 */
export declare class LengthEdit {
    static readonly empty: LengthEdit;
    static single(replacement: LengthReplacement): LengthEdit;
    static replace(replaceRange: OffsetRange, newLength: number): LengthEdit;
    readonly replacements: readonly LengthReplacement[];
    constructor(replacements: readonly LengthReplacement[]);
    get isEmpty(): boolean;
    equals(other: LengthEdit): boolean;
    toString(): string;
}

/**
 * A single "the text in `replaceRange` now spans `newLength` characters"
 * statement. Unlike {@link StringReplacement} it carries no text — it only
 * describes *where* and *by how much* something changed, not *what to*.
 *
 * For syntax highlighting it means: the characters that used to occupy
 * `replaceRange` are replaced by `newLength` characters whose tokens may now
 * be coloured differently. A same-length replacement (`replaceRange.length ===
 * newLength`) therefore means "these characters kept their positions but got
 * re-coloured".
 */
export declare class LengthReplacement {
    readonly replaceRange: OffsetRange;
    readonly newLength: number;
    static replace(replaceRange: OffsetRange, newLength: number): LengthReplacement;
    constructor(replaceRange: OffsetRange, newLength: number);
    get lengthDelta(): number;
    equals(other: LengthReplacement): boolean;
    toString(): string;
}

export declare class LinkAstNode extends AstNode {
    readonly url: string;
    readonly content: readonly (MarkerAstNode | InlineAstNode | GlueAstNode)[];
    readonly kind = "link";
    constructor(url: string, content: readonly (MarkerAstNode | InlineAstNode | GlueAstNode)[]);
    get children(): readonly AstNode[];
    mapChildren(m: ReadonlyMap<AstNode, AstNode>): AstNode;
    protected _localEquals(o: this): boolean;
}

/**
 * Declarative rendering data for one link. `kind` selects the package-owned
 * visual treatment; providers never supply DOM or CSS.
 */
export declare interface LinkPresentation {
    readonly kind: LinkPresentationKind;
    readonly title?: string;
    readonly detail?: string;
    readonly reference?: string;
    /** Primary resource state, such as pull-request lifecycle or session state. */
    readonly status?: LinkPresentationStatus;
    /** Secondary state, such as pull-request CI status. */
    readonly secondaryStatus?: LinkPresentationStatus;
    readonly changes?: LinkPresentationChanges;
    readonly tooltip?: string;
    readonly ariaLabel?: string;
}

declare interface LinkPresentationChanges {
    readonly insertions: number;
    readonly deletions: number;
}

export declare type LinkPresentationKind = 'resource' | 'issue' | 'pullRequest' | 'commit' | 'file' | 'folder' | 'session' | 'repository' | 'branch';

export declare interface LinkPresentationStatus {
    readonly kind: LinkPresentationStatusKind;
    readonly label: string;
}

export declare type LinkPresentationStatusKind = 'neutral' | 'pending' | 'success' | 'warning' | 'error' | 'open' | 'closed' | 'merged' | 'draft' | 'notPlanned';

declare class LinkViewData {
    readonly ast: LinkAstNode;
    /** Active: render the Markdown source; inactive: allow a rich presentation. */
    readonly showMarkup: boolean;
    readonly content: readonly AnyViewData[];
    readonly kind = "link";
    constructor(ast: LinkAstNode, 
    /** Active: render the Markdown source; inactive: allow a rich presentation. */
    showMarkup: boolean, content: readonly AnyViewData[]);
}

export declare class ListAstNode extends BlockAstNodeBase {
    readonly ordered: boolean;
    readonly content: readonly (ListItemAstNode | GlueAstNode)[];
    readonly leadingTrivia?: GlueAstNode | undefined;
    readonly kind = "list";
    constructor(ordered: boolean, content: readonly (ListItemAstNode | GlueAstNode)[], leadingTrivia?: GlueAstNode | undefined);
    get children(): readonly AstNode[];
    get items(): readonly ListItemAstNode[];
    mapChildren(m: ReadonlyMap<AstNode, AstNode>): AstNode;
    withLeadingTrivia(trivia: GlueAstNode | undefined): ListAstNode;
    protected _localEquals(o: this): boolean;
}

export declare class ListItemAstNode extends AstNode {
    readonly marker: MarkerAstNode;
    readonly content: readonly (BlockAstNode | GlueAstNode)[];
    readonly checked?: boolean | undefined;
    readonly leadingTrivia?: GlueAstNode | undefined;
    readonly kind = "listItem";
    constructor(marker: MarkerAstNode, content: readonly (BlockAstNode | GlueAstNode)[], checked?: boolean | undefined, leadingTrivia?: GlueAstNode | undefined);
    get children(): readonly AstNode[];
    get blocks(): readonly BlockAstNode[];
    mapChildren(m: ReadonlyMap<AstNode, AstNode>): AstNode;
    withLeadingTrivia(trivia: GlueAstNode | undefined): ListItemAstNode;
    protected _localEquals(o: this): boolean;
}

declare class ListItemViewData {
    readonly ast: ListItemAstNode;
    /** Whether the selection reaches this item (reveals its markers). */
    readonly isActive: boolean;
    readonly content: readonly AnyViewData[];
    /** 1-based list nesting depth, used to size the indentation gutter. */
    readonly level: number;
    /**
     * Whether this is an inactive task item whose first paragraph begins
     * with the `:running:` marker (see {@link TextViewData.hiddenPrefixLength}).
     * Always `false` while the item is active — an active/editing task
     * reveals the literal marker instead of the progress affordance.
     */
    readonly isRunning: boolean;
    readonly kind = "listItem";
    constructor(ast: ListItemAstNode, 
    /** Whether the selection reaches this item (reveals its markers). */
    isActive: boolean, content: readonly AnyViewData[], 
    /** 1-based list nesting depth, used to size the indentation gutter. */
    level: number, 
    /**
     * Whether this is an inactive task item whose first paragraph begins
     * with the `:running:` marker (see {@link TextViewData.hiddenPrefixLength}).
     * Always `false` while the item is active — an active/editing task
     * reveals the literal marker instead of the progress affordance.
     */
    isRunning?: boolean);
}

declare class ListViewData {
    readonly ast: ListAstNode;
    readonly content: readonly AnyViewData[];
    readonly kind = "list";
    constructor(ast: ListAstNode, content: readonly AnyViewData[]);
}

/**
 * Compact in-memory history for editors that hold the only copy of the
 * document, such as a standalone browser page. Where the surrounding host
 * already records history — a VS Code `TextDocument` — forward to that
 * instead.
 */
export declare class LocalHistoryStrategy implements IHistoryStrategy {
    private readonly _model;
    private readonly _past;
    private readonly _future;
    /**
     * The source text as of the last change this strategy recorded or applied.
     * Any other value means the document was replaced behind its back, so the
     * stored edits no longer line up and must be discarded rather than applied.
     */
    private _lastKnownText;
    constructor(_model: EditorModel);
    record(operation: () => void, edit?: StringEdit): void;
    undo(): void;
    redo(): void;
    /** The entry on top of `stack`, or `undefined` when it cannot be applied. */
    private _peekApplicable;
    private _apply;
    private _clear;
}

/**
 * Parses markdown into a {@link DocumentAstNode}.
 *
 * When given the `previous` document and the `edit` that produced the new
 * text, it reuses unchanged subtrees and carries node identities across the
 * edit (see {@link parseIncremental}), so views can diff cheaply and code
 * blocks keep their incremental highlighting sessions.
 */
export declare class MarkdownParser {
    parse(text: StringValue, previous?: DocumentAstNode, edit?: StringEdit): DocumentAstNode;
}

/** A semantic syntax marker (heading `#`, fences, brackets, list bullet, …). */
export declare class MarkerAstNode extends LeafAstNode {
    readonly markerKind: string;
    readonly content: string;
    readonly kind = "marker";
    constructor(markerKind: string, content: string);
    protected _localEquals(o: this): boolean;
}

declare class MarkerViewData {
    readonly ast: MarkerAstNode;
    readonly visible: boolean;
    readonly kind = "marker";
    constructor(ast: MarkerAstNode, visible: boolean);
}

export declare class MathBlockAstNode extends BlockAstNodeBase {
    readonly content: readonly (MarkerAstNode | GlueAstNode)[];
    readonly leadingTrivia?: GlueAstNode | undefined;
    readonly kind = "mathBlock";
    constructor(content: readonly (MarkerAstNode | GlueAstNode)[], leadingTrivia?: GlueAstNode | undefined);
    get children(): readonly AstNode[];
    get code(): MarkerAstNode | undefined;
    mapChildren(m: ReadonlyMap<AstNode, AstNode>): AstNode;
    withLeadingTrivia(trivia: GlueAstNode | undefined): MathBlockAstNode;
}

declare class MathBlockViewData {
    readonly ast: MathBlockAstNode;
    /** Active: render the source; inactive: the KaTeX output. */
    readonly showMarkup: boolean;
    readonly content: readonly AnyViewData[];
    readonly kind = "mathBlock";
    constructor(ast: MathBlockAstNode, 
    /** Active: render the source; inactive: the KaTeX output. */
    showMarkup: boolean, content: readonly AnyViewData[]);
}

/** Result of a {@link BlockViewOptions.renderMath} renderer. */
export declare interface MathRendering {
    /** Host element to mount (the rendered math output). */
    readonly dom: HTMLElement;
    /** Source-mapped spans within {@link dom} (need not tile the whole node). */
    readonly segments: readonly MathSourceSegment[];
}

/** Input to a {@link BlockViewOptions.renderMath} renderer. */
export declare interface MathRenderRequest {
    /** The LaTeX source of the math content (without the `$$`/`$` fences). */
    readonly latex: string;
    /** `true` for a `$$…$$` block, `false` for inline `$…$`. */
    readonly displayMode: boolean;
    /** CSS class the host element must carry (editor styling/measurement hooks). */
    readonly className: string;
    /** Full source length of the math node (fences/`$` included). */
    readonly nodeLength: number;
    /** Offset of {@link latex} within the node (i.e. after the opening fence/`$`). */
    readonly contentStart: number;
}

/**
 * A span of the rendered math output that maps to a slice of source. The
 * renderer reports these for the parts it can map (e.g. identifier glyphs);
 * the editor tiles the gaps between them so the whole math node stays mapped.
 */
export declare interface MathSourceSegment {
    /** A DOM node (ideally a Text node) within the rendered output. */
    readonly dom: globalThis.Node;
    /** Start offset of the mapped slice, relative to the math node's start. */
    readonly start: number;
    /** Source length of the mapped slice. */
    readonly length: number;
}

/**
 * Immutable record of one rendered debug frame.
 */
export declare class MeasuredLayoutDebugRendering {
    readonly blockCount: number;
    readonly mountedCount: number;
    readonly lineCount: number;
    /** Absolute source offsets that map to a rendered DOM character. */
    readonly mappedOffsets: ReadonlySet<number>;
    constructor(blockCount: number, mountedCount: number, lineCount: number, 
    /** Absolute source offsets that map to a rendered DOM character. */
    mappedOffsets: ReadonlySet<number>);
}

/**
 * Debug view for a {@link MeasuredLayoutModel}.
 *
 * Exposes two DOM nodes the caller can place independently:
 *
 *  - {@link overlayElement} — absolutely positioned; the caller mounts it
 *    inside the editor overlay container so dashed line-bands and run-boxes
 *    share the measured editor-local coordinates.
 *  - {@link infoElement} — block-flow; the caller mounts it as a sibling
 *    *below* the editor. Contains the per-block summary table that used
 *    to live on the overlay.
 *
 * Same pattern as `CursorView` / `SelectionView`: the rendering pipeline
 * is a single `derived` whose compute callback writes the DOM and returns
 * a {@link MeasuredLayoutDebugRendering} value as proof. An autorun keeps
 * the derived subscribed.
 */
export declare class MeasuredLayoutDebugView extends Disposable {
    readonly overlayElement: HTMLElement;
    readonly infoElement: HTMLElement;
    readonly rendering: IObservable<MeasuredLayoutDebugRendering>;
    /** Absolute source offsets that map to a rendered DOM character. */
    readonly mappedOffsets: IObservable<ReadonlySet<number>>;
    /** Whether the dashed line-bands and run boxes are drawn (persisted). */
    private readonly _showLineRects;
    constructor(_overlayParent: HTMLElement, options: MeasuredLayoutDebugViewOptions);
}

export declare interface MeasuredLayoutDebugViewOptions {
    readonly model: MeasuredLayoutModel;
    readonly coordinateSpace: EditorCoordinateSpace;
    /**
     * DEBUG ONLY. Maps an absolute source offset to a fill color for that
     * character's glyph rect. The fixture passes the same function to the
     * raw-source view so a character and its rect share one color — a
     * mismatch exposes a source ↔ DOM mapping bug.
     */
    readonly colorForOffset?: (offset: number) => string | undefined;
    /**
     * DEBUG ONLY. Shared "currently hovered source offset". When set, the
     * overlay isolates the matching glyph rect; the fixture passes the same
     * observable to the raw-source view so hovering either side highlights the
     * same character in both. Hovering a rect writes this; `undefined` clears.
     */
    readonly hoveredOffset?: ISettableObservable<number | undefined>;
}

/**
 * The set of measurements/estimates the view has produced for the current
 * document. This is the "view → derived facts about layout" channel: the
 * view writes here as a side effect of rendering and measuring; the
 * controller (and selection/cursor rendering) reads from here.
 *
 * Keeping these facts in their own observable model — instead of as ad-hoc
 * fields on the view — preserves the invariant
 *
 *     view(model + Δ) = view(model) + Δ
 *
 * i.e. the view becomes a pure function of (EditorModel, MeasuredLayoutModel).
 * Everything else that depends on layout (controller, commands) goes
 * through this model and never touches view fields directly.
 */
export declare class MeasuredLayoutModel {
    private readonly _measurements;
    readonly measurements: IObservable<readonly BlockMeasurement[]>;
    private readonly _virtualLines;
    /**
     * Concatenated visual line map across all mounted blocks. Every per-block
     * map uses the same editor-local coordinate space, so concatenation is
     * well-formed without translation or re-sorting.
     */
    readonly visualLineMap: IObservableWithChange<VisualLineMap, void>;
    setMeasurements(measurements: readonly BlockMeasurement[], virtualLines: readonly VirtualLineMeasurement[]): void;
}

/**
 * {@link ISyntaxHighlighter} backed by monaco's Monarch tokenizer.
 *
 * Highlighting is synchronous and incremental: an edit only re-runs the
 * tokenizer from the first changed line onward (earlier lines and their saved
 * end-states are reused), and the {@link LengthEdit} delivered with the new
 * snapshot is the minimal char range whose colour actually changed.
 *
 * Only Monarch's *classic* tokenizer path is used, which needs neither a theme
 * nor the DOM, so this runs headless (Node, workers) as well as in the browser.
 */
export declare class MonacoSyntaxHighlighter implements ISyntaxHighlighter {
    private readonly _monaco;
    private readonly _grammars;
    private readonly _tokenizers;
    /**
     * @param _monaco The Monarch runtime ({@link IMonarchApi}), injected so this
     * package depends on `monaco-editor` for types only.
     * @param _grammars Maps a language id to its Monarch language definition.
     */
    constructor(_monaco: IMonarchApi, _grammars: ReadonlyMap<string, unknown>);
    create(language: string, initialText: string): ISyntaxHighlighterDocument;
    dispose(): void;
    private _tokenizerFor;
}

/**
 * Default strategy: handle the browser's native `copy`/`cut`/`paste` events,
 * reading and writing the synchronous {@link ClipboardEvent.clipboardData}.
 * This is the standard rich-editor approach and works wherever the browser
 * actually dispatches those events to the focused element (e.g. a standalone
 * web page).
 */
export declare class NativeClipboardStrategy implements IClipboardStrategy {
    connect(context: IClipboardContext): IDisposable;
}

declare interface NestedItem {
    readonly kind: 'nested';
    readonly original: AstNode;
    readonly originalStart: number;
    readonly modified: AstNode;
    readonly modifiedStart: number;
    readonly children: readonly DiffItem[];
}

/**
 * Move the cursor one position left or right, skipping over hidden marker
 * ranges in inactive blocks (and inactive items of an active list).
 */
export declare function nextCursorPosition(doc: DocumentAstNode, markerVisibleBlocks: ReadonlySet<BlockAstNode>, cursor: number, direction: 'left' | 'right'): number;

declare const NO_ACTIVE_BLOCKS: unique symbol;

export declare function normalizeCursorPosition(doc: DocumentAstNode, markerVisibleBlocks: ReadonlySet<BlockAstNode>, cursor: number, target: number, direction: 'left' | 'right', includeHiddenRangeBoundary?: boolean): number;

export declare class OffsetRange {
    readonly start: number;
    readonly endExclusive: number;
    static fromTo(start: number, endExclusive: number): OffsetRange;
    static ofLength(length: number): OffsetRange;
    static ofStartAndLength(start: number, length: number): OffsetRange;
    static emptyAt(offset: number): OffsetRange;
    constructor(start: number, endExclusive: number);
    get isEmpty(): boolean;
    get length(): number;
    delta(offset: number): OffsetRange;
    deltaStart(offset: number): OffsetRange;
    deltaEnd(offset: number): OffsetRange;
    contains(offset: number): boolean;
    containsRange(other: OffsetRange): boolean;
    intersects(other: OffsetRange): boolean;
    intersectsOrTouches(other: OffsetRange): boolean;
    intersect(other: OffsetRange): OffsetRange | undefined;
    join(other: OffsetRange): OffsetRange;
    isBefore(other: OffsetRange): boolean;
    isAfter(other: OffsetRange): boolean;
    substring(str: string): string;
    slice<T>(arr: readonly T[]): T[];
    equals(other: OffsetRange): boolean;
    toString(): string;
}

/** The lossless source slices of a block HTML comment whose closer has not been typed. */
declare interface OpenHtmlCommentSource extends HtmlCommentSourceBase {
    readonly kind: 'open';
}

/** Outdent the current line, or every line touched by the selection. */
export declare function outdent(config?: IndentationConfig): EditCommand;

export declare class ParagraphAstNode extends BlockAstNodeBase {
    readonly content: readonly (InlineAstNode | GlueAstNode)[];
    readonly leadingTrivia?: GlueAstNode | undefined;
    readonly kind = "paragraph";
    constructor(content: readonly (InlineAstNode | GlueAstNode)[], leadingTrivia?: GlueAstNode | undefined);
    get children(): readonly AstNode[];
    mapChildren(m: ReadonlyMap<AstNode, AstNode>): AstNode;
    withLeadingTrivia(trivia: GlueAstNode | undefined): ParagraphAstNode;
}

declare class ParagraphViewData {
    readonly ast: ParagraphAstNode;
    /**
     * gp-fork: renderCustomBlock. Upstream never stored this on
     * ParagraphViewData (a plain paragraph has no other block-level
     * active/inactive rendering to switch between); the seam's `!showMarkup`
     * gate needs it here the same way codeBlock/mathBlock/frontMatter/
     * unhandledBlock already carry it. See dist/index.js's Xr class.
     */
    readonly showMarkup: boolean;
    readonly content: readonly AnyViewData[];
    readonly kind = "paragraph";
    constructor(ast: ParagraphAstNode, showMarkup: boolean, content: readonly AnyViewData[]);
}

/**
 * A *transient* editing state: an empty paragraph adjacent to a real block.
 * Markdown has no empty-paragraph node, so this never lives in
 * {@link EditorModel['sourceText']} or the parsed {@link EditorModel.document}
 * — it is pure edit intent that the view renders as a synthetic blank line and
 * that the controller either *materializes* (the user types) or *cancels* (the
 * user navigates away / backspaces).
 */
declare interface PendingParagraph {
    /** The block the blank line is rendered directly after. */
    readonly anchorBlock: BlockAstNode;
    /**
     * Source region rewritten when the pending paragraph is materialized — the
     * gap between {@link anchorBlock}'s text and whatever follows it.
     */
    readonly replaceRange: OffsetRange;
    /** Whether materialized text needs a blank-line separator before it. */
    readonly separateFromPreviousBlock: boolean;
    /** Whether {@link replaceRange} ends at the end of the document. */
    readonly atEof: boolean;
    /**
     * Horizontal whitespace typed on the source-less line. It remains transient
     * until other input materializes the paragraph. Contains only spaces and tabs.
     */
    readonly text: string;
    /** The source-less visual line occupied by the pending caret. */
    readonly cursorLine: VirtualCursorLine;
    /**
     * A throwaway AST node that exists only to give the synthetic view child a
     * stable identity across render frames (the view pairs nodes by `ast.id`).
     * It is never part of {@link document}.
     */
    readonly syntheticAst: ParagraphAstNode;
}

declare interface PendingParagraphResult {
    readonly kind: 'pending';
    readonly anchorBlock: BlockAstNode;
    readonly replaceRange: OffsetRange;
    /** Whether materialized text needs a blank-line separator before it. */
    readonly separateFromPreviousBlock: boolean;
    readonly atEof: boolean;
}

/**
 * View-data for the transient empty paragraph (see `PendingParagraph` in the
 * model). It carries the throwaway {@link ParagraphAstNode} that gives the
 * rendered line a stable identity across frames, its anchor block, source-less
 * cursor line, and transient horizontal whitespace. It has no source content or
 * selection range.
 */
declare class PendingParagraphViewData {
    readonly ast: ParagraphAstNode;
    readonly anchorBlock: BlockAstNode;
    readonly cursorLine: VirtualCursorLine;
    readonly text: string;
    readonly kind = "pendingParagraph";
    constructor(ast: ParagraphAstNode, anchorBlock: BlockAstNode, cursorLine: VirtualCursorLine, text: string);
}

/**
 * The mounted transient empty paragraph: a `<p class="md-pending-paragraph">`
 * holding either a `<br>` or decorated transient horizontal whitespace. It is a
 * leaf view node with no inline source content; the document view publishes its
 * element geometry as a virtual visual line.
 */
declare class PendingParagraphViewNode extends ViewNode {
    readonly element: HTMLElement;
    readonly anchorBlock: BlockAstNode;
    readonly cursorLine: VirtualCursorLine;
    private _text;
    constructor(view: PendingParagraphViewData);
    update(text: string): void;
    getCaretClientRect(): DOMRect;
}

/**
 * Immutable point in a caller-defined 2D CSS-pixel coordinate space.
 * Coordinate-owning APIs must document whether values are viewport-client or
 * editor-local; values from different spaces must not be mixed.
 */
export declare class Point2D {
    readonly x: number;
    readonly y: number;
    static readonly ZERO: Point2D;
    constructor(x: number, y: number);
    translate(dx: number, dy: number): Point2D;
}

/**
 * Immutable axis-aligned rectangle in a caller-defined 2D CSS-pixel coordinate
 * space. `x`/`y` is the top-left corner, growing right/down.
 *
 * Half-open in both dimensions: `right` and `bottom` are excluded.
 */
export declare class Rect2D {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    static readonly EMPTY: Rect2D;
    static fromPointPoint(left: number, top: number, right: number, bottom: number): Rect2D;
    static fromPointSize(x: number, y: number, width: number, height: number): Rect2D;
    private constructor();
    get left(): number;
    get top(): number;
    get right(): number;
    get bottom(): number;
    get topLeft(): Point2D;
    containsX(x: number): boolean;
    containsY(y: number): boolean;
    containsPoint(p: Point2D): boolean;
    /** Same y/height, zero-width band at `x = this.left`. Useful for caret rects derived from a line. */
    withZeroWidthAt(x: number): Rect2D;
    translate(dx: number, dy: number): Rect2D;
}

declare interface RemovedItem {
    readonly kind: 'removed';
    readonly node: AstNode;
    readonly originalStart: number;
    readonly deletedLocal: readonly AnnotatedRange[];
}

declare interface ReplacedItem {
    readonly kind: 'replaced';
    readonly original: AstNode;
    readonly originalStart: number;
    readonly modified: AstNode;
    readonly modifiedStart: number;
    readonly insertedLocal: readonly AnnotatedRange[];
    readonly deletedLocal: readonly AnnotatedRange[];
}

export declare class RichLink {
    static create(options: RichLinkOptions): RichLink;
    static mount(element: HTMLElement, authoredLabel: HTMLSpanElement): RichLink;
    static clear(element: HTMLElement): void;
    readonly element: HTMLElement;
    readonly authoredLabel: HTMLSpanElement;
    private readonly _icon;
    private readonly _title;
    private readonly _detail;
    private readonly _reference;
    private readonly _changes;
    private readonly _status;
    private readonly _secondaryStatus;
    private constructor();
    update(presentation: LinkPresentation | undefined): void;
    private _renderUnavailable;
    private _setDefaultOrder;
}

export declare interface RichLinkOptions {
    readonly href: string;
    readonly authoredLabel: string;
    readonly presentation?: LinkPresentation;
}

export declare const selectAll: SelectionCommand;

export declare function selectBlock(ctx: CursorCommandContext, blockRange: OffsetRange): Selection_2;

declare class Selection_2 {
    readonly anchor: SourceOffset;
    readonly active: SourceOffset;
    static collapsed(offset: SourceOffset): Selection_2;
    constructor(anchor: SourceOffset, active: SourceOffset);
    get isCollapsed(): boolean;
    get isForward(): boolean;
    get range(): OffsetRange;
    collapseToActive(): Selection_2;
    withActive(active: SourceOffset): Selection_2;
}
export { Selection_2 as Selection }

/**
 * One mounted block, as far as selection painting is concerned. The view
 * supplies its block cache in this shape so the selection layer never has
 * to reach back into private view state.
 */
export declare interface SelectionBlock {
    readonly block: BlockAstNode;
    readonly absoluteStart: number;
    /** Block border box in editor-local coordinates. */
    readonly rect: Rect2D;
    /** Visible horizontal padding-box bounds for a scrolling block. */
    readonly viewportClip: {
        readonly left: number;
        readonly right: number;
    } | undefined;
}

export declare type SelectionCommand = (ctx: CursorCommandContext, offset: SourceOffset) => Selection_2;

export declare interface SelectionRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** The interaction that produced the current editor selection. */
export declare type SelectionSource = 'user' | 'find';

/**
 * Owns the SVG overlay that paints the selection.
 *
 * Rendering is *line-based*, not glyph-based:
 *
 *  1. Each {@link VisualLine} overlapping the selection produces one rect
 *     using the full line-box height (so the selection has even, line-
 *     height bands instead of jagged glyph rects).
 *  2. Inter-block gaps fully inside the selection become connector rects.
 *  3. All rects are grouped into vertically-adjacent clusters and each
 *     cluster is rendered as a single connected polygon with rounded
 *     corners.
 *
 * To keep the polygon connected without gaps, "middle" lines (any line
 * that is neither the first nor the last selected line in the document)
 * are extended to their full line extent, while the first and last lines
 * are clipped to the actual selection start/end. This is the standard
 * envelope shape used by IDE selection rendering.
 */
export declare class SelectionView extends Disposable {
    readonly element: SVGSVGElement;
    readonly rendering: IObservable<SelectionViewRendering>;
    private readonly _path;
    constructor(options: SelectionViewOptions);
}

export declare interface SelectionViewOptions {
    readonly selection: IObservable<Selection_2 | undefined>;
    readonly visualLineMap: IObservable<VisualLineMap>;
    readonly blocks: IObservable<readonly SelectionBlock[]>;
}

export declare class SelectionViewRendering {
    readonly rects: readonly SelectionRect[];
    constructor(rects: readonly SelectionRect[]);
}

export declare const selectWord: SelectionCommand;

/**
 * The outcome of {@link insertSmartEnter}: either a concrete source edit (the
 * ordinary cases), or a request to arm a transient empty paragraph (Enter at
 * the very end of a paragraph), which the controller turns into
 * {@link EditorModel.armPendingParagraph} rather than a source edit. Modelling
 * the empty paragraph as state instead of source keeps the document valid
 * Markdown — which has no empty-paragraph node — until the user actually types.
 */
export declare type SmartEnterResult = {
    readonly kind: 'edit';
    readonly edit: StringEdit;
    readonly selection: Selection_2;
    /** Post-edit range of indentation copied onto a new fenced-code line. */
    readonly generatedIndentation?: OffsetRange;
} | PendingParagraphResult;

/**
 * A run of {@link Token}s together with the exact {@link OffsetRange} they
 * cover.
 *
 * Because tokens are returned whole (never clipped), this is the natural unit
 * of structural comparison: for any region untouched by an edit, two snapshots
 * return an equal `SnapshotTokens` (same `range`, same token lengths/classes).
 */
export declare interface SnapshotTokens {
    readonly range: OffsetRange;
    readonly tokens: readonly Token[];
}

/** Metadata delivered synchronously immediately before a model-owned source edit is applied. */
export declare interface SourceEditEvent {
    readonly baseSourceTextId: number;
    readonly resultSourceTextId: number;
    readonly edit: StringEdit;
    readonly transaction: ITransaction;
}

export declare type SourceOffset = number;

export declare class StrikethroughAstNode extends AstNode {
    readonly openMarker: MarkerAstNode;
    readonly content: readonly (InlineAstNode | GlueAstNode)[];
    readonly closeMarker: MarkerAstNode;
    readonly kind = "strikethrough";
    constructor(openMarker: MarkerAstNode, content: readonly (InlineAstNode | GlueAstNode)[], closeMarker: MarkerAstNode);
    get children(): readonly AstNode[];
    mapChildren(m: ReadonlyMap<AstNode, AstNode>): AstNode;
}

declare class StrikethroughViewData {
    readonly ast: StrikethroughAstNode;
    readonly content: readonly AnyViewData[];
    readonly kind = "strikethrough";
    constructor(ast: StrikethroughAstNode, content: readonly AnyViewData[]);
}

export declare class StringEdit {
    static readonly empty: StringEdit;
    static single(replacement: StringReplacement): StringEdit;
    static replace(range: OffsetRange, text: string): StringEdit;
    static insert(offset: number, text: string): StringEdit;
    static delete(range: OffsetRange): StringEdit;
    readonly replacements: readonly StringReplacement[];
    constructor(replacements: readonly StringReplacement[]);
    get isEmpty(): boolean;
    apply(base: string): string;
    inverse(original: string): StringEdit;
    equals(other: StringEdit): boolean;
    mapOffset(offset: number): number;
    toString(): string;
}

export declare class StringReplacement {
    readonly replaceRange: OffsetRange;
    readonly newText: string;
    static insert(offset: number, text: string): StringReplacement;
    static replace(range: OffsetRange, text: string): StringReplacement;
    static delete(range: OffsetRange): StringReplacement;
    constructor(replaceRange: OffsetRange, newText: string);
    get isEmpty(): boolean;
    equals(other: StringReplacement): boolean;
    /**
     * Narrows this replacement to the span that actually changes, by trimming
     * the prefix and suffix it shares with the text it replaces in `source`.
     */
    removeCommonSuffixPrefix(source: string): StringReplacement;
    toString(): string;
}

export declare class StringValue {
    readonly value: string;
    constructor(value: string);
    get length(): number;
    substring(range: OffsetRange): string;
    toString(): string;
}

export declare class StrongAstNode extends AstNode {
    readonly openMarker: MarkerAstNode;
    readonly content: readonly (InlineAstNode | GlueAstNode)[];
    readonly closeMarker: MarkerAstNode;
    readonly kind = "strong";
    constructor(openMarker: MarkerAstNode, content: readonly (InlineAstNode | GlueAstNode)[], closeMarker: MarkerAstNode);
    get children(): readonly AstNode[];
    mapChildren(m: ReadonlyMap<AstNode, AstNode>): AstNode;
}

declare class StrongViewData {
    readonly ast: StrongAstNode;
    readonly content: readonly AnyViewData[];
    readonly kind = "strong";
    constructor(ast: StrongAstNode, content: readonly AnyViewData[]);
}

export declare type TabKeyboardAction = 'insert' | 'outdent';

export declare class TableAstNode extends BlockAstNodeBase {
    readonly content: readonly (TableRowAstNode | GlueAstNode)[];
    readonly leadingTrivia?: GlueAstNode | undefined;
    readonly kind = "table";
    constructor(content: readonly (TableRowAstNode | GlueAstNode)[], leadingTrivia?: GlueAstNode | undefined);
    get children(): readonly AstNode[];
    private get _rows();
    get headerRow(): TableRowAstNode | undefined;
    get delimiterRow(): TableRowAstNode | undefined;
    get bodyRows(): readonly TableRowAstNode[];
    mapChildren(m: ReadonlyMap<AstNode, AstNode>): AstNode;
    withLeadingTrivia(trivia: GlueAstNode | undefined): TableAstNode;
}

export declare class TableCellAstNode extends AstNode {
    readonly content: readonly (InlineAstNode | MarkerAstNode | GlueAstNode)[];
    readonly kind = "tableCell";
    constructor(content: readonly (InlineAstNode | MarkerAstNode | GlueAstNode)[]);
    get children(): readonly AstNode[];
    mapChildren(m: ReadonlyMap<AstNode, AstNode>): AstNode;
}

declare class TableCellViewData {
    readonly ast: TableCellAstNode;
    /** Whether the selection reaches this cell (reveals its inline markers). */
    readonly isActive: boolean;
    /** Whether the owning table is active (reveals the structural pipes). */
    readonly showTableGlue: boolean;
    readonly content: readonly AnyViewData[];
    readonly kind = "tableCell";
    constructor(ast: TableCellAstNode, 
    /** Whether the selection reaches this cell (reveals its inline markers). */
    isActive: boolean, 
    /** Whether the owning table is active (reveals the structural pipes). */
    showTableGlue: boolean, content: readonly AnyViewData[]);
}

export declare class TableRowAstNode extends AstNode {
    readonly content: readonly (TableCellAstNode | GlueAstNode)[];
    readonly kind = "tableRow";
    constructor(content: readonly (TableCellAstNode | GlueAstNode)[]);
    get children(): readonly AstNode[];
    get cells(): readonly TableCellAstNode[];
    mapChildren(m: ReadonlyMap<AstNode, AstNode>): AstNode;
}

declare class TableRowViewData {
    readonly ast: TableRowAstNode;
    readonly isDelimiter: boolean;
    readonly content: readonly AnyViewData[];
    readonly kind = "tableRow";
    constructor(ast: TableRowAstNode, isDelimiter: boolean, content: readonly AnyViewData[]);
}

declare class TableViewData {
    readonly ast: TableAstNode;
    readonly content: readonly AnyViewData[];
    readonly kind = "table";
    constructor(ast: TableAstNode, content: readonly AnyViewData[]);
}

/**
 * Source range (relative to `item`) of a task list item's `[x]`/`[ ]`
 * checkbox, or `undefined` when the item is not a task item. The checkbox is
 * plain glue in the AST, so a host that wants to toggle it locates the literal
 * `[x]`/`[ ]` token here.
 */
export declare function taskCheckboxRange(item: ListItemAstNode): OffsetRange | undefined;

/** Real document text (an {@link InlineAstNode}). */
export declare class TextAstNode extends LeafAstNode {
    readonly content: string;
    readonly kind = "text";
    constructor(content: string);
    protected _localEquals(o: this): boolean;
}

declare class TextViewData {
    readonly ast: TextAstNode;
    readonly showWhitespace: boolean;
    readonly leftWordBoundary: boolean;
    readonly rightWordBoundary: boolean;
    /**
     * Number of leading source characters to keep out of the rendered
     * text (but not out of the source): the `:running:` marker plus its
     * mandatory leading separator, once
     * {@link isRunnerMarkerText} has matched this node. Zero otherwise.
     */
    readonly hiddenPrefixLength: number;
    readonly kind = "text";
    /**
     * Whether non-obvious whitespace in this text is revealed (block is active).
     * `leftWordBoundary`/`rightWordBoundary` say whether the inline sibling on
     * that side ends/starts with visible word content (e.g. inline code, a link,
     * emphasis); a single space touching such a sibling is obvious and stays
     * undecorated, just like a space between two words within this leaf.
     */
    constructor(ast: TextAstNode, showWhitespace: boolean, leftWordBoundary?: boolean, rightWordBoundary?: boolean, 
    /**
     * Number of leading source characters to keep out of the rendered
     * text (but not out of the source): the `:running:` marker plus its
     * mandatory leading separator, once
     * {@link isRunnerMarkerText} has matched this node. Zero otherwise.
     */
    hiddenPrefixLength?: number);
}

export declare class ThematicBreakAstNode extends BlockAstNodeBase {
    readonly content: readonly (MarkerAstNode | GlueAstNode)[];
    readonly leadingTrivia?: GlueAstNode | undefined;
    readonly kind = "thematicBreak";
    constructor(content: readonly (MarkerAstNode | GlueAstNode)[], leadingTrivia?: GlueAstNode | undefined);
    get children(): readonly AstNode[];
    get marker(): MarkerAstNode | undefined;
    mapChildren(m: ReadonlyMap<AstNode, AstNode>): AstNode;
    withLeadingTrivia(trivia: GlueAstNode | undefined): ThematicBreakAstNode;
}

declare class ThematicBreakViewData {
    readonly ast: ThematicBreakAstNode;
    /** Active: reveal the source markup (`---`) instead of the rendered rule. */
    readonly showMarkup: boolean;
    /** Marker (and any absorbed trailing glue), rendered only when active. */
    readonly content: readonly AnyViewData[];
    readonly kind = "thematicBreak";
    constructor(ast: ThematicBreakAstNode, 
    /** Active: reveal the source markup (`---`) instead of the rendered rule. */
    showMarkup: boolean, 
    /** Marker (and any absorbed trailing glue), rendered only when active. */
    content: readonly AnyViewData[]);
}

/**
 * A coloured run of `length` characters. Tokens are *dense* and *offset-free*:
 * a snapshot's tokens for a range cover it exactly, back to back, so
 * `sum(token.length) === range.length`. A token never stores where it is — its
 * position is implied by the lengths of the tokens before it, mirroring how the
 * rest of the editor keeps source offsets out of its data structures.
 */
export declare class Token {
    readonly length: number;
    /** CSS class for this run, or `undefined` for an unstyled run. */
    readonly className: string | undefined;
    constructor(length: number, 
    /** CSS class for this run, or `undefined` for an unstyled run. */
    className: string | undefined);
}

declare interface UnchangedItem {
    readonly kind: 'unchanged';
    /** The modified-side node (identical in content to the original). */
    readonly node: AstNode;
    readonly modifiedStart: number;
}

/**
 * A block whose token type the parser does not understand (a setext heading or
 * any future/extension construct). Rather than dropping the
 * span — which would demote its text to invisible glue — the parser captures the
 * whole source range verbatim as a single {@link MarkerAstNode} of kind
 * `content` and records the originating micromark {@link tokenType}, so the view
 * can render it as raw, editable text with an "unhandled" affordance. Offsets
 * stay sound: `content` tiles the block's full source span exactly.
 */
declare class UnhandledBlockAstNode extends BlockAstNodeBase {
    readonly tokenType: string;
    readonly content: readonly (MarkerAstNode | GlueAstNode)[];
    readonly leadingTrivia?: GlueAstNode | undefined;
    readonly kind = "unhandledBlock";
    constructor(tokenType: string, content: readonly (MarkerAstNode | GlueAstNode)[], leadingTrivia?: GlueAstNode | undefined);
    get children(): readonly AstNode[];
    get code(): MarkerAstNode | undefined;
    /**
     * Lossless slices when this raw HTML block starts one comment after optional
     * whitespace. An open comment consumes the remaining source as its body. A
     * complete comment permits only trailing whitespace after its closer.
     */
    get htmlComment(): HtmlCommentSource | undefined;
    mapChildren(m: ReadonlyMap<AstNode, AstNode>): AstNode;
    withLeadingTrivia(trivia: GlueAstNode | undefined): UnhandledBlockAstNode;
    protected _localEquals(o: this): boolean;
}

/**
 * View-data for an {@link UnhandledBlockAstNode}. The source remains verbatim
 * in both states. Complete HTML comments use {@link showMarkup} to switch
 * between their quiet reading treatment and editable source presentation;
 * other unhandled blocks ignore the flag and keep their warning treatment.
 */
declare class UnhandledBlockViewData {
    readonly ast: UnhandledBlockAstNode;
    readonly showMarkup: boolean;
    readonly content: readonly AnyViewData[];
    readonly kind = "unhandledBlock";
    constructor(ast: UnhandledBlockAstNode, showMarkup: boolean, content: readonly AnyViewData[]);
}

/**
 * Immutable view of an AST node. Pairs `ast` with its rendered `dom` and a
 * mirror of `ast.children` as ViewNode children. Source offsets are NEVER
 * stored — they are recomputed by walking and summing `ast.length` of
 * preceding siblings, just like the AST itself.
 *
 * Leaves are ViewNodes with no children. A leaf whose `dom` is a Text node
 * participates in source mapping; a leaf whose `dom` is an Element does not
 * (e.g. KaTeX-rendered math, or `<hr>` for a thematic break).
 */
export declare class ViewNode extends Disposable {
    readonly ast: AstNode;
    readonly dom: globalThis.Node;
    private _children;
    constructor(ast: AstNode, dom: globalThis.Node, children?: readonly ViewNode[]);
    /** This node's view children (a mirror of `ast.children`). */
    get children(): readonly ViewNode[];
    /**
     * Replace this node's children in place, disposing the old ones and
     * re-pointing the new ones' parent to this node. The node value is still
     * conceptually immutable with respect to its `ast`/`dom` *identity*; this
     * is used only when a node patches its own DOM subtree in place (a code
     * block re-tokenising on a highlighter recolour), where the source-mapping
     * leaves must follow the new DOM text nodes without rebuilding the node
     * itself.
     */
    protected _replaceChildren(children: readonly ViewNode[]): void;
    dispose(): void;
    /**
     * The number of source characters this node spans. Defaults to the length
     * of its {@link ast}; a synthetic leaf that subdivides one ast node (a
     * decorated-whitespace character, a code-block token span) shares that ast
     * for identity but overrides this with the length of its own slice, so the
     * renderer never has to fabricate an AST node just to carry a length.
     */
    get sourceLength(): number;
    /**
     * The DOM node a parent mounts for this child. It is {@link dom} for almost
     * everything; a marker is the exception — its `dom` is the inner Text node
     * (so source ↔ DOM mapping lands on it) while the node it mounts is the
     * wrapping `<span>`.
     */
    get mountNode(): globalThis.Node;
    /** The view node that rendered this node's parent, or `undefined` for a root. */
    get parent(): ViewNode | undefined;
    /**
     * Closest view node owning `domNode`: the node itself if registered, else
     * the nearest registered ancestor. Returns `undefined` if the DOM node is
     * outside any view tree.
     */
    static forDom(domNode: globalThis.Node | null): ViewNode | undefined;
    /**
     * This node's start offset within its parent's local source space: the sum
     * of the `ast.length` of the siblings before it. Polymorphic via
     * {@link _localOffsetOfChild} so a parent whose children do not map
     * linearly (e.g. it hides or reorders some) can override how its children
     * are placed.
     */
    localOffsetInParent(): number;
    /** Start offset of `child` within this node's local source space. */
    protected _localOffsetOfChild(child: ViewNode): number;
    /**
     * Map a DOM hit that lands on THIS node's own representation into a source
     * range in this node's local space `[0, ast.length)`. Polymorphic: a text
     * leaf maps the caret offset 1:1. For an element hit — an element-only node
     * (KaTeX math, `<hr>`, an image, a hidden marker) or a wrapper/container
     * element — the platform reports a child-index offset, not a text caret, so
     * there is no internal mapping to honour: it snaps to the node's nearer
     * edge, `offset 0` (the "before" side) → start, any `offset >= 1` (the
     * "after" side) → end. Subclasses may override for finer control.
     */
    getLocalSourceRange(pos: DomPosition): OffsetRange;
    /**
     * DOM hit (any node + offset within it) → source offset relative to THIS
     * node, or `undefined` when the hit is outside this node's subtree. Enters
     * the tree at the closest owning view node ({@link forDom}), maps the hit
     * into that node's local space ({@link getLocalSourceRange}), then lifts the
     * range up the parent chain — adding each node's {@link localOffsetInParent} —
     * until it reaches this node.
     */
    resolveSource(pos: DomPosition): number | undefined;
    /**
     * Source offset → DOM position. `nodeOffset` is the absolute source
     * offset of THIS node's start. Returns a position into a DOM Text node,
     * descending into children based on accumulated lengths.
     */
    sourceToDom(localSourceOffset: number, nodeSourceOffset?: number): DomPosition | undefined;
    /** Visit every text-bearing leaf in this subtree with its absolute offset. */
    forEachTextLeaf(nodeOffset: number, visitor: (leaf: ViewNode, leafOffset: number) => void): void;
}

/**
 * A visual cursor line that has no representation in the source text.
 *
 * The two source offsets are the positions immediately before and after the
 * virtual line. The object itself is the stable identity of the line.
 */
export declare class VirtualCursorLine {
    readonly sourceOffsetBefore: SourceOffset;
    readonly sourceOffsetAfter: SourceOffset;
    constructor(sourceOffsetBefore: SourceOffset, sourceOffsetAfter: SourceOffset);
}

/** A measured source-less line inserted directly after a source block. */
declare interface VirtualLineMeasurement {
    readonly afterBlock: BlockAstNode;
    readonly line: VisualLine;
}

export declare type VisualCursorCommand = (ctx: VisualCursorCommandContext) => CursorMoveResult;

export declare interface VisualCursorCommandContext extends CursorCommandContext {
    readonly lineMap: VisualLineMap;
    readonly desiredColumn: number | undefined;
}

export declare function visualizeAst(root: AstNode, source: string): AstVisualization;

/**
 * One visual line of rendered text: a horizontal band
 * (`rect.top`..`rect.bottom`) split into one or more {@link VisualRun}s
 * arranged left-to-right.
 */
export declare class VisualLine {
    readonly rect: Rect2D;
    readonly runs: readonly VisualRun[];
    readonly virtualCursorLine?: VirtualCursorLine | undefined;
    static virtual(cursorLine: VirtualCursorLine, rect: Rect2D): VisualLine;
    constructor(rect: Rect2D, runs: readonly VisualRun[], virtualCursorLine?: VirtualCursorLine | undefined);
    containsOffset(offset: SourceOffset): boolean;
    /**
     * How `offset` relates to this line's runs:
     *   - `'covers'`: a run starts at or strictly contains the offset
     *     (`start <= offset < endExclusive`), or a zero-length visual-line
     *     anchor sits at the offset — the caret belongs on this line.
     *   - `'end'`: the offset is only some run's trailing boundary
     *     (`offset === endExclusive`) with no run covering it — a line-break
     *     boundary the caret should leave for the next line.
     *   - `'none'`: no run touches the offset.
     */
    offsetMembership(offset: SourceOffset): 'covers' | 'end' | 'none';
    /**
     * Min `|offset - r|` over offsets `r` in any of this line's runs. Used
     * to pick the nearest line when no run actually covers the offset.
     */
    sourceDistanceTo(offset: SourceOffset): number;
    /**
     * x of the caret position before `offset` on this line.
     *
     * The runs tile the source but are stored in paint order, not sorted by
     * source offset (hidden-marker runs are appended last). So this scans all
     * runs rather than assuming any ordering:
     *
     *  - A zero-source visual anchor owns its exact offset, so a marker-only line
     *    wins over the preceding line's inclusive end boundary.
     *  - Otherwise a run starting at `offset` owns that seam. This keeps an
     *    out-of-flow prefix from placing the caret at its trailing edge when the
     *    following body starts at a visually separate x.
     *  - Otherwise, if some run *covers* `offset`, its own geometry places the
     *    caret (exact glyph boundary for text runs). In the active,
     *    markers-visible form every interior offset is covered, so this branch
     *    keeps distinct offsets distinct.
     *  - Otherwise `offset` sits in a gap — a hidden inline marker such as the
     *    `**` of `**bold**`, or before/after the painted text. It snaps to the
     *    seam between the source-nearest runs on either side: the right edge of
     *    the closest run ending at/before `offset`, else the left edge of the
     *    closest run starting at/after it. A hidden marker collapses to zero
     *    width, so both edges coincide at the seam.
     */
    xAtOffset(offset: SourceOffset): number;
    /**
     * Snap `x` to the nearest offset on this line. If `x` falls inside a
     * run, the run resolves the offset (exact glyph boundary for text runs,
     * nearer edge for source-less runs); otherwise it snaps to the closer
     * edge of the nearest run.
     */
    offsetAtX(x: number): SourceOffset;
}

/**
 * Geometry of the rendered document, as a map from source offsets to 2D
 * positions and back. All geometry is expressed in the editor overlay's local
 * CSS-pixel coordinate space.
 *
 * Structure (top to bottom):
 *
 *     VisualLineMap   = ordered list of VisualLines
 *     VisualLine      = a horizontal band [rect.top, rect.bottom) split
 *                       into one or more VisualRuns
 *     VisualRun       = a contiguous source range painted at a rectangle
 *                       on the line
 *
 * Invariants:
 *   - `lines[i].rect.bottom <= lines[i+1].rect.top + ε`
 *   - For any offset `o` covered by some run on line `L`:
 *       `xAtOffset(o)` is inside that run's horizontal range
 *       `xAtOffset(o)` is inside `L.rect.left..L.rect.right`
 *
 * The "map" goes both ways:
 *   - SourceOffset → (line, x) via {@link lineIndexOfOffset} + {@link xAtOffset}
 *   - Point2D → SourceOffset       via {@link offsetAtPoint}
 *
 * Both directions are total but not bijective: many offsets at a line
 * boundary map to the same `x`, and large areas of the document
 * (padding, gaps) map onto the nearest offset on the nearest line.
 *
 * Rendering a caret rect from these primitives is a consumer concern:
 *
 *     const i = map.lineIndexOfOffset(o);
 *     const caretRect = map.lineRect(i).withZeroWidthAt(map.xAtOffset(o));
 */
export declare class VisualLineMap {
    readonly lines: readonly VisualLine[];
    static readonly EMPTY: VisualLineMap;
    static measure(blockViews: readonly {
        readonly absoluteStart: number;
        readonly viewNode: ViewNode;
    }[], coordinateSpace: EditorCoordinateSpace, transform?: EditorCoordinateTransform): VisualLineMap;
    /** Lines backed by source ranges, excluding source-less cursor lines. */
    readonly sourceLines: readonly VisualLine[];
    constructor(lines: readonly VisualLine[]);
    get lineCount(): number;
    get isEmpty(): boolean;
    lineRect(lineIndex: number): Rect2D;
    /**
     * Line whose runs cover the offset, or the nearest line by source
     * distance if no run covers it.
     *
     * An offset that is only a run's *trailing* boundary (`offset ===
     * endExclusive`) — most notably the source offset just past a
     * line-breaking `\n`, which a zero-width run reports as its end on the line
     * it terminates — belongs to the START of the NEXT line instead. Preferring
     * the line that actually *starts* the offset makes the caret advance past a
     * newline to the next line rather than collapsing onto the previous line's
     * end (which would render two distinct offsets at the same caret position).
     * The first such trailing-boundary line is remembered as a fallback for the
     * document's very last offset, where no later line starts it.
     */
    lineIndexOfOffset(offset: SourceOffset): number;
    /**
     * x of the caret position before `offset`, on the line returned by
     * {@link lineIndexOfOffset}. Returns `0` when the map is empty.
     */
    xAtOffset(offset: SourceOffset): number;
    /**
     * Line occupied by a source or virtual cursor position. A virtual position
     * returns `undefined` until its corresponding DOM line has been measured.
     */
    lineIndexOfPosition(position: CursorPosition): number | undefined;
    xAtPosition(position: CursorPosition): number;
    /**
     * Line whose vertical band contains `y`, clamped to the first/last
     * line when `y` is outside the document.
     */
    lineIndexAtY(y: number): number;
    /**
     * Snap a 2D point to the nearest source offset. Uses `y` to pick a
     * line, then `x` to pick an offset within it. Up/down navigation
     * uses {@link offsetInLineAtX} directly to preserve desired column.
     */
    offsetAtPoint(point: Point2D): SourceOffset;
    /** Snap `x` to the nearest offset on a specific line. */
    offsetInLineAtX(lineIndex: number, x: number): SourceOffset;
    positionInLineAtX(lineIndex: number, x: number): CursorPosition;
    lineStartOffset(lineIndex: number): SourceOffset | undefined;
    lineEndOffset(lineIndex: number): SourceOffset | undefined;
}

/**
 * One contiguous run of text painted on a single visual line.
 *
 * When constructed with a {@link VisualRunSource}, `xAtOffset` returns the
 * pixel-exact x of the caret before character `offset` by measuring the
 * prefix `[textNodeStart, textNodeStart + (offset - sourceStart))` with a
 * DOM `Range`.
 *
 * A source-less run has no per-offset geometry: it either represents an
 * element-only block (KaTeX math, a mermaid/custom diagram, an image, an
 * inactive `<hr>`) whose box does not correspond to source offsets, or a
 * hand-built run in a test. Either way it maps between offsets and x by
 * snapping to the nearer edge of {@link rect} rather than fabricating
 * interior positions.
 */
export declare class VisualRun {
    readonly sourceRange: OffsetRange;
    readonly rect: Rect2D;
    readonly source?: VisualRunSource | undefined;
    readonly isVisualLineAnchor: boolean;
    static visualLineAnchor(sourceOffset: SourceOffset, rect: Rect2D): VisualRun;
    constructor(sourceRange: OffsetRange, rect: Rect2D, source?: VisualRunSource | undefined, isVisualLineAnchor?: boolean);
    get sourceStart(): SourceOffset;
    get sourceEndExclusive(): SourceOffset;
    get sourceLength(): number;
    containsOffset(offset: SourceOffset): boolean;
    sourceDistanceTo(offset: SourceOffset): number;
    xAtOffset(offset: SourceOffset): number;
    offsetAtX(x: number): SourceOffset;
}

/**
 * The DOM source of a {@link VisualRun}. When set, `xAtOffset` and
 * `offsetAtX` measure exact glyph positions via `Range.getBoundingClientRect`.
 * This matters for proportional fonts where character widths differ a lot
 * (e.g. `m` vs `i`): a caret placed by anything coarser than real glyph
 * measurement lands several pixels inside the wrong character.
 *
 * A run without a source has no per-offset geometry, so it maps between
 * offsets and x by snapping to the nearer run edge. Real text runs always
 * carry a source; source-less runs are element-only blocks (see
 * {@link _appendElementBlockRun}) and hand-built runs in tests.
 */
declare interface VisualRunSource {
    readonly textNode: Text;
    /** Offset within `textNode.data` corresponding to `sourceRange.start`. */
    readonly textNodeStart: number;
    readonly coordinateSpace: EditorCoordinateSpace;
}

export declare const vscodeHostKeyboardProfile: KeyboardProfile;

export declare const vscodeKeyboardProfile: KeyboardProfile;

export declare const vscodeLocalKeyboardProfile: KeyboardProfile;

export declare interface WordNavigationConfig {
    readonly wordSeparators: string;
    readonly wordSegmenterLocales: readonly string[];
}

export { }
