import path from "node:path";
import { medusaComposeFileNames, } from "./medusa-env.js";
/** `<harnessRoot>/.harness/medusa-compose.json`: the ordered compose file names `up()` started. */
export function medusaComposeRecordFile(harnessRoot) {
    return path.join(harnessRoot, ".harness", "medusa-compose.json");
}
export function serializeMedusaComposeRecord(files) {
    return `${JSON.stringify({ files: [...files] }, null, 2)}\n`;
}
/** Returns the recorded file names, or undefined when the text is missing or not a non-empty list of names. */
export function parseMedusaComposeRecord(text) {
    if (text === undefined) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(text);
        const files = parsed.files;
        if (Array.isArray(files) &&
            files.length > 0 &&
            files.every((f) => typeof f === "string" && f.trim() !== "")) {
            return files;
        }
    }
    catch {
        // Fall through: an unreadable record is the same as no record.
    }
    return undefined;
}
/** `down()` uses the recorded list when present, otherwise the compose files the current env would start. */
export function resolveMedusaComposeFiles(recordText, switches) {
    return (parseMedusaComposeRecord(recordText) ?? [
        ...medusaComposeFileNames(switches),
    ]);
}
//# sourceMappingURL=medusa-compose-record.js.map