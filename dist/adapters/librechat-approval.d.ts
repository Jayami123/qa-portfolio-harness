/**
 * H3: LibreChat's tool-approval policy, written under `endpoints.agents.toolApproval` in librechat.yaml (pinned v0.8.9).
 * Off by default: with LIBRECHAT_TOOL_APPROVAL unset, nothing is written and the YAML is unchanged.
 *
 * Source (v0.8.9): `agentsEndpointSchema` in packages/data-provider/src/config.ts (line ~1889) holds
 * `toolApproval: toolApprovalPolicySchema`. The schema fields are `enabled`, `mode` (default | dontAsk | bypass), `allow`,
 * `deny`, `ask` (glob arrays), `reason` and `hooks`. Rules match `mcp:<server>:<tool>`; `deny` wins over every other list.
 * The example in librechat.example.yaml uses `mcp:trusted-server:read_*`, `mcp:*:delete_*` and `mcp:*:*`.
 */
export declare const LIBRECHAT_TOOL_APPROVAL_INVALID = "LIBRECHAT_TOOL_APPROVAL_INVALID";
export declare const TOOL_APPROVAL_MODES: readonly ["default", "dontAsk", "bypass"];
export type ToolApprovalMode = (typeof TOOL_APPROVAL_MODES)[number];
export interface LibreChatToolApproval {
    mode: ToolApprovalMode;
    allow: string[];
    deny: string[];
    ask: string[];
    /**
     * Offer "Always allow" on the approval card (v0.8.9 `toolApproval.allowAlways`, default false). Absent or false writes no
     * key, so the YAML is unchanged. Set only when true.
     */
    allowAlways?: boolean;
}
/** Exactly "1" turns the policy on. Unset is off. Any other value throws without echoing it. */
export declare function parseToolApprovalFlag(raw: string): boolean;
/** LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS: exactly "1" turns "Always allow" on. Unset is off. Any other value throws without echoing it. */
export declare function parseAllowAlwaysFlag(raw: string): boolean;
export declare function parseToolApprovalMode(raw: string): ToolApprovalMode;
/**
 * Splits a comma list of `mcp:<server>:<tool>` rules. `<server>` is `*` or a configured MCP server name; `<tool>` is a glob.
 * A rule that does not match the form, or names a server that is not configured, throws naming the rule (rules are not
 * secrets).
 */
export declare function parseToolApprovalRules(raw: string, servers: string[]): string[];
/**
 * The `endpoints.agents` block, one line per key. Only called when the policy is on. `allowAlways` is written as the last
 * key and only when true, so a policy without it (or with false) produces the same lines as before.
 */
export declare function toolApprovalYamlLines(policy: LibreChatToolApproval): string[];
//# sourceMappingURL=librechat-approval.d.ts.map