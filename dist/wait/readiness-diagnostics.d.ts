/** One diagnostic command. argv is run without a shell, except the explicit `sh -c` for the ss pipe. */
export interface DiagnosticCommand {
    label: string;
    argv: string[];
}
/**
 * The commands printed when a readiness wait times out in the agent-hosts job: docker ps for the run, the app container's
 * port map, the listener on the product's port, and an HTTP status from the runner. The URL and the container name are the
 * only inputs. No header or secret is part of any command.
 */
export declare function readinessDiagnosticCommands(opts: {
    url: string;
    container: string;
}): DiagnosticCommand[];
/** Runs each diagnostic and prints its output. Never throws: a failed diagnostic is printed and the wait keeps its error. */
export declare function printReadinessDiagnostics(opts: {
    url: string;
    container: string;
}): void;
/** Result of one docker call. The default runner uses spawnSync; tests pass a stub. */
export interface DockerResult {
    status: number | null;
    stdout: string;
    stderr: string;
}
export type DockerRunner = (args: string[]) => DockerResult;
export declare const spawnDocker: DockerRunner;
/** State of the app container from `docker inspect`. `exited` is true only for status "exited" or "dead". */
export interface ContainerState {
    container: string;
    status: string;
    exited: boolean;
    exitCode?: number;
    oomKilled?: boolean;
}
/**
 * Hides values that look like secrets in container output: KEY=value and "key": "value" pairs whose name looks secret,
 * Authorization and Bearer values, credentials inside URLs, and JWTs. The name stays so the line is still readable.
 */
export declare function redactSecrets(text: string): string;
/** `docker logs --tail 200`, redacted and capped. stdout and stderr are both kept because apps log to either. */
export declare function captureContainerLogs(container: string, docker?: DockerRunner): string;
/** Reads status, ExitCode and OOMKilled with one `docker inspect`. Returns undefined when the container cannot be inspected. */
export declare function inspectContainerState(container: string, docker?: DockerRunner): ContainerState | undefined;
/** One-line message for an exited container: name, exit code and OOMKilled. */
export declare function describeContainerExit(state: ContainerState): string;
/** Thrown by a readiness wait as soon as the app container is seen exited. */
export declare class ContainerExitedError extends Error {
    readonly state: ContainerState;
    constructor(state: ContainerState);
}
/**
 * Call on each poll. When the container has exited, prints its exit state and redacted log tail, then throws
 * ContainerExitedError. A container that is missing, starting or restarting is not an exit: the wait keeps polling and
 * the timeout stays the backstop.
 */
export declare function failIfContainerExited(container: string, url: string, docker?: DockerRunner): void;
/** Prints the exit state and the redacted log tail of the app container. Never throws. */
export declare function printContainerFailureDiagnostics(container: string, docker?: DockerRunner): void;
//# sourceMappingURL=readiness-diagnostics.d.ts.map