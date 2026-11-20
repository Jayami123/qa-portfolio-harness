import type { DocumensoConfig } from "../config.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { BaseAdapter } from "./base.js";
export declare class DocumensoAdapter extends BaseAdapter<DocumensoConfig> {
    /** Per-run OIDC values (admin password, client secret, user passwords). In memory only; never logged or written. */
    private oidcRun;
    readonly id: "documenso";
    private seedResult?;
    private webProcess?;
    constructor(cfg: DocumensoConfig);
    private remixDir;
    private buildDir;
    private builtServerMain;
    private buildMarkerPath;
    private logFile;
    /** `oidc` adds the mock OIDC overlay. up() passes the flag; down() passes false, and --remove-orphans removes the provider. */
    private composeOpts;
    private appEnv;
    /** Stops unless the Node that runs Documenso (`$NODE24`, else the harness's Node) is version 24 or newer. */
    private assertDocumensoNode;
    private timeoutFromEnv;
    private buildTimeoutMs;
    private webWaitMs;
    private readLogTail;
    /** Ensures node_modules exists and a local .env is present (copied from .env.example in the fork). */
    private prepareProductFiles;
    private productGitSha;
    private readBuildMarkerSha;
    private shouldSkipBuild;
    /** Mirrors apps/remix/.bin/build.sh without bash, so it runs under Windows cmd. */
    private ensureBuild;
    private waitForPortClosed;
    private stopListeningWeb;
    private isPortOpen;
    /**
     * Diagnostic only. Lists the listener PID and executable so the owner can decide.
     * Never stops anything: no taskkill, no kill signal.
     */
    private portOwnerReport;
    /** Strict 127.0.0.1 probe. Both /signin and /api/auth/csrf must answer 200. */
    private probeBase;
    /**
     * Strict 127.0.0.1 probe. Localhost is probed only when the strict probe fails, and only to
     * classify the failure: a localhost-only 200 is an ENVIRONMENT finding, never a pass.
     */
    private probe;
    private describeStatus;
    private environmentError;
    /** HTML of GET /signin on the listen URL. Used only to read window.__ENV__.NEXT_PUBLIC_WEBAPP_URL. */
    private fetchSigninHtml;
    private stalePublicUrlError;
    private waitReady;
    up(): Promise<void>;
    /** Generate the Prisma client (not run by `npm ci` for this fork), then apply migrations. */
    private migrate;
    private startWeb;
    down(): Promise<void>;
    health(): Promise<HealthStatus>;
    waitHealthy(timeoutMs?: number): Promise<void>;
    private seedUsers;
    /** Read-only check. If the table or DB is not ready yet, return false and let prisma:seed run. */
    private seedAlreadyPresent;
    seed(): Promise<SeedResult>;
    authenticate(): Promise<AuthSession>;
    proveAuth(session: AuthSession): Promise<void>;
}
//# sourceMappingURL=documenso.adapter.d.ts.map