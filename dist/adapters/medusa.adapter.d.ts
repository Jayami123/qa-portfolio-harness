import type { MedusaConfig } from "../config.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { BaseAdapter } from "./base.js";
export declare class MedusaAdapter extends BaseAdapter<MedusaConfig> {
    readonly id: "medusa";
    private backendProcess?;
    private storefrontProcess?;
    private seedResult?;
    private resolvedPublishableKey?;
    constructor(cfg: MedusaConfig);
    private harnessSwitches;
    private backendDir;
    private builtServerPackage;
    private buildMarkerPath;
    private logFile;
    private secondLogFile;
    /** Seams for stopSecondBackend tests: the real record and pid file live under HARNESS_ROOT. */
    private readSecondRecord;
    private stopSecondPidFile;
    private secondPidRunning;
    private storefrontLogFile;
    private storefrontDir;
    private composeOpts;
    private composeRecordPath;
    private readComposeRecordText;
    private writeComposeRecord;
    private clearComposeRecord;
    private timeoutFromEnv;
    private buildTimeoutMs;
    private webWaitMs;
    private readLogTail;
    private pnpmVersion;
    private assertToolchain;
    private writeBackendEnv;
    private backendProcessEnv;
    private productGitSha;
    private readBuildMarkerText;
    private logBuildSkipDecision;
    private shouldSkipBuild;
    private writeBuildMarker;
    private runPnpm;
    private rebuildProvenPackages;
    private migrate;
    private ensureBuild;
    private writeRuntimeMedusaConfig;
    private medusaStoreDataFingerprint;
    private ensureStorefrontBuild;
    private writeStorefrontEnv;
    private waitForStorefrontReady;
    private startStorefront;
    private stopStorefront;
    private listeningPids;
    /** Full argv of `pid`. Windows reads the CIM command line; Linux reads /proc, then falls back to ps. */
    private processArgv;
    /** Working directory of `pid`. Linux only (/proc/<pid>/cwd); undefined elsewhere. */
    private processCwd;
    private childPids;
    private signalPids;
    private pidAlive;
    /**
     * Windows: taskkill /T /F. Unix: walk all descendants with pgrep -P, SIGTERM them deepest first and
     * then the pid, wait 2 s, SIGKILL whatever is still alive. No process-group kill.
     */
    private killProcessTree;
    /**
     * After the pid-file stop, kill leftover listeners on `port` only when they were launched through
     * the harness's own entry point for `expected` (see classifyHarnessLauncher). Anything else is left alone.
     */
    private reapProductListeners;
    private isPortOpen;
    private waitForPortClosed;
    private probeStrict;
    private probe;
    private describeStatus;
    private environmentError;
    private waitReady;
    /**
     * Production `medusa start` resolves the admin build as `{cwd}/public/admin`.
     * `medusa build` writes that folder under `.medusa/server`, so start must run there.
     * Develop stays in `apps/backend`, where `medusa develop` compiles the admin itself.
     */
    private backendStartCwd;
    private startBackend;
    private stopBackend;
    /**
     * Starts the optional second backend on the same database. Called only after the primary is healthy.
     * PORT is set explicitly so an inherited PORT cannot move the primary backend.
     */
    /** Resolves true only when this call launched a process; false when it adopted a healthy one or had no URL. */
    private startSecondBackend;
    /** Starts the second backend when needed and waits for /health. Stops it on a readiness failure only if this call launched it. */
    private startAndAwaitSecondBackend;
    private waitSecondReady;
    /**
     * The recorded baseUrl wins over the current env, so a second backend started earlier is still stopped
     * after MEDUSA_SECOND_BASE_URL is unset. With neither set this is a no-op.
     * A stop error from the pid file propagates; nothing is reaped after it.
     */
    private stopSecondBackend;
    up(): Promise<void>;
    /**
     * The backend was already running, so its env (MEDUSA_REDIS/MEDUSA_STRIPE) is not re-read.
     * The storefront still needs to come up.
     */
    private onAlreadyHealthy;
    /**
     * Build and start the storefront after seed() so Next.js force-cache sees collections (smoke path).
     */
    startStorefrontAfterSeed(): Promise<void>;
    private storefrontAnswering;
    private maybeStartStorefront;
    private resolvePublishableKeyForStorefront;
    down(): Promise<void>;
    health(): Promise<HealthStatus>;
    waitHealthy(timeoutMs?: number): Promise<void>;
    seed(): Promise<SeedResult>;
    authenticate(): Promise<AuthSession>;
    proveAuth(session: AuthSession): Promise<void>;
}
//# sourceMappingURL=medusa.adapter.d.ts.map