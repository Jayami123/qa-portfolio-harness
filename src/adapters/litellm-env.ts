/** Mode for the LiteLLM aliases (ADR 0007, D14). Task 1 holds only the parser. Task 3 adds the rest of this file. */
export type P4LlmMode = "stub" | "nightly";

/** Blank or unset means stub. Anything other than stub or nightly throws. Never reads a key. */
export function parseP4LlmMode(raw: string | undefined): P4LlmMode {
  const value = (raw ?? "").trim();
  if (value === "" || value === "stub") {
    return "stub";
  }
  if (value === "nightly") {
    return "nightly";
  }
  throw new Error('P4_LLM_MODE must be "stub" or "nightly" (the value is not printed).');
}
