/**
 * Routes for the MCP recorder (H9). A route maps a name to one upstream MCP server. LibreChat reaches the server through
 * `http://mcp-recorder:9100/<name>/...`, and the recorder forwards `/...` to the upstream origin. Pure functions, no imports.
 */
export declare const MCP_RECORDER_CONFIG = "MCP_RECORDER_CONFIG";
export declare const ROUTE_NAME: RegExp;
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
export declare function parseRecorderRoutes(raw: string): RecorderRoute[];
/** Finds the route for a request path such as /nextcloud/mcp, and the path to forward (/mcp). Null when none matches. */
export declare function matchRoute(routes: readonly RecorderRoute[], pathname: string): {
    route: RecorderRoute;
    upstreamPath: string;
} | null;
//# sourceMappingURL=routes.d.ts.map