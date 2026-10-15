/** Medusa helpers. Parsers and env rendering are pure (no I/O). File existence is injected so tests stay offline. */

import fs from "node:fs";
import path from "node:path";

/** DTC starter `package.json` `engines.node`. */
export const MEDUSA_MIN_NODE = "22.22.0";
/** DTC starter `packageManager`. */
export const MEDUSA_MIN_PNPM = "10.11.1";
export const MEDUSA_DEFAULT_PORT = "9000";

export type MedusaHttpMode = "production" | "develop";

/**
 * production: `pnpm medusa build` then `pnpm medusa start`.
 * develop: `pnpm medusa develop`.
 * Task 2 sets this from the cold build + start measurement (production when that total is under 10 minutes).
 */
export const MEDUSA_HTTP_MODE: MedusaHttpMode = "production";

/**
 * Packages whose install scripts `medusa build` / `medusa start` actually need.
 * Empty means the ignored-build install is enough. Do not list packages "just in case".
 */
export const MEDUSA_REBUILD_PACKAGES: readonly string[] = [];

/**
 * False: `REDIS_URL` does not become `projectConfig.redisUrl`. The harness compose does not start Redis.
 * Confirmed against `@medusajs/framework` 2.21.2 and a `medusa start` log (see the plan and ADR 0001).
 */
export const MEDUSA_REDIS_WIRED = false;

type Semver = readonly [number, number, number];

/** Major.minor.patch. A missing patch is 0. A leading `v` is allowed. */
export function parseSemverCore(version: string): Semver | undefined {
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(version.trim());
  if (match === null) {
    return undefined;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = match[3] === undefined ? 0 : Number(match[3]);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) {
    return undefined;
  }
  return [major, minor, patch];
}

function isAtLeast(version: string, minimum: string): boolean {
  const actual = parseSemverCore(version);
  const floor = parseSemverCore(minimum);
  if (actual === undefined || floor === undefined) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    const left = actual[index] ?? 0;
    const right = floor[index] ?? 0;
    if (left > right) {
      return true;
    }
    if (left < right) {
      return false;
    }
  }
  return true;
}

export function assertMedusaNodeVersion(version: string): void {
  if (!isAtLeast(version, MEDUSA_MIN_NODE)) {
    throw new Error(`Medusa needs Node ${MEDUSA_MIN_NODE} or newer; active Node is v${version}.`);
  }
}

export function assertMedusaPnpmVersion(version: string): void {
  if (!isAtLeast(version, MEDUSA_MIN_PNPM)) {
    throw new Error(
      `Medusa needs pnpm ${MEDUSA_MIN_PNPM} or newer (DTC starter packageManager); active pnpm is ${version}.`,
    );
  }
}

export interface MedusaListen {
  host: string;
  port: string;
}

/**
 * Only 127.0.0.1 is accepted. localhost can resolve to ::1 on Windows and hide an IPv4-only bind.
 */
export function medusaListen(baseUrl: string): MedusaListen {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`MEDUSA_BASE_URL must be an http URL on 127.0.0.1 (got ${baseUrl}).`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`MEDUSA_BASE_URL must use http or https (got ${parsed.protocol}).`);
  }
  if (parsed.hostname !== "127.0.0.1") {
    throw new Error(
      `MEDUSA_BASE_URL must use 127.0.0.1 (got ${parsed.hostname}). localhost can hide an IPv6-only bind, so the harness does not accept it.`,
    );
  }
  return { host: parsed.hostname, port: parsed.port || MEDUSA_DEFAULT_PORT };
}

export function medusaHealthUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  const { host, port } = medusaListen(baseUrl);
  return `${parsed.protocol}//${host}:${port}/health`;
}

/** HTTP 200 only. 201, redirects, and 5xx are not healthy. */
export function isMedusaHealthyStatus(statusCode: number): boolean {
  return statusCode === 200;
}

export type MedusaProbeVerdict = "healthy" | "unhealthy" | "environment";

/**
 * healthy: 127.0.0.1 returned 200.
 * environment: 127.0.0.1 failed and localhost returned 200. Blocking, never a pass.
 * unhealthy: neither returned 200.
 */
export function classifyMedusaProbe(strictOk: boolean, localhostOk: boolean): MedusaProbeVerdict {
  if (strictOk) {
    return "healthy";
  }
  return localhostOk ? "environment" : "unhealthy";
}

export interface MedusaBackendEnvInput {
  databaseUrl: string;
  /** Set only when Medusa actually reads Redis from the environment. */
  redisUrl?: string;
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * Copy the backend template and set DATABASE_URL.
 * REDIS_URL is written only when `redisUrl` is passed. Otherwise that line is dropped.
 */
export function buildMedusaBackendEnvFile(template: string, input: MedusaBackendEnvInput): string {
  let sawDatabase = false;
  let sawRedis = false;
  const lines: string[] = [];
  for (const line of splitLines(template)) {
    if (/^DATABASE_URL=/.test(line)) {
      sawDatabase = true;
      lines.push(`DATABASE_URL=${input.databaseUrl}`);
      continue;
    }
    if (/^REDIS_URL=/.test(line)) {
      sawRedis = true;
      if (input.redisUrl !== undefined) {
        lines.push(`REDIS_URL=${input.redisUrl}`);
      }
      continue;
    }
    lines.push(line);
  }
  if (!sawDatabase) {
    lines.push(`DATABASE_URL=${input.databaseUrl}`);
  }
  if (input.redisUrl !== undefined && !sawRedis) {
    lines.push(`REDIS_URL=${input.redisUrl}`);
  }
  const body = lines.join("\n");
  return body.endsWith("\n") ? body : `${body}\n`;
}

/** KEY=VALUE lines. Comments and blanks are skipped. Values are not logged by this function. */
export function parseMedusaEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of splitLines(text)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (key === "") {
      continue;
    }
    env[key] = trimmed.slice(eq + 1);
  }
  return env;
}

/**
 * Redact a publishable key. The returned string never contains the token.
 * `scripts/lib.mjs` `redactSecret` keeps 8 + 4 characters, which is too much of a `pk_` token.
 * Empty and short inputs return a placeholder and do not throw.
 */
export function redactPublishableKey(token: string): string {
  if (token.trim() === "") {
    return "(empty)";
  }
  return "(redacted)";
}

const PUBLISHABLE_KEY = /\bpk_[A-Za-z0-9_-]+\b/g;
const DATABASE_URL_IN_TEXT = /postgres(?:ql)?:\/\/\S+/gi;

/** Strip publishable keys and database URLs from a log tail before it is printed. */
export function redactMedusaText(text: string): string {
  return text.replace(PUBLISHABLE_KEY, "(redacted)").replace(DATABASE_URL_IN_TEXT, "postgres://(redacted)");
}

export function medusaBackendConfigPath(productRoot: string): string {
  return path.join(productRoot, "apps", "backend", "medusa-config.ts");
}

/**
 * Fail when the directory is not the DTC starter. The engine monorepo has no `apps/backend/medusa-config.ts`.
 */
export function assertMedusaBackendPresent(
  productRoot: string,
  exists: (filePath: string) => boolean = fs.existsSync,
): void {
  const configPath = medusaBackendConfigPath(productRoot);
  if (!exists(configPath)) {
    throw new Error(
      `Medusa backend config not found at ${configPath}. MEDUSA_PRODUCT_DIR must point at medusa-dtc-starter, not the engine monorepo.`,
    );
  }
}

export function medusaBackendStartArgs(mode: MedusaHttpMode): readonly string[] {
  return mode === "production" ? ["medusa", "start"] : ["medusa", "develop"];
}
