/** Builders and parsers for the OpenClaw seed. No I/O here, so every function is unit tested. */

/**
 * The argv that writes openclaw.json into the state volume (review answer 0.5). It runs as the image's `node` user
 * (uid 1000), with no network, and the config arrives on stdin. No root, no chown.
 */
export function openClawWriteConfigArgs(image: string, volume: string): string[] {
  return [
    "run",
    "--rm",
    "-i",
    "--network",
    "none",
    "--user",
    "1000:1000",
    "-v",
    `${volume}:/home/node/.openclaw`,
    "--entrypoint",
    "sh",
    image,
    "-c",
    "cat > /home/node/.openclaw/openclaw.json",
  ];
}

/** /readyz is ready only when the body says ready: true. */
export function readyzIsReady(body: unknown): boolean {
  return (body as { ready?: unknown } | null)?.ready === true;
}

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
export function openClawResponsesBody(task: string, tools: OpenClawClientTool[], requireTool: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = { model: "openclaw/default", input: task, stream: false };
  if (tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: "function",
      name: t.name,
      ...(t.description === undefined ? {} : { description: t.description }),
      ...(t.parameters === undefined ? {} : { parameters: t.parameters }),
    }));
    body.tool_choice = requireTool ? "required" : "auto";
  }
  return body;
}

function parseCallArguments(raw: unknown): unknown {
  if (typeof raw !== "string") {
    return raw ?? {};
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { _unparsed: true };
  }
}

/** Reads the trace from a /v1/responses body: every `function_call` output item, in order. Never echoes the body. */
export function openClawRunResult(status: number, body: unknown): OpenClawRunResult {
  const root = (body ?? {}) as { id?: unknown; output?: unknown };
  const items = Array.isArray(root.output) ? (root.output as Array<Record<string, unknown>>) : [];
  const toolCalls: OpenClawToolCall[] = [];
  const texts: string[] = [];
  for (const item of items) {
    if (item.type === "function_call" && typeof item.name === "string") {
      const callId = typeof item.call_id === "string" ? item.call_id : typeof item.id === "string" ? item.id : "";
      toolCalls.push({ callId, name: item.name, arguments: parseCallArguments(item.arguments) });
    } else if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content as Array<Record<string, unknown>>) {
        if (typeof part.text === "string") texts.push(part.text);
      }
    }
  }
  return { status, responseId: typeof root.id === "string" ? root.id : null, toolCalls, text: texts.join("") };
}

// ---- H2: seed primitive (workspace files, memory, skills, cron) and H3: approvals read ----------------------------------

/** The agent workspace in the state volume (docs/concepts/agent-workspace.md at 2026.10.33: default `~/.openclaw/workspace`). */
export const OPENCLAW_WORKSPACE_DIR = "/home/node/.openclaw/workspace";

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * A path relative to the workspace. No absolute path, no `..`, no `.`, no empty segment, no backslash, no NUL, and each
 * segment starts with a letter or digit, so the result can never leave the workspace or reach a hidden file.
 */
export function assertWorkspaceRelativePath(rel: string): string {
  if (typeof rel !== "string" || rel === "" || rel.length > 200 || rel.includes("\0") || rel.includes("\\") || rel.startsWith("/")) {
    throw new Error("OPENCLAW_SEED_PATH_INVALID: the path must be relative to the workspace (the path is not printed).");
  }
  const parts = rel.split("/");
  if (!parts.every((part) => part !== ".." && SEGMENT.test(part))) {
    throw new Error("OPENCLAW_SEED_PATH_INVALID: the path must be relative to the workspace (the path is not printed).");
  }
  return rel;
}

/** A skill name is one directory name (docs/tools/skills.md: `<workspace>/skills/<name>/SKILL.md`). */
export function assertSkillName(name: string): string {
  if (typeof name !== "string" || name.length > 64 || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new Error("OPENCLAW_SEED_NAME_INVALID: a skill name is lowercase letters, digits and hyphens (the name is not printed).");
  }
  return name;
}

