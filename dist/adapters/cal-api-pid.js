import fs from "node:fs";
import path from "node:path";
import { HARNESS_ROOT } from "../paths.js";
import { captureProcessStartMark } from "./documenso-web-pid.js";
import { CalWebStopError, parseCalWebPidFileText, } from "./cal-web-pid.js";
import { isPidRunning } from "../internal/spawn-detached.js";
import { killRootTree } from "./cal-web-process.js";
export const CAL_API_PID_BASENAME = "cal-api.pid";
export function calApiPidFile(harnessRoot = HARNESS_ROOT) {
    return path.join(harnessRoot, ".harness", CAL_API_PID_BASENAME);
}
export function describeCalApiRecord(record) {
    if (record === undefined) {
        return "no pid record";
    }
    return `recorded pid ${String(record.pid)}, start mark ${record.startMark ?? "none"}`;
}
/** Writes the record to a temp file in the same directory, then renames it over the record. */
export function writeCalApiPid(pid, harnessRoot = HARNESS_ROOT) {
    const file = calApiPidFile(harnessRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const startMark = captureProcessStartMark(pid);
    const record = startMark === undefined ? { pid } : { pid, startMark };
    const temp = `${file}.${String(process.pid)}.tmp`;
    try {
        fs.writeFileSync(temp, `${JSON.stringify(record)}\n`, "utf8");
        fs.renameSync(temp, file);
    }
    catch (error) {
        fs.rmSync(temp, { force: true });
        throw error;
    }
}
export function readCalApiPidRecord(harnessRoot = HARNESS_ROOT) {
    const file = calApiPidFile(harnessRoot);
    if (!fs.existsSync(file)) {
        return undefined;
    }
    return parseCalWebPidFileText(fs.readFileSync(file, "utf8"));
}
/**
 * The spawn for Cal API v2: node runs the built `main.js` with no shell, detached on every platform so the
 * recorded pid leads its own process group on POSIX (the same reasoning as calWebSpawnSpec).
 */
export function calApiSpawnSpec(input) {
    return { command: input.execPath, args: [input.mainJs], shell: false, detached: true };
}
/** Stop dependencies for the real harness. The stop rules are the web's: start mark, process group, taskkill /T. */
export function calApiStopDeps(harnessRoot = HARNESS_ROOT, platform = process.platform) {
    return {
        platform,
        readRecord: () => readCalApiPidRecord(harnessRoot),
        hasPidFile: () => fs.existsSync(calApiPidFile(harnessRoot)),
        removePidFile: () => {
            fs.rmSync(calApiPidFile(harnessRoot), { force: true });
        },
        isPidRunning,
        captureStartMark: captureProcessStartMark,
        killRootTree: (pid, signal) => {
            killRootTree(pid, signal, platform);
        },
    };
}
/**
 * Removes the pid file only when the port is free. While the port is held the file stays, so a later down can retry.
 * A held port throws and names the listener, as the web does.
 */
export function settleCalApiStop(input) {
    if (!input.portHeld) {
        input.removePidFile();
        return;
    }
    const described = describeCalApiRecord(input.record);
    if (input.listeners.length === 0) {
        throw new CalWebStopError(`Cal API v2 still listening on ${input.address}; listener pid unknown (${described}). Pid file kept.`);
    }
    if (input.record !== undefined && input.listeners.includes(input.record.pid)) {
        throw new CalWebStopError(`Cal API v2 still listening on ${input.address} as the recorded pid ${String(input.record.pid)}; ` +
            `the stop did not complete. Pid file kept; run down again.`);
    }
    throw new CalWebStopError(`Cal API v2 still listening on ${input.address} as pid ${input.listeners.join(", ")}, which does not match ` +
        `${described}; not killed. Pid file kept.`);
}
/** The listener on the API port must be the recorded pid after health answers. */
export function assertApiListenerIsRecorded(input) {
    const { address, listeners, record } = input;
    if (record !== undefined && listeners.includes(record.pid)) {
        return;
    }
    if (listeners.length === 0) {
        throw new Error(`Cal API v2 is healthy on ${address}, but no listener pid could be read (${describeCalApiRecord(record)}). ` +
            `Not guessing which process serves it.`);
    }
    throw new Error(`Cal API v2 is healthy on ${address}, but the listener pid ${listeners.join(", ")} does not match ` +
        `${describeCalApiRecord(record)}. Not guessing which process serves it.`);
}
/**
 * The API state for up(). The answer must come from the recorded pid: `ok` when the health answer is OK and the
 * port listener is the live recorded pid; `starting` when that pid listens but is not healthy yet (wait, do not spawn);
 * `down` when nothing listens. Any other holder throws and names it, even one that answers OK.
 */
export function classifyCalApiState(input) {
    const ours = input.record !== undefined && input.recordLive && input.listeners.includes(input.record.pid);
    if (input.healthy && ours) {
        return "ok";
    }
    if (!input.healthy && !input.portOpen) {
        return "down";
    }
    if (!input.healthy && ours) {
        return "starting";
    }
    const holder = input.listeners.length === 0 ? "a process whose pid could not be read" : `pid ${input.listeners.join(", ")}`;
    const answer = input.healthy ? "answers OK" : "does not answer OK";
    throw new Error(`Port ${String(input.port)} is held by ${holder}, which is not the recorded Cal API v2 process ` +
        `(${describeCalApiRecord(input.record)}) and ${answer} at ${input.healthUrl}. ` +
        `Stop it yourself, then run up again. The harness does not kill processes it did not start.`);
}
//# sourceMappingURL=cal-api-pid.js.map