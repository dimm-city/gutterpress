import stylelint from "stylelint";
export declare const ruleRemoteUrls = "printsafe/no-remote-urls";
export declare const ruleRiskyProps = "printsafe/no-risky-print-effects";
export declare const rulePagedjsCrashSelectors = "printsafe/no-pagedjs-crash-selectors";
declare const mainPlugin: stylelint.Plugin;
export declare const riskyRule: stylelint.Plugin;
export declare const pagedjsCrashSelectorRulePlugin: stylelint.Plugin;
export declare const messagesRemoteUrls: {
    rejected: (url: string) => string;
};
export declare const messagesRiskyProps: {
    rejected: (prop: string) => string;
};
export declare const messagesPagedjsCrashSelectors: {
    rejected: (selector: string) => string;
};
export default mainPlugin;