/** Memory files: `MEMORY.md`, or `memory/<name>.md` (docs/concepts/memory.md). */
export function openClawMemoryPath(name: string): string {
  if (name === "MEMORY.md") {
    return name;
  }
  if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.md$/.test(name)) {
    throw new Error("OPENCLAW_SEED_NAME_INVALID: a memory file is MEMORY.md or a plain <name>.md under memory/ (the name is not printed).");
  }
  return `memory/${name}`;
}

export function openClawSkillPath(name: string): string {
  return `skills/${assertSkillName(name)}/SKILL.md`;
}

/**
 * The argv that writes one file into the workspace in the state volume. Same pattern as the config write: image's `node`
 * user (uid 1000), no network, content on stdin. The path travels as a positional parameter ($1) to `sh -c`, never
 * interpolated into the script text, so it cannot inject a shell command. Parent directories are created.
 */
export function openClawSeedFileArgs(image: string, volume: string, relPath: string): string[] {
  const rel = assertWorkspaceRelativePath(relPath);
  return [
    "run",
    "--rm",
    "-i",
    "--network",
    "none",
    "--user",
    "1000:1000",
    "-v",
    `${volume}:/home/node/.openclaw`,
    "--entrypoint",
    "sh",
    image,
    "-c",
    `set -e; f="${OPENCLAW_WORKSPACE_DIR}/$1"; mkdir -p "$(dirname "$f")"; cat > "$f"`,
    "seed",
    rel,
  ];
}

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
export function openClawCronCreateCommand(spec: OpenClawCronSpec): string[] {
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(spec.name)) {
    throw new Error("OPENCLAW_SEED_NAME_INVALID: the cron job name is not valid (the name is not printed).");
  }
  if (!/^[0-9*/,\- ]+$/.test(spec.schedule) || spec.schedule.trim().split(/\s+/).length !== 5) {
    throw new Error("OPENCLAW_SEED_CRON_INVALID: the schedule must be five cron fields (the value is not printed).");
  }
  if (spec.message.trim() === "" || spec.message.length > 2000 || spec.message.startsWith("-")) {
    throw new Error("OPENCLAW_SEED_CRON_INVALID: the message must be 1 to 2000 characters and must not start with a dash.");
  }
  return ["openclaw", "automations", "create", spec.schedule.trim(), spec.message, "--name", spec.name, "--session", "isolated"];
}

/** The commands for the H3 read primitive (docs/cli/approvals.md at 2026.10.33). */
export const OPENCLAW_APPROVALS_GET_COMMAND = ["openclaw", "approvals", "get", "--json"];
export const OPENCLAW_APPROVALS_PENDING_COMMAND = ["openclaw", "approvals", "pending", "--json"];

function parseJsonOrThrow(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // The output can hold a socket token, so no part of it goes into the message.
    throw new Error("OPENCLAW_APPROVALS_UNPARSEABLE: the command output is not JSON (the output is not printed).");
  }
}

/** Drops the `socket` object (it holds a token) from an approvals document, at any depth of the top two levels. */
function dropSocket(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(dropSocket);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (key === "socket") {
        continue;
      }
      out[key] = dropSocket(inner);
    }
    return out;
  }
  return value;
}

/** `openclaw approvals get --json`: the effective exec policy and the approvals document, with no `socket` object. */
export function parseOpenClawApprovals(text: string): Record<string, unknown> {
  const parsed = parseJsonOrThrow(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OPENCLAW_APPROVALS_UNPARSEABLE: expected a JSON object (the output is not printed).");
  }
  return dropSocket(parsed) as Record<string, unknown>;
}

/** `openclaw approvals pending --json`: a bare array or `{ approvals: [...] }`. Returns the entries, without any `socket` key. */
export function parseOpenClawPendingApprovals(text: string): Array<Record<string, unknown>> {
  const parsed = parseJsonOrThrow(text);
  const list = Array.isArray(parsed) ? parsed : (parsed as { approvals?: unknown } | null)?.approvals;
  if (!Array.isArray(list) || !list.every((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry))) {
    throw new Error("OPENCLAW_APPROVALS_UNPARSEABLE: expected an array of approvals (the output is not printed).");
  }
  return dropSocket(list) as Array<Record<string, unknown>>;
}
