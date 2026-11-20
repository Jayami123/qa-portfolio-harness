import type { TwentyConfig } from "../config.js";
import { type SecondIdentityProbe } from "./p4-second-identity.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { BaseAdapter } from "./base.js";
import type { McpReadiness } from "./types.js";
export declare class TwentyAdapter extends BaseAdapter<TwentyConfig> {
    readonly id: "twenty";
    private seedResult?;
    constructor(cfg: TwentyConfig);
    private dockerDir;
    private composeOpts;
    private healthUrl;
    private waitBudgetMs;
    private listDockerVolumes;
    private prepareDockerEnvAsync;
    private dockerComposeArgs;
    private assertRunningServerImage;
    up(): Promise<void>;
    /** The start sequence of up(), after the network, tag and freshness checks. Also used to start again after a seed reset. */
    private startStack;
    /**
     * Wipes the harness-owned Twenty volumes and starts the stack again, so a seed retry starts from an empty database.
     * `workspace:seed:dev` cannot be re-run on top of a partial seed (see TwentySeedAttemptIo.reset). Only called after a seed
     * this adapter ran itself on a database that had no seed user, so no earlier data is lost.
     */
    private resetForSeedRetry;
    down(): Promise<void>;
    health(): Promise<HealthStatus>;
    waitHealthy(timeoutMs?: number): Promise<void>;
    mcpRunStateFile(): string;
    /** The second identity's run state (H2). Only written when P4_SECOND_IDENTITY=1. */
    secondRunStateFile(): string;
    /**
     * The workspace token from the loginToken exchange. The plain signIn token is workspace-agnostic: /mcp rejects it and
     * createApiKey refuses it (probe, 2026-11-17). So the MCP path always takes the exchange route.
     */
    private workspaceToken;
    /** The workspace token for any member. The password is sent only in the GraphQL body, never printed. */
    private workspaceTokenFor;
    /** Authenticated GraphQL on /metadata. metadataGraphql above sends no Authorization, so this one does. */
    private authedGraphql;
    /** Mints a least-privilege API key, exchanges it for the MCP bearer, and writes the run state (mode 0600). */
    private prepareMcp;
    /**
     * H2. Twenty denies API-key management to a Member ("Entity performing the request does not have permission", live
     * 2026-11-19), and API keys belong to the workspace, not to a user. So the second key is minted by the workspace admin,
     * with the same least-privilege role as the owner's key, and recorded against the second member's identity. The second
     * member's own sign-in is proven separately by probeSecondIdentity (currentUser).
     */
    private prepareSecondMcp;
    private mintMcpCredential;
    /** H2: MCP readiness for the second key (its own run state). The key is not printed. */
    waitSecondMcp(timeoutMs?: number): Promise<McpReadiness>;
    /**
     * H2 live probe. Both members sign in and their currentUser emails differ; the MCP handshake and tools list pass for both
     * keys. Returns emails and counts only; no token or key is returned or printed.
     */
    probeSecondIdentity(): Promise<SecondIdentityProbe>;
    /** currentUser.email for one workspace token. */
    private currentEmailFor;
    /** MCP readiness: a real handshake and tools/list with the scoped key. The key is not printed. */
    waitMcp(timeoutMs?: number): Promise<McpReadiness>;
    private seedUsers;
    /** The loginToken exchange that /mcp and the API key need. It fails with "User is not a member of the workspace" on a cut-short seed. */
    private membershipOk;
    private seedAlreadyPresent;
    seed(): Promise<SeedResult>;
    authenticate(): Promise<AuthSession>;
    proveAuth(session: AuthSession): Promise<void>;
    private metadataGraphql;
}
//# sourceMappingURL=twenty.adapter.d.ts.map