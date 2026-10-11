/** Documenso helpers. Parsers are pure (no I/O). DNS lookup is injected so tests stay offline. */

import dns from "node:dns/promises";
import net from "node:net";

export const DOCUMENSO_NODE_MAJOR = 24;
export const DOCUMENSO_DEFAULT_PORT = "3001";

/** IPv4-only lookup. Injected in tests; production uses dns.promises.lookup (hosts file). */
export type DocumensoLoopbackLookup = (
  hostname: string,
  options: { family: 4 },
) => Promise<{ address: string }>;

export interface DocumensoListen {
  host: string;
  port: string;
}

/**
 * Parse the configured base URL. Only 127.0.0.1 is accepted: localhost can resolve to ::1 on Windows
 * and hide an app that only listens on IPv4 (or the reverse), so the harness never passes on it.
 */
export function documensoListen(baseUrl: string): DocumensoListen {
  const parsed = new URL(baseUrl);
  if (parsed.hostname !== "127.0.0.1") {
    throw new Error(
      `DOCUMENSO_BASE_URL must use 127.0.0.1 (got ${parsed.hostname}). localhost can hide an IPv6-only bind, so the harness does not accept it.`,
    );
  }
  return { host: parsed.hostname, port: parsed.port || DOCUMENSO_DEFAULT_PORT };
}

/** The localhost twin of a 127.0.0.1 base URL, used only to diagnose an IPv6-only bind. */
export function localhostTwin(baseUrl: string): string {
  return baseUrl.replace("://127.0.0.1", "://localhost");
}

export function documensoHealthUrls(baseUrl: string): { signin: string; csrf: string } {
  const base = baseUrl.replace(/\/$/, "");
  return { signin: `${base}/signin`, csrf: `${base}/api/auth/csrf` };
}

export function isDocumensoHealthyStatus(statusCode: number): boolean {
  return statusCode === 200;
}

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function effectiveUrlPort(parsed: URL): string {
  if (parsed.port) return parsed.port;
  return parsed.protocol === "https:" ? "443" : "80";
}

/**
 * Validate optional DOCUMENSO_PUBLIC_URL. Hostname must not be localhost or an IP.
 * Port must equal the listen port from DOCUMENSO_BASE_URL. Trailing slash is stripped.
 */
export function parseDocumensoPublicUrl(raw: string, listenPort: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error(
      `DOCUMENSO_PUBLIC_URL must be an http(s) URL (got ${raw}). Example: http://p1.lvh.me:${listenPort}.`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `DOCUMENSO_PUBLIC_URL must use http or https (got ${parsed.protocol}). Example: http://p1.lvh.me:${listenPort}.`,
    );
  }
  const hostname = parsed.hostname;
  if (!hostname) {
    throw new Error(
      `DOCUMENSO_PUBLIC_URL must include a hostname. Example: http://p1.lvh.me:${listenPort}.`,
    );
  }
  const unbracketed =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (hostname.toLowerCase() === "localhost" || net.isIP(unbracketed) !== 0) {
    throw new Error(
      `DOCUMENSO_PUBLIC_URL hostname must not be localhost or an IP (got ${unbracketed}). ` +
        `Use a hosts-file name such as p1.lvh.me.`,
    );
  }
  const publicPort = effectiveUrlPort(parsed);
  if (publicPort !== listenPort) {
    throw new Error(
      `DOCUMENSO_PUBLIC_URL port must match DOCUMENSO_BASE_URL listen port ${listenPort} (got ${publicPort}).`,
    );
  }
  return stripTrailingSlash(parsed.href);
}

function publicHostResolveError(hostname: string, detail: string): Error {
  return new Error(
    `DOCUMENSO_PUBLIC_URL host ${hostname} does not resolve to 127.0.0.1 (${detail}). ` +
      `Add this line to your hosts file and retry:\n  127.0.0.1 ${hostname}\n` +
      `Windows: C:\\Windows\\System32\\drivers\\etc\\hosts\n` +
      `Linux/macOS: /etc/hosts`,
  );
}

/**
 * Fail unless hostname resolves to 127.0.0.1 (IPv4). Uses getaddrinfo so /etc/hosts is honoured.
 * No localhost fallback.
 */
export async function assertDocumensoPublicHostResolvesToLoopback(
  hostname: string,
  lookup: DocumensoLoopbackLookup = dns.lookup,
): Promise<void> {
  let address: string;
  try {
    const result = await lookup(hostname, { family: 4 });
    address = result.address;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw publicHostResolveError(hostname, detail);
  }
  if (address !== "127.0.0.1") {
    throw publicHostResolveError(hostname, `got ${address}`);
  }
}

function extractJsonObject(source: string, start: number): unknown {
  if (source[start] !== "{") return undefined;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, i + 1)) as unknown;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/**
 * Read NEXT_PUBLIC_WEBAPP_URL from Documenso's `window.__ENV__ = {...}; window.__webpack_nonce__` script.
 * Returns undefined when the assignment is missing or not JSON.
 */
