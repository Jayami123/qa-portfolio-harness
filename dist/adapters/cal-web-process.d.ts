import { type CalWebSignal, type CalWebStopDeps } from "./cal-web-pid.js";
import { type ProcFs } from "./proc-net-listeners.js";
/**
 * The fork's `start` script (apps/web/package.json), split into arguments after `next`. The harness
 * appends `-H <host> -p <port>`; the fork's script stays the source of truth for the rest.
 */
export declare function readWebStartArgs(webDir: string): string[];
/** The Next.js bin for apps/web, resolved from that package the way yarn's workspace resolves it. */
export declare function resolveNextBin(webDir: string): string;
export interface ListenerDeps {
    readonly procFs: ProcFs;
    readonly execFile: (command: string, args: string[]) => string;
}
/**
 * Pids listening on the web port. Empty when the lookup finds nothing or fails (the caller fails closed).
 * Linux reads /proc/net/tcp{,6} and /proc/<pid>/fd, because lsof skips a process whose name has an
 * unbalanced parenthesis, such as `next-server (v16.x)`. lsof is the fallback when /proc/net/tcp cannot
 * be read, and the lookup on macOS. Windows parses `netstat -ano`.
 */
export declare function listenerPids(port: number, platform?: NodeJS.Platform, deps?: ListenerDeps): number[];
/** Stops the recorded pid's tree: taskkill /T on Windows, the process group on POSIX. */
export declare function killRootTree(pid: number, signal: CalWebSignal, platform?: NodeJS.Platform): void;
/** The stop dependencies for the real harness: pid file under the harness root, real processes. */
export declare function calWebStopDeps(harnessRoot?: string, platform?: NodeJS.Platform): CalWebStopDeps;
//# sourceMappingURL=cal-web-process.d.ts.map