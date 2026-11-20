/**
 * Opt-in synthetic canary for the Twenty server and worker. The caller names one variable and gives its value.
 * The override file holds only the reference `NAME: ${HARNESS_TWENTY_CANARY_VALUE}`; compose interpolates the value
 * from the environment of `up`. The value is never written to disk and never appears in an error message.
 */
export declare const CANARY_NAME_ENV = "HARNESS_TWENTY_CANARY_NAME";
export declare const CANARY_VALUE_ENV = "HARNESS_TWENTY_CANARY_VALUE";
export declare const CANARY_NAME_PATTERN: RegExp;
export interface TwentyCanary {
    readonly name: string;
}
/**
 * Undefined when the name is unset or blank; the value is then ignored.
 * Throws for a name that fails the pattern, a name in `reserved` (harness-owned), or a blank value when a name is set.
 * Error messages name the variables only. An invalid name is not echoed, because a misplaced value would then leak.
 */
export declare function readTwentyCanary(env: NodeJS.ProcessEnv, reserved: ReadonlySet<string>): TwentyCanary | undefined;
/** The override lines for one service: the reference only, never the value. */
export declare function canaryYamlLines(canary: TwentyCanary | undefined): string[];
//# sourceMappingURL=twenty-canary.d.ts.map