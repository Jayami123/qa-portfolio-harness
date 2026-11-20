export declare const REDACTED = "[REDACTED]";
/** Values shorter than this are not treated as secrets when checking for leaks (matches the env-file redaction). */
export declare const MIN_LEAK_VALUE_LENGTH = 6;
export declare function sessionDigest(value: string): string;
export declare function redactHeaders(headers: Record<string, string | string[] | number | undefined>): Record<string, string>;
/** Replaces credential-shaped text in any string (a path, a query, a log line, a body). */
export declare function redactText(text: string): string;
/** Replaces the value of every credential-like key in a parsed JSON value. Keys stay, so the shape stays readable. */
export declare function redactJson(value: unknown): unknown;
/** Redacts a message body by content type: SSE per data line, JSON by key, anything else as text. */
export declare function redactBody(text: string, contentType: string | undefined): string;
/** How many of the given secret values appear in the text. Used by the leak checks; the values are never returned. */
export declare function countLeakedValues(text: string, values: readonly string[]): number;
//# sourceMappingURL=redact.d.ts.map