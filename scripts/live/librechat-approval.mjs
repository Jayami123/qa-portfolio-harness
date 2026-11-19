// Live H3 check (run after: nextcloud, litellm with P4_STUB_API_BASE to scripts/live/approval-stub.mjs, and librechat with
//   LIBRECHAT_TOOL_APPROVAL=1, LIBRECHAT_TOOL_APPROVAL_ASK="mcp:nextcloud:nc_notes_list_notes",
//   LIBRECHAT_TOOL_APPROVAL_DENY="mcp:nextcloud:nc_notes_delete_note").
// It asserts:
//   ask-listed tool  : the run pauses (requires_action) before the tool runs, then /resume with an approve decision
//                      runs it once and the run completes;
//   deny-listed tool : the run never pauses, the tool never runs, and the note it would delete still exists.
// It prints names, statuses and counts only. Credentials are read from the run-state files and never printed.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? process.cwd();
const LC = process.env.LIBRECHAT_BASE_URL ?? "http://127.0.0.1:3080";
const NC_MCP = process.env.NEXTCLOUD_MCP_URL ?? "http://127.0.0.1:8765/mcp";
const STUB = process.env.APPROVAL_STUB_URL ?? "http://127.0.0.1:9099";
const OWNER_EMAIL = "qa-owner@p4.test";
const ASK = "nc_notes_list_notes";
const DENY = "nc_notes_delete_note";
const PARENT = "00000000-0000-0000-0000-000000000000";

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};
const check = (cond, msg) => {
  if (!cond) fail(msg);
  console.log(`ok: ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function stub(pathname, init) {
  const r = await fetch(`${STUB}${pathname}`, init);
  return r.json().catch(() => ({}));
}

/** Streamable-HTTP MCP reply: plain JSON or one SSE event. Returns the JSON-RPC message. */
async function mcpRpc(auth, method, params, id) {
  const r = await fetch(NC_MCP, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: auth },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await r.text();
  if (r.status !== 200) fail(`MCP ${method} returned HTTP ${r.status}`);
  const data = text.includes("data:") ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("") : text;
  return JSON.parse(data);
}

async function mcpTool(auth, name, args) {
  const msg = await mcpRpc(auth, "tools/call", { name, arguments: args }, crypto.randomInt(1e6));
  if (msg.error) fail(`MCP tools/call ${name} returned a JSON-RPC error (code ${msg.error.code})`);
  return msg.result?.content?.map((c) => c.text ?? "").join("\n") ?? "";
}

async function lcJson(url, init) {
  const r = await fetch(`${LC}${url}`, init);
  const body = await r.json().catch(() => undefined);
  return { status: r.status, body };
}

/** Runs the chat turn and does not wait for the SSE to end: the status poll decides what happened. */
function startChat(token, body) {
  fetch(`${LC}/api/agents/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
    .then((r) => r.body?.cancel())
    .catch(() => {});
}

async function pollStatus(token, conversationId, until, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let seenPause = false;
  let last;
  while (Date.now() < deadline) {
    const s = await lcJson(`/api/agents/chat/status/${conversationId}`, { headers: { authorization: `Bearer ${token}` } });
    last = s.body;
    if (last?.status === "requires_action") seenPause = true;
    if (until(last)) return { status: last, seenPause };
    await sleep(1000);
  }
  return { status: last, seenPause, timedOut: true };
}

const done = (s) => s && s.status !== "running" && s.status !== "requires_action";

// --- Setup ----------------------------------------------------------------------------------------------------------------
const lcSecrets = JSON.parse(fs.readFileSync(path.join(root, ".harness", "librechat", "secrets.json"), "utf8"));
const ncRun = JSON.parse(fs.readFileSync(path.join(root, ".harness", "nextcloud-run.json"), "utf8"));
const login = await lcJson("/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: OWNER_EMAIL, password: lcSecrets.ownerPassword }),
});
check(login.status === 200 && typeof login.body?.token === "string", "LibreChat login as the owner");
const token = login.body.token;

const noteText = await mcpTool(ncRun.mcpAuthorization, "nc_notes_create_note", { title: "h3 approval probe", content: "keep me", category: "h3" });
const noteId = Number(/"id"\s*:\s*(\d+)/.exec(noteText)?.[1] ?? /(\d+)/.exec(noteText)?.[1]);
check(Number.isInteger(noteId) && noteId > 0, "seeded a probe note through the Nextcloud MCP (id not printed)");

