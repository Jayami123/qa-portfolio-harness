export interface McpWaitIo {
    /** GET /api/mcp/tools as the seeded user. Opens the per-user connections. */
    openTools(): Promise<unknown>;
    /** GET /api/mcp/connection/status. Reads the connections. */
    readStatus(): Promise<unknown>;
    /** Runs once, the first time a status poll shows any server not connected. The adapter runs the probe here. */
    onFirstNotConnected?(states: Record<string, string>): Promise<void>;
    /** Runs when the wait gives up. The adapter prints diagnostics here. */
    onTimeout(states: Record<string, string>): void;
    sleep(ms: number): Promise<void>;
    now(): number;
}
export interface McpWaitOptions {
    names: string[];
    timeoutMs: number;
    pollMs: number;
    /** Re-open the connections at this interval while any server is still not connected. */
    reopenMs: number;
}
export declare function summarizeStates(states: Record<string, string>): string;
/** Resolves with the tool count per server once every configured server is connected. Throws on timeout. */
export declare function waitForMcpServers(io: McpWaitIo, opts: McpWaitOptions): Promise<Record<string, number>>;
//# sourceMappingURL=librechat-mcp-wait.d.ts.map