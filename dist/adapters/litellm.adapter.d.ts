import type { LiteLlmConfig } from "../config.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { BaseAdapter } from "./base.js";
/**
 * LiteLLM proxy (ADR 0007). One OpenAI-compatible endpoint with two aliases and no fallbacks (D14). Its MCP route is
 * never granted and is asserted empty (D15, review answer 0.4). The proxy is not an MCP server for the suite.
 */
export declare class LiteLlmAdapter extends BaseAdapter<LiteLlmConfig> {
    readonly id: "litellm";
    constructor(cfg: LiteLlmConfig);
    private secretsFile;
    private configFile;
    private readSecrets;
    private composeOpts;
    up(): Promise<void>;
    /** Removes containers. Never creates secrets: a missing file is passed through as a placeholder. */
    down(): Promise<void>;
    health(): Promise<HealthStatus>;
    /** Liveliness only. It does not need the Gemini key (D14). */
    waitHealthy(timeoutMs?: number): Promise<void>;
    /** The live config lists exactly the two aliases. GET /v1/models calls no model. */
    waitModels(timeoutMs?: number): Promise<string[]>;
    /** The MCP route answers an empty tools/list (no grants). Sent without a session, as the spike did. */
    waitMcpEmpty(): Promise<void>;
    /** One p4-stub call. Logs the route names from the headers, never the key. Never sends p4-nightly (D14). */
    waitStubRoute(): Promise<void>;
    seed(): Promise<SeedResult>;
    /** baseUrl is the host url (no /v1). The run state's baseUrl already ends in /v1, so it is not used here. */
    authenticate(): Promise<AuthSession>;
    /** Proves the key with a model list (no model call). /v1 is added once here. */
    proveAuth(session: AuthSession): Promise<void>;
}
//# sourceMappingURL=litellm.adapter.d.ts.map