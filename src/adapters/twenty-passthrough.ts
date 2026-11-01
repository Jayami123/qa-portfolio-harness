/**
 * Variables the harness forwards by name to the Twenty server and worker. The override file lists only the name
 * (`NAME:` in mapping form), and compose takes the value from the environment of `up`. No value is written to disk.
 *
 * Names confirmed at upstream tag twenty/v2.44.0, twenty-config/config-variables.ts:106 (OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS),
 * :945 (IS_BILLING_ENABLED), :1035 (BILLING_STRIPE_API_KEY), :1044 (BILLING_STRIPE_WEBHOOK_SECRET), :1053 (BILLING_STRIPE_PUBLISHABLE_KEY).
 */
export const TWENTY_PASSTHROUGH_ENV = [
  "OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS",
  "IS_BILLING_ENABLED",
  "BILLING_STRIPE_API_KEY",
  "BILLING_STRIPE_WEBHOOK_SECRET",
  "BILLING_STRIPE_PUBLISHABLE_KEY",
] as const;

export type TwentyPassthroughName = (typeof TWENTY_PASSTHROUGH_ENV)[number];

/** The names set to a non-blank value in `env`, in allowlist order. Blank and whitespace-only values count as unset. */
export function readTwentyPassthroughNames(env: NodeJS.ProcessEnv): TwentyPassthroughName[] {
  return TWENTY_PASSTHROUGH_ENV.filter((name) => {
    const raw = env[name];
    return raw !== undefined && raw.trim() !== "";
  });
}
