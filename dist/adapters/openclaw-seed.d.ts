/** Builders and parsers for the OpenClaw seed. No I/O here, so every function is unit tested. */
/**
 * The argv that writes openclaw.json into the state volume (review answer 0.5). It runs as the image's `node` user
 * (uid 1000), with no network, and the config arrives on stdin. No root, no chown.
 */
export declare function openClawWriteConfigArgs(image: string, volume: string): string[];
/** /readyz is ready only when the body says ready: true. */
export declare function readyzIsReady(body: unknown): boolean;
/** A client-side function tool offered to the agent. Its call comes back as a function_call item, never executed by the gateway. */
export interface OpenClawClientTool {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
}
/** One tool call from a run: the trace entry. `arguments` is the parsed JSON, or { _unparsed: true } when it is not JSON. */
export interface OpenClawToolCall {
    callId: string;
    name: string;
    arguments: unknown;
}
export interface OpenClawRunResult {
    status: number;
    responseId: string | null;
    /** Tool calls in output order. This is the trace. */
    toolCalls: OpenClawToolCall[];
    /** Assistant text, joined. For logging only; tests must not assert on it. */
    text: string;
}
/**
 * The body for POST /v1/responses (docs/gateway/openresponses-http-api.md at 2026.10.33). Stateless, non-streaming, the
 * default agent. When tools are offered and `requireTool` is true, tool_choice is "required", so a turn with no matching
 * client tool call fails (502) instead of passing quietly.
 */
export declare function openClawResponsesBody(task: string, tools: OpenClawClientTool[], requireTool: boolean): Record<string, unknown>;
/** Reads the trace from a /v1/responses body: every `function_call` output item, in order. Never echoes the body. */
export declare function openClawRunResult(status: number, body: unknown): OpenClawRunResult;
/** The agent workspace in the state volume (docs/concepts/agent-workspace.md at 2026.10.33: default `~/.openclaw/workspace`). */
export declare const OPENCLAW_WORKSPACE_DIR = "/home/node/.openclaw/workspace";
/**
 * A path relative to the workspace. No absolute path, no `..`, no `.`, no empty segment, no backslash, no NUL, and each
 * segment starts with a letter or digit, so the result can never leave the workspace or reach a hidden file.
 */
export declare function assertWorkspaceRelativePath(rel: string): string;
/** A skill name is one directory name (docs/tools/skills.md: `<workspace>/skills/<name>/SKILL.md`). */
export declare function assertSkillName(name: string): string;
/** Memory files: `MEMORY.md`, or `memory/<name>.md` (docs/concepts/memory.md). */
export declare function openClawMemoryPath(name: string): string;
export declare function openClawSkillPath(name: string): string;
/**
 * The argv that writes one file into the workspace in the state volume. Same pattern as the config write: image's `node`
 * user (uid 1000), no network, content on stdin. The path travels as a positional parameter ($1) to `sh -c`, never
 * interpolated into the script text, so it cannot inject a shell command. Parent directories are created.
 */
export declare function openClawSeedFileArgs(image: string, volume: string, relPath: string): string[];
export interface OpenClawCronSpec {
    /** A job name: letters, digits, space, hyphen, underscore, dot. */
    name: string;
    /** A five-field cron expression. */
    schedule: string;
    /** The message the job sends to the agent. */
    message: string;
}
/**
 * The argv for `openclaw automations create "<cron>" "<message>" --name <name> --session isolated`, run inside the gateway
 * container (docs/automation/cron-jobs/managing-jobs.md at 2026.10.33). Every value is its own argv entry.
 */
export declare function openClawCronCreateCommand(spec: OpenClawCronSpec): string[];
/** The commands for the H3 read primitive (docs/cli/approvals.md at 2026.10.33). */
export declare const OPENCLAW_APPROVALS_GET_COMMAND: string[];
export declare const OPENCLAW_APPROVALS_PENDING_COMMAND: string[];
/** `openclaw approvals get --json`: the effective exec policy and the approvals document, with no `socket` object. */
export declare function parseOpenClawApprovals(text: string): Record<string, unknown>;
/** `openclaw approvals pending --json`: a bare array or `{ approvals: [...] }`. Returns the entries, without any `socket` key. */
export declare function parseOpenClawPendingApprovals(text: string): Array<Record<string, unknown>>;
//# sourceMappingURL=openclaw-seed.d.ts.map