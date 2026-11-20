export declare const MEDUSA_BACKEND_PID_BASENAME = "medusa-backend.pid";
export declare const MEDUSA_STOREFRONT_PID_BASENAME = "medusa-storefront.pid";
export declare const MEDUSA_BACKEND_2_PID_BASENAME = "medusa-backend-2.pid";
export interface MedusaBackendPidRecord {
    readonly pid: number;
    /** Opaque OS start marker. When set, down() checks it before signaling a live pid. */
    readonly startMark?: string;
    /** Base URL the backend was started on. Written for the second backend so stop does not depend on env. */
    readonly baseUrl?: string;
}
export declare class MedusaBackendStopError extends Error {
    readonly preservePidFile = true;
}
export declare function medusaHarnessPidFile(basename: string, harnessRoot?: string): string;
export declare function medusaBackendPidFile(harnessRoot?: string): string;
export declare function medusaStorefrontPidFile(harnessRoot?: string): string;
/** A non-empty decimal string that is a positive safe integer. */
export declare function parsePositiveSafeInteger(text: string): number | undefined;
export declare function parseMedusaBackendPidFileText(text: string): MedusaBackendPidRecord | undefined;
export declare function captureProcessStartMark(pid: number): string | undefined;
export declare function writeMedusaPid(basename: string, pid: number, harnessRoot?: string, extra?: {
    baseUrl?: string;
}): void;
export declare function writeMedusaBackendPid(pid: number, harnessRoot?: string): void;
export declare function writeMedusaBackend2Pid(pid: number, baseUrl: string, harnessRoot?: string): void;
export declare function writeMedusaStorefrontPid(pid: number, harnessRoot?: string): void;
export declare function readMedusaBackendPidRecord(harnessRoot?: string): MedusaBackendPidRecord | undefined;
export declare function readMedusaBackend2Record(harnessRoot?: string): (MedusaBackendPidRecord & {
    baseUrl?: string;
}) | undefined;
export declare function defaultKillProcessTree(pid: number): void;
export interface StopMedusaBackendFromPidFileDeps {
    readRecord: () => MedusaBackendPidRecord | undefined;
    removePidFile: () => void;
    isPidRunning: (pid: number) => boolean;
    killProcessTree: (pid: number) => void;
    captureStartMark: (pid: number) => string | undefined;
}
/**
 * Stops only the harness-recorded Medusa backend pid and its tree.
 * A missing pid file is a no-op. A corrupt pid file is removed.
 * Throws {@link MedusaBackendStopError} when kill fails and the pid is still live,
 * or when a live pid no longer matches the recorded start mark.
 */
export declare function stopMedusaPidFile(basename: string, harnessRoot?: string, deps?: Partial<StopMedusaBackendFromPidFileDeps>): void;
export declare function stopMedusaBackendFromPidFile(harnessRoot?: string, deps?: Partial<StopMedusaBackendFromPidFileDeps>): void;
export declare function stopMedusaBackend2FromPidFile(harnessRoot?: string, deps?: Partial<StopMedusaBackendFromPidFileDeps>): void;
export declare function stopMedusaStorefrontFromPidFile(harnessRoot?: string, deps?: Partial<StopMedusaBackendFromPidFileDeps>): void;
//# sourceMappingURL=medusa-backend-pid.d.ts.map