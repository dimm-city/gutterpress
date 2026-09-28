import { ContentType } from '@vscode/web-editors';
import { HostTransport } from '@vscode/web-editors';
import { IDisposable } from '@vscode/observables';

export declare interface CodeBlockEditorProviderDefinition {
    readonly id: string;
    readonly selector: CodeBlockEditorSelector;
}

export declare type CodeBlockEditorProviderSelection<T> = {
    readonly kind: 'match';
    readonly provider: T;
} | {
    readonly kind: 'ambiguous';
    readonly providers: readonly T[];
};

export declare type CodeBlockEditorSelector = {
    readonly language: string;
} | {
    readonly languagePrefix: string;
};

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

export declare type IframeEmbeddedEditorHostTransport = HostTransport & IDisposable;

export declare interface IframeEmbeddedEditorProvider extends CodeBlockEditorProviderDefinition {
    readonly resolve: (infoString: string) => Promise<ResolvedIframeEmbeddedEditor | undefined>;
    readonly createHostTransport?: (runtimeKey: string) => IframeEmbeddedEditorHostTransport;
}

export declare type IframeEmbeddedEditorProviderSelector = CodeBlockEditorSelector;

declare interface IframeSandboxOptions {
    readonly forms?: boolean;
    readonly downloads?: boolean;
    readonly pointerLock?: boolean;
    readonly clipboardWrite?: boolean;
}

