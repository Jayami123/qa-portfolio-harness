/**
 * Twenty MCP (ADR 0006, Task 7). Opt-in with TWENTY_MCP=1 exactly. Twenty v2.44.0 serves /mcp with no gate (probe,
 * 2026-11-17), so the only harness step is to mint a scoped API key. The workspace token from the loginToken exchange
 * is required: the token from a plain signIn is rejected by /mcp and cannot create keys.
 */
export declare const TWENTY_MCP_ENV = "TWENTY_MCP";
export declare function twentyMcpEnabled(env: NodeJS.ProcessEnv): boolean;
export declare function twentyMcpUrl(baseUrl: string): string;
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
export declare function selectApiKeyRole(roles: ApiKeyRole[]): ApiKeyRole;
export declare const GET_API_KEY_ROLES = "query { getApiKeyRoles { id label canUpdateAllSettings canUpdateAllObjectRecords } }";
export declare const CREATE_API_KEY = "mutation CreateApiKey($input: CreateApiKeyInput!) { createApiKey(input: $input) { id } }";
export declare const GENERATE_API_KEY_TOKEN = "mutation GenerateApiKeyToken($apiKeyId: UUID!, $expiresAt: String!) { generateApiKeyToken(apiKeyId: $apiKeyId, expiresAt: $expiresAt) { token } }";
/** ISO expiry `hours` after `now`. The key is short-lived; down() leaves it to expire. */
export declare function apiKeyExpiry(now: Date, hours?: number): string;
/** Reads the token from a generateApiKeyToken reply. Throws a fixed message and never echoes the body. */
export declare function extractApiKeyToken(body: {
    data?: {
        generateApiKeyToken?: {
            token?: unknown;
        };
    } | null;
    errors?: unknown[];
}): string;
//# sourceMappingURL=twenty-mcp.d.ts.map