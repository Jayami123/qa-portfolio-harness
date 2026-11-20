/**
 * The LibreChat MCP wait, as a pure function with injected I/O, so the call order is unit tested.
 *
 * LibreChat's /api/mcp/connection/status only reads per-user connections. It never creates one (VERIFIED in the
 * pinned image: getServerConnectionStatus reads appConnections/userConnections). The CI run that failed on
 * "nextcloud is disconnected" polled status forever and never opened a connection. So the order is fixed here:
 * GET /api/mcp/tools first, which opens the connections, then poll status until every configured server is connected.
 * Every server is evaluated, not only the first one.
 */
import { connectionStates } from "./librechat-diag.js";
import { toolCountsByServer } from "./librechat-seed.js";
export function summarizeStates(states) {
    return Object.entries(states)
        .map(([name, state]) => `${name}=${state}`)
        .join(", ");
}
/** Resolves with the tool count per server once every configured server is connected. Throws on timeout. */
export async function waitForMcpServers(io, opts) {
    const deadline = io.now() + opts.timeoutMs;
    let lastOpen = Number.NEGATIVE_INFINITY;
    let states = Object.fromEntries(opts.names.map((n) => [n, "not polled"]));
    let last = "no attempt";
    let notConnectedSeen = false;
    for (;;) {
        // 1. Open the connections (first pass, and again while a server is still down).
        if (io.now() - lastOpen >= opts.reopenMs) {
            lastOpen = io.now();
            try {
                await io.openTools();
            }
            catch (err) {
                last = `open tools: ${err instanceof Error ? err.message.slice(0, 160) : "unknown"}`;
            }
        }
        // 2. Poll status, and evaluate all configured servers.
        try {
            states = connectionStates(await io.readStatus(), opts.names);
            if (opts.names.every((n) => states[n] === "connected")) {
                // Read the tools again now that every connection is open, so the counts are current.
                return toolCountsByServer(await io.openTools(), opts.names);
            }
            last = `not connected: ${opts.names.filter((n) => states[n] !== "connected").join(", ")}`;
            if (!notConnectedSeen) {
                notConnectedSeen = true;
                await io.onFirstNotConnected?.(states);
            }
        }
        catch (err) {
            last = err instanceof Error ? err.message.slice(0, 160) : "unknown";
        }
        if (io.now() >= deadline) {
            break;
        }
        await io.sleep(Math.min(opts.pollMs, deadline - io.now()));
    }
    io.onTimeout(states);
    throw new Error(`Timed out waiting for LibreChat MCP servers (last: ${last}). Connection states: ${summarizeStates(states)}`);
}
//# sourceMappingURL=librechat-mcp-wait.js.map