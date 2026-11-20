import { type LibreChatMcpServer } from "./librechat-env.js";
/** The LibreChat app container (compose project qa-harness-librechat, service app). */
export declare const LIBRECHAT_APP_CONTAINER = "qa-harness-librechat-app-1";
/** The MCP container behind each Part A server name (compose project and service, as the Part A files define them). */
export declare const MCP_CONTAINERS: Record<string, string>;
/** Hard stop for the streamed probe on the host. The in-container probe finishes well before this. */
export declare const PROBE_HOST_TIMEOUT_MS = 45000;
/** Every value in the env file and every string in the secrets, so a redaction pass covers them all. */
export declare function redactionValues(envText: string, secrets: Record<string, unknown>): string[];
export declare function redactText(text: string, values: string[]): string;
/**
 * Lines about MCP connections, allow lists and errors, in log order. Every [MCP][<name>] line is kept, so a per-server
 * decision such as "OAuth Required" is never cut. Of the other matching lines, only the last `max` are kept.
 */
export declare function interestingLogLines(text: string, max?: number): string[];
/** Each server's connectionState from /api/mcp/connection/status. A missing server reads "missing". */
export declare function connectionStates(statusBody: unknown, names: string[]): Record<string, string>;
/**
 * The probe that runs inside the LibreChat container. Every server is checked in parallel. Each request has a 4 s limit
 * and each DNS lookup a 3 s limit, so the whole probe ends in about 8 s. A server's line is printed as soon as its check
 * ends. A line holds the name, the host, the resolved address, the HTTP status or error code, and whether the auth
 * variable is set and non-empty. The value is never printed, and the header is sent only when the value is non-empty.
 */
export declare const PROBE_SCRIPT: string;
/** The docker exec argv for the probe. The server list holds names, URLs and env variable NAMES only. */
export declare function probeArgs(servers: LibreChatMcpServer[]): string[];
export declare function serversFor(names: string[]): LibreChatMcpServer[];
export declare function mcpContainerFor(name: string): string | undefined;
/**
 * Runs the probe on the host and prints each line as it arrives, redacted. It resolves when the probe ends, and it never
 * rejects: a probe that cannot start is printed and the wait keeps its own error.
 */
export declare function streamMcpProbe(names: string[], values: string[], log?: (line: string) => void): Promise<void>;
//# sourceMappingURL=librechat-diag.d.ts.map