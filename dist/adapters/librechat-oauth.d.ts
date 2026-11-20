/**
 * H4: OAuth sign-in for LibreChat MCP connections. Opt-in with LIBRECHAT_MCP_OAUTH=1 (exact value, off by default).
 *
 * Unset, nothing changes: every server keeps `requiresOAuth: false` and its static Authorization header, and the written
 * librechat.yaml and env file are byte-identical to 0.6.8 (unit tested).
 *
 * With the flag on, a server listed in OAUTH_CAPABLE_PRODUCTS (and named in LIBRECHAT_MCP_PRODUCTS) is written with
 * `requiresOAuth: true`, no static header, and a pre-configured `oauth` block. The harness registers a public OAuth client
 * with the product before LibreChat starts (RFC 7591 dynamic registration, token_endpoint_auth_method none, PKCE S256). The
 * client id is not a secret. There is no client secret. LibreChat stores the tokens it receives, encrypted with CREDS_KEY,
 * in MongoDB. The harness never reads them.
 *
 * Why pre-configured and not discovered: LibreChat builds the browser's authorize URL from the metadata it fetches inside
 * the network (issuer http://twenty-server:3000), which the owner's browser cannot open. With the endpoints pinned, the
 * browser URL is the host-published one. LibreChat takes the pre-configured path only when authorization_url, token_url and
 * client_id are all set (packages/api/src/mcp/oauth/handler.ts, the "pre-configured OAuth settings" branch).
 *
 * The probe that picked the capable servers is recorded in docs/plans/2026-11-19-librechat-l3-primitives.md (session 8).
 */
import type { LibreChatMcpServer } from "./librechat-env.js";
export declare const LIBRECHAT_MCP_OAUTH_INVALID = "LIBRECHAT_MCP_OAUTH_INVALID";
export declare const LIBRECHAT_MCP_OAUTH_NO_SERVER = "LIBRECHAT_MCP_OAUTH_NO_SERVER";
export declare const LIBRECHAT_MCP_OAUTH_NOT_REGISTERED = "LIBRECHAT_MCP_OAUTH_NOT_REGISTERED";
/**
 * Products whose MCP server is protected by an authorization server the product itself runs (probe, session 8). Twenty
 * serves RFC 9728 and RFC 8414 metadata, /oauth/register (dynamic client registration), /oauth/token and /authorize (frontend).
 * Not in the list: Nextcloud (OAuth mode needs an OIDC provider and the user_oidc app, not built), Outline and Penpot (no
 * OAuth metadata), Mattermost (no dynamic registration on the site; not built), and lab (no OAuth).
 */
export declare const OAUTH_CAPABLE_PRODUCTS: readonly string[];
/**
 * The origin the owner's browser uses for LibreChat, and the callback base. It is LibreChat's own default (DOMAIN_SERVER unset
 * means http://localhost:3080), so the callback URL LibreChat would use is the same one written here. The initiate and the
 * callback must share one origin, because LibreChat's CSRF cookie is set by the initiate request.
 */
export declare const LIBRECHAT_OAUTH_CALLBACK_BASE = "http://localhost:3080";
/** The scope LibreChat requested before this change (observed in the authorize URL of v0.8.9). Pinned so the config is explicit. */
export declare const LIBRECHAT_OAUTH_SCOPE = "api profile";
/** Exactly "1" turns OAuth sign-in on. Unset is off. Any other value throws without echoing it. */
export declare function parseMcpOauthFlag(raw: string): boolean;
export interface LibreChatMcpOauth {
    /** Products that sign in with OAuth. Always a subset of OAUTH_CAPABLE_PRODUCTS and of LIBRECHAT_MCP_PRODUCTS. */
    products: string[];
    /** Browser-reachable base URL of Twenty (TWENTY_BASE_URL). Its /authorize page is opened by the owner's browser. */
    twentyBrowserBaseUrl: string;
    /** Client id per product, filled by the adapter after registration. Empty until then. */
    clients: Record<string, string>;
}
/**
 * Resolves the H4 option. Returns null when the flag is off. With the flag on, the OAuth products are the capable products
 * named in LIBRECHAT_MCP_PRODUCTS. With the flag on and none of them named, it throws rather than doing nothing.
 */
export declare function resolveLibreChatMcpOauth(opts: {
    flag: string;
    mcpProducts: string[];
    twentyBrowserBaseUrl: string;
}): LibreChatMcpOauth | null;
/** The callback URL LibreChat is told to use for a product. Registered with the product, and pinned in librechat.yaml. */
export declare function oauthRedirectUri(product: string): string;
/** The authorization URL the owner's browser opens for a product, or null when the product is not an OAuth product. */
export declare function oauthAuthorizationUrl(product: string, oauth: LibreChatMcpOauth | null): string | null;
/**
 * Applies H4 to one server: drops its static header and writes the pre-configured oauth block (authorization URL for the
 * browser, token URL inside the network, the registered client id, the callback and the scope). Other servers pass through.
 */
export declare function applyMcpOauth(server: LibreChatMcpServer, product: string, oauth: LibreChatMcpOauth | null): LibreChatMcpServer;
/** The RFC 7591 registration body for a product's public client. No secret is requested or returned. */
export declare function oauthRegistrationBody(product: string): Record<string, unknown>;
/** Lines for one server's `oauth` block in librechat.yaml. Every value is a public address, a public id or a scope. */
export declare function mcpOauthYamlLines(server: LibreChatMcpServer): string[];
/** Hosts of the browser authorize URLs, which LibreChat must allow in mcpSettings.allowedDomains. */
export declare function oauthAllowedHosts(servers: LibreChatMcpServer[]): string[];
export interface SecretLeakOptions {
    /** Values that must never appear (for example the owner's password and a per-run JWT). Values under 8 characters are ignored. */
    values?: string[];
}
/**
 * Leak check for text the harness is about to print or write. Returns the names of the rules that matched, never the matched
 * text. Rules: any listed value, a JWT shape, a Bearer token, a Set-Cookie header, a refresh or access cookie, an OAuth `code=`
 * query value, and a `client_secret` assignment. An empty list means nothing matched.
 */
export declare function findSecretLeaks(text: string, opts?: SecretLeakOptions): string[];
/**
 * The servers the readiness wait must see connected. An OAuth product reads "disconnected" until the owner signs in
 * (LibreChat opens no user connection without a token), so it is left out here. The live H4 check signs it in.
 */
export declare function mcpWaitNames(products: string[], oauth: LibreChatMcpOauth | null): string[];
/** Returns the same options with the registered client ids set. Pure: the registration itself is in librechat-oauth-register.ts. */
export declare function withRegisteredClients(oauth: LibreChatMcpOauth, clients: Record<string, string>): LibreChatMcpOauth;
//# sourceMappingURL=librechat-oauth.d.ts.map