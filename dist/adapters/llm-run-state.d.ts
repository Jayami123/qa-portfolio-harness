/** Run state for an LLM host (LiteLLM). The api key is the proxy master key. It is never printed or logged. */
export interface LlmRunState {
    version: 1;
    product: "litellm";
    /** OpenAI-compatible base URL on the host, for example http://127.0.0.1:4000/v1 */
    baseUrl: string;
    /** Bearer key for the proxy. */
    apiKey: string;
}
export declare function llmRunStateFile(product: "litellm", harnessRoot?: string): string;
/** Writes the state with mode 0600, also when the file already existed. */
export declare function writeLlmRunState(file: string, state: LlmRunState): void;
/** Reads the state. Throws P4_RUN_STATE_MISSING or P4_RUN_STATE_INVALID. No message contains a value from the file. */
export declare function readLlmRunState(product: "litellm", file?: string): LlmRunState;
//# sourceMappingURL=llm-run-state.d.ts.map