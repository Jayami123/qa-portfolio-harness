import type { HealthStatus } from "../types.js";
import { type DockerRunner } from "./readiness-diagnostics.js";
export interface PollHealthOptions {
    timeoutMs?: number;
    intervalMs?: number;
    /** Per-request abort. Cal webpack's first GET / can exceed a minute. */
    requestTimeoutMs?: number;
    /** Extra headers (e.g. publishable API key). */
    headers?: Record<string, string>;
    /** Decides healthy from the HTTP status. Default: any status below 500. */
    isOk?: (statusCode: number) => boolean;
    /** Also try the localhost/127.0.0.1 twin of the URL. Default true. */
    alternateLoopback?: boolean;
    /** App container to check on each poll. When it has exited, the wait throws at once instead of running out the timeout. */
    container?: string;
    /** Docker call used for the container check. Tests pass a stub. */
    docker?: DockerRunner;
}
/** Windows Node fetch often fails on `localhost` (::1) while the app listens on IPv4. */
export declare function candidateUrls(url: string): string[];
/**
 * Poll GET `url` every 2s until the status is healthy (default: < 500) or timeout.
 * Returns the last status / error. Does not throw, except ContainerExitedError when `container` is set and has exited.
 */
export declare function pollHealth(url: string, options?: PollHealthOptions): Promise<HealthStatus>;
/** Poll until healthy, then throw with the last error if the deadline is hit. */
export declare function waitUntilHealthy(url: string, options?: PollHealthOptions): Promise<HealthStatus>;
//# sourceMappingURL=health.d.ts.map