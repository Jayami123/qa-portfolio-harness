/**
 * H3: LibreChat's tool-approval policy, written under `endpoints.agents.toolApproval` in librechat.yaml (pinned v0.8.9).
 * Off by default: with LIBRECHAT_TOOL_APPROVAL unset, nothing is written and the YAML is unchanged.
 *
 * Source (v0.8.9): `agentsEndpointSchema` in packages/data-provider/src/config.ts (line ~1889) holds
 * `toolApproval: toolApprovalPolicySchema`. The schema fields are `enabled`, `mode` (default | dontAsk | bypass), `allow`,
 * `deny`, `ask` (glob arrays), `reason` and `hooks`. Rules match `mcp:<server>:<tool>`; `deny` wins over every other list.
 * The example in librechat.example.yaml uses `mcp:trusted-server:read_*`, `mcp:*:delete_*` and `mcp:*:*`.
 */
export const LIBRECHAT_TOOL_APPROVAL_INVALID = "LIBRECHAT_TOOL_APPROVAL_INVALID";
export const TOOL_APPROVAL_MODES = ["default", "dontAsk", "bypass"] as const;
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
export function parseToolApprovalFlag(raw: string): boolean {
  if (raw === "") return false;
  if (raw === "1") return true;
  throw new Error(`${LIBRECHAT_TOOL_APPROVAL_INVALID}: LIBRECHAT_TOOL_APPROVAL must be exactly "1" or unset (value not printed)`);
}

/** LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS: exactly "1" turns "Always allow" on. Unset is off. Any other value throws without echoing it. */
export function parseAllowAlwaysFlag(raw: string): boolean {
  if (raw === "") return false;
  if (raw === "1") return true;
  throw new Error(`${LIBRECHAT_TOOL_APPROVAL_INVALID}: LIBRECHAT_TOOL_APPROVAL_ALLOW_ALWAYS must be exactly "1" or unset (value not printed)`);
}

export function parseToolApprovalMode(raw: string): ToolApprovalMode {
  const value = raw.trim() === "" ? "default" : raw.trim();
  if ((TOOL_APPROVAL_MODES as readonly string[]).includes(value)) return value as ToolApprovalMode;
  throw new Error(`${LIBRECHAT_TOOL_APPROVAL_INVALID}: mode must be one of ${TOOL_APPROVAL_MODES.join(", ")}`);
}

/**
 * Splits a comma list of `mcp:<server>:<tool>` rules. `<server>` is `*` or a configured MCP server name; `<tool>` is a glob.
 * A rule that does not match the form, or names a server that is not configured, throws naming the rule (rules are not
 * secrets).
 */
export function parseToolApprovalRules(raw: string, servers: string[]): string[] {
  const rules = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  for (const rule of rules) {
    const m = /^mcp:([A-Za-z0-9_*-]+):([A-Za-z0-9_*.-]+)$/.exec(rule);
    if (!m) {
      throw new Error(`${LIBRECHAT_TOOL_APPROVAL_INVALID}: "${rule}" is not in the form mcp:<server>:<tool>`);
    }
    const server = m[1] ?? "";
    if (server !== "*" && !servers.includes(server)) {
      throw new Error(`${LIBRECHAT_TOOL_APPROVAL_INVALID}: "${rule}" names server "${server}", which is not in LIBRECHAT_MCP_PRODUCTS`);
    }
  }
  return [...new Set(rules)];
}

/**
 * The `endpoints.agents` block, one line per key. Only called when the policy is on. `allowAlways` is written as the last
 * key and only when true, so a policy without it (or with false) produces the same lines as before.
 */
export function toolApprovalYamlLines(policy: LibreChatToolApproval): string[] {
  const list = (items: string[]) => `[${items.map((i) => `"${i}"`).join(", ")}]`;
  return [
    "  agents:",
    "    toolApproval:",
    "      enabled: true",
    `      mode: ${policy.mode}`,
    `      allow: ${list(policy.allow)}`,
    `      deny: ${list(policy.deny)}`,
    `      ask: ${list(policy.ask)}`,
    ...(policy.allowAlways === true ? ["      allowAlways: true"] : []),
  ];
}
