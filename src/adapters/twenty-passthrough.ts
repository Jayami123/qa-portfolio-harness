/**
 * Variables the harness forwards by name to the Twenty server and worker. The override file lists only the name
 * (`NAME:` in mapping form), and compose takes the value from the environment of `up`. No value is written to disk.
 *
 * Names confirmed at upstream tag twenty/v2.44.0, twenty-config/config-variables.ts:106 (OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS),
 * :945 (IS_BILLING_ENABLED), :1035 (BILLING_STRIPE_API_KEY), :1044 (BILLING_STRIPE_WEBHOOK_SECRET), :1053 (BILLING_STRIPE_PUBLISHABLE_KEY).
 * IS_MULTIWORKSPACE_ENABLED: twenty-server config-variables.ts:2113 at the v2.44.0 pin (commit 7cbdfec6). docker/twenty.compose.yml sets it to "false"; a set value here overrides it.
 * LOGIC_FUNCTION_TYPE: Twenty 7cbdfec6 config-variables.ts:732-735. Unset passes nothing, so the upstream default applies.
 * IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS: Twenty 7cbdfec6 config-variables.ts:566, BOOLEAN, upstream default true.
 *   Gate: packages/twenty-server/src/engine/core-modules/auth/services/sign-in-up.service.ts:547-553. The P5 lane needs false at up.
 * IS_CONFIG_VARIABLES_IN_DB_ENABLED: Twenty 7cbdfec6 config-variables.ts:1465, BOOLEAN, env-only, upstream default true.
 *   Opt-in: set false to stop config values stored in the database from overriding the environment (SSRF-001 / NEW-TW-3).
 * The two boolean names accept only the exact values true or false (assertTwentyBooleanPassthrough). Unset passes nothing.
 */
export const TWENTY_PASSTHROUGH_ENV = [
  "OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS",
  "IS_BILLING_ENABLED",
  "IS_MULTIWORKSPACE_ENABLED",
  "BILLING_STRIPE_API_KEY",
  "BILLING_STRIPE_WEBHOOK_SECRET",
  "BILLING_STRIPE_PUBLISHABLE_KEY",
  "LOGIC_FUNCTION_TYPE",
  "IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS",
  "IS_CONFIG_VARIABLES_IN_DB_ENABLED",
] as const;

/** Passthrough names that take only the exact values true or false. */
export const TWENTY_BOOLEAN_PASSTHROUGH = [
  "IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS",
  "IS_CONFIG_VARIABLES_IN_DB_ENABLED",
] as const;

export type TwentyPassthroughName = (typeof TWENTY_PASSTHROUGH_ENV)[number];

/**
 * Throws TWENTY_FLAG_INVALID when a boolean passthrough is set to anything but exactly "true" or "false". The raw value is
 * checked, not a trimmed copy: compose interpolates the raw value, so " true" would reach the container unchanged.
 * Blank and whitespace-only values count as unset. The error names the variable and never the value.
 */
export function assertTwentyBooleanPassthrough(env: NodeJS.ProcessEnv): void {
  for (const name of TWENTY_BOOLEAN_PASSTHROUGH) {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") {
      continue;
    }
    if (raw !== "true" && raw !== "false") {
      throw new Error(
        `TWENTY_FLAG_INVALID: ${name} must be exactly true or false. The value is not printed. Unset it to keep the upstream default.`,
      );
    }
  }
}

/** The names set to a non-blank value in `env`, in allowlist order. Blank and whitespace-only values count as unset. */
export function readTwentyPassthroughNames(env: NodeJS.ProcessEnv): TwentyPassthroughName[] {
  return TWENTY_PASSTHROUGH_ENV.filter((name) => {
    const raw = env[name];
    return raw !== undefined && raw.trim() !== "";
  });
}
