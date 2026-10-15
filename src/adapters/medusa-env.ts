/** Medusa helpers. Parsers and env rendering are pure (no I/O). File existence is injected so tests stay offline. */

import { createHash } from "node:crypto";
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

/** Default harness Redis URL when `MEDUSA_REDIS=1`. */
export const MEDUSA_DEFAULT_REDIS_URL = "redis://127.0.0.1:6380";

export const MEDUSA_STRIPE_PROVIDER_ID = "pp_stripe_stripe";

export const MEDUSA_SEED_PROMO_CODE = "QA10";
export const MEDUSA_GERMAN_WAREHOUSE_NAME = "German Warehouse";
export const MEDUSA_SEED_COLLECTION_TITLE = "Featured";
export const MEDUSA_US_REGION_NAME = "United States";
export const MEDUSA_DEFAULT_CUSTOMER_EMAIL = "customer@test.com";
export const MEDUSA_DEFAULT_CUSTOMER_PASSWORD = "customer123";

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

export interface MedusaHarnessSwitches {
  readonly redis: boolean;
  readonly stripe: boolean;
}

export function parseMedusaHarnessSwitches(env: Record<string, string | undefined>): MedusaHarnessSwitches {
  return {
    redis: env.MEDUSA_REDIS === "1",
    stripe: env.MEDUSA_STRIPE === "1",
  };
}

export function medusaComposeFileNames(switches: MedusaHarnessSwitches): readonly string[] {
  const files = ["medusa.compose.yml"];
  if (switches.redis) {
    files.push("medusa.redis.compose.yml");
  }
  return files;
}

export interface MedusaBackendEnvInput {
  databaseUrl: string;
  /** Set when `MEDUSA_REDIS=1`. */
  redisUrl?: string;
  stripeApiKey?: string;
  stripeWebhookSecret?: string;
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * Copy the backend template and set DATABASE_URL.
 * REDIS_URL is written only when `redisUrl` is passed. Otherwise that line is dropped.
 */
function upsertEnvLine(lines: string[], key: string, value: string | undefined): void {
  const prefix = `${key}=`;
  let saw = false;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.startsWith(prefix)) {
      saw = true;
      if (value !== undefined) {
        lines[index] = `${prefix}${value}`;
      } else {
        lines.splice(index, 1);
      }
      return;
    }
  }
  if (value !== undefined && !saw) {
    lines.push(`${prefix}${value}`);
  }
}

export function buildMedusaBackendEnvFile(template: string, input: MedusaBackendEnvInput): string {
  const lines = splitLines(template);
  upsertEnvLine(lines, "DATABASE_URL", input.databaseUrl);
  upsertEnvLine(lines, "REDIS_URL", input.redisUrl);
  upsertEnvLine(lines, "STRIPE_API_KEY", input.stripeApiKey);
  upsertEnvLine(lines, "STRIPE_WEBHOOK_SECRET", input.stripeWebhookSecret);
  const body = lines.join("\n");
  return body.endsWith("\n") ? body : `${body}\n`;
}

export interface MedusaStorefrontEnvInput {
  backendUrl: string;
  publishableKey: string;
  stripePublishableKey?: string;
}

export function buildMedusaStorefrontEnvLocal(template: string, input: MedusaStorefrontEnvInput): string {
  const lines = splitLines(template);
  upsertEnvLine(lines, "NEXT_PUBLIC_MEDUSA_BACKEND_URL", input.backendUrl);
  upsertEnvLine(lines, "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY", input.publishableKey);
  upsertEnvLine(lines, "NEXT_PUBLIC_STRIPE_KEY", input.stripePublishableKey);
  const body = lines.join("\n");
  return body.endsWith("\n") ? body : `${body}\n`;
}

export function shouldEnableStripeOnRegion(switches: MedusaHarnessSwitches, stripeApiKey?: string): boolean {
  return switches.stripe && stripeApiKey !== undefined && stripeApiKey.trim() !== "";
}

export function medusaBuiltServerConfigPath(backendDir: string): string {
  return path.join(medusaBuiltServerDir(backendDir), "medusa-config.js");
}

