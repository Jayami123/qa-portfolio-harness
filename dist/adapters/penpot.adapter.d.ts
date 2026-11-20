import type { PenpotConfig } from "../config.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { BaseAdapter } from "./base.js";
import { type SecondIdentityProbe } from "./p4-second-identity.js";
import { type PerUserPluginProbe } from "./penpot-plugin.js";
import type { McpReadiness } from "./types.js";
/**
 * Penpot with its official MCP server (ADR 0006). Starts the stack; creates the fake owner through the backend's
 * manage.py CLI; logs in over RPC to prove the owner works; waits for a real MCP handshake and the four tools.
 * Tool calls that edit a design need a browser with the MCP plugin connected: that is proven by the spike, not here.
 */
export declare class PenpotAdapter extends BaseAdapter<PenpotConfig> {
    readonly id: "penpot";
    private secrets;
    constructor(cfg: PenpotConfig);
    mcpRunStateFile(): string;
    /** The second identity's run state (H2). Only written when P4_SECOND_IDENTITY=1. */
    secondRunStateFile(): string;
    /** H2: the second profile's password, derived from the owner-side secret so a kept volume reuses it. */
    private secondPassword;
    private secretsFile;
    private secretsFromDisk;
    private writeSecrets;
    private composeOpts;
    private composeArgs;
    up(): Promise<void>;
    /**
     * H6. Starts scripts/penpot-plugin-tabs.mjs detached: it logs in as each profile, opens that profile's own file, starts
     * the MCP plugin and keeps the tab open. Waits until both tabs report the plugin connected. Its log holds no secrets.
     */
    private startPluginTabs;
    /** Stops the tab process and removes its state files. Missing files are not an error. */
    private stopPluginTabs;
    /**
     * H6 live probe. Each tab's user token reaches the MCP and the plugin answers for that user: execute_code returns the
     * name of the file that profile opened. The two names must differ and each must be its own profile's file.
     */
    probePerUserPlugin(): Promise<PerUserPluginProbe>;
    down(): Promise<void>;
    health(): Promise<HealthStatus>;
    /** Polls the backend through the frontend proxy until get-profile answers (the anonymous profile is enough). */
    waitHealthy(timeoutMs?: number): Promise<void>;
    private login;
    /** login-with-password for any profile. Returns the auth-token cookie value; the password is never printed. */
    private loginAs;
    /**
     * H2. Creates the second profile with manage.py when its login fails (not there yet), then logs in and checks that
     * get-profile names it. Writes penpot-b-run.json with a null credential, because the MCP is single-user (see below).
     */
    seedSecond(): Promise<void>;
    /**
     * H2 live probe. Both profiles log in and get-profile names each one; the two emails differ. The MCP handshake and tools
     * list run for both run states. The MCP is single-user, so it cannot tell the two apart: the probe reports that.
     */
    probeSecondIdentity(): Promise<SecondIdentityProbe>;
    /** Creates the owner with manage.py when login fails, then logs in and checks the profile email. */
    seed(): Promise<SeedResult>;
    private profileEmailWith;
    authenticate(): Promise<AuthSession>;
    proveAuth(session: AuthSession): Promise<void>;
    /** MCP readiness: handshake, tools/list with at least four tools, and the named tool present. */
    waitMcp(timeoutMs?: number): Promise<McpReadiness>;
}
//# sourceMappingURL=penpot.adapter.d.ts.map