export function parseDocumensoRunningWebappUrl(html: string): string | undefined {
  const marker = "window.__ENV__ = ";
  const index = html.indexOf(marker);
  if (index < 0) return undefined;
  const extracted = extractJsonObject(html, index + marker.length);
  if (typeof extracted !== "object" || extracted === null || Array.isArray(extracted)) {
    return undefined;
  }
  const webappUrl = (extracted as Record<string, unknown>).NEXT_PUBLIC_WEBAPP_URL;
  return typeof webappUrl === "string" && webappUrl.length > 0 ? stripTrailingSlash(webappUrl) : undefined;
}

export function runningWebappUrlMatches(html: string, expectedPublicUrl: string): boolean {
  const running = parseDocumensoRunningWebappUrl(html);
  return running !== undefined && running === stripTrailingSlash(expectedPublicUrl);
}

/**
 * Local-only values for the app process and migrate/seed commands. These are the stock
 * `.env.example` placeholders from the fork, not secrets. The harness values win over the
 * product `.env` because dotenv does not override variables already set in the environment.
 *
 * NEXT_PRIVATE_INTERNAL_WEBAPP_URL always stays on the listen/base URL so the server can
 * talk to itself without depending on a public hostname. NEXT_PUBLIC_WEBAPP_URL follows
 * publicUrl when set (passkey RP ID / cookie domain).
 */
export function buildDocumensoAppEnv(cfg: {
  baseUrl: string;
  dbUrl: string;
  publicUrl?: string;
}): Record<string, string> {
  const { port } = documensoListen(cfg.baseUrl);
  return {
    NEXTAUTH_SECRET: "secret",
    NEXT_PRIVATE_ENCRYPTION_KEY: "CAFEBABE",
    NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY: "DEADBEEF",
    NEXT_PUBLIC_WEBAPP_URL: cfg.publicUrl ?? cfg.baseUrl,
    NEXT_PRIVATE_INTERNAL_WEBAPP_URL: cfg.baseUrl,
    PORT: port,
    NEXT_PRIVATE_DATABASE_URL: cfg.dbUrl,
    NEXT_PRIVATE_DIRECT_DATABASE_URL: cfg.dbUrl,
    NEXT_PRIVATE_SMTP_TRANSPORT: "smtp-auth",
    NEXT_PRIVATE_SMTP_HOST: "127.0.0.1",
    NEXT_PRIVATE_SMTP_PORT: "2525",
    NEXT_PRIVATE_SMTP_USERNAME: "documenso",
    NEXT_PRIVATE_SMTP_PASSWORD: "password",
    NEXT_PRIVATE_SMTP_FROM_NAME: "Documenso",
    NEXT_PRIVATE_SMTP_FROM_ADDRESS: "noreply@documenso.com",
    NEXT_PUBLIC_UPLOAD_TRANSPORT: "database",
    NEXT_PRIVATE_JOBS_PROVIDER: "local",
  };
}

/** Throws unless the active Node major version is at least Documenso's required 24. */
export function assertDocumensoNodeVersion(version: string): void {
  const major = Number(version.split(".")[0]);
  if (!Number.isInteger(major) || major < DOCUMENSO_NODE_MAJOR) {
    throw new Error(
      `Documenso needs Node ${DOCUMENSO_NODE_MAJOR} or newer; active Node is v${version}. Run nvm use ${DOCUMENSO_NODE_MAJOR} for Documenso commands, then retry.`,
    );
  }
}

export type DocumensoProbeVerdict = "healthy" | "unhealthy" | "environment";

/**
 * healthy: 127.0.0.1 answers 200 on both routes.
 * environment: 127.0.0.1 fails but localhost answers. Blocking, never a pass.
 * unhealthy: neither answers.
 */
export function classifyDocumensoProbe(strictOk: boolean, localhostOk: boolean): DocumensoProbeVerdict {
  if (strictOk) return "healthy";
  return localhostOk ? "environment" : "unhealthy";
}

/** PIDs of LISTENING sockets on `port`, from `netstat -ano` output. Diagnostic only. */
export function parseNetstatListeningPids(netstatOutput: string, port: string): number[] {
  const pids = new Set<number>();
  for (const line of netstatOutput.split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue;
    const columns = line.trim().split(/\s+/);
    const localAddress = columns[1] ?? "";
    if (!localAddress.endsWith(`:${port}`)) continue;
    const pid = Number(columns[columns.length - 1]);
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

/** Executable name from `tasklist /FI "PID eq n" /NH` output. Diagnostic only. */
export function parseTasklistImageName(tasklistOutput: string): string | undefined {
  return tasklistOutput.match(/^\s*(\S+)\s+\d+\s/m)?.[1];
}
