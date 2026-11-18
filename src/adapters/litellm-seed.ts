/** Builders and parsers for LiteLLM readiness. No I/O here, so every function is unit tested. */
import { LITELLM_ALIASES, LITELLM_NIGHTLY_ALIAS, LITELLM_STUB_ALIAS } from "./litellm-env.js";

/** Throws unless the live /v1/models list is exactly the two aliases (D14). Never echoes the body. */
export function assertLiteLlmModels(body: unknown): string[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    throw new Error("LITELLM_MODELS_MISSING: /v1/models has no data array (body not printed)");
  }
  const ids = data
    .map((m) => (m as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === "string")
    .sort();
  const expected = [...LITELLM_ALIASES].sort();
  if (ids.length !== expected.length || ids.some((id, i) => id !== expected[i])) {
    throw new Error(`LITELLM_ALIASES_WRONG: expected exactly ${expected.join(", ")}; got ${ids.length} model ids`);
  }
  return ids;
}

/**
 * Reads the route from the response headers of a p4-stub call (names VERIFIED on v1.110.0). Throws unless the model
 * group is p4-stub and the upstream name is present.
 */
export function stubRouteFromHeaders(headers: { get(name: string): string | null }): { alias: string; upstream: string } {
  const alias = headers.get("x-litellm-model-group") ?? "";
  const upstream = headers.get("x-litellm-model-name") ?? "";
  if (alias !== LITELLM_STUB_ALIAS) {
    throw new Error(`LITELLM_ROUTE_WRONG: model group is "${alias}", expected ${LITELLM_STUB_ALIAS}`);
  }
  if (upstream === "") {
    throw new Error("LITELLM_ROUTE_WRONG: no x-litellm-model-name header");
  }
  return { alias, upstream };
}

/** The one completion readiness makes. It always names p4-stub, never p4-nightly (D14). */
export function stubCompletionRequest(baseUrl: string, apiKey: string): { url: string; init: RequestInit } {
  return {
    url: `${baseUrl}/chat/completions`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: LITELLM_STUB_ALIAS,
        messages: [{ role: "user", content: "p4 readiness ping" }],
        max_tokens: 4,
      }),
    },
  };
}

/** Guard: readiness code never sends the Gemma alias. */
export function assertNoNightlyCall(init: RequestInit): void {
  const body = typeof init.body === "string" ? init.body : "";
  if (body.includes(`"${LITELLM_NIGHTLY_ALIAS}"`)) {
    throw new Error("LITELLM_NIGHTLY_CALL_REFUSED: readiness never calls p4-nightly");
  }
}

/** A tools/list reply is JSON, or an SSE body with one `data:` line. Returns the tools array. Never echoes the text. */
export function toolsFromMcpReply(text: string): unknown[] {
  const trimmed = text.trim();
  const dataLine = trimmed.startsWith("{")
    ? trimmed
    : (trimmed.split(/\r?\n/).find((line) => line.startsWith("data:")) ?? "").slice("data:".length).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLine);
  } catch {
    throw new Error("MCP_REPLY_UNREADABLE: the tools/list reply is not JSON (text not printed)");
  }
  const tools = (parsed as { result?: { tools?: unknown } } | null)?.result?.tools;
  if (!Array.isArray(tools)) {
    throw new Error("MCP_REPLY_UNREADABLE: the tools/list reply has no result.tools array");
  }
  return tools;
}

/** Throws unless /mcp lists no tools. With no grants LiteLLM's /mcp must advertise nothing (review answer 0.4). */
export function assertEmptyToolsList(text: string): void {
  const tools = toolsFromMcpReply(text);
  if (tools.length !== 0) {
    throw new Error(`LITELLM_MCP_NOT_EMPTY: /mcp listed ${tools.length} tools; expected none (no grants)`);
  }
}
