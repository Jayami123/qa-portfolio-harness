/**
 * Twenty MCP (ADR 0006, Task 7). Opt-in with TWENTY_MCP=1 exactly. Twenty v2.44.0 serves /mcp with no gate (probe,
 * 2026-11-17), so the only harness step is to mint a scoped API key. The workspace token from the loginToken exchange
 * is required: the token from a plain signIn is rejected by /mcp and cannot create keys.
 */
export const TWENTY_MCP_ENV = "TWENTY_MCP";

export function twentyMcpEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[TWENTY_MCP_ENV] === "1";
}

export function twentyMcpUrl(baseUrl: string): string {
  return `${baseUrl}/mcp`;
}

export interface ApiKeyRole {
  id: string;
  label: string;
  canUpdateAllSettings?: boolean;
  canUpdateAllObjectRecords?: boolean;
}

/**
 * The least-privileged assignable role: prefer one that cannot change settings or update all records, then one that
 * cannot change settings. Throws, naming the labels only, when every role can change settings.
 */
export function selectApiKeyRole(roles: ApiKeyRole[]): ApiKeyRole {
  const readOnlyish = roles.find((r) => !r.canUpdateAllSettings && !r.canUpdateAllObjectRecords);
  if (readOnlyish) {
    return readOnlyish;
  }
  const noSettings = roles.find((r) => !r.canUpdateAllSettings);
  if (noSettings) {
    return noSettings;
  }
  const labels = roles.map((r) => r.label).join(", ");
  throw new Error(`TWENTY_MCP_ROLE_UNAVAILABLE: no API key role without settings access (roles: ${labels || "none"})`);
}

export const GET_API_KEY_ROLES = `query { getApiKeyRoles { id label canUpdateAllSettings canUpdateAllObjectRecords } }`;

export const CREATE_API_KEY = `mutation CreateApiKey($input: CreateApiKeyInput!) { createApiKey(input: $input) { id } }`;

export const GENERATE_API_KEY_TOKEN = `mutation GenerateApiKeyToken($apiKeyId: UUID!, $expiresAt: String!) { generateApiKeyToken(apiKeyId: $apiKeyId, expiresAt: $expiresAt) { token } }`;

/** ISO expiry `hours` after `now`. The key is short-lived; down() leaves it to expire. */
export function apiKeyExpiry(now: Date, hours = 4): string {
  return new Date(now.getTime() + hours * 3_600_000).toISOString();
}

/** Reads the token from a generateApiKeyToken reply. Throws a fixed message and never echoes the body. */
export function extractApiKeyToken(body: { data?: { generateApiKeyToken?: { token?: unknown } } | null; errors?: unknown[] }): string {
  const token = body?.data?.generateApiKeyToken?.token;
  if (typeof token !== "string" || token === "" || (body.errors && body.errors.length > 0)) {
    throw new Error("TWENTY_MCP_TOKEN_MISSING: generateApiKeyToken returned no token (body not printed)");
  }
  return token;
}
