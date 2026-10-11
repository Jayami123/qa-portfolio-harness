/** Pure Documenso helpers. No I/O, so unit tests run without Docker or the app. */

export const DOCUMENSO_NODE_MAJOR = 24;
export const DOCUMENSO_DEFAULT_PORT = "3001";

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

/**
 * Local-only values for the app process and migrate/seed commands. These are the stock
 * `.env.example` placeholders from the fork, not secrets. The harness values win over the
 * product `.env` because dotenv does not override variables already set in the environment.
 */
export function buildDocumensoAppEnv(cfg: { baseUrl: string; dbUrl: string }): Record<string, string> {
  const { port } = documensoListen(cfg.baseUrl);
  return {
    NEXTAUTH_SECRET: "secret",
    NEXT_PRIVATE_ENCRYPTION_KEY: "CAFEBABE",
    NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY: "DEADBEEF",
    NEXT_PUBLIC_WEBAPP_URL: cfg.baseUrl,
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
