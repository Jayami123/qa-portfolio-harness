import { type TwentyRateLimitEnvName } from "./twenty-rate-limits.js";
import { type ElPreload } from "./telemetry-env.js";
import { type TwentyPassthroughName } from "./twenty-passthrough.js";
import { type TwentyCanary } from "./twenty-canary.js";
export declare const TWENTY_RUNTIME_OVERRIDE_FILE = "twenty.runtime.compose.yml";
/** Names a canary may not use: the passthrough and rate-limit names, the preload names, TWENTY_REQUIRE_FRESH,
 *  the two canary names, and the compose-set keys above. */
export declare const TWENTY_RESERVED_ENV: ReadonlySet<string>;
export interface RuntimeOverrideFs {
    writeFileSync(file: string, text: string): void;
    rmSync(file: string, opts: {
        force: true;
    }): void;
    mkdirSync(dir: string, opts: {
        recursive: true;
    }): void;
    chmodSync(dir: string, mode: number): void;
}
/** The override file the harness owns: path.join(HARNESS_ROOT, ".harness", "twenty.runtime.compose.yml") (HARNESS_ROOT: src/paths.ts:5). */
export declare function twentyRuntimeOverridePath(): string;
/** The override as a compose -f entry, or no entry when the last up() wrote none. */
export declare function twentyRuntimeOverrideFiles(): string[];
export declare const LOGIC_FUNCTION_TYPE_VALUES: readonly ["DISABLED", "LAMBDA", "LOCAL"];
/** Undefined when unset or blank. Throws TWENTY_LOGIC_FUNCTION_TYPE_INVALID for any other value (checked after toUpperCase). */
export declare function readTwentyLogicFunctionType(env: NodeJS.ProcessEnv): string | undefined;
/** The override YAML for server and worker: the rate-limit keys, and when the preload is on, its environment and mounts.
 *  Returns undefined when there is nothing to write. Host paths are single-quoted, so Windows backslashes are not escapes. */
export declare function twentyRuntimeOverrideYaml(values: Partial<Record<TwentyRateLimitEnvName, string>>, preload: ElPreload | undefined, passthrough?: readonly TwentyPassthroughName[], canary?: TwentyCanary): string | undefined;
/** Writes the override only when a key is needed, and always removes a stale file first.
 *  Validates every rate-limit value before touching the disk: a bad value throws with no file system call.
 *  With the event-loop preload on, the out directory is made mode 0777 before the override is written (the Twenty containers run as UID 1000).
 *  Returns the absolute path written, or undefined. */
export declare function writeTwentyRuntimeOverride(opts: {
    env: NodeJS.ProcessEnv;
    fs?: RuntimeOverrideFs;
}): string | undefined;
//# sourceMappingURL=twenty-runtime-override.d.ts.map