/** Medusa helpers. Parsers and env rendering are pure (no I/O). File existence is injected so tests stay offline. */
/** DTC starter `package.json` `engines.node`. */
export declare const MEDUSA_MIN_NODE = "22.22.0";
/** DTC starter `packageManager`. */
export declare const MEDUSA_MIN_PNPM = "10.11.1";
export declare const MEDUSA_DEFAULT_PORT = "9000";
export type MedusaHttpMode = "production" | "develop";
/**
 * production: `pnpm medusa build` then `pnpm medusa start`.
 * develop: `pnpm medusa develop`.
 * Task 2 sets this from the cold build + start measurement (production when that total is under 10 minutes).
 */
export declare const MEDUSA_HTTP_MODE: MedusaHttpMode;
/**
 * Packages whose install scripts `medusa build` / `medusa start` actually need.
 * Empty means the ignored-build install is enough. Do not list packages "just in case".
 */
export declare const MEDUSA_REBUILD_PACKAGES: readonly string[];
/** Default harness Redis URL when `MEDUSA_REDIS=1`. */
export declare const MEDUSA_DEFAULT_REDIS_URL = "redis://127.0.0.1:6380";
export declare const MEDUSA_STRIPE_PROVIDER_ID = "pp_stripe_stripe";
export declare const MEDUSA_SEED_PROMO_CODE = "QA10";
export declare const MEDUSA_GERMAN_WAREHOUSE_NAME = "German Warehouse";
export declare const MEDUSA_SEED_COLLECTION_TITLE = "Featured";
export declare const MEDUSA_US_REGION_NAME = "United States";
export declare const MEDUSA_DEFAULT_CUSTOMER_EMAIL = "customer@test.com";
export declare const MEDUSA_DEFAULT_CUSTOMER_PASSWORD = "customer123";
type Semver = readonly [number, number, number];
/** Major.minor.patch. A missing patch is 0. A leading `v` is allowed. */
export declare function parseSemverCore(version: string): Semver | undefined;
export declare function assertMedusaNodeVersion(version: string): void;
export declare function assertMedusaPnpmVersion(version: string): void;
export interface MedusaListen {
    host: string;
    port: string;
}
/**
 * Only 127.0.0.1 is accepted. localhost can resolve to ::1 on Windows and hide an IPv4-only bind.
 */
export declare function medusaListen(baseUrl: string): MedusaListen;
/**
 * The optional second backend (`MEDUSA_SECOND_BASE_URL`) gets its own listen port, so it must
 * be a valid 127.0.0.1 URL and must not share a port with the primary backend.
 */
export declare function assertMedusaSecondBaseUrl(primaryBaseUrl: string, secondBaseUrl: string): void;
export declare function medusaHealthUrl(baseUrl: string): string;
/** HTTP 200 only. 201, redirects, and 5xx are not healthy. */
export declare function isMedusaHealthyStatus(statusCode: number): boolean;
export type MedusaProbeVerdict = "healthy" | "unhealthy" | "environment";
/**
 * healthy: 127.0.0.1 returned 200.
 * environment: 127.0.0.1 failed and localhost returned 200. Blocking, never a pass.
 * unhealthy: neither returned 200.
 */
export declare function classifyMedusaProbe(strictOk: boolean, localhostOk: boolean): MedusaProbeVerdict;
/** `memory` keeps Medusa's in-process locks. `redis` adds the Redis locking provider (needs MEDUSA_REDIS=1). */
export type MedusaLockProvider = "memory" | "redis";
export interface MedusaHarnessSwitches {
    readonly redis: boolean;
    readonly stripe: boolean;
    /** Absent in hand-built switches; treated as `memory`. */
    readonly lock?: MedusaLockProvider;
    /** Absent in hand-built switches; treated as off. Needs `redis`. Set by MEDUSA_FF_CACHING=true. */
    readonly caching?: boolean;
}
export declare function parseMedusaHarnessSwitches(env: Record<string, string | undefined>): MedusaHarnessSwitches;
export declare function medusaComposeFileNames(switches: MedusaHarnessSwitches): readonly string[];
export declare const MEDUSA_FF_RBAC_VALUES: readonly ["true", "false"];
/** Undefined when unset or blank. Throws MEDUSA_FF_RBAC_INVALID for any value other than exactly "true" or "false". */
export declare function readMedusaFfRbac(env: Record<string, string | undefined>): "true" | "false" | undefined;
export interface MedusaBackendEnvInput {
    databaseUrl: string;
    /** Set when `MEDUSA_REDIS=1`. */
    redisUrl?: string;
    stripeApiKey?: string;
    stripeWebhookSecret?: string;
    /** Written only when defined. Unset leaves the template line as it is. */
    ffRbac?: "true" | "false";
}
export declare function buildMedusaBackendEnvFile(template: string, input: MedusaBackendEnvInput): string;
export interface MedusaStorefrontEnvInput {
    backendUrl: string;
    publishableKey: string;
    stripePublishableKey?: string;
}
export declare function buildMedusaStorefrontEnvLocal(template: string, input: MedusaStorefrontEnvInput): string;
export declare function shouldEnableStripeOnRegion(switches: MedusaHarnessSwitches, stripeApiKey?: string): boolean;
export declare function medusaBuiltServerConfigPath(backendDir: string): string;
/**
 * Gitignored runtime config written under `apps/backend/.medusa/server` before `medusa start`.
 * Paths match `@medusajs/utils` `TEMPORARY_REDIS_MODULE_PACKAGE_NAMES` for 2.21.2.
 * On an http base URL the session cookie drops `Secure`: `medusa start` forces it in production,
 * and browsers never send a Secure cookie over http, so admin login could not hold a session.
 */
