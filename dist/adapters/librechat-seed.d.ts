import { type LibreChatMcpServer } from "./librechat-env.js";
import { type LibreChatMcpOauth } from "./librechat-oauth.js";
/** The Mongo URI for the app. The password is percent-encoded and authSource is the root database (see the compose file). */
export declare function librechatMongoUri(password: string): string;
/**
 * The shape of a header value written into librechat.env: one scheme (Basic or Bearer), one space, then a token made of
 * URL-safe characters. Nothing is trimmed, so a bad value is reported, not quietly fixed. The reason names the problem and
 * never includes the value.
 */
export declare function assertMcpAuthorizationShape(product: string, value: string): void;
/**
 * For each Part A product in the list: the alias server entry, and the Authorization env value from its run state
 * (credential only, review answer 0.1). Throws the named P4_RUN_STATE_MISSING when a run state is absent, and
 * LIBRECHAT_MCP_AUTH_MISSING when a product that needs a header has none.
 */
export declare function librechatMcpEnv(products: string[], readCreds?: (product: string, file: string) => {
    mcpAuthorization: string | null;
}, stateFile?: (product: string) => string, oauth?: LibreChatMcpOauth | null): {
    servers: LibreChatMcpServer[];
    env: Record<string, string>;
};
/**
 * Arguments for `npm run create-user` in the app container. Non-interactive: all four values and the verified flag.
 * The caller runs this through runCapture with the password redacted, so no log line carries it.
 */
export declare function createOwnerArgs(password: string): string[];
/** Throws unless every expected server reports connected (review answer 0.7). Never echoes the status body. */
export declare function assertServersConnected(statusBody: unknown, expected: string[]): void;
/** Counts the tools each expected server lists from /api/mcp/tools. Throws if any server lists none (review answer 0.7). */
export declare function toolCountsByServer(toolsBody: unknown, expected: string[]): Record<string, number>;
/** POST /api/auth/login for the seeded owner. The request body is never logged. */
export declare function loginRequest(baseUrl: string, email: string, password: string): {
    url: string;
    init: RequestInit;
};
/** Reads the bearer token from a login reply. Throws a fixed message and never echoes the body. */
export declare function tokenFromLogin(body: unknown): string;
//# sourceMappingURL=librechat-seed.d.ts.map