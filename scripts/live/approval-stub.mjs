// Fixture for the live H3 check. An OpenAI-compatible chat-completions stub, bound on the host and reached by LiteLLM
// through P4_STUB_API_BASE (http://host.docker.internal:<port>/v1). It never calls a real model.
//
// Behaviour, keyed on the last user message:
//   [approval-test:ask]     -> one tool call to nc_contacts_list_addressbooks (the ask-listed tool)
//   [approval-test:deny]    -> one tool call to nc_contacts_delete_addressbook for the book named in [addressbook:<name>]
//   last message is a tool result -> a plain final answer
// GET /stats reports how many tool results the stub has received and the names of the tools it offered.
// POST /reset clears the counters. Nothing here prints a secret; the stub holds none.
import http from "node:http";

const port = Number(process.env.APPROVAL_STUB_PORT ?? 9099);
const stats = { requests: 0, toolResults: 0, toolResultNames: [], toolResultTexts: [], offered: [] };

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p?.text === "string" ? p.text : "")).join("\n");
  return "";
}

function pickTool(tools, base) {
  return (tools ?? []).map((t) => t?.function?.name).find((n) => typeof n === "string" && n.startsWith(base));
}

function decide(body) {
  const messages = body.messages ?? [];
  const last = messages[messages.length - 1] ?? {};
  if (last.role === "tool") {
    stats.toolResults += 1;
    stats.toolResultNames.push(String(last.name ?? last.tool_call_id ?? "?"));
    stats.toolResultTexts.push(textOf(last.content).slice(0, 300));
    return { kind: "text", text: "Final answer after the tool result." };
  }
  stats.offered = (body.tools ?? []).map((t) => t?.function?.name).filter(Boolean);
  const user = [...messages].reverse().find((m) => m.role === "user");
  const text = textOf(user?.content);
  if (text.includes("[approval-test:ask]")) {
    const name = pickTool(body.tools, "nc_contacts_list_addressbooks");
    return name ? { kind: "tool", name, args: {} } : { kind: "text", text: "list tool not offered" };
  }
  if (text.includes("[approval-test:deny]")) {
    const name = pickTool(body.tools, "nc_contacts_delete_addressbook");
    const book = /\[addressbook:([A-Za-z0-9_-]+)\]/.exec(text)?.[1] ?? "none";
    return name ? { kind: "tool", name, args: { name: book } } : { kind: "text", text: "delete tool not offered" };
  }
  return { kind: "text", text: "No approval test marker in the message." };
}

function completion(model, decision) {
  const id = `chatcmpl-stub-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const toolCall = decision.kind === "tool" ? { id: `call_${Date.now()}`, type: "function", function: { name: decision.name, arguments: JSON.stringify(decision.args) } } : undefined;
  return {
    id, object: "chat.completion", created, model,
    choices: [{ index: 0, finish_reason: toolCall ? "tool_calls" : "stop", message: toolCall ? { role: "assistant", content: null, tool_calls: [toolCall] } : { role: "assistant", content: decision.text } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function sse(res, model, decision) {
  const id = `chatcmpl-stub-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  res.write(chunk({ role: "assistant" }));
  if (decision.kind === "tool") {
    res.write(chunk({ tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: "function", function: { name: decision.name, arguments: "" } }] }));
    res.write(chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(decision.args) } }] }));
    res.write(chunk({}, "tool_calls"));
  } else {
    res.write(chunk({ content: decision.text }));
    res.write(chunk({}, "stop"));
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/stats") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(stats));
  }
  if (req.method === "POST" && req.url === "/reset") {
    Object.assign(stats, { requests: 0, toolResults: 0, toolResultNames: [], toolResultTexts: [], offered: [] });
    res.writeHead(200);
    return res.end("reset");
  }
  if (req.method === "POST" && req.url?.endsWith("/chat/completions")) {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || "{}");
    stats.requests += 1;
    const decision = decide(body);
    if (body.stream) return sse(res, body.model ?? "p4-stub", decision);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(completion(body.model ?? "p4-stub", decision)));
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(port, "0.0.0.0", () => console.log(`approval stub listening on ${port}`));