export declare function renderServerMedusaConfigJs(switches: MedusaHarnessSwitches, baseUrl: string): string;
/** KEY=VALUE lines. Comments and blanks are skipped. Values are not logged by this function. */
export declare function parseMedusaEnvFile(text: string): Record<string, string>;
/**
 * Redact a publishable key. The returned string never contains the token.
 * `scripts/lib.mjs` `redactSecret` keeps 8 + 4 characters, which is too much of a `pk_` token.
 * Empty and short inputs return a placeholder and do not throw.
 */
export declare function redactPublishableKey(token: string): string;
/** Strip publishable keys and database URLs from a log tail before it is printed. */
export declare function redactMedusaText(text: string): string;
export declare function medusaBackendConfigPath(productRoot: string): string;
/**
 * Fail when the directory is not the DTC starter. The engine monorepo has no `apps/backend/medusa-config.ts`.
 */
export declare function assertMedusaBackendPresent(productRoot: string, exists?: (filePath: string) => boolean): void;
export declare function medusaBackendStartArgs(mode: MedusaHttpMode): readonly string[];
/** Same filename as Cal `apps/web/.next/harness-build.json`. */
export declare const MEDUSA_HARNESS_BUILD_MARKER = "harness-build.json";
export declare function medusaBuiltServerDir(backendDir: string): string;
export declare function medusaBuiltServerPackagePath(backendDir: string): string;
export declare function medusaHarnessBuildMarkerPath(backendDir: string): string;
export interface MedusaHarnessBuildRecord {
    readonly gitSha: string;
}
/**
 * `medusa build` forces NODE_ENV=development unless the caller sets it, which ships a
 * development admin bundle (error boundary "Error Details (Development Mode)").
 */
export declare const MEDUSA_BUILD_NODE_ENV = "production";
export interface MedusaBackendBuildRecord extends MedusaHarnessBuildRecord {
    /** NODE_ENV the build ran with; a missing or different value forces a rebuild. */
    readonly mode: string;
}
export declare function serializeMedusaHarnessBuildRecord(gitSha: string): string;
export declare function parseMedusaHarnessBuildMode(fileText: string): string | undefined;
export declare function medusaPublishableKeyFingerprint(publishableKey: string): string;
export interface MedusaStorefrontBuildRecord extends MedusaHarnessBuildRecord {
    readonly publishableKeyFingerprint: string;
    /** e.g. collections:1 — rebuild when harness seed adds collections on a fresh DB. */
    readonly storeDataFingerprint: string;
}
export declare function serializeMedusaStorefrontBuildRecord(gitSha: string, publishableKey: string, storeDataFingerprint: string): string;
export declare function parseMedusaStorefrontBuildRecord(fileText: string): MedusaStorefrontBuildRecord | undefined;
export declare function parseMedusaHarnessBuildGitSha(fileText: string): string | undefined;
export type MedusaBuildSkipReason = "skip_develop_mode" | "skip_matches_head" | "rebuild_forced" | "rebuild_missing_output" | "rebuild_missing_marker" | "rebuild_bad_marker" | "rebuild_mode_mismatch" | "rebuild_head_unknown" | "rebuild_sha_mismatch" | "rebuild_publishable_key_mismatch";
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
export declare function decideMedusaBuildSkip(input: MedusaBuildSkipInput): MedusaBuildSkipDecision;
export interface MedusaStorefrontBuildSkipInput {
    readonly forceRebuild: boolean;
    readonly nextBuildOutputExists: boolean;
    /** `undefined` when the marker file is absent. */
    readonly markerFileText: string | undefined;
    readonly headGitSha: string | undefined;
    readonly publishableKey: string;
    readonly storeDataFingerprint: string;
}
export declare function decideMedusaStorefrontBuildSkip(input: MedusaStorefrontBuildSkipInput): MedusaBuildSkipDecision;
export {};
//# sourceMappingURL=medusa-env.d.ts.map