/**
 * Gitignored runtime config written under `apps/backend/.medusa/server` before `medusa start`.
 * Paths match `@medusajs/utils` `TEMPORARY_REDIS_MODULE_PACKAGE_NAMES` for 2.21.2.
 */
export function renderServerMedusaConfigJs(switches: MedusaHarnessSwitches): string {
  const modules: string[] = [];
  if (switches.redis) {
    modules.push(
      `    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: {
        redisUrl: process.env.REDIS_URL,
        workerOptions: { concurrency: 1 },
      },
    }`,
      `    {
      resolve: "@medusajs/medusa/cache-redis",
      options: { redisUrl: process.env.REDIS_URL },
    }`,
      `    {
      resolve: "@medusajs/medusa/workflow-engine-redis",
      options: { redis: { url: process.env.REDIS_URL } },
    }`,
    );
  }
  if (switches.stripe) {
    modules.push(
      `    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/payment-stripe",
            id: "stripe",
            options: {
              apiKey: process.env.STRIPE_API_KEY,
              webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
            },
          },
        ],
      },
    }`,
    );
  }
  const redisUrlLine = switches.redis ? "    redisUrl: process.env.REDIS_URL,\n" : "";
  const modulesBlock =
    modules.length === 0
      ? ""
      : `,
  modules: [
${modules.join(",\n")},
  ]`;
  return `"use strict";
const utils = require("@medusajs/framework/utils");
utils.loadEnv(process.env.NODE_ENV || "development", process.cwd());
module.exports = utils.defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
${redisUrlLine}    http: {
      storeCors: process.env.STORE_CORS,
      adminCors: process.env.ADMIN_CORS,
      authCors: process.env.AUTH_CORS,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    },
  }${modulesBlock},
});
`;
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

/** Same filename as Cal `apps/web/.next/harness-build.json`. */
export const MEDUSA_HARNESS_BUILD_MARKER = "harness-build.json";

export function medusaBuiltServerDir(backendDir: string): string {
  return path.join(backendDir, ".medusa", "server");
}

export function medusaBuiltServerPackagePath(backendDir: string): string {
  return path.join(medusaBuiltServerDir(backendDir), "package.json");
}

export function medusaHarnessBuildMarkerPath(backendDir: string): string {
  return path.join(medusaBuiltServerDir(backendDir), MEDUSA_HARNESS_BUILD_MARKER);
}

export interface MedusaHarnessBuildRecord {
  readonly gitSha: string;
}

export function serializeMedusaHarnessBuildRecord(gitSha: string): string {
  const record: MedusaHarnessBuildRecord = { gitSha };
  return `${JSON.stringify(record)}\n`;
}

export function medusaPublishableKeyFingerprint(publishableKey: string): string {
  const normalized = publishableKey.trim();
  if (normalized === "") {
    return "";
  }
  return createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 16);
}

export interface MedusaStorefrontBuildRecord extends MedusaHarnessBuildRecord {
  readonly publishableKeyFingerprint: string;
  /** e.g. collections:1 — rebuild when harness seed adds collections on a fresh DB. */
  readonly storeDataFingerprint: string;
}

export function serializeMedusaStorefrontBuildRecord(
  gitSha: string,
  publishableKey: string,
  storeDataFingerprint: string,
): string {
  const record: MedusaStorefrontBuildRecord = {
    gitSha,
    publishableKeyFingerprint: medusaPublishableKeyFingerprint(publishableKey),
    storeDataFingerprint,
  };
  return `${JSON.stringify(record)}\n`;
}

export function parseMedusaStorefrontBuildRecord(fileText: string): MedusaStorefrontBuildRecord | undefined {
  try {
    const parsed = JSON.parse(fileText) as MedusaStorefrontBuildRecord;
    if (typeof parsed.gitSha !== "string" || parsed.gitSha.trim() === "") {
      return undefined;
    }
    if (
      typeof parsed.publishableKeyFingerprint !== "string" ||
      parsed.publishableKeyFingerprint.trim() === ""
    ) {
      return undefined;
    }
    if (
      typeof parsed.storeDataFingerprint !== "string" ||
      parsed.storeDataFingerprint.trim() === ""
    ) {
      return undefined;
    }
    return {
      gitSha: parsed.gitSha.trim(),
      publishableKeyFingerprint: parsed.publishableKeyFingerprint.trim(),
      storeDataFingerprint: parsed.storeDataFingerprint.trim(),
    };
  } catch {
    return undefined;
  }
}

