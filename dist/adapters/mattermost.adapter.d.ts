import { type SecondIdentityProbe } from "./p4-second-identity.js";
import { type SeededPostsProbe } from "./mattermost-posts.js";
import type { MattermostConfig } from "../config.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { BaseAdapter } from "./base.js";
import type { McpReadiness } from "./types.js";
/**
 * Mattermost with the standalone MCP server (ADR 0006, decision Q2). The MCP binary is development-only upstream and is
 * built from a pinned commit. Seeds one team, one owner (system admin, used only to set up), and one member account
 * whose PAT is the MCP credential. The member has no admin role; the PAT role is granted by the owner.
 */
export declare class MattermostAdapter extends BaseAdapter<MattermostConfig> {
    readonly id: "mattermost";
    private secrets;
    constructor(cfg: MattermostConfig);
    mcpRunStateFile(): string;
    /** The second identity's run state (H2). Only written when P4_SECOND_IDENTITY=1. */
    secondRunStateFile(): string;
    private secretsFile;
    private secretsFromDisk;
    private writeSecrets;
    /** The per-run build folder: the Dockerfile plus extra-ca.pem (empty unless MATTERMOST_EXTRA_CA_FILE is set). */
    private buildContext;
    /** Copies the Dockerfile and writes the optional CA into the build folder. Never logs the CA. */
    private prepareBuildContext;
    private composeOpts;
    private composeArgs;
    up(): Promise<void>;
    down(): Promise<void>;
    health(): Promise<HealthStatus>;
    waitHealthy(timeoutMs?: number): Promise<void>;
    private login;
    private mmctl;
    /** Owner (system admin, setup only), team, member, PAT role grant, then the member's PAT. Idempotent on a kept volume. */
    seed(): Promise<SeedResult>;
    /** H2: the second password, derived from the agent password the secrets file already keeps. Never stored. */
    private secondPassword;
    /**
     * H2. A second member of the same team, with the PAT role granted by the owner, and its own PAT. Idempotent: an existing
     * account with the derived password is reused, and a kept volume's PAT is minted again (the run state is rewritten).
     */
    private seedSecond;
    authenticate(): Promise<AuthSession>;
    /** Uses the PAT on /users/me and checks the account is the member, not an admin. */
    proveAuth(session: AuthSession): Promise<void>;
    /**
     * H7. The second member posts the missing messages from SEED_POST_PREFIX in town-square. It logs in with its derived
     * password (the same account H2 created) and reads the channel first, so a kept volume posts only what is missing.
     */
    private seedSecondPosts;
    /** The channel id of SEED_CHANNEL_NAME in the harness team, read with the given token. */
    private channelIdFor;
    private channelPosts;
    /**
     * H7 live probe. Reads the channel as the owner (the MCP's own PAT, a team member) and checks that every seeded message
     * exists exactly once and that its author is the second identity's user id. Returns counts and the second username only.
     */
    probeSeededPosts(): Promise<SeededPostsProbe>;
    /** users/me for one PAT: the id, username and roles. The PAT is never printed. */
    private me;
    /** H2: MCP readiness and the users/me identity for the second PAT (its own run state). */
    waitSecondMcp(timeoutMs?: number): Promise<McpReadiness>;
    /**
     * H2 live probe. Both PATs authenticate as their own accounts (different usernames, neither an admin), and the MCP
     * handshake and tools list pass for both. Returns usernames and counts only.
     */
    probeSecondIdentity(): Promise<SecondIdentityProbe>;
    waitMcp(timeoutMs?: number): Promise<McpReadiness>;
}
//# sourceMappingURL=mattermost.adapter.d.ts.map