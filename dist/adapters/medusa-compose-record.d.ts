import { type MedusaHarnessSwitches } from "./medusa-env.js";
/** `<harnessRoot>/.harness/medusa-compose.json`: the ordered compose file names `up()` started. */
export declare function medusaComposeRecordFile(harnessRoot: string): string;
export declare function serializeMedusaComposeRecord(files: readonly string[]): string;
/** Returns the recorded file names, or undefined when the text is missing or not a non-empty list of names. */
export declare function parseMedusaComposeRecord(text: string | undefined): string[] | undefined;
/** `down()` uses the recorded list when present, otherwise the compose files the current env would start. */
export declare function resolveMedusaComposeFiles(recordText: string | undefined, switches: MedusaHarnessSwitches): string[];
//# sourceMappingURL=medusa-compose-record.d.ts.map