export function parseMedusaHarnessBuildGitSha(fileText: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(fileText);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "gitSha" in parsed &&
      typeof parsed.gitSha === "string" &&
      parsed.gitSha.trim().length > 0
    ) {
      return parsed.gitSha.trim();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export type MedusaBuildSkipReason =
  | "skip_develop_mode"
  | "skip_matches_head"
  | "rebuild_forced"
  | "rebuild_missing_output"
  | "rebuild_missing_marker"
  | "rebuild_bad_marker"
  | "rebuild_head_unknown"
  | "rebuild_sha_mismatch"
  | "rebuild_publishable_key_mismatch";

export interface MedusaBuildSkipInput {
  readonly httpMode: MedusaHttpMode;
  readonly forceRebuild: boolean;
  readonly builtServerPackageExists: boolean;
  /** `undefined` when the marker file is absent. */
  readonly markerFileText: string | undefined;
  readonly headGitSha: string | undefined;
}

export interface MedusaBuildSkipDecision {
  readonly skip: boolean;
  readonly reason: MedusaBuildSkipReason;
}

export function decideMedusaBuildSkip(input: MedusaBuildSkipInput): MedusaBuildSkipDecision {
  if (input.httpMode !== "production") {
    return { skip: true, reason: "skip_develop_mode" };
  }
  if (input.forceRebuild) {
    return { skip: false, reason: "rebuild_forced" };
  }
  if (!input.builtServerPackageExists) {
    return { skip: false, reason: "rebuild_missing_output" };
  }
  if (input.markerFileText === undefined) {
    return { skip: false, reason: "rebuild_missing_marker" };
  }
  const recorded = parseMedusaHarnessBuildGitSha(input.markerFileText);
  if (recorded === undefined) {
    return { skip: false, reason: "rebuild_bad_marker" };
  }
  const current = input.headGitSha;
  if (current === undefined) {
    return { skip: false, reason: "rebuild_head_unknown" };
  }
  if (recorded !== current) {
    return { skip: false, reason: "rebuild_sha_mismatch" };
  }
  return { skip: true, reason: "skip_matches_head" };
}

export interface MedusaStorefrontBuildSkipInput {
  readonly forceRebuild: boolean;
  readonly nextBuildOutputExists: boolean;
  /** `undefined` when the marker file is absent. */
  readonly markerFileText: string | undefined;
  readonly headGitSha: string | undefined;
  readonly publishableKey: string;
  readonly storeDataFingerprint: string;
}

export function decideMedusaStorefrontBuildSkip(
  input: MedusaStorefrontBuildSkipInput,
): MedusaBuildSkipDecision {
  if (input.forceRebuild) {
    return { skip: false, reason: "rebuild_forced" };
  }
  if (!input.nextBuildOutputExists) {
    return { skip: false, reason: "rebuild_missing_output" };
  }
  if (input.markerFileText === undefined) {
    return { skip: false, reason: "rebuild_missing_marker" };
  }
  const recorded = parseMedusaStorefrontBuildRecord(input.markerFileText);
  if (recorded === undefined) {
    return { skip: false, reason: "rebuild_bad_marker" };
  }
  const current = input.headGitSha;
  if (current === undefined) {
    return { skip: false, reason: "rebuild_head_unknown" };
  }
  if (recorded.gitSha !== current) {
    return { skip: false, reason: "rebuild_sha_mismatch" };
  }
  const fingerprint = medusaPublishableKeyFingerprint(input.publishableKey);
  if (fingerprint === "" || recorded.publishableKeyFingerprint !== fingerprint) {
    return { skip: false, reason: "rebuild_publishable_key_mismatch" };
  }
  if (recorded.storeDataFingerprint !== input.storeDataFingerprint) {
    return { skip: false, reason: "rebuild_sha_mismatch" };
  }
  return { skip: true, reason: "skip_matches_head" };
}
