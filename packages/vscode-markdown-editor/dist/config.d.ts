export declare const DEFAULT_WORD_NAVIGATION_CONFIG: WordNavigationConfig;

export declare const DEFAULT_WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?";

export declare interface WordNavigationConfig {
    readonly wordSeparators: string;
    readonly wordSegmenterLocales: readonly string[];
}

export { }
