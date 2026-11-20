/**
 * Per-run MCP credential channel for the P4 products (ADR 0006, D7). `up()` writes
 * `<harnessRoot>/.harness/<product>-run.json` with mode 0600; `down()` removes it. Only `readP4McpCredentials` reads
 * the credential. Nothing prints, logs or uploads this file or its values. The `.harness/` folder is gitignored.
 */
export declare const P4_RUN_STATE_MISSING = "P4_RUN_STATE_MISSING";
export declare const P4_RUN_STATE_INVALID = "P4_RUN_STATE_INVALID";
export interface P4RunState {
    version: 1;
    product: string;
    /** The MCP endpoint, for example http://127.0.0.1:8765/mcp. */
    mcpUrl: string;
    /**
     * The full Authorization header value the MCP client sends, for example `Bearer <key>` or
     * `Basic <base64(user:app-password)>`. The scheme depends on the product (see ADR 0006). `null` means the MCP
     * takes no credential: Penpot runs in single-user mode on loopback, and its plugin sends no token (spike, 2026-11-17).
     */
    mcpAuthorization: string | null;
    /** Fake owner identity. No password is stored here. */
    owner: {
        username: string;
        email: string;
    };
}
/** For products that always take a credential (Nextcloud, Outline, Mattermost): throws when the state has none. */
export declare function requireMcpAuthorization(creds: {
    mcpAuthorization: string | null;
}, product: string): string;
export declare function p4RunStateFile(product: string, harnessRoot?: string): string;
/** Writes the state with mode 0600, also when the file already existed. Never logs. */
export declare function writeP4RunState(file: string, state: P4RunState): void;
/** Removes the state. A missing file is not an error. Never logs. */
export declare function removeP4RunState(file: string): void;
/**
 * Reads the MCP URL and Authorization value for one product. Throws P4_RUN_STATE_MISSING when the file is absent, and
 * P4_RUN_STATE_INVALID when it is not the expected shape. Neither message contains any value from the file.
 */
export declare function readP4McpCredentials(product: string, file?: string): {
    mcpUrl: string;
    mcpAuthorization: string | null;
};
//# sourceMappingURL=p4-run-state.d.ts.map