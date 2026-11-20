/**
 * Returns NODE_OPTIONS with a default heap limit. The caller's own limit wins and is returned unchanged.
 * Otherwise the default is appended after the caller's flags, which are kept. A blank input returns the default
 * alone, so an empty NODE_OPTIONS gives the same value as v0.2.18.
 */
export declare function withHeapDefault(current: string | undefined, defaultMb: number): string;
//# sourceMappingURL=node-options.d.ts.map