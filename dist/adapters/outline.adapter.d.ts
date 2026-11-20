import type { OutlineConfig } from "../config.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { BaseAdapter } from "./base.js";
import { type SecondIdentityProbe } from "./p4-second-identity.js";
import type { McpReadiness } from "./types.js";
/**
 * Outline with its built-in MCP (ADR 0006). Starts db, redis and mail; runs the migration with the
 * production-ssl-disabled config; starts the app; waits for /_health; seeds one fake owner and one API key through
 * Outline's models; waits for a real MCP handshake made with that key.
 */
export declare class OutlineAdapter extends BaseAdapter<OutlineConfig> {
    readonly id: "outline";
    private secrets;
    constructor(cfg: OutlineConfig);
    mcpRunStateFile(): string;
    /** The second identity's run state (H2). Only written when P4_SECOND_IDENTITY=1. */
    secondRunStateFile(): string;
    private secretsFile;
    private secretsFromDisk;
    private writeSecrets;
    private composeOpts;
    private composeArgs;
    up(): Promise<void>;
    down(): Promise<void>;
    health(): Promise<HealthStatus>;
    waitHealthy(timeoutMs?: number): Promise<void>;
    /** Runs the seed script inside the container, then stores the owner's key in the run state. */
    seed(): Promise<SeedResult>;
    authenticate(): Promise<AuthSession>;
    /** Reads auth.info for one key and returns the authenticated user's email. The key is never printed. */
    private emailFor;
    proveAuth(session: AuthSession): Promise<void>;
    waitMcp(timeoutMs?: number): Promise<McpReadiness>;
    /** H2: MCP readiness and the auth.info identity for the second key (its own run state). */
    waitSecondMcp(timeoutMs?: number): Promise<McpReadiness>;
    /**
     * H2 live probe. Both identities authenticate, they are different users, and the MCP accepts both keys.
     * Returns the emails and tool counts only; no key is returned or printed.
     */
    probeSecondIdentity(): Promise<SecondIdentityProbe>;
}
//# sourceMappingURL=outline.adapter.d.ts.map