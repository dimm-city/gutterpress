import type { Check, CheckCategory, CheckPhase } from "./types";
export declare function registerCheck(check: Check): void;
export interface CheckFilter {
    category?: CheckCategory | CheckCategory[];
    phase?: CheckPhase;
    ids?: string[];
}
export declare function getChecks(filter?: CheckFilter): Check[];
export declare function getCheckById(id: string): Check | undefined;
export declare function getAllCheckIds(): string[];
export declare function resolveCheckSelectors(selectors: string[]): string[];
