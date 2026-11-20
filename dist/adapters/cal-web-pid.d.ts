export declare const CAL_WEB_PID_BASENAME = "cal-web.pid";
/**
 * `pid` is the Next.js server itself: node running the fork's `next` bin. No shell and no yarn
 * process sit between the harness and the server, so the recorded pid is the listener.
 */
export interface CalWebPidRecord {
    readonly pid: number;
    /** OS start marker of `pid`; down() verifies it before signaling a live pid. */
    readonly startMark?: string;
}
export declare class CalWebStopError extends Error {
    readonly preservePidFile = true;
}
export type CalWebSignal = "SIGTERM" | "SIGKILL";
export interface CalWebSpawnInput {
    readonly platform: NodeJS.Platform;
    readonly execPath: string;
    /** The fork's resolved Next.js bin (`next/dist/bin/next`). */
    readonly nextBin: string;
    /** Arguments after the bin, e.g. `["start", "-H", "127.0.0.1", "-p", "3000"]`. */
    readonly args: readonly string[];
}
export interface CalWebSpawnSpec {
    readonly command: string;
    readonly args: string[];
    readonly shell: false;
    /** POSIX: the server leads its own process group, so the recorded pid is the group id. */
    readonly detached: boolean;
}
export declare function calWebPidFile(harnessRoot?: string): string;
export declare function describeCalWebRecord(record: CalWebPidRecord | undefined): string;
export declare function parseCalWebPidFileText(text: string): CalWebPidRecord | undefined;
/** Writes the record to a temp file in the same directory, then renames it over the record, so a reader never sees a partial file. */
export declare function writeCalWebPid(pid: number, harnessRoot?: string): void;
export declare function readCalWebPidRecord(harnessRoot?: string): CalWebPidRecord | undefined;
/**
 * The spawn for the Cal web server: node runs the fork's Next.js bin directly. Never a shell, and
 * no yarn in between. Detached on every platform: POSIX makes the server a process-group leader, and
 * on Windows a non-detached child died with the `up` process (observed on this machine).
 */
export declare function calWebSpawnSpec(input: CalWebSpawnInput): CalWebSpawnSpec;
export interface CalWebStopDeps {
    readonly platform: NodeJS.Platform;
    readRecord: () => CalWebPidRecord | undefined;
    hasPidFile: () => boolean;
    removePidFile: () => void;
    isPidRunning: (pid: number) => boolean;
    captureStartMark: (pid: number) => string | undefined;
    /** Signals the recorded pid and its tree: kill(-pgid) on POSIX, taskkill /T on Windows. */
    killRootTree: (pid: number, signal: CalWebSignal) => void;
}
/**
 * `dead`: the recorded pid is gone. `stale`: a live pid whose start mark differs (or none was
 * recorded), so the pid was reused and must not be signaled. `live`: the recorded process itself.
 */
export type CalWebRecordState = "dead" | "stale" | "live";
export declare function recordedWebState(record: CalWebPidRecord, deps: Pick<CalWebStopDeps, "isPidRunning" | "captureStartMark">): CalWebRecordState;
export interface StoppedCalWeb {
    readonly record: CalWebPidRecord;
    readonly state: CalWebRecordState;
}
/**
 * Signals the recorded pid only when it is `live`. A `dead` or `stale` record signals nothing: the
 * port decides what is left, and a stale record is reported. A corrupt pid file is removed. Leaves
 * the pid file alone; see {@link settleCalWebStop}.
 */
export declare function stopRecordedCalWeb(deps: CalWebStopDeps, signal?: CalWebSignal): StoppedCalWeb | undefined;
/**
 * The listener on the web port must be the recorded pid. Otherwise up does not guess and fails.
 */
export declare function assertListenerIsRecorded(input: {
    readonly address: string;
    readonly listeners: readonly number[];
    readonly record: CalWebPidRecord | undefined;
}): void;
export interface SettleCalWebStopInput {
    /** The web address, for messages only. */
    readonly address: string;
    readonly portHeld: boolean;
    /** Pids listening on the web port (empty when unknown). */
    readonly listeners: readonly number[];
    /** The record that was stopped (from {@link stopRecordedCalWeb}). */
    readonly record: CalWebPidRecord | undefined;
    readonly removePidFile: () => void;
}
/** Removes the pid file only when the port is free. While the port is held the file stays, so a later down can retry. */
export declare function settleCalWebStop(input: SettleCalWebStopInput): void;
//# sourceMappingURL=cal-web-pid.d.ts.map