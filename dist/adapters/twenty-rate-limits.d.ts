/**
 * The Twenty rate-limit variables the harness forwards to the Twenty server and worker.
 *
 * This is an exact-name allowlist. APPLICATION_API_RATE_LIMITING_* does not match the API_RATE_LIMITING_* prefix,
 * so those two names are listed by name. Nothing else is read from the caller's environment.
 */
export declare const TWENTY_RATE_LIMIT_ENV: readonly ["API_RATE_LIMITING_SHORT_TTL_IN_MS", "API_RATE_LIMITING_SHORT_LIMIT", "API_RATE_LIMITING_LONG_TTL_IN_MS", "API_RATE_LIMITING_LONG_LIMIT", "APPLICATION_API_RATE_LIMITING_TTL_IN_MS", "APPLICATION_API_RATE_LIMITING_LIMIT"];
export type TwentyRateLimitEnvName = (typeof TWENTY_RATE_LIMIT_ENV)[number];
/** Returns only the allowlisted names that the caller set to a non-blank value. Blank or whitespace = unset, and the key is
 *  never written for it (Twenty's CastToPositiveNumber turns "" into 0, so an empty key would set the limit to 0).
 *  Throws TWENTY_RATE_LIMIT_NOT_INTEGER for any non-blank value that is not a whole number of at least 1. */
export declare function readTwentyRateLimitEnv(env: NodeJS.ProcessEnv): Partial<Record<TwentyRateLimitEnvName, string>>;
//# sourceMappingURL=twenty-rate-limits.d.ts.map