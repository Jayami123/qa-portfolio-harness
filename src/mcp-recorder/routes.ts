/**
 * Routes for the MCP recorder (H9). A route maps a name to one upstream MCP server. LibreChat reaches the server through
 * `http://mcp-recorder:9100/<name>/...`, and the recorder forwards `/...` to the upstream origin. Pure functions, no imports.
 */
export const MCP_RECORDER_CONFIG = "MCP_RECORDER_CONFIG";
export const ROUTE_NAME = /^[a-z][a-z0-9-]{0,31}$/;

export interface RecorderRoute {
  name: string;
  /** Origin only, for example http://nextcloud-mcp:8000. The path always comes from the client. */
  origin: string;
  hostname: string;
  port: number;
  protocol: "http:" | "https:";
}

/**
 * Parses MCP_RECORDER_ROUTES: a comma list of `name=origin`. Errors never print an upstream URL, because a URL could carry
 * a credential. An upstream with user info, a path, a query or a fragment is refused.
 */
export function parseRecorderRoutes(raw: string): RecorderRoute[] {
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (items.length === 0) {
    throw new Error(`${MCP_RECORDER_CONFIG}: MCP_RECORDER_ROUTES names no route (expected name=http://host:port,...)`);
  }
  const seen = new Set<string>();
  return items.map((item) => {
    const eq = item.indexOf("=");
    if (eq <= 0) {
      throw new Error(`${MCP_RECORDER_CONFIG}: a route is name=origin (the value is not printed)`);
    }
    const name = item.slice(0, eq).trim();
    if (!ROUTE_NAME.test(name)) {
      throw new Error(`${MCP_RECORDER_CONFIG}: route name "${name}" must be lowercase letters, digits and hyphens`);
    }
    if (seen.has(name)) {
      throw new Error(`${MCP_RECORDER_CONFIG}: route "${name}" is listed twice`);
    }
    seen.add(name);
    let url: URL;
    try {
      url = new URL(item.slice(eq + 1).trim());
    } catch {
      throw new Error(`${MCP_RECORDER_CONFIG}: route "${name}" has an invalid upstream URL (value not printed)`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`${MCP_RECORDER_CONFIG}: route "${name}" must use http or https`);
    }
    if (url.username !== "" || url.password !== "") {
      throw new Error(`${MCP_RECORDER_CONFIG}: route "${name}" must not carry credentials in its URL (value not printed)`);
    }
    if (url.search !== "" || url.hash !== "" || (url.pathname !== "/" && url.pathname !== "")) {
      throw new Error(`${MCP_RECORDER_CONFIG}: route "${name}" takes an origin only, with no path, query or fragment`);
    }
    return {
      name,
      origin: url.origin,
      hostname: url.hostname,
      port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
      protocol: url.protocol,
    };
  });
}

/** Finds the route for a request path such as /nextcloud/mcp, and the path to forward (/mcp). Null when none matches. */
export function matchRoute(routes: readonly RecorderRoute[], pathname: string): { route: RecorderRoute; upstreamPath: string } | null {
  for (const route of routes) {
    if (pathname === `/${route.name}`) return { route, upstreamPath: "/" };
    if (pathname.startsWith(`/${route.name}/`)) {
      return { route, upstreamPath: pathname.slice(route.name.length + 1) };
    }
  }
  return null;
}
