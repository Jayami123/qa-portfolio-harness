/**
 * Opt-in synthetic canary for the Twenty server and worker. The caller names one variable and gives its value.
 * The override file holds only the reference `NAME: ${HARNESS_TWENTY_CANARY_VALUE}`; compose interpolates the value
 * from the environment of `up`. The value is never written to disk and never appears in an error message.
 */
export const CANARY_NAME_ENV = "HARNESS_TWENTY_CANARY_NAME";
export const CANARY_VALUE_ENV = "HARNESS_TWENTY_CANARY_VALUE";
export const CANARY_NAME_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;

export interface TwentyCanary {
  readonly name: string;
}

/**
 * Undefined when the name is unset or blank; the value is then ignored.
 * Throws for a name that fails the pattern, a name in `reserved` (harness-owned), or a blank value when a name is set.
 * Error messages name the variables only. An invalid name is not echoed, because a misplaced value would then leak.
 */
export function readTwentyCanary(env: NodeJS.ProcessEnv, reserved: ReadonlySet<string>): TwentyCanary | undefined {
  const raw = env[CANARY_NAME_ENV];
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  if (!CANARY_NAME_PATTERN.test(raw)) {
    throw new Error(
      `TWENTY_CANARY_NAME_INVALID: ${CANARY_NAME_ENV} must match ${CANARY_NAME_PATTERN.source} (the name is not printed).`,
    );
  }
  if (reserved.has(raw)) {
    throw new Error(
      `TWENTY_CANARY_NAME_RESERVED: ${raw} is a harness-owned variable name and cannot be the canary name. Choose another ${CANARY_NAME_ENV}.`,
    );
  }
  const value = env[CANARY_VALUE_ENV];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `TWENTY_CANARY_VALUE_MISSING: ${CANARY_VALUE_ENV} must be set to a non-blank value when ${CANARY_NAME_ENV} is set.`,
    );
  }
  return { name: raw };
}

/** The override lines for one service: the reference only, never the value. */
export function canaryYamlLines(canary: TwentyCanary | undefined): string[] {
  return canary === undefined ? [] : [`      ${canary.name}: \${${CANARY_VALUE_ENV}}`];
}
