import type { NextcloudConfig } from "../config.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { BaseAdapter } from "./base.js";
import { type SecondIdentityProbe } from "./p4-second-identity.js";
import { type MailFlowResult } from "./nextcloud-mail-seed.js";
import type { McpReadiness } from "./types.js";
/** H1 live check result: counts and flags per identity. No password, token or message body. */
export interface MailProbe {
    product: "nextcloud";
    owner: MailFlowResult & {
        email: string;
    };
    second?: MailFlowResult & {
        email: string;
    };
}
/**
 * Nextcloud with its MCP server (ADR 0006, D9). Starts docker/nextcloud.compose.yml, waits for status.php to report
 * installed, mints one app password for the fake owner over OCS, then starts the MCP server in pass-through mode and
 * waits for a real initialize plus tools/list made with that app password.
 */
export declare class NextcloudAdapter extends BaseAdapter<NextcloudConfig> {
    readonly id: "nextcloud";
    private secrets;
    constructor(cfg: NextcloudConfig);
    mcpRunStateFile(): string;
    /** The second identity's run state (H2). Only written when the option is on. */
    secondRunStateFile(): string;
    private secretsFile;
    /** Reads the secrets an earlier run kept, or makes new ones. Writes nothing. */
    private secretsFromDisk;
    /** Keeps the secrets next to the volumes they initialise, mode 0600. Never logged. */
    private writeSecrets;
    private composeOpts;
    up(): Promise<void>;
    down(): Promise<void>;
    health(): Promise<HealthStatus>;
    /** Polls status.php until it reports installed, out of maintenance, with no upgrade pending. */
    waitHealthy(timeoutMs?: number): Promise<void>;
    /** Mints the owner's app password over OCS and writes the MCP credential to the run state. */
    seed(): Promise<SeedResult>;
    /**
     * H2. Creates the second user over OCS as the owner, or resets its password when it already exists. The password is a
     * fresh random value for this run; it is never written to disk. The app password minted as that user goes to
     * nextcloud-b-run.json, which the MCP credential reader uses the same way as the owner's.
     */
    seedSecondIdentity(ownerPassword: string): Promise<void>;
    /**
     * H1. Installs the pinned Mail app, then configures a Mail account for each identity against GreenMail. Each identity's
     * GreenMail password is new for this run, and it is never printed or written to a file.
     */
    private seedMail;
    /**
     * H1 live check. The owner's MCP lists the accounts and the inbox, and sends a marked message to the owner. With the
     * second identity, the owner also sends to qa-user-b, and that identity's own MCP credential lists it. Each message must
     * reach GreenMail and then appear in the recipient's MCP inbox after a Mail sync. Returns ids, counts and flags only.
     */
    probeMail(): Promise<MailProbe>;
    authenticate(): Promise<AuthSession>;
    proveAuth(session: AuthSession): Promise<void>;
    /**
     * H2 live probe. Both app passwords resolve to their own users over OCS (different ids), and the MCP handshake and tools
     * list pass for both. Returns ids and counts only; no password is returned or printed.
     */
    probeSecondIdentity(): Promise<SecondIdentityProbe>;
    private cloudUserIdFor;
    /** MCP readiness: a real handshake with the pass-through credential, then the Nextcloud user check. */
    waitMcp(timeoutMs?: number): Promise<McpReadiness>;
}
//# sourceMappingURL=nextcloud.adapter.d.ts.map