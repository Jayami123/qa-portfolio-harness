import fs from "node:fs";
import path from "node:path";
import { HARNESS_ROOT } from "../paths.js";
import { P4_RUN_STATE_INVALID, P4_RUN_STATE_MISSING } from "./p4-run-state.js";

/** Run state for an LLM host (LiteLLM). The api key is the proxy master key. It is never printed or logged. */
export interface LlmRunState {
  version: 1;
  product: "litellm";
  /** OpenAI-compatible base URL on the host, for example http://127.0.0.1:4000/v1 */
  baseUrl: string;
  /** Bearer key for the proxy. */
  apiKey: string;
}

export function llmRunStateFile(product: "litellm", harnessRoot: string = HARNESS_ROOT): string {
  return path.join(harnessRoot, ".harness", `${product}-run.json`);
}

/** Writes the state with mode 0600, also when the file already existed. */
export function writeLlmRunState(file: string, state: LlmRunState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/** Reads the state. Throws P4_RUN_STATE_MISSING or P4_RUN_STATE_INVALID. No message contains a value from the file. */
export function readLlmRunState(product: "litellm", file: string = llmRunStateFile(product)): LlmRunState {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${P4_RUN_STATE_MISSING}: ${file} does not exist. Run up for ${product} first.`);
    }
    throw new Error(`${P4_RUN_STATE_INVALID}: ${file} could not be read.`);
  }
  let parsed: Partial<LlmRunState> | undefined;
  try {
    parsed = JSON.parse(text) as Partial<LlmRunState>;
  } catch {
    throw new Error(`${P4_RUN_STATE_INVALID}: ${file} is not JSON (content not printed).`);
  }
  if (
    parsed?.version !== 1 ||
    parsed.product !== product ||
    typeof parsed.baseUrl !== "string" ||
    !/^https?:\/\//.test(parsed.baseUrl) ||
    typeof parsed.apiKey !== "string" ||
    parsed.apiKey.trim() === ""
  ) {
    throw new Error(`${P4_RUN_STATE_INVALID}: ${file} does not have the expected shape (content not printed).`);
  }
  return { version: 1, product, baseUrl: parsed.baseUrl, apiKey: parsed.apiKey };
}
