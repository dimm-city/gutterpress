/**
 * Canonical editor command catalog. Standalone keyboard handling and host
 * integrations derive their command registration and default keybindings from
 * this list.
 */
export declare const commands: readonly EditorCommandDefinition[];

export declare type CursorKeyboardAction = 'left' | 'right' | 'up' | 'down' | 'wordLeft' | 'wordRight' | 'visualLineStart' | 'visualLineEnd' | 'logicalLineStart' | 'logicalLineEnd' | 'documentStart' | 'documentEnd';

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

export declare type HistoryKeyboardAction = 'undo' | 'redo';

export declare interface KeyboardModifiers {
    readonly shift?: boolean;
    readonly alt?: boolean;
    readonly ctrl?: boolean;
    readonly meta?: boolean;
}

export declare type KeyboardPlatform = 'macos' | 'windows' | 'linux';

export declare type TabKeyboardAction = 'insert' | 'outdent';

export { }