declare class OffsetRange {
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

declare class PhysicalIframe implements IDisposable {
    private readonly _descriptor;
    private readonly _hostTransport;
    private readonly _frameRoot;
    private readonly _scriptNonce;
    private readonly _themeCss;
    readonly iframe: HTMLIFrameElement;
    editor: VirtualizedIframeEmbeddedEditor | undefined;
    readonly pool: PhysicalIframePool;
    private _host;
    private _transport;
    private _pendingEditor;
    private _reportedHeight;
    private _disposed;
    private readonly _onWindowMessage;
    constructor(pool: PhysicalIframePool, _descriptor: ResolvedIframeEmbeddedEditor, _hostTransport: IframeEmbeddedEditorHostTransport | undefined, frameLayer: HTMLElement, _frameRoot: HTMLElement, _scriptNonce: string | undefined, _themeCss: string | (() => string) | undefined);
    bind(editor: VirtualizedIframeEmbeddedEditor): void;
    unbind(): void;
    layout(editor: VirtualizedIframeEmbeddedEditor): void;
    dispose(): void;
    private _setup;
    private _getThemeCss;
    private _postTheme;
    private _applyReportedHeight;
}

declare class PhysicalIframePool implements IDisposable {
    private readonly _provider;
    private readonly _frameLayer;
    private readonly _frameRoot;
    private readonly _scriptNonce;
    private readonly _themeCss;
    private readonly _iframeBootstrapUrl;
    readonly descriptor: ResolvedIframeEmbeddedEditor;
    private readonly _frames;
    constructor(_provider: IframeEmbeddedEditorProvider, descriptor: ResolvedIframeEmbeddedEditor, _frameLayer: HTMLElement, _frameRoot: HTMLElement, _scriptNonce: string | undefined, _themeCss: string | (() => string) | undefined, _iframeBootstrapUrl: string | undefined);
    get leasedFrames(): number;
    get idleFrames(): number;
    acquire(editor: VirtualizedIframeEmbeddedEditor): void;
    release(editor: VirtualizedIframeEmbeddedEditor): void;
    park(iframe: HTMLIFrameElement): void;
    dispose(): void;
    layout(): void;
    private _createFrame;
}

export declare interface ResolvedIframeEmbeddedEditor {
    readonly html: string;
    readonly runtimeKey: string;
    readonly resourceBaseUrl?: string;
    readonly hostTransport?: boolean;
    readonly contentType?: ContentType;
    readonly initialHeight?: number;
    readonly sandbox?: IframeSandboxOptions;
}

export declare type ResolvedIframeEmbeddedEditorSandbox = IframeSandboxOptions;

export declare function selectCodeBlockEditorProvider<T extends CodeBlockEditorProviderDefinition>(providers: readonly T[], language: string): CodeBlockEditorProviderSelection<T> | undefined;

declare class StringEdit {
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

declare class StringReplacement {
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

declare class VirtualizedIframeEmbeddedEditor implements IEmbeddedCodeEditor {
    private readonly _factory;
    readonly provider: IframeEmbeddedEditorProvider;
    readonly element: HTMLElement;
    onEdit?: (edit: StringEdit) => void;
    readonly estimateHeight: () => number;
    frame: PhysicalIframe | undefined;
    disposed: boolean;
    visible: boolean;
    readonly infoString: string;
    private readonly _frameHost;
    private _content;
    private _readOnly;
    private _pool;
    private _resolved;
    constructor(_factory: VirtualizedIframeEmbeddedEditorFactory, provider: IframeEmbeddedEditorProvider, infoString: string, initialContent: string, initialHeight: number, generation: number);
    setContent(content: string): void;
    setReadOnly(readOnly: boolean): void;
    setVisible(visible: boolean): void;
    resolve(pool: PhysicalIframePool | undefined): void;
    invalidate(): void;
    bindFrame(frame: PhysicalIframe): void;
    unbindFrame(height: number): void;
    applyGuestText(text: string): void;
    applyHeight(height: number): void;
    observeLayout(observer: ResizeObserver): void;
    hasFocus(): boolean;
    get content(): string;
    get readOnly(): boolean;
    get frameHost(): HTMLElement;
    dispose(): void;
    private _renderFallback;
}

export declare interface VirtualizedIframeEmbeddedEditorDiagnostics {
    readonly logicalEditors: number;
    readonly leasedFrames: number;
    readonly idleFrames: number;
    readonly descriptorCacheEntries: number;
    readonly descriptorCacheHits: number;
}

export declare class VirtualizedIframeEmbeddedEditorFactory implements IEmbeddedCodeEditorFactory, IDisposable {
    private readonly _options;
    private readonly _frameLayer;
    private _frameRoot;
    private _restoreFrameRootPosition;
    private _layoutObserver;
    private _layoutFrame;
    private readonly _observer;
    private readonly _logicalEditors;
    private readonly _pools;
    private readonly _descriptorCache;
    private readonly _rejectedProviders;
    private _providers;
    private _generation;
    private _descriptorCacheHits;
    private _disposed;
    constructor(_options: VirtualizedIframeEmbeddedEditorOptions);
    updateProviders(providers: readonly IframeEmbeddedEditorProvider[]): void;
    get diagnostics(): VirtualizedIframeEmbeddedEditorDiagnostics;
    create(language: string, infoString: string, initialContent: string): IEmbeddedCodeEditor | undefined;
    dispose(): void;
    remove(editor: VirtualizedIframeEmbeddedEditor): void;
    resolve(editor: VirtualizedIframeEmbeddedEditor, generation: number): Promise<void>;
    private _rejectEditor;
    private _ensureFrameRoot;
    private _setFrameRoot;
    private readonly _scheduleLayout;
    private _disposePools;
}

export declare interface VirtualizedIframeEmbeddedEditorOptions {
    readonly providers: readonly IframeEmbeddedEditorProvider[];
    readonly root?: Element | Document | null;
    readonly frameRoot?: HTMLElement;
    readonly scriptNonce?: string;
    readonly themeCss?: string | (() => string);
    /** Optional same-origin document URL to load before writing the iframe content. */
    readonly iframeBootstrapUrl?: string;
    readonly defaultHeight?: number;
    readonly onAmbiguous?: (language: string, providers: readonly CodeBlockEditorProviderDefinition[]) => void;
    readonly onDidChange?: () => void;
}

export { }
