import type { CalConfig } from "../config.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { BaseAdapter } from "./base.js";
/** The fork's Postgres service. --wait must name it: the fork's one-shot postgres_is_ready container exits, and --wait fails on any exit (docker/compose#10596). */
export declare const CAL_POSTGRES_SERVICE = "postgres";
export declare const CAL_REDIS_SERVICE = "redis";
/** Services `up cal` names for --wait. compose starts only these, so the mail catcher must be listed to be created. */
export declare const CAL_UP_WAIT_SERVICES: string[];
/** Cal's default old-space limit. The caller's own limit in NODE_OPTIONS wins; otherwise the default is merged in. */
export declare const CAL_HEAP_MB = 8192;
/** The heap-only env every Cal process gets (the default for all callers except the web server). */
/** The order of down(): the API first, then the web, then compose (which also removes Redis). Exported so the order is tested. */
export declare function calDownSequence(steps: {
    readonly stopApi: () => Promise<void>;
    readonly stopWeb: () => Promise<void>;
    readonly composeDown: () => Promise<void>;
}): Promise<void>;
/** The readiness timeout for the API, with the API log tail. Exported so the message is tested. */
export declare function apiTimeoutMessage(url: string, logTail: string): string;
export declare function calHeapEnv(processEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
/** The Cal web server env: the heap env, plus the event-loop preload when HARNESS_EL_PRELOAD is set. */
export declare function calNodeHeapEnv(processEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export declare class CalAdapter extends BaseAdapter<CalConfig> {
    readonly id: "cal";
    private seededApiKey?;
    private seedResult?;
    private webProcess?;
    private apiProcess?;
    constructor(cfg: CalConfig);
    private webRootUrl;
    private harnessStateDir;
    private prismaDir;
    private productComposeFile;
    private composeOpts;
    private readLogTail;
    /** Turbopack dev crashes on this fork/Windows with a bogus instrumentation.ts miss, so webpack is the Windows default. */
    private bundler;
    /** Default is production (`next build` + `next start`). `CAL_WEB_MODE=dev` keeps next-dev. */
    private webMode;
    private nodeHeapEnv;
    private nextDir;
    private prodMarkerPath;
    private harnessBuildMarkerPath;
    private trpcAppRouterDts;
    private timeoutFromEnv;
    private nextBuildTimeoutMs;
    private trpcBuildTimeoutMs;
    private currentProductGitSha;
    private readHarnessBuildGitSha;
    private writeHarnessBuildMarker;
    private shouldSkipProdBuild;
    /**
     * packages/trpc/react/trpc.ts imports AppRouter from ../types/server/routers/_app,
     * which is gitignored output of @calcom/trpc#build. turbo's @calcom/web#build gets
     * it via ^build; a direct `next build` does not.
     */
    private generateTrpcTypes;
    private ensureProdBuild;
    private webListen;
    private isWebPortOpen;
    private killOccupyingWebPort;
    private waitForWeb;
    /** The web and API states for up(). A held API port that is neither healthy nor the recorded pid throws here. */
    private readyState;
    /** 200 with the body "OK" (the fork's health route, apps/api/v2/src/app.controller.ts:7). Anything else is not healthy. */
    private apiHealthOk;
    private apiState;
    private apiListen;
    private isApiPortOpen;
    private apiLogFile;
    /** The API process env: the no-fallback keys from the product root .env, the generated test secret, and the port and Redis URL. */
    private apiSpawnEnv;
    /** Builds the fork's API v2 with its own scripts. Skips when the build marker matches the fork HEAD and main.js exists. */
    private ensureApiBuild;
    /** Starts the built API v2 as a detached node process, records its pid, and checks that it stayed up. */
    private startApi;
    /** Polls `${apiBaseUrl}/health` until 200. A process that exits, or a timeout, throws with the API log tail. */
    /** Polls the API health until OK. A process that exits, or a timeout, throws with the API log tail. */
    private waitForApi;
    private verifyApiListenerIsRecorded;
    /** Stops the recorded API pid when its start mark matches, waits for the port, and removes the pid file only when it is free. */
    private stopApi;
    up(): Promise<void>;
    /**
     * One DB-backed read through the API (GET /v2/me). `/health` does not touch the database, so it cannot show a
     * missing DATABASE_URL. Fails with a harness: error; the key is used in the request header only, never printed.
     */
    private assertApiReadsDatabase;
    /** The web server path of up(): seed, start or reuse the recorded web process, wait for it to answer. */
    private ensureWeb;
    /** After Cal answers, the port listener must be the recorded pid. Otherwise up fails and does not guess. */
    private verifyListenerIsRecorded;
    down(): Promise<void>;
    /**
     * Signals the recorded pid, waits for the port to close, and removes the pid file only when the port is
     * free. A held port keeps the file and throws, saying whether the listener matches the record.
     */
    private stopWeb;
    health(): Promise<HealthStatus>;
    private seedUsers;
    /** The fork only prints the key on first create. Recover it from scripts/seed.ts if skipped. */
    private apiKeyFromSeedScript;
    private hashCalApiKey;
    /** True only when the core seed user's row is in the database. A failed db-seed is accepted on this, not on output alone. */
    private coreSeedUserRowExists;
    private seedAlreadyPresent;
    private captureApiKeyFromSeedOutput;
    seed(): Promise<SeedResult>;
    authenticate(): Promise<AuthSession>;
    /**
     * Prove the Bearer token against an authenticated API v2 route.
     * Public GET /health is not used — it does not require a key.
     */
    proveAuth(session: AuthSession): Promise<void>;
    private apiKeyRowExists;
}
//# sourceMappingURL=cal.adapter.d.ts.map