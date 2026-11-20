/** Pinned in docs/pins/p4.md. Official image, no fork (ADR 0007, D13). v1.110.0 is the newest stable at 2026-11-18. */
export declare const LITELLM_IMAGE = "ghcr.io/berriai/litellm:v1.110.0@sha256:4295b064b22eb88f9530e616afc812edd47048891ba64896bfc3fa74e2b883c3";
export declare const LITELLM_COMPOSE_PROJECT = "qa-harness-litellm";
/** Alias on qa-harness-p4 (review answer 0.1). Other hosts reach the proxy at http://litellm:4000/v1. */
export declare const LITELLM_NETWORK_ALIAS = "litellm";
export declare const LITELLM_STUB_ALIAS = "p4-stub";
export declare const LITELLM_NIGHTLY_ALIAS = "p4-nightly";
/** The only two aliases (D14). */
export declare const LITELLM_ALIASES: readonly ["p4-stub", "p4-nightly"];
export type P4LlmMode = "stub" | "nightly";
/** Blank or unset means stub. Anything other than stub or nightly throws. Never reads a key. */
export declare function parseP4LlmMode(raw: string | undefined): P4LlmMode;
/** Per-run master key, "sk-" prefixed (accepted by the B1 spike). Never logged. */
export declare function generateLiteLlmMasterKey(randomBytes?: (n: number) => Buffer): string;
/**
 * Validates an optional P4_STUB_API_BASE. Blank or unset returns undefined (p4-stub keeps mock_response). Otherwise it
 * must be an http(s) URL with no credentials, query or fragment; the trailing slash is removed. The value is never echoed
 * in the error. The URL is read by the LiteLLM container, so it must be reachable from there (a container alias on
 * qa-harness-p4, or http://host.docker.internal:<port>/v1, which the compose file maps to the host gateway).
 */
export declare function parseStubApiBase(raw: string | undefined): string | undefined;
/**
 * The proxy config. It holds no secret: the master key comes from LITELLM_MASTER_KEY and the Gemma key from
 * GEMINI_API_KEY. p4-stub answers from config-level mock_response (VERIFIED on v1.110.0, review answer 0.9).
 * There are two aliases and no fallback keys (D14).
 *
 * With `stubApiBase` set (env P4_STUB_API_BASE), p4-stub instead routes to that OpenAI-compatible stub (the suite's fixture
 * server) and the proxy forwards the client's `x-` headers, so X-P4-Fixture reaches the stub. The upstream key is a fixed
 * placeholder, not a secret. With it unset, nothing changes: p4-stub answers from mock_response.
 */
export declare function liteLlmConfigYaml(opts?: {
    stubApiBase?: string;
}): string;
/**
 * The environment for `docker compose`. GEMINI_API_KEY is passed only in nightly mode. In stub mode it is an empty
 * string, which overrides any key in the caller's shell (D14).
 */
export declare function liteLlmComposeEnv(base: NodeJS.ProcessEnv, opts: {
    mode: P4LlmMode;
    masterKey: string;
    configFile: string;
}): NodeJS.ProcessEnv;
/** Reads the saved master key from a secrets text, or makes a new one. Same shape as nextcloudSecretsFromText. */
export declare function litellmSecretsFromText(text: string | undefined, make?: () => {
    masterKey: string;
}): {
    masterKey: string;
};
export declare function litellmComposeFiles(): string[];
//# sourceMappingURL=litellm-env.d.ts.map