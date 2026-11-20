import { type CalWebPidRecord, type CalWebSpawnSpec, type CalWebStopDeps } from "./cal-web-pid.js";
export declare const CAL_API_PID_BASENAME = "cal-api.pid";
export declare function calApiPidFile(harnessRoot?: string): string;
export declare function describeCalApiRecord(record: CalWebPidRecord | undefined): string;
/** Writes the record to a temp file in the same directory, then renames it over the record. */
export declare function writeCalApiPid(pid: number, harnessRoot?: string): void;
export declare function readCalApiPidRecord(harnessRoot?: string): CalWebPidRecord | undefined;
/**
 * The spawn for Cal API v2: node runs the built `main.js` with no shell, detached on every platform so the
 * recorded pid leads its own process group on POSIX (the same reasoning as calWebSpawnSpec).
 */
export declare function calApiSpawnSpec(input: {
    execPath: string;
    mainJs: string;
}): CalWebSpawnSpec;
/** Stop dependencies for the real harness. The stop rules are the web's: start mark, process group, taskkill /T. */
export declare function calApiStopDeps(harnessRoot?: string, platform?: NodeJS.Platform): CalWebStopDeps;
/**
 * Removes the pid file only when the port is free. While the port is held the file stays, so a later down can retry.
 * A held port throws and names the listener, as the web does.
 */
export declare function settleCalApiStop(input: {
    readonly address: string;
    readonly portHeld: boolean;
    readonly listeners: readonly number[];
    readonly record: CalWebPidRecord | undefined;
    readonly removePidFile: () => void;
}): void;
/** The listener on the API port must be the recorded pid after health answers. */
export declare function assertApiListenerIsRecorded(input: {
    readonly address: string;
    readonly listeners: readonly number[];
    readonly record: CalWebPidRecord | undefined;
}): void;
export type CalApiState = "ok" | "starting" | "down";
export interface CalApiStateInput {
    /** `GET <apiBaseUrl>/health` returned status 200 with the body "OK" (the fork's health route). */
    readonly healthy: boolean;
    /** Something accepts TCP connections on the API port. */
    readonly portOpen: boolean;
    /** Pids listening on the API port (empty when the lookup failed). */
    readonly listeners: readonly number[];
    readonly record: CalWebPidRecord | undefined;
    /** The recorded pid is alive and its start mark matches. */
    readonly recordLive: boolean;
    readonly port: number;
    readonly healthUrl: string;
}
/**
 * The API state for up(). The answer must come from the recorded pid: `ok` when the health answer is OK and the
 * port listener is the live recorded pid; `starting` when that pid listens but is not healthy yet (wait, do not spawn);
 * `down` when nothing listens. Any other holder throws and names it, even one that answers OK.
 */
export declare function classifyCalApiState(input: CalApiStateInput): CalApiState;
//# sourceMappingURL=cal-api-pid.d.ts.map