// Live H6 check. Run after `npm run up -- penpot` with P4_SECOND_IDENTITY=1 and P4_PENPOT_PLUGIN=1 (the two browser tabs
// are open and the MCP plugin is connected in each). For each profile, the MCP is called with that tab's user token:
// it lists its tools, and execute_code returns the name of the file that profile opened. The check passes only when the
// two names differ and each is its own profile's file. It prints the result on stdout (the step log). No token is printed.
//
// Part 2 (H6 through LibreChat). Run it with LibreChat up on penpot only (LIBRECHAT_MCP_PRODUCTS=penpot, P4_PENPOT_PLUGIN=1)
// and LiteLLM pointed at scripts/live/approval-stub.mjs (APPROVAL_STUB_URL, default http://127.0.0.1:9099). Both checks use
// LibreChat's own API as the owner, so the call goes LibreChat -> Penpot MCP with the owner's token URL:
//   tools/list: GET /api/mcp/tools lists penpot's execute_code;
//   read-only call: a chat turn in which the stub asks LibreChat to run execute_code (penpot.currentFile.name). The tool
//   result must name the owner's file and must not name the second profile's file.
// The LibreChat part fails loudly if LibreChat is not up. It prints names, statuses and counts only.
import { loadHarness } from "../lib.mjs";
import { PENPOT_PLUGIN_FILE } from "../../dist/adapters/penpot-plugin.js";

const { getAdapter } = await loadHarness();
const STUB = process.env.APPROVAL_STUB_URL ?? "http://127.0.0.1:9099";
const PARENT = "00000000-0000-0000-0000-000000000000";
const FINAL = "Final answer after the tool result.";
// LibreChat's uaParser middleware answers "Illegal request" to a client that is not a recognized browser. Not a credential.
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function directProbe() {
  const probe = await getAdapter("penpot").probePerUserPlugin();
  console.log(
    `${probe.ok ? "ok" : "FAIL"} penpot per-user plugin: owner tab sees file=${probe.ownerFile} (matches=${probe.ownerMatches}), second tab sees file=${probe.secondFile} (matches=${probe.secondMatches}), distinct=${probe.distinct}, mcp tools owner=${probe.ownerTools} second=${probe.secondTools}`,
  );
  if (!probe.ok) return false;
  console.log(`H6 live check passed: the MCP distinguishes the two profiles through their open tabs (${probe.ownerFile} vs ${probe.secondFile}).`);
  return true;
}

async function libreChatProof() {
  const session = await getAdapter("librechat").authenticate();
  const base = session.baseUrl;
  const auth = session.authorizationHeader;
  const call = async (pathname, init = {}) => {
    const r = await fetch(`${base}${pathname}`, { ...init, headers: { "user-agent": BROWSER_UA, authorization: auth, ...(init.headers ?? {}) } });
    return { status: r.status, body: await r.json().catch(() => undefined) };
  };

  // 1. tools/list, routed through LibreChat's connection to Penpot.
  const listed = await call("/api/mcp/tools");
  const penpotTools = listed.body?.servers?.penpot?.tools;
  const list = Array.isArray(penpotTools) ? penpotTools : [];
  const executeNames = list.map((t) => String(t?.name ?? t?.function?.name ?? "")).filter((n) => n.startsWith("execute_code"));
  const listOk = executeNames.length > 0;
  console.log(`${listOk ? "ok" : "FAIL"} LibreChat tools/list: penpot lists ${list.length} tools, execute_code offered=${listOk}`);
  if (!listOk) return false;

  // 2. A read-only call, routed through LibreChat. The stub asks for execute_code; LibreChat runs it on Penpot.
  const agent = await call("/api/agents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "h6-penpot-proof",
      provider: "P4 LiteLLM",
      model: "p4-stub",
      instructions: "Use the tools you are offered.",
      tools: ["execute_code_mcp_penpot"],
    }),
  });
  if ((agent.status !== 200 && agent.status !== 201) || typeof agent.body?.id !== "string") {
    console.log(`FAIL LibreChat agent for the Penpot call was not created (HTTP ${agent.status})`);
    return false;
  }
  await fetch(`${STUB}/reset`, { method: "POST" });
  const chat = await fetch(`${base}/api/agents/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: auth, "user-agent": BROWSER_UA },
    body: JSON.stringify({
      text: "[penpot-proof] which file is open?",
      endpoint: "agents",
      agent_id: agent.body.id,
      model: "p4-stub",
      conversationId: crypto.randomUUID(),
      parentMessageId: PARENT,
      messageId: crypto.randomUUID(),
    }),
  });
  const started = await chat.json().catch(() => undefined);
  if (chat.status !== 200 || typeof started?.conversationId !== "string") {
    console.log(`FAIL the chat turn was not started (HTTP ${chat.status})`);
    return false;
  }
  // Wait for the stub's final answer, which it writes only after the tool result. The wait is bounded.
  const deadline = Date.now() + 120_000;
  let finished = false;
  while (Date.now() < deadline && !finished) {
    const m = await call(`/api/messages/${started.conversationId}`);
    const messages = Array.isArray(m.body) ? m.body : [];
    finished = messages.some((x) => !x.isCreatedByUser && !x.unfinished && JSON.stringify(x.content ?? x.text ?? "").includes(FINAL));
    if (!finished) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!finished) {
    console.log("FAIL the chat turn did not finish within 120 s");
    return false;
  }
  const stats = await (await fetch(`${STUB}/stats`)).json();
  const texts = Array.isArray(stats.toolResultTexts) ? stats.toolResultTexts : [];
  const sawOwner = texts.some((t) => t.includes(PENPOT_PLUGIN_FILE.owner));
  const sawSecond = texts.some((t) => t.includes(PENPOT_PLUGIN_FILE.second));
  const callOk = sawOwner && !sawSecond;
  console.log(
    `${callOk ? "ok" : "FAIL"} LibreChat-routed execute_code (read-only): tool results=${stats.toolResults}, owner's file seen=${sawOwner}, second profile's file seen=${sawSecond}`,
  );
  if (callOk) {
    console.log(`H6 LibreChat check passed: LibreChat lists Penpot's tools and its read-only call reaches the owner's plugin (${PENPOT_PLUGIN_FILE.owner}).`);
  }
  return callOk;
}

try {
  if (!(await directProbe())) process.exit(1);
  if (!(await libreChatProof())) process.exit(1);
} catch (error) {
  console.log(`FAIL penpot per-user plugin: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
