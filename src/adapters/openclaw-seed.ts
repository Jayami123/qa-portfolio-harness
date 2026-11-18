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
