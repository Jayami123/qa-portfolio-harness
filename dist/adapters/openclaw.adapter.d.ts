import type { OpenClawConfig } from "../config.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { BaseAdapter } from "./base.js";
import { type OpenClawClientTool, type OpenClawCronSpec, type OpenClawRunResult } from "./openclaw-seed.js";
/** OpenClaw gateway (ADR 0007). Approvals on, LiteLLM as the only provider, no channel in B1 (D19, review answer 0.3). */
export declare class OpenClawAdapter extends BaseAdapter<OpenClawConfig> {
    readonly id: "openclaw";
    constructor(cfg: OpenClawConfig);
    private secretsFile;
    private envFile;
    /** The gateway token, kept in secrets.json (mode 0600). Created on first use; never created by down. */
    private tokenFor;
    /**
     * H1: the per-run bot token for the mock channel, kept in secrets.json (mode 0600). Created on first use when `create` is
     * true. Returns undefined when the channel option is off or the file has none. Never printed.
     */
    private mockChannelTokenFor;
    /** H1: the bot token the suite's mock channel must accept (Bot API path `/bot<token>/...`). Undefined unless OPENCLAW_CHANNEL_MOCK=1 ran `up`. */
    mockChannelBotToken(): string | undefined;
    private composeOpts;
    /** Streams the config to a one-off container that runs as uid 1000 with no network (review answer 0.5). */
    private writeConfigInVolume;
    /** Runs `docker <args>` with `input` on stdin. Output is never printed; only the exit code and the stderr size are reported. */
    private dockerWithStdin;
    /** Runs a command in the running gateway container and returns stdout. Nothing is printed; a failure reports only the exit code. */
    private execInGateway;
    /** Writes `content` to `<workspace>/<relPath>`. The path is validated (relative, no `..`). */
    seedWorkspaceFile(relPath: string, content: string): Promise<void>;
    /** Writes MEMORY.md, or memory/<name>.md. */
    seedMemory(name: string, content: string): Promise<void>;
    /** Writes <workspace>/skills/<name>/SKILL.md. */
    seedSkill(name: string, skillMarkdown: string): Promise<void>;
    /** Creates one automation (cron job) in the running gateway through the CLI. Needs the gateway up. */
    seedCron(spec: OpenClawCronSpec): Promise<void>;
    /** `openclaw approvals get --json` in the gateway container: the effective exec policy and the approvals document. */
    readApprovals(): Promise<Record<string, unknown>>;
    /** `openclaw approvals pending --json`: approvals waiting for a decision. */
    readPendingApprovals(): Promise<Array<Record<string, unknown>>>;
    /**
     * Restarts the gateway container and waits for /healthz and /readyz. The state volume, the env file and the config are
     * kept as they are, so no option can change across a restart. `up` and `down` stay the only start and stop commands.
     */
    restart(): Promise<void>;
    up(): Promise<void>;
    /** Removes containers only. It never creates the token or the env file. The volume goes only with OPENCLAW_DOWN_VOLUMES=1. */
    down(): Promise<void>;
    health(): Promise<HealthStatus>;
    /** /healthz 200, then /readyz with ready: true (VERIFIED: ready after about 30 s). */
    waitHealthy(timeoutMs?: number): Promise<void>;
    seed(): Promise<SeedResult>;
    authenticate(): Promise<AuthSession>;
    /**
     * Headless agent run: sends one task through POST /v1/responses (the supported gateway API, same codepath as
     * `openclaw agent`) and returns the tool-call trace. It needs OPENCLAW_RESPONSES_API=1 at `up`. The tools are client-side
     * function tools: the gateway returns each call as a function_call item and does not execute it. It never prints the
     * token or the response body. Throws OPENCLAW_RUN_FAILED with the HTTP status on a non-200 (for example 502 when a
     * required tool was not called, or 404 when the endpoint is not enabled).
     */
    runTask(task: string, opts?: {
        tools?: OpenClawClientTool[];
        requireTool?: boolean;
        timeoutMs?: number;
    }): Promise<OpenClawRunResult>;
    /** Health only in B1. An authenticated gateway call is a B2 proof. */
    proveAuth(session: AuthSession): Promise<void>;
}
//# sourceMappingURL=openclaw.adapter.d.ts.map