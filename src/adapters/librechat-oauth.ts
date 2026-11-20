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

export const LIBRECHAT_MCP_OAUTH_INVALID = "LIBRECHAT_MCP_OAUTH_INVALID";
export const LIBRECHAT_MCP_OAUTH_NO_SERVER = "LIBRECHAT_MCP_OAUTH_NO_SERVER";
export const LIBRECHAT_MCP_OAUTH_NOT_REGISTERED = "LIBRECHAT_MCP_OAUTH_NOT_REGISTERED";

/**
 * Products whose MCP server is protected by an authorization server the product itself runs (probe, session 8). Twenty
 * serves RFC 9728 and RFC 8414 metadata, /oauth/register (dynamic client registration), /oauth/token and /authorize (frontend).
 * Not in the list: Nextcloud (OAuth mode needs an OIDC provider and the user_oidc app, not built), Outline and Penpot (no
 * OAuth metadata), Mattermost (no dynamic registration on the site; not built), and lab (no OAuth).
 */
export const OAUTH_CAPABLE_PRODUCTS: readonly string[] = ["twenty"];

/**
 * The origin the owner's browser uses for LibreChat, and the callback base. It is LibreChat's own default (DOMAIN_SERVER unset
 * means http://localhost:3080), so the callback URL LibreChat would use is the same one written here. The initiate and the
 * callback must share one origin, because LibreChat's CSRF cookie is set by the initiate request.
 */
export const LIBRECHAT_OAUTH_CALLBACK_BASE = "http://localhost:3080";
/** The scope LibreChat requested before this change (observed in the authorize URL of v0.8.9). Pinned so the config is explicit. */
export const LIBRECHAT_OAUTH_SCOPE = "api profile";

/** Exactly "1" turns OAuth sign-in on. Unset is off. Any other value throws without echoing it. */
export function parseMcpOauthFlag(raw: string): boolean {
  if (raw === "") return false;
  if (raw === "1") return true;
  throw new Error(`${LIBRECHAT_MCP_OAUTH_INVALID}: LIBRECHAT_MCP_OAUTH must be exactly "1" or unset (value not printed)`);
}

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
export function resolveLibreChatMcpOauth(opts: {
  flag: string;
  mcpProducts: string[];
  twentyBrowserBaseUrl: string;
}): LibreChatMcpOauth | null {
  if (!parseMcpOauthFlag(opts.flag)) return null;
  const products = opts.mcpProducts.filter((p) => OAUTH_CAPABLE_PRODUCTS.includes(p));
  if (products.length === 0) {
    throw new Error(
      `${LIBRECHAT_MCP_OAUTH_NO_SERVER}: LIBRECHAT_MCP_OAUTH=1 needs an OAuth-capable product in LIBRECHAT_MCP_PRODUCTS (${OAUTH_CAPABLE_PRODUCTS.join(", ")})`,
    );
  }
  const base = new URL(opts.twentyBrowserBaseUrl).toString().replace(/\/$/, "");
  return { products, twentyBrowserBaseUrl: base, clients: {} };
}

/** The callback URL LibreChat is told to use for a product. Registered with the product, and pinned in librechat.yaml. */
export function oauthRedirectUri(product: string): string {
  return `${LIBRECHAT_OAUTH_CALLBACK_BASE}/api/mcp/${product}/oauth/callback`;
}

/** The authorization URL the owner's browser opens for a product, or null when the product is not an OAuth product. */
export function oauthAuthorizationUrl(product: string, oauth: LibreChatMcpOauth | null): string | null {
  if (oauth === null || !oauth.products.includes(product)) return null;
  if (product === "twenty") return `${oauth.twentyBrowserBaseUrl}/authorize`;
  throw new Error(`${LIBRECHAT_MCP_OAUTH_INVALID}: no authorization URL is defined for "${product}"`);
}

/**
 * Applies H4 to one server: drops its static header and writes the pre-configured oauth block (authorization URL for the
 * browser, token URL inside the network, the registered client id, the callback and the scope). Other servers pass through.
 */
export function applyMcpOauth(server: LibreChatMcpServer, product: string, oauth: LibreChatMcpOauth | null): LibreChatMcpServer {
  const authorizationUrl = oauthAuthorizationUrl(product, oauth);
  if (authorizationUrl === null || oauth === null) return server;
  const clientId = oauth.clients[product];
  if (clientId === undefined || clientId === "") {
    throw new Error(`${LIBRECHAT_MCP_OAUTH_NOT_REGISTERED}: no OAuth client is registered for "${product}" yet`);
  }
  const tokenUrl = `${new URL(server.url).origin}/oauth/token`;
  return {
    ...server,
    authEnv: null,
    oauth: { authorizationUrl, tokenUrl, clientId, redirectUri: oauthRedirectUri(product), scope: LIBRECHAT_OAUTH_SCOPE },
  };
}

/** The RFC 7591 registration body for a product's public client. No secret is requested or returned. */
export function oauthRegistrationBody(product: string): Record<string, unknown> {
  return {
    client_name: `qa-harness L3 H4 (${product})`,
    redirect_uris: [oauthRedirectUri(product)],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: LIBRECHAT_OAUTH_SCOPE,
  };
}

/** Lines for one server's `oauth` block in librechat.yaml. Every value is a public address, a public id or a scope. */
export function mcpOauthYamlLines(server: LibreChatMcpServer): string[] {
  if (server.oauth === undefined) return [];
  const o = server.oauth;
  return [
    "    oauth:",
    `      authorization_url: "${o.authorizationUrl}"`,
    `      token_url: "${o.tokenUrl}"`,
    `      client_id: "${o.clientId}"`,
    `      redirect_uri: "${o.redirectUri}"`,
    `      scope: "${o.scope}"`,
  ];
}

/** Hosts of the browser authorize URLs, which LibreChat must allow in mcpSettings.allowedDomains. */
export function oauthAllowedHosts(servers: LibreChatMcpServer[]): string[] {
  return servers.flatMap((s) => (s.oauth === undefined ? [] : [new URL(s.oauth.authorizationUrl).hostname]));
}

export interface SecretLeakOptions {
  /** Values that must never appear (for example the owner's password and a per-run JWT). Values under 8 characters are ignored. */
  values?: string[];
}

/**
 * Leak check for text the harness is about to print or write. Returns the names of the rules that matched, never the matched
 * text. Rules: any listed value, a JWT shape, a Bearer token, a Set-Cookie header, a refresh or access cookie, an OAuth `code=`
 * query value, and a `client_secret` assignment. An empty list means nothing matched.
 */
export function findSecretLeaks(text: string, opts: SecretLeakOptions = {}): string[] {
  const hits: string[] = [];
  for (const value of opts.values ?? []) {
    if (value.length >= 8 && text.includes(value)) hits.push("listed value");
  }
  const rules: Array<[string, RegExp]> = [
    ["jwt", /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
    ["bearer", /bearer\s+[A-Za-z0-9._~+/=-]{16,}/i],
    ["set-cookie", /set-cookie\s*:/i],
    ["cookie", /(refreshToken|token_provider|connect\.sid)=[^\s;]{8,}/],
    ["oauth-code", /[?&]code=[A-Za-z0-9._-]{8,}/],
    ["client-secret", /client_secret["']?\s*[:=]\s*["']?[^\s"',}]{6,}/i],
  ];
  for (const [name, re] of rules) {
    if (re.test(text)) hits.push(name);
  }
  return [...new Set(hits)];
}

/**
 * The servers the readiness wait must see connected. An OAuth product reads "disconnected" until the owner signs in
 * (LibreChat opens no user connection without a token), so it is left out here. The live H4 check signs it in.
 */
export function mcpWaitNames(products: string[], oauth: LibreChatMcpOauth | null): string[] {
  const oauthProducts = new Set(oauth?.products ?? []);
  return products.filter((p) => !oauthProducts.has(p));
}

/** Returns the same options with the registered client ids set. Pure: the registration itself is in librechat-oauth-register.ts. */
export function withRegisteredClients(oauth: LibreChatMcpOauth, clients: Record<string, string>): LibreChatMcpOauth {
  return { ...oauth, clients: { ...clients } };
}
