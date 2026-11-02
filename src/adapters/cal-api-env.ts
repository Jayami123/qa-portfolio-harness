import { randomBytes } from "node:crypto";

/**
 * The env keys Cal API v2 reads with no fallback at startup (a missing one throws, see the fork's src/env.ts getEnv),
 * and how the harness supplies each one. Source lines are in the fork at c2b7ac44c66f24ffef1662b276f0653988a609a3.
 *
 * - `shared`: the web app's value, read from the product root .env (or DATABASE_URL for the two DB URLs).
 * - `generated`: a test-only secret the harness creates per run with crypto.randomBytes. Never written to disk.
 * - `external`: a real third-party credential. Never generated and never faked: a missing one is a STOP.
 * - `infra`: the harness's own local service address. Not a secret.
 */
export const CAL_API_NO_FALLBACK_KEYS = [
  { key: "DATABASE_READ_URL", class: "shared", source: "apps/api/v2/src/config/app.ts:26" },
  { key: "DATABASE_WRITE_URL", class: "shared", source: "apps/api/v2/src/config/app.ts:27" },
  { key: "REDIS_URL", class: "infra", source: "apps/api/v2/src/config/app.ts:32" },
  { key: "NEXTAUTH_SECRET", class: "shared", source: "apps/api/v2/src/config/app.ts:36" },
  { key: "CALENDSO_ENCRYPTION_KEY", class: "shared", source: "apps/api/v2/src/modules/tokens/tokens.service.ts:33" },
  { key: "STRIPE_API_KEY", class: "external", source: "apps/api/v2/src/config/app.ts:39" },
  { key: "STRIPE_WEBHOOK_SECRET", class: "external", source: "apps/api/v2/src/config/app.ts:40" },
  { key: "JWT_SECRET", class: "generated", source: "apps/api/v2/src/modules/jwt/jwt.module.ts:8" },
  { key: "NODE_ENV", class: "infra", source: "apps/api/v2/src/swagger/generate-swagger.ts:32" },
] as const;

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
export function generateTestSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * The spawn env for Cal API v2: every no-fallback key, plus the port and Redis URL. Throws, naming the key only, when an
 * external credential is missing (a STOP: the harness does not invent one).
 */
export function buildCalApiEnv(input: CalApiEnvInput): Record<string, string> {
  const randomSecret = input.randomSecret ?? generateTestSecret;
  const env: Record<string, string> = {
    API_PORT: String(input.apiPort),
    REDIS_URL: input.redisUrl,
    // Read with no fallback by the swagger path (generate-swagger.ts:32). Production matches the web start.
    NODE_ENV: "production",
  };
  const missing: string[] = [];
  for (const { key, class: cls } of CAL_API_NO_FALLBACK_KEYS) {
    if (cls === "infra") {
      continue;
    }
    if (cls === "generated") {
      env[key] = randomSecret();
      continue;
    }
    if (cls === "external") {
      const value = input.processEnv[key] ?? input.rootEnv[key];
      if (value === undefined) {
        missing.push(key);
      } else {
        env[key] = value;
      }
      continue;
    }
    // shared: the web's value; the DB URLs fall back to the web's DATABASE_URL
    const fromRoot = key === "DATABASE_READ_URL" || key === "DATABASE_WRITE_URL" ? input.rootEnv.DATABASE_URL : input.rootEnv[key];
    const value = input.rootEnv[key] ?? fromRoot;
    if (value === undefined) {
      missing.push(key);
    } else {
      env[key] = value;
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Cal API v2 needs ${missing.join(", ")}: these are real credentials or shared web values the harness will not invent. ` +
        `Set them in the environment of up, or in the Cal product .env. Names only; no value is printed.`,
    );
  }
  env.DATABASE_URL = input.dbUrl;
  return env;
}

/** Keys whose values are safe to print: the port, the local Redis address, and the mode. Everything else is redacted. */
const PRINTABLE_ENV_KEYS = new Set(["API_PORT", "REDIS_URL", "NODE_ENV"]);

/** A log-safe view of the env. Secrets and connection strings (shared, generated, external) are never printed. */
export function describeCalApiEnv(env: Readonly<Record<string, string>>): string {
  return Object.keys(env)
    .map((key) => `${key}=${PRINTABLE_ENV_KEYS.has(key) ? env[key] : "<redacted>"}`)
    .join(" ");
}
