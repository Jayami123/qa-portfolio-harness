import type { HealthStatus } from "../types.js";

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface PollHealthOptions {
  timeoutMs?: number;
  intervalMs?: number;
  /** Per-request abort. Cal webpack's first GET / can exceed a minute. */
  requestTimeoutMs?: number;
  /** Extra headers (e.g. publishable API key). */
  headers?: Record<string, string>;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Windows Node fetch often fails on `localhost` (::1) while the app listens on IPv4. */
function candidateUrls(url: string): string[] {
  const urls = [url];
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "localhost") {
      parsed.hostname = "127.0.0.1";
      urls.push(parsed.toString());
    } else if (parsed.hostname === "127.0.0.1") {
      parsed.hostname = "localhost";
      urls.push(parsed.toString());
    }
  } catch {
    // keep original
  }
  return urls;
}

async function getOnce(
  url: string,
  headers?: Record<string, string>,
  requestTimeoutMs = 45_000,
): Promise<HealthStatus> {
  let lastError = "fetch failed";
  for (const candidate of candidateUrls(url)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(candidate, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "application/json, text/plain, */*",
          ...headers,
        },
      });
      const statusCode = response.status;
      return {
        ok: statusCode < 500,
        url: candidate,
        statusCode,
        checkedAt: nowIso(),
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (lastError.includes("abort")) {
        lastError = "fetch timed out";
      }
    } finally {
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
 * Poll GET `url` every 2s until HTTP status < 500 (server is up) or timeout.
 * Returns the last status / error. Does not throw.
 */
export async function pollHealth(url: string, options: PollHealthOptions = {}): Promise<HealthStatus> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? 45_000;
  let last = await getOnce(url, options.headers, requestTimeoutMs);
  if (timeoutMs <= 0) {
    return last;
  }
  const deadline = Date.now() + timeoutMs;

  while (!last.ok && Date.now() < deadline) {
    const remaining = deadline - Date.now();
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(remaining, 0))));
    last = await getOnce(url, options.headers, requestTimeoutMs);
  }

  return last;
}

/** Poll until healthy, then throw with the last error if the deadline is hit. */
export async function waitUntilHealthy(url: string, options: PollHealthOptions = {}): Promise<HealthStatus> {
  const result = await pollHealth(url, options);
  if (!result.ok) {
    throw new Error(
      `Timed out waiting for ${url} to become healthy` +
        (result.statusCode !== undefined ? ` (last HTTP ${result.statusCode})` : "") +
        (result.error ? `: ${result.error}` : ""),
    );
  }
  return result;
}
