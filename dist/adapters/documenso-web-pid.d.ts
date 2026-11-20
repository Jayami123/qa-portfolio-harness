export declare const DOCUMENSO_WEB_PID_BASENAME = "documenso-web.pid";
export interface DocumensoWebPidRecord {
    readonly pid: number;
    /** Opaque OS start marker; when set, down() verifies before signaling a live pid. */
    readonly startMark?: string;
}
export declare class DocumensoWebStopError extends Error {
    readonly preservePidFile = true;
}
export declare function documensoWebPidFile(harnessRoot?: string): string;
/** Accepts only a non-empty decimal string that is a positive safe integer. */
export declare function parsePositiveSafeInteger(text: string): number | undefined;
export declare function parseDocumensoWebPidFileText(text: string): DocumensoWebPidRecord | undefined;
export declare function captureProcessStartMark(pid: number): string | undefined;
export declare function writeDocumensoWebPid(pid: number, harnessRoot?: string): void;
export declare function readDocumensoWebPidRecord(harnessRoot?: string): DocumensoWebPidRecord | undefined;
export declare function readDocumensoWebPidFromFile(harnessRoot?: string): number | undefined;
export declare function defaultKillProcessTree(pid: number): void;
export interface StopDocumensoWebFromPidFileDeps {
    readRecord: () => DocumensoWebPidRecord | undefined;
    removePidFile: () => void;
    isPidRunning: (pid: number) => boolean;
    killProcessTree: (pid: number) => void;
    captureStartMark: (pid: number) => string | undefined;
}
/** Parent pid of a process, or undefined when it has no parent or cannot be read (Windows: CIM; POSIX: ps). */
export declare function parentPidOf(pid: number, platformName?: NodeJS.Platform): number | undefined;
/**
 * The pid to signal so that a port listener dies, or undefined when the listener is not proven to belong to the record.
 * The listener belongs to the record when the recorded pid is on its ancestor chain. A live root is signaled whole
 * (taskkill /T, or the process group). A dead root keeps its children on the chain (Windows does not reparent them),
 * so the child just below the root is signaled and its tree takes the listener with it.
 */
export declare function ownedKillTarget(input: {
    readonly listener: number;
    readonly recordedRoot: number;
    readonly rootAlive: boolean;
    readonly parentOf: (pid: number) => number | undefined;
}): number | undefined;
export type DocumensoRootState = "none" | "dead" | "live";
export interface DocumensoRootStop {
    readonly record: DocumensoWebPidRecord | undefined;
    /** dead: the recorded pid had already exited. live: the recorded tree was signaled (or its kill returned). */
    readonly state: DocumensoRootState;
}
/**
 * Signals the recorded root tree only while the root is alive and its start mark matches. Never removes the pid
 * file: the caller removes it after the port is confirmed free. A corrupt pid file is removed (it names no pid).
 * A dead root is reported as dead, not as stopped: its children may still hold the port.
 */
export declare function stopDocumensoWebRoot(harnessRoot?: string, deps?: Partial<StopDocumensoWebFromPidFileDeps>): DocumensoRootStop;
/** Removes the recorded pid file. Called only after the port is confirmed free. */
export declare function removeDocumensoWebPidFile(harnessRoot?: string): void;
//# sourceMappingURL=documenso-web-pid.d.ts.map