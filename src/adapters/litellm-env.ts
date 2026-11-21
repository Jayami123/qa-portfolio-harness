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

/** The provider behind p4-nightly. Gemma is the default; DeepSeek is opt-in (v0.6.11). */
export type P4NightlyProvider = "gemma" | "deepseek";

/**
 * Blank or unset means gemma. Anything other than gemma or deepseek throws, and the value is never printed. Same shape as
 * parseP4LlmMode. It only picks which upstream p4-nightly uses; there is no fallback between providers (D14).
 */
export function parseP4NightlyProvider(raw: string | undefined): P4NightlyProvider {
  const value = (raw ?? "").trim();
  if (value === "" || value === "gemma") {
    return "gemma";
  }
  if (value === "deepseek") {
    return "deepseek";
  }
  throw new Error('P4_NIGHTLY_PROVIDER must be "gemma" or "deepseek" (the value is not printed).');
}

/** Per-run master key, "sk-" prefixed (accepted by the B1 spike). Never logged. */
export function generateLiteLlmMasterKey(randomBytes: (n: number) => Buffer = crypto.randomBytes): string {
  return `sk-p4-${randomBytes(24).toString("base64url")}`;
}

/**
 * Validates an optional P4_STUB_API_BASE. Blank or unset returns undefined (p4-stub keeps mock_response). Otherwise it
 * must be an http(s) URL with no credentials, query or fragment; the trailing slash is removed. The value is never echoed
 * in the error. The URL is read by the LiteLLM container, so it must be reachable from there (a container alias on
 * qa-harness-p4, or http://host.docker.internal:<port>/v1, which the compose file maps to the host gateway).
 */
export function parseStubApiBase(raw: string | undefined): string | undefined {
  const value = (raw ?? "").trim();
  if (value === "") {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("P4_STUB_API_BASE_INVALID: not a URL (the value is not printed).");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("P4_STUB_API_BASE_INVALID: the scheme must be http or https.");
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error("P4_STUB_API_BASE_INVALID: credentials, a query or a fragment are not allowed.");
  }
  return value.replace(/\/+$/, "");
}

/**
 * The proxy config. It holds no secret: the master key comes from LITELLM_MASTER_KEY and the Gemma key from
 * GEMINI_API_KEY. p4-stub answers from config-level mock_response (VERIFIED on v1.110.0, review answer 0.9).
 * There are two aliases and no fallback keys (D14).
 *
 * With `stubApiBase` set (env P4_STUB_API_BASE), p4-stub instead routes to that OpenAI-compatible stub (the suite's fixture
 * server) and the proxy forwards the client's `x-` headers, so X-P4-Fixture reaches the stub. The upstream key is a fixed
 * placeholder, not a secret. With it unset, nothing changes: p4-stub answers from mock_response.
 */
/**
 * The p4-nightly entry for each provider. Only the chosen provider is written; there is no fallback (D14).
 *
 * deepseek (checked 2026-11-21):
 * - Model id `deepseek-flash`, from https://api-docs.deepseek.com/ ("Use `deepseek-flash` as the model name"; the
 *   Models & Pricing table lists DeepSeek-V4.1-Flash-1017 for it). The LiteLLM model is `deepseek/deepseek-flash`.
 * - LiteLLM v1.110.0 supports the `deepseek/` prefix: https://docs.litellm.ai/docs/providers/deepseek ("set `deepseek/`
 *   as a prefix"). The pinned image's bundled cost map lists `deepseek/deepseek-flash` with provider `deepseek`, and
 *   its chat transformation reads DEEPSEEK_API_KEY.
 * - Rate limits: https://api-docs.deepseek.com/quick_start/rate_limit publishes only a concurrency limit (2500 for
 *   deepseek-flash, HTTP 429 when exceeded). It publishes no RPM or TPM figure, so rpm and tpm are NOT set here.
 * - num_retries 3 is kept as for gemma. The LiteLLM reliability page shows num_retries under litellm_settings and
 *   router_settings, not as a litellm_params key; this placement is UNVERIFIED on v1.110.0, as it is for gemma.
 */
function nightlyParams(provider: P4NightlyProvider): string[] {
  if (provider === "deepseek") {
    return ["      model: deepseek/deepseek-flash", "      api_key: os.environ/DEEPSEEK_API_KEY", "      num_retries: 3"];
  }
  // Free-tier limits for the Gemma model, checked 2026-11-18 against the Google AI Studio rate-limits page
  // (https://aistudio.google.com/docs/rate-limits). That page lists no Gemma free-tier figures; its only free-tier
  // figures are for Gemini (RPM 200, TPM 50,000, RPD 10,000), which do not apply to this model.
  // rpm 30 is the owner's setting and is not verified on the page.
  // tpm 16000 is UNVERIFIED: taken from the suite plan.
  // num_retries: LiteLLM retries retriable errors, rate-limit (HTTP 429) errors included.
  return [
    "      model: gemini/gemma-4-31b-it",
    "      api_key: os.environ/GEMINI_API_KEY",
    "      rpm: 30",
    "      tpm: 16000",
    "      num_retries: 3",
  ];
}

export function liteLlmConfigYaml(
  opts: { stubApiBase?: string; nightlyProvider?: P4NightlyProvider } = {},
): string {
  const stubParams =
    opts.stubApiBase === undefined
      ? ['      mock_response: "stub-ok"']
      : [`      api_base: "${opts.stubApiBase}"`, '      api_key: "p4-stub-upstream-placeholder"'];
  return [
    "model_list:",
    `  - model_name: ${LITELLM_STUB_ALIAS}`,
    "    litellm_params:",
    "      model: openai/stub-upstream-model",
    ...stubParams,
    `  - model_name: ${LITELLM_NIGHTLY_ALIAS}`,
    "    litellm_params:",
    ...nightlyParams(opts.nightlyProvider ?? "gemma"),
    "general_settings:",
    "  master_key: os.environ/LITELLM_MASTER_KEY",
    ...(opts.stubApiBase === undefined ? [] : ["  forward_client_headers_to_llm_api: true"]),
    "",
  ].join("\n");
}

/**
 * The environment for `docker compose`. GEMINI_API_KEY and DEEPSEEK_API_KEY are passed only in nightly mode. In stub mode
 * they are empty strings, which override any key in the caller's shell (D14). The keys are never printed or logged.
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
    DEEPSEEK_API_KEY: opts.mode === "nightly" ? (base.DEEPSEEK_API_KEY ?? "") : "",
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
