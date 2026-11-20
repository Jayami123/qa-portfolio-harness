import { failIfContainerExited } from "./readiness-diagnostics.js";
import { describeFetchFailure } from "./readiness-error.js";
const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;
function nowIso() {
    return new Date().toISOString();
}
/** Windows Node fetch often fails on `localhost` (::1) while the app listens on IPv4. */
export function candidateUrls(url) {
    const urls = [url];
    try {
        const parsed = new URL(url);
        if (parsed.hostname === "localhost") {
            parsed.hostname = "127.0.0.1";
            urls.push(parsed.toString());
        }
        else if (parsed.hostname === "127.0.0.1") {
            parsed.hostname = "localhost";
            urls.push(parsed.toString());
        }
    }
    catch {
        // keep original
    }
    return urls;
}
async function getOnce(url, probe) {
    let lastError = "fetch failed";
    const candidates = probe.alternateLoopback ? candidateUrls(url) : [url];
    for (const candidate of candidates) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), probe.requestTimeoutMs);
        try {
            const response = await fetch(candidate, {
                method: "GET",
                redirect: "manual",
                signal: controller.signal,
                headers: {
                    Accept: "application/json, text/plain, */*",
                    ...probe.headers,
                },
            });
            const statusCode = response.status;
            return {
                ok: probe.isOk(statusCode),
                url: candidate,
                statusCode,
                checkedAt: nowIso(),
            };
        }
        catch (error) {
            lastError = describeFetchFailure(error);
        }
        finally {
            clearTimeout(timer);
        }
    }
    return {
        ok: false,
        url,
        error: lastError,
        checkedAt: nowIso(),
    };
}
/**
 * Poll GET `url` every 2s until the status is healthy (default: < 500) or timeout.
 * Returns the last status / error. Does not throw, except ContainerExitedError when `container` is set and has exited.
 */
export async function pollHealth(url, options = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    const probe = {
        headers: options.headers,
        requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        isOk: options.isOk ?? ((statusCode) => statusCode < 500),
        alternateLoopback: options.alternateLoopback ?? true,
    };
    let last = await getOnce(url, probe);
    if (timeoutMs <= 0) {
        return last;
    }
    const deadline = Date.now() + timeoutMs;
    while (!last.ok && Date.now() < deadline) {
        if (options.container !== undefined) {
            failIfContainerExited(options.container, url, options.docker);
        }
        const remaining = deadline - Date.now();
        await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(remaining, 0))));
        last = await getOnce(url, probe);
    }
    return last;
}
/** Poll until healthy, then throw with the last error if the deadline is hit. */
export async function waitUntilHealthy(url, options = {}) {
    const result = await pollHealth(url, options);
    if (!result.ok) {
        throw new Error(`Timed out waiting for ${url} to become healthy` +
            (result.statusCode !== undefined ? ` (last HTTP ${result.statusCode})` : "") +
            (result.error ? `: ${result.error}` : ""));
    }
    return result;
}
//# sourceMappingURL=health.js.map