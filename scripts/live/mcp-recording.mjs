// Live H9 check. Run after: nextcloud (with its MCP run state), litellm, and librechat started with
// LIBRECHAT_MCP_RECORDING=1 (see src/adapters/librechat-recording.ts). LibreChat's MCP connections go through the recorder.
// It reads the recorder's container log (`docker logs`) and asserts:
//   1. the recorder container is running and healthy;
//   2. every configured MCP server has request records, and each records an `initialize` answered with HTTP 200;
//   3. the recorder logged no forwarding error (kind "error");
//   4. no Authorization or Cookie value is in the log (the header records read "[REDACTED]" or are absent);
//   5. the leak check: no secret value from the env file or the secrets file appears anywhere in the log.
// It prints names, counts and statuses only. On a pass it copies the redacted log to evidence/mcp-recording.jsonl. Secret values are read from the saved files and never printed.
// Usage: node scripts/live/mcp-recording.mjs [harness-root]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? process.cwd());
const CONTAINER = "qa-harness-librechat-mcp-recorder-1";
const configured = (process.env.LIBRECHAT_MCP_PRODUCTS ?? "nextcloud,outline,twenty,penpot,mattermost")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s !== "");

const { countLeakedValues } = await import(pathToFileURL(path.join(root, "dist", "mcp-recorder", "redact.js")).href);
const { redactionValues } = await import(pathToFileURL(path.join(root, "dist", "adapters", "librechat-diag.js")).href);

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? "ok" : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};

const health = execFileSync("docker", ["inspect", "-f", "{{.State.Health.Status}}", CONTAINER], { encoding: "utf8" }).trim();
check(health === "healthy", `recorder container ${CONTAINER} is healthy (status: ${health})`);

const logText = execFileSync("docker", ["logs", CONTAINER], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
const records = logText
  .split("\n")
  .filter((l) => l.startsWith("{"))
  .map((l) => JSON.parse(l));
const requests = records.filter((r) => r.kind === "request");
const responses = records.filter((r) => r.kind === "response");
const errors = records.filter((r) => r.kind === "error");
console.log(`records: ${requests.length} requests, ${responses.length} responses, ${errors.length} errors`);

for (const server of configured) {
  const mine = requests.filter((r) => r.server === server);
  check(mine.length > 0, `${server}: request records exist (${mine.length})`);
  const init = mine.find((r) => /"method"\s*:\s*"initialize"/.test(r.body ?? ""));
  const initResponse = init && responses.find((r) => r.id === init.id);
  check(initResponse?.status === 200, `${server}: initialize recorded and answered with HTTP ${initResponse?.status ?? "none"}`);
}

check(errors.length === 0, `no forwarding errors recorded (${errors.length})`);

const sensitiveHeaderValues = records.flatMap((r) =>
  Object.entries(r.headers ?? {})
    .filter(([name]) => /^(authorization|cookie|set-cookie|proxy-authorization)$/.test(name))
    .map(([, value]) => value),
);
check(sensitiveHeaderValues.every((v) => v === "[REDACTED]"), `every authorization, cookie and set-cookie header is [REDACTED] (${sensitiveHeaderValues.length} seen)`);

const dir = path.join(root, ".harness", "librechat");
const envText = fs.readFileSync(path.join(dir, "librechat.env"), "utf8");
const secrets = JSON.parse(fs.readFileSync(path.join(dir, "secrets.json"), "utf8"));
const values = redactionValues(envText, secrets);
const leaked = countLeakedValues(logText, values);
check(leaked === 0, `leak check: no secret value in the recording (${values.length} values checked, ${leaked} found)`);

if (failures.length > 0) {
  console.log(`H9 live check FAILED: ${failures.length} check(s) failed`);
  process.exit(1);
}
// The copy is written only after every check passed, so an uploaded evidence file never holds a leak.
fs.mkdirSync(path.join(root, "evidence"), { recursive: true });
fs.writeFileSync(path.join(root, "evidence", "mcp-recording.jsonl"), logText, { mode: 0o644 });
console.log("H9 live check passed; redacted recording copied to evidence/mcp-recording.jsonl");
