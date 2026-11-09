/**
 * Variables the harness forwards by name to the Twenty server and worker. The override file lists only the name
 * (`NAME:` in mapping form), and compose takes the value from the environment of `up`. No value is written to disk.
 *
 * Names confirmed at upstream tag twenty/v2.44.0, twenty-config/config-variables.ts:106 (OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS),
 * :945 (IS_BILLING_ENABLED), :1035 (BILLING_STRIPE_API_KEY), :1044 (BILLING_STRIPE_WEBHOOK_SECRET), :1053 (BILLING_STRIPE_PUBLISHABLE_KEY).
 * IS_MULTIWORKSPACE_ENABLED: twenty-server config-variables.ts:2113 at the v2.44.0 pin (commit 7cbdfec6). docker/twenty.compose.yml sets it to "false"; a set value here overrides it.
 * LOGIC_FUNCTION_TYPE: Twenty 7cbdfec6 config-variables.ts:732-735. Unset passes nothing, so the upstream default applies.
 */
export const TWENTY_PASSTHROUGH_ENV = [
  "OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS",
  "IS_BILLING_ENABLED",
  "IS_MULTIWORKSPACE_ENABLED",
  "BILLING_STRIPE_API_KEY",
  "BILLING_STRIPE_WEBHOOK_SECRET",
  "BILLING_STRIPE_PUBLISHABLE_KEY",
  "LOGIC_FUNCTION_TYPE",
] as const;

export type TwentyPassthroughName = (typeof TWENTY_PASSTHROUGH_ENV)[number];

/** The names set to a non-blank value in `env`, in allowlist order. Blank and whitespace-only values count as unset. */
export function readTwentyPassthroughNames(env: NodeJS.ProcessEnv): TwentyPassthroughName[] {
  return TWENTY_PASSTHROUGH_ENV.filter((name) => {
    const raw = env[name];
    return raw !== undefined && raw.trim() !== "";
  });
}
