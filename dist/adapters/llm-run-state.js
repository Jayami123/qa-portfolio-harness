import fs from "node:fs";
import path from "node:path";
import { HARNESS_ROOT } from "../paths.js";
import { P4_RUN_STATE_INVALID, P4_RUN_STATE_MISSING } from "./p4-run-state.js";
export function llmRunStateFile(product, harnessRoot = HARNESS_ROOT) {
    return path.join(harnessRoot, ".harness", `${product}-run.json`);
}
/** Writes the state with mode 0600, also when the file already existed. */
export function writeLlmRunState(file, state) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(file, 0o600);
}
/** Reads the state. Throws P4_RUN_STATE_MISSING or P4_RUN_STATE_INVALID. No message contains a value from the file. */
export function readLlmRunState(product, file = llmRunStateFile(product)) {
    let text;
    try {
        text = fs.readFileSync(file, "utf8");
    }
    catch (err) {
        if (err.code === "ENOENT") {
            throw new Error(`${P4_RUN_STATE_MISSING}: ${file} does not exist. Run up for ${product} first.`);
        }
        throw new Error(`${P4_RUN_STATE_INVALID}: ${file} could not be read.`);
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new Error(`${P4_RUN_STATE_INVALID}: ${file} is not JSON (content not printed).`);
    }
    if (parsed?.version !== 1 ||
        parsed.product !== product ||
        typeof parsed.baseUrl !== "string" ||
        !/^https?:\/\//.test(parsed.baseUrl) ||
        typeof parsed.apiKey !== "string" ||
        parsed.apiKey.trim() === "") {
        throw new Error(`${P4_RUN_STATE_INVALID}: ${file} does not have the expected shape (content not printed).`);
    }
    return { version: 1, product, baseUrl: parsed.baseUrl, apiKey: parsed.apiKey };
}
//# sourceMappingURL=llm-run-state.js.map