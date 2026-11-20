export interface ElPreload {
    preload: string;
    out: string;
}
export type ElRole = "server" | "server-2";
/** undefined when HARNESS_EL_PRELOAD is unset, blank or empty (the preload is off).
 *  Throws `HARNESS_EL_PRELOAD must be an absolute path to a readable file (got "<raw>")` for a relative, missing or unreadable
 *  preload, and `HARNESS_EL_OUT must be an absolute path when HARNESS_EL_PRELOAD is set` when the out path is not absolute.
 *  Creates the out directory with mkdir -p when it is missing. */
export declare function elPreloadFromEnv(env: NodeJS.ProcessEnv): ElPreload | undefined;
/** Keeps the base flags and appends --require. */
export declare function appendNodeOptions(base: string | undefined, preload: string): string;
/** The env of one server process: the base env plus the preload keys. Returns base unchanged when there is no preload. */
export declare function serverProcessEnv(base: Record<string, string>, role: ElRole, el: ElPreload | undefined): Record<string, string>;
/** The Documenso app env: the base env, plus the preload keys when HARNESS_EL_PRELOAD is set (role server). */
export declare function documensoAppEnvWithPreload(base: Record<string, string>, processEnv: NodeJS.ProcessEnv): Record<string, string>;
//# sourceMappingURL=telemetry-env.d.ts.map