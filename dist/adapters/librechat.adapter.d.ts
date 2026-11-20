import type { LibreChatConfig } from "../config.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { BaseAdapter } from "./base.js";
/**
 * LibreChat chat host (ADR 0007). It boots against LiteLLM by alias and attaches the Part A MCP servers by alias.
 * B1 proves health, the seeded login, and that each configured MCP server is connected and lists tools (review answers
 * 0.6 and 0.7). On a timeout it prints redacted diagnostics before it throws.
 */
export declare class LibreChatAdapter extends BaseAdapter<LibreChatConfig> {
    readonly id: "librechat";
    constructor(cfg: LibreChatConfig);
    private secretsFile;
    private envFile;
    private configFile;
    /** Reads the saved secrets, or creates them (mode 0600). Creates nothing on down. */
    private secrets;
    /**
     * The compose options. With recording on (H9), `recordedFrom` is the unrecorded server list: it sets the route list and
     * the mounts for the recorder, and adds its compose file. Without it, the call is the same as before H9.
     */
    private composeOpts;
    /** The recorder mounts the compiled dist folder, so a build must exist. Names the step to run if it does not. */
    private recorderEnv;
    up(): Promise<void>;
    /** Removes containers only. It never creates secrets. */
    down(): Promise<void>;
    health(): Promise<HealthStatus>;
    /** /health and /api/config both 200 (VERIFIED in the spike). */
    waitHealthy(timeoutMs?: number): Promise<void>;
    /**
     * Creates the fake owner once. If the login already works, nothing is created (idempotent on a kept volume).
     * create-user takes the password as an argument. It runs through runCapture with the password redacted, so neither
     * npm's output nor a thrown error carries it. npm runs with --silent, so it does not echo the command.
     */
    seed(): Promise<SeedResult>;
    /**
     * Logs in, then polls the supported MCP routes until every configured server is connected and lists tools. On timeout it
     * prints every server's state and redacted diagnostics, then throws. The error names each state, never a value.
     */
    waitMcpProofs(timeoutMs?: number): Promise<Record<string, number>>;
    /**
     * Redacted diagnostics for a failed MCP wait: every state, LibreChat's MCP and allow-list lines, the tail of each failing
     * MCP container's log, and a probe run inside the LibreChat container (DNS address and HTTP status per server). Only
     * names, addresses, statuses and log lines are printed. Every line is redacted with the env-file values and the secrets.
     */
    private diagnoseMcp;
    /** Every env-file value and secret, for redaction of anything printed from the probe or the logs. */
    private redactionValues;
    private token;
    authenticate(): Promise<AuthSession>;
    proveAuth(session: AuthSession): Promise<void>;
}
//# sourceMappingURL=librechat.adapter.d.ts.map