const agent = await lcJson("/api/agents", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({
    name: "h3-approval-probe",
    provider: "P4 LiteLLM",
    model: "p4-stub",
    instructions: "Use the tools you are offered.",
    tools: [`${ASK}_mcp_nextcloud`, `${DENY}_mcp_nextcloud`],
  }),
});
check(agent.status === 200 || agent.status === 201, `created the probe agent (HTTP ${agent.status})`);
const agentId = agent.body?.id;
check(typeof agentId === "string", "the probe agent has an id");

// --- Flow A: ask-listed tool pauses, then approves -----------------------------------------------------------------------
await fetch(`${STUB}/reset`, { method: "POST" });
const convA = crypto.randomUUID();
const bodyA = {
  text: "[approval-test:ask] list my notes",
  endpoint: "agents",
  agent_id: agentId,
  model: "p4-stub",
  conversationId: convA,
  parentMessageId: PARENT,
  messageId: crypto.randomUUID(),
};
startChat(token, bodyA);
const paused = await pollStatus(token, convA, (s) => s?.status === "requires_action" || done(s), 120000);
check(paused.status?.status === "requires_action", `the ask-listed run pauses for approval (status ${paused.status?.status ?? "none"})`);
const pending = paused.status.pendingAction;
check(pending && pending.payload?.type === "tool_approval", "the pause is a tool_approval with a pending action");
check(JSON.stringify(pending).includes(ASK), `the pending approval names ${ASK}`);
const before = await stub("/stats");
check(before.toolResults === 0, `no tool result reached the model while paused (toolResults ${before.toolResults})`);
const toolCallId = pending.payload?.reviews?.[0]?.tool_call_id ?? pending.payload?.tool_call_id ?? pending.payload?.toolCallId ?? pending.payload?.interrupts?.[0]?.tool_call_id;
check(typeof toolCallId === "string" && toolCallId.length > 0, "the pending action carries a tool call id");

const resumed = await lcJson("/api/agents/chat/resume", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({
    ...bodyA,
    actionId: pending.actionId,
    decisions: [{ tool_call_id: toolCallId, decision: "approve" }],
  }),
});
check(resumed.status === 200, `POST /resume accepted the approval (HTTP ${resumed.status})`);
const finishedA = await pollStatus(token, convA, (s) => done(s), 180000);
check(!finishedA.timedOut && finishedA.status?.status !== "requires_action", `the approved run finishes (status ${finishedA.status?.status ?? "none"})`);
const afterA = await stub("/stats");
check(afterA.toolResults === 1, `the approved tool ran exactly once (toolResults ${afterA.toolResults})`);
check(afterA.toolResultNames.some((n) => n.includes(ASK)), `the tool result is for ${ASK}`);

// --- Flow B: deny-listed tool never pauses and never runs ----------------------------------------------------------------
await fetch(`${STUB}/reset`, { method: "POST" });
const convB = crypto.randomUUID();
startChat(token, {
  text: `[approval-test:deny] [note:${noteId}] remove it`,
  endpoint: "agents",
  agent_id: agentId,
  model: "p4-stub",
  conversationId: convB,
  parentMessageId: PARENT,
  messageId: crypto.randomUUID(),
});
const finishedB = await pollStatus(token, convB, (s) => done(s), 180000);
check(!finishedB.seenPause, "the deny-listed run never pauses for approval");
check(!finishedB.timedOut, `the deny-listed run finishes (status ${finishedB.status?.status ?? "none"})`);
const afterB = await stub("/stats");
check(afterB.toolResultNames.some((n) => n.includes(DENY)), `the model received a result for ${DENY}`);
const denial = afterB.toolResultTexts.find((t) => t) ?? "";
console.log(`info: deny result starts with: ${JSON.stringify(denial.slice(0, 80))}`);
const stillThere = await mcpTool(ncRun.mcpAuthorization, "nc_notes_get_note", { note_id: noteId });
check(stillThere.includes("keep me"), "the note the deny-listed tool would delete still exists");

// --- Cleanup ----------------------------------------------------------------------------------------------------------------
await mcpTool(ncRun.mcpAuthorization, "nc_notes_delete_note", { note_id: noteId });
console.log("PASS: H3 live check (ask pauses and resumes; deny never pauses and never runs)");
