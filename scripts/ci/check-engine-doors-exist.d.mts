/** Types for check-engine-doors-exist.mjs (the release gate door scan). */
export declare function stripComments(src: string): string;
export declare function doorsIn(source: string): Set<string>;
export declare function engineDoors(root?: string): Map<string, string[]>;
export declare function refusalText(kind: string, names?: string[]): string;
