/** Throws unless the live /v1/models list is exactly the two aliases (D14). Never echoes the body. */
export declare function assertLiteLlmModels(body: unknown): string[];
/**
 * Reads the route from the response headers of a p4-stub call (names VERIFIED on v1.110.0). Throws unless the model
 * group is p4-stub and the upstream name is present.
 */
export declare function stubRouteFromHeaders(headers: {
    get(name: string): string | null;
}): {
    alias: string;
    upstream: string;
};
/** The one completion readiness makes. It always names p4-stub, never p4-nightly (D14). */
export declare function stubCompletionRequest(baseUrl: string, apiKey: string): {
    url: string;
    init: RequestInit;
};
/** Guard: readiness code never sends the Gemma alias. */
export declare function assertNoNightlyCall(init: RequestInit): void;
/** A tools/list reply is JSON, or an SSE body with one `data:` line. Returns the tools array. Never echoes the text. */
export declare function toolsFromMcpReply(text: string): unknown[];
/** Throws unless /mcp lists no tools. With no grants LiteLLM's /mcp must advertise nothing (review answer 0.4). */
export declare function assertEmptyToolsList(text: string): void;
//# sourceMappingURL=litellm-seed.d.ts.map