/**
 * The Twenty rate-limit variables the harness forwards to the Twenty server and worker.
 *
 * This is an exact-name allowlist. APPLICATION_API_RATE_LIMITING_* does not match the API_RATE_LIMITING_* prefix,
 * so those two names are listed by name. Nothing else is read from the caller's environment.
 */
export const TWENTY_RATE_LIMIT_ENV = [
  "API_RATE_LIMITING_SHORT_TTL_IN_MS",
  "API_RATE_LIMITING_SHORT_LIMIT",
  "API_RATE_LIMITING_LONG_TTL_IN_MS",
  "API_RATE_LIMITING_LONG_LIMIT",
  "APPLICATION_API_RATE_LIMITING_TTL_IN_MS",
  "APPLICATION_API_RATE_LIMITING_LIMIT",
] as const;

export type TwentyRateLimitEnvName = (typeof TWENTY_RATE_LIMIT_ENV)[number];

const WHOLE_NUMBER_AT_LEAST_ONE = /^[1-9][0-9]*$/;

function assertWholeLimit(name: TwentyRateLimitEnvName, raw: string): void {
  if (!WHOLE_NUMBER_AT_LEAST_ONE.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new Error(
      `TWENTY_RATE_LIMIT_NOT_INTEGER: ${name} must be a whole number of at least 1 (got "${raw}"). Unset it to keep the image default.`,
    );
  }
}

/** Returns only the allowlisted names that the caller set to a non-blank value. Blank or whitespace = unset, and the key is
 *  never written for it (Twenty's CastToPositiveNumber turns "" into 0, so an empty key would set the limit to 0).
 *  Throws TWENTY_RATE_LIMIT_NOT_INTEGER for any non-blank value that is not a whole number of at least 1. */
export function readTwentyRateLimitEnv(
  env: NodeJS.ProcessEnv,
): Partial<Record<TwentyRateLimitEnvName, string>> {
  const values: Partial<Record<TwentyRateLimitEnvName, string>> = {};
  for (const name of TWENTY_RATE_LIMIT_ENV) {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") {
      continue;
    }
    assertWholeLimit(name, raw);
    values[name] = raw;
  }
  return values;
}

/** YAML for server and worker with the same keys, or undefined when there are no keys. Values are digits only. */
export function twentyRateLimitComposeYaml(
  values: Partial<Record<TwentyRateLimitEnvName, string>>,
): string | undefined {
  const names = TWENTY_RATE_LIMIT_ENV.filter((name) => values[name] !== undefined);
  if (names.length === 0) {
    return undefined;
  }
  const lines = ["services:"];
  for (const service of ["server", "worker"]) {
    lines.push(`  ${service}:`, "    environment:");
    for (const name of names) {
      const value = values[name] as string;
      assertWholeLimit(name, value);
      lines.push(`      ${name}: "${value}"`);
    }
  }
  return `${lines.join("\n")}\n`;
}
