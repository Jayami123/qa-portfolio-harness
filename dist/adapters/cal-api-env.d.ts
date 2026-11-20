/**
 * The env keys Cal API v2 reads with no fallback at startup (a missing one throws, see the fork's src/env.ts getEnv),
 * and how the harness supplies each one. Source lines are in the fork at c2b7ac44c66f24ffef1662b276f0653988a609a3.
 *
 * - `shared`: the web app's value, read from the product root .env (or DATABASE_URL for the two DB URLs).
 * - `generated`: a test-only secret the harness creates per run with crypto.randomBytes. Never written to disk.
 * - `external`: a real third-party credential. Never generated and never faked: a missing one is a STOP.
 * - `infra`: the harness's own local service address. Not a secret.
 */
export declare const CAL_API_NO_FALLBACK_KEYS: readonly [{
    readonly key: "DATABASE_READ_URL";
    readonly class: "shared";
    readonly source: "apps/api/v2/src/config/app.ts:26";
}, {
    readonly key: "DATABASE_WRITE_URL";
    readonly class: "shared";
    readonly source: "apps/api/v2/src/config/app.ts:27";
}, {
    readonly key: "REDIS_URL";
    readonly class: "infra";
    readonly source: "apps/api/v2/src/config/app.ts:32";
}, {
    readonly key: "NEXTAUTH_SECRET";
    readonly class: "shared";
    readonly source: "apps/api/v2/src/config/app.ts:36";
}, {
    readonly key: "CALENDSO_ENCRYPTION_KEY";
    readonly class: "shared";
    readonly source: "apps/api/v2/src/modules/tokens/tokens.service.ts:33";
}, {
    readonly key: "STRIPE_API_KEY";
    readonly class: "external";
    readonly source: "apps/api/v2/src/config/app.ts:39";
}, {
    readonly key: "STRIPE_WEBHOOK_SECRET";
    readonly class: "external";
    readonly source: "apps/api/v2/src/config/app.ts:40";
}, {
    readonly key: "JWT_SECRET";
    readonly class: "generated";
    readonly source: "apps/api/v2/src/modules/jwt/jwt.module.ts:8";
}, {
    readonly key: "NODE_ENV";
    readonly class: "infra";
    readonly source: "apps/api/v2/src/swagger/generate-swagger.ts:32";
}];
export type CalApiEnvKey = (typeof CAL_API_NO_FALLBACK_KEYS)[number]["key"];
export interface CalApiEnvInput {
    /** The product root .env, parsed in memory. */
    readonly rootEnv: Readonly<Record<string, string | undefined>>;
    /** The harness process env. Used for an external key the root .env does not provide. */
    readonly processEnv: NodeJS.ProcessEnv;
    /** The harness Cal database URL (CAL_DB_URL). Passed as DATABASE_URL: the API's Prisma client reads it, and never logged. */
    readonly dbUrl: string;
    /** The API's listen port and the harness Redis URL. */
    readonly apiPort: number;
    readonly redisUrl: string;
    /** Source of test-only secrets. Injected so the tests can check that values differ between runs. */
    readonly randomSecret?: () => string;
}
/** A generated secret: 32 random bytes, hex. Used only in the spawn env of the API process. */
export declare function generateTestSecret(): string;
/**
 * The spawn env for Cal API v2: every no-fallback key, plus the port and Redis URL. Throws, naming the key only, when an
 * external credential is missing (a STOP: the harness does not invent one).
 */
export declare function buildCalApiEnv(input: CalApiEnvInput): Record<string, string>;
/**
 * The rate-limit keys the harness forwards from its own process env, only when set (fork: apps/api/v2/src/lib/throttler-guard.ts:34-36
 * and apps/api/v2/src/env.ts:25-26; the fork falls back to 120 requests and 60000 ms). A blank value counts as unset.
 * The harness never sets a default: unset means the fork's own default applies.
 */
export declare const CAL_RATE_LIMIT_KEYS: readonly ["RATE_LIMIT_DEFAULT_LIMIT_API_KEY", "RATE_LIMIT_DEFAULT_TTL_MS"];
/**
 * The effective API-key limit the Cal API v2 process is started with: the forwarded RATE_LIMIT_DEFAULT_LIMIT_API_KEY, as a number.
 * Reads the same env the spawn env is built from. Throws by name when unset, so the fork's 120 is never reported as effective
 * without the harness having set it.
 */
export declare function calApiKeyRateLimit(processEnv?: NodeJS.ProcessEnv): number;
/** A log-safe view of the env. Secrets and connection strings (shared, generated, external) are never printed. */
export declare function describeCalApiEnv(env: Readonly<Record<string, string>>): string;
//# sourceMappingURL=cal-api-env.d.ts.map