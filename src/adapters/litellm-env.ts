import crypto from "node:crypto";
import { harnessComposeFile } from "../internal/compose.js";

/** Pinned in docs/pins/p4.md. Official image, no fork (ADR 0007, D13). v1.110.0 is the newest stable at 2026-11-18. */
export const LITELLM_IMAGE =
  "ghcr.io/berriai/litellm:v1.110.0@sha256:4295b064b22eb88f9530e616afc812edd47048891ba64896bfc3fa74e2b883c3";
export const LITELLM_COMPOSE_PROJECT = "qa-harness-litellm";
/** Alias on qa-harness-p4 (review answer 0.1). Other hosts reach the proxy at http://litellm:4000/v1. */
export const LITELLM_NETWORK_ALIAS = "litellm";
export const LITELLM_STUB_ALIAS = "p4-stub";
export const LITELLM_NIGHTLY_ALIAS = "p4-nightly";
/** The only two aliases (D14). */
export const LITELLM_ALIASES = [LITELLM_STUB_ALIAS, LITELLM_NIGHTLY_ALIAS] as const;

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

/** Per-run master key, "sk-" prefixed (accepted by the B1 spike). Never logged. */
export function generateLiteLlmMasterKey(randomBytes: (n: number) => Buffer = crypto.randomBytes): string {
  return `sk-p4-${randomBytes(24).toString("base64url")}`;
}

/**
 * The proxy config. It holds no secret: the master key comes from LITELLM_MASTER_KEY and the Gemma key from
 * GEMINI_API_KEY. p4-stub answers from config-level mock_response (VERIFIED on v1.110.0, review answer 0.9).
 * There are two aliases and no fallback keys (D14).
 */
export function liteLlmConfigYaml(): string {
  return [
    "model_list:",
    `  - model_name: ${LITELLM_STUB_ALIAS}`,
    "    litellm_params:",
    "      model: openai/stub-upstream-model",
    '      mock_response: "stub-ok"',
    `  - model_name: ${LITELLM_NIGHTLY_ALIAS}`,
    "    litellm_params:",
    "      model: gemini/gemma-4-31b-it",
    "      api_key: os.environ/GEMINI_API_KEY",
    "general_settings:",
    "  master_key: os.environ/LITELLM_MASTER_KEY",
    "",
  ].join("\n");
}

/**
 * The environment for `docker compose`. GEMINI_API_KEY is passed only in nightly mode. In stub mode it is an empty
 * string, which overrides any key in the caller's shell (D14).
 */
export function liteLlmComposeEnv(
  base: NodeJS.ProcessEnv,
  opts: { mode: P4LlmMode; masterKey: string; configFile: string },
): NodeJS.ProcessEnv {
  return {
    ...base,
    LITELLM_MASTER_KEY: opts.masterKey,
    LITELLM_CONFIG_FILE: opts.configFile,
    GEMINI_API_KEY: opts.mode === "nightly" ? (base.GEMINI_API_KEY ?? "") : "",
  };
}

/** Reads the saved master key from a secrets text, or makes a new one. Same shape as nextcloudSecretsFromText. */
export function litellmSecretsFromText(
  text: string | undefined,
  make: () => { masterKey: string } = () => ({ masterKey: generateLiteLlmMasterKey() }),
): { masterKey: string } {
  if (text === undefined) {
    return make();
  }
  try {
    const parsed = JSON.parse(text) as { masterKey?: unknown };
    if (typeof parsed.masterKey === "string" && parsed.masterKey.startsWith("sk-")) {
      return { masterKey: parsed.masterKey };
    }
  } catch {
    // damaged file: fall through and make a new key
  }
  return make();
}

export function litellmComposeFiles(): string[] {
  return [harnessComposeFile("litellm.compose.yml")];
}
