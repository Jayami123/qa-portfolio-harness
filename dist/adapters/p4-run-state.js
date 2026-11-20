import fs from "node:fs";
import path from "node:path";
import { HARNESS_ROOT } from "../paths.js";
/**
 * Per-run MCP credential channel for the P4 products (ADR 0006, D7). `up()` writes
 * `<harnessRoot>/.harness/<product>-run.json` with mode 0600; `down()` removes it. Only `readP4McpCredentials` reads
 * the credential. Nothing prints, logs or uploads this file or its values. The `.harness/` folder is gitignored.
 */
export const P4_RUN_STATE_MISSING = "P4_RUN_STATE_MISSING";
export const P4_RUN_STATE_INVALID = "P4_RUN_STATE_INVALID";
/** For products that always take a credential (Nextcloud, Outline, Mattermost): throws when the state has none. */
export function requireMcpAuthorization(creds, product) {
    if (creds.mcpAuthorization === null) {
        throw new Error(`${P4_RUN_STATE_INVALID}: ${product} run state has no MCP credential (content not printed).`);
    }
    return creds.mcpAuthorization;
}
export function p4RunStateFile(product, harnessRoot = HARNESS_ROOT) {
    return path.join(harnessRoot, ".harness", `${product}-run.json`);
}
/** Writes the state with mode 0600, also when the file already existed. Never logs. */
export function writeP4RunState(file, state) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(file, 0o600);
}
/** Removes the state. A missing file is not an error. Never logs. */
export function removeP4RunState(file) {
    fs.rmSync(file, { force: true });
}
/**
 * Reads the MCP URL and Authorization value for one product. Throws P4_RUN_STATE_MISSING when the file is absent, and
 * P4_RUN_STATE_INVALID when it is not the expected shape. Neither message contains any value from the file.
 */
export function readP4McpCredentials(product, file = p4RunStateFile(product)) {
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
        typeof parsed.mcpUrl !== "string" ||
        !/^https?:\/\//.test(parsed.mcpUrl) ||
        !(parsed.mcpAuthorization === null || (typeof parsed.mcpAuthorization === "string" && parsed.mcpAuthorization.trim() !== ""))) {
        throw new Error(`${P4_RUN_STATE_INVALID}: ${file} does not have the expected shape (content not printed).`);
    }
    return { mcpUrl: parsed.mcpUrl, mcpAuthorization: parsed.mcpAuthorization };
}
//# sourceMappingURL=p4-run-state.js.map