/** Builders, parsers and readiness checks for LibreChat. No I/O here, so every function is unit tested. */
import { readP4McpCredentials, p4RunStateFile } from "./p4-run-state.js";
import {
  LIBRECHAT_MONGO_HOST,
  LIBRECHAT_MONGO_USER,
  LIBRECHAT_OWNER_EMAIL,
  LIBRECHAT_OWNER_NAME,
  LIBRECHAT_OWNER_USERNAME,
  PENPOT_MCP_USER_TOKEN_ENV,
  librechatMcpServerFor,
  librechatMcpServerForRun,
  type LibreChatMcpServer,
} from "./librechat-env.js";
import { applyMcpOauth, type LibreChatMcpOauth } from "./librechat-oauth.js";

/** The Mongo URI for the app. The password is percent-encoded and authSource is the root database (see the compose file). */
export function librechatMongoUri(password: string): string {
  return `mongodb://${LIBRECHAT_MONGO_USER}:${encodeURIComponent(password)}@${LIBRECHAT_MONGO_HOST}:27017/LibreChat?authSource=admin`;
}

/**
 * The shape of a header value written into librechat.env: one scheme (Basic or Bearer), one space, then a token made of
 * URL-safe characters. Nothing is trimmed, so a bad value is reported, not quietly fixed. The reason names the problem and
 * never includes the value.
 */
export function assertMcpAuthorizationShape(product: string, value: string): void {
  const fail = (reason: string): never => {
    throw new Error(`LIBRECHAT_MCP_AUTH_SHAPE: ${product} authorization is ${reason} (value not printed)`);
  };
  if (value === "") fail("empty");
  if (/[\r\n]/.test(value)) fail("split by a line break or carriage return");
  if (/["']/.test(value)) fail("quoted");
  if (!/^(Basic|Bearer) /.test(value)) fail("missing a Basic or Bearer scheme");
  if (/^(Basic|Bearer) (Basic|Bearer) /.test(value)) fail("doubled with a second scheme");
  const token = value.slice(value.indexOf(" ") + 1);
  if (token === "") fail("missing its token");
  if (/\s/.test(token)) fail("containing whitespace inside the token");
  if (!/^[A-Za-z0-9._~+\/=_-]+$/.test(token)) fail("containing characters outside the URL-safe set");
}

/**
 * H6: the owner's Penpot token must be URL-safe: it goes into a query string and a compose env line unescaped. A value
 * outside that set is refused. The reason never includes the value.
 */
export function assertPenpotUserTokenShape(value: string): void {
  if (!/^[A-Za-z0-9._~-]+$/.test(value)) {
    throw new Error(`harness: LIBRECHAT_PENPOT_TOKEN_SHAPE: the Penpot owner token has characters outside the URL-safe set (value not printed)`);
  }
}

/**
 * For each Part A product in the list: the alias server entry, and the Authorization env value from its run state
 * (credential only, review answer 0.1). Throws the named P4_RUN_STATE_MISSING when a run state is absent, and
 * LIBRECHAT_MCP_AUTH_MISSING when a product that needs a header has none.
 * H6: `penpotPlugin` carries the owner's Penpot token. Penpot then takes the token URL and the token goes to the env file
 * as PENPOT_MCP_USER_TOKEN_ENV. Null (the default) leaves Penpot as before H6.
 */
export function librechatMcpEnv(
  products: string[],
  readCreds: (product: string, file: string) => { mcpAuthorization: string | null } = readP4McpCredentials,
  stateFile: (product: string) => string = p4RunStateFile,
  oauth: LibreChatMcpOauth | null = null,
  penpotPlugin: { ownerToken: string } | null = null,
): { servers: LibreChatMcpServer[]; env: Record<string, string> } {
  const servers: LibreChatMcpServer[] = [];
  const env: Record<string, string> = {};
  for (const product of products) {
    const tokenUrl = penpotPlugin !== null && product === "penpot";
    // H4: an OAuth product takes no static header, so its credential is neither read nor written to the env file.
    const server = applyMcpOauth(librechatMcpServerForRun(product, { penpotPlugin: tokenUrl }), product, oauth);
    servers.push(server);
    if (tokenUrl) {
      assertPenpotUserTokenShape(penpotPlugin.ownerToken);
      env[PENPOT_MCP_USER_TOKEN_ENV] = penpotPlugin.ownerToken;
      continue;
    }
    if (server.authEnv !== null) {
      const creds = readCreds(product, stateFile(product));
      if (creds.mcpAuthorization === null) {
        throw new Error(`LIBRECHAT_MCP_AUTH_MISSING: ${product} has no MCP credential in its run state (value not printed)`);
      }
      assertMcpAuthorizationShape(product, creds.mcpAuthorization);
      env[server.authEnv] = creds.mcpAuthorization;
    }
  }
  return { servers, env };
}

/**
 * Arguments for `npm run create-user` in the app container. Non-interactive: all four values and the verified flag.
 * The caller runs this through runCapture with the password redacted, so no log line carries it.
 */
export function createOwnerArgs(password: string): string[] {
  return [
    "run",
    "--silent", // npm does not echo the command, so the password is not echoed by npm
    "create-user",
    "--",
    LIBRECHAT_OWNER_EMAIL,
    LIBRECHAT_OWNER_NAME,
    LIBRECHAT_OWNER_USERNAME,
    password,
    "--email-verified=true",
  ];
}

/** Throws unless every expected server reports connected (review answer 0.7). Never echoes the status body. */
export function assertServersConnected(statusBody: unknown, expected: string[]): void {
  const map = (statusBody as { connectionStatus?: Record<string, { connectionState?: unknown }> } | null)?.connectionStatus;
  if (map === undefined || typeof map !== "object") {
    throw new Error("LIBRECHAT_STATUS_MISSING: /api/mcp/connection/status has no connectionStatus map (body not printed)");
  }
  for (const name of expected) {
    const state = map[name]?.connectionState;
    if (state !== "connected") {
      throw new Error(`LIBRECHAT_MCP_NOT_CONNECTED: ${name} is ${typeof state === "string" ? state : "missing"}`);
    }
  }
}

/** Counts the tools each expected server lists from /api/mcp/tools. Throws if any server lists none (review answer 0.7). */
export function toolCountsByServer(toolsBody: unknown, expected: string[]): Record<string, number> {
  const servers = (toolsBody as { servers?: Record<string, { tools?: unknown }> } | null)?.servers;
  if (servers === undefined || typeof servers !== "object") {
    throw new Error("LIBRECHAT_TOOLS_MISSING: /api/mcp/tools has no servers map (body not printed)");
  }
  const counts: Record<string, number> = {};
  for (const name of expected) {
    const tools = servers[name]?.tools;
    const n = Array.isArray(tools) ? tools.length : 0;
    if (n === 0) {
      throw new Error(`LIBRECHAT_NO_TOOLS: ${name} lists no tools`);
    }
    counts[name] = n;
  }
  return counts;
}

/** POST /api/auth/login for the seeded owner. The request body is never logged. */
export function loginRequest(baseUrl: string, email: string, password: string): { url: string; init: RequestInit } {
  return {
    url: `${baseUrl}/api/auth/login`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
  };
}

/** Reads the bearer token from a login reply. Throws a fixed message and never echoes the body. */
export function tokenFromLogin(body: unknown): string {
  const token = (body as { token?: unknown } | null)?.token;
  if (typeof token !== "string" || token === "") {
    throw new Error("LIBRECHAT_LOGIN_FAILED: the login reply has no token (body not printed)");
  }
  return token;
}
