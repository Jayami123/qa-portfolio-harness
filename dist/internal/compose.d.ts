export interface ComposeOptions {
    projectName: string;
    files: string[];
    cwd: string;
    env?: NodeJS.ProcessEnv;
}
/** The argv for `docker compose up -d`. With `wait`, `--wait` is limited to `waitServices` when given: compose treats any
 *  exited container as a failure under --wait, so one-shot services (Cal's postgres_is_ready) must stay out of the wait. */
export declare function composeUpArgs(options: ComposeOptions, opts?: {
    wait?: boolean;
    waitServices?: string[];
}): string[];
export declare function composeUp(options: ComposeOptions, opts?: {
    wait?: boolean;
    waitServices?: string[];
}): Promise<void>;
export declare function composeDown(options: ComposeOptions, extra?: string[]): Promise<void>;
/** The argv for `docker compose restart <service>`. It keeps volumes and the env file as they are. */
export declare function composeRestartArgs(options: ComposeOptions, service: string): string[];
export declare function composeRestart(options: ComposeOptions, service: string): Promise<void>;
/**
 * The argv for `docker compose exec -T <service> <command...>`. The command is passed as separate argv entries, never as a
 * shell string, so no value is ever re-parsed by a shell. `-T` means no TTY, so stdin and stdout are plain pipes.
 */
export declare function composeExecArgs(options: ComposeOptions, service: string, command: string[]): string[];
export declare function harnessComposeFile(name: string): string;
//# sourceMappingURL=compose.d.ts.map