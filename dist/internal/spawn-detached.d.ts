import { spawn } from "node:child_process";
export declare function resolveYarn(): string;
/** npm on Windows is a `.cmd` shim; the shell resolves it from PATH (same Node the shell uses). */
export declare function resolveNpm(): string;
/** pnpm on Windows is a `.cmd` shim. The DTC starter pins pnpm via packageManager. */
export declare function resolvePnpm(): string;
/** Keep the returned process referenced so Windows does not GC/kill it mid-smoke. */
export declare function spawnLogged(command: string, args: string[], options: {
    cwd: string;
    logFile: string;
    env?: NodeJS.ProcessEnv;
    detached?: boolean;
    shell?: boolean;
}): ReturnType<typeof spawn>;
export declare function spawnDetached(command: string, args: string[], options: {
    cwd: string;
    logFile: string;
}): number;
export declare function isPidRunning(pid: number): boolean;
//# sourceMappingURL=spawn-detached.d.ts.map