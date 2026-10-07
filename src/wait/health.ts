import type { HealthStatus } from "../types.js";

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface PollHealthOptions {
  timeoutMs?: number;
  intervalMs?: number;
  /** Extra headers (e.g. publishable API key). */
  headers?: Record<string, string>;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function getOnce(url: string, headers?: Record<string, string>): Promise<HealthStatus> {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "application/json, text/plain, */*",
        ...headers,
      },
    });
    const statusCode = response.status;
    return {
      ok: statusCode < 500,
      url,
      statusCode,
      checkedAt: nowIso(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      url,
      error: message,
      checkedAt: nowIso(),
    };
  }
}

/**
 * Poll GET `url` every 2s until HTTP status < 500 (server is up) or timeout.
 * Returns the last status / error. Does not throw.
 */
export async function pollHealth(url: string, options: PollHealthOptions = {}): Promise<HealthStatus> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let last = await getOnce(url, options.headers);

  while (!last.ok && Date.now() < deadline) {
    const remaining = deadline - Date.now();
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(remaining, 0))));
    last = await getOnce(url, options.headers